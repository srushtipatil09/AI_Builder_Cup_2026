"""Firestore client and data repository."""

import logging
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

from google.cloud import firestore
from google.api_core.exceptions import GoogleAPICallError

from saathi.config import load_settings
from saathi.contracts.desk import Desk, Memory
from saathi.contracts.identity import FamilyLinkRecord, HouseholdRecord

logger = logging.getLogger(__name__)

DESK_CACHE_SECONDS = 120

# Code alphabet avoiding lookalikes (0/O, 1/I/L)
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def make_family_code() -> str:
    """Generate 6-character family code like KMR-4F7."""
    part1 = "".join(secrets.choice(ALPHABET) for _ in range(3))
    part2 = "".join(secrets.choice(ALPHABET) for _ in range(3))
    return f"{part1}-{part2}"


def normalize_code(code: str) -> str:
    clean = "".join(c for c in code.upper() if c.isalnum())
    if len(clean) > 3:
        return f"{clean[:3]}-{clean[3:6]}"
    return clean


class FirestoreRepository:
    def __init__(self, client: Optional[firestore.Client] = None):
        self._settings = load_settings()
        self._client = client
        self._fallback_store: dict[str, dict] = {
            "households": {},
            "desks": {},
            "family_codes": {},
        }
        self._use_fallback = False
        # Desks are read on every call start; keep them in memory for a short time.
        self._desk_cache: dict[str, tuple[float, Desk]] = {}

    @property
    def client(self) -> Optional[firestore.Client]:
        if self._client is None and not self._use_fallback:
            project = self._settings.firebase_project_id or self._settings.google_cloud_project
            if project:
                try:
                    self._client = firestore.Client(project=project)
                except Exception as exc:
                    logger.warning("Could not connect to Firestore (%s); using in-memory store for local testing", exc)
                    self._use_fallback = True
            else:
                self._use_fallback = True
        return self._client

    # Household methods
    def get_household(self, household_id: str) -> Optional[HouseholdRecord]:
        client = self.client
        if client and not self._use_fallback:
            try:
                doc = client.collection("households").document(household_id).get()
                if doc.exists:
                    return HouseholdRecord(**doc.to_dict())
            except GoogleAPICallError as exc:
                logger.error("Firestore get_household error: %s; falling back to in-memory", exc)
                self._use_fallback = True
        data = self._fallback_store["households"].get(household_id)
        return HouseholdRecord(**data) if data else None

    def save_household(self, household: HouseholdRecord) -> None:
        client = self.client
        if client and not self._use_fallback:
            try:
                client.collection("households").document(household.id).set(household.model_dump())
                return
            except GoogleAPICallError as exc:
                logger.error("Firestore save_household error: %s; falling back to in-memory", exc)
                self._use_fallback = True
        self._fallback_store["households"][household.id] = household.model_dump()

    # Desk methods
    def get_desk(self, household_id: str) -> Optional[Desk]:
        hit = self._desk_cache.get(household_id)
        if hit and time.monotonic() - hit[0] < DESK_CACHE_SECONDS:
            return hit[1]
        desk = self._load_desk(household_id)
        if desk:
            self._desk_cache[household_id] = (time.monotonic(), desk)
        return desk

    def _load_desk(self, household_id: str) -> Optional[Desk]:
        client = self.client
        if client and not self._use_fallback:
            try:
                doc = client.collection("households").document(household_id).collection("desk").document("current").get()
                if doc.exists:
                    return Desk(**doc.to_dict())
            except GoogleAPICallError as exc:
                logger.error("Firestore get_desk error: %s; falling back to in-memory", exc)
                self._use_fallback = True
        data = self._fallback_store["desks"].get(household_id)
        return Desk(**data) if data else None

    def save_desk(self, household_id: str, desk: Desk) -> None:
        self._desk_cache[household_id] = (time.monotonic(), desk)
        client = self.client
        if client and not self._use_fallback:
            try:
                client.collection("households").document(household_id).collection("desk").document("current").set(desk.model_dump())
                return
            except GoogleAPICallError as exc:
                logger.error("Firestore save_desk error: %s; falling back to in-memory", exc)
                self._use_fallback = True
        self._fallback_store["desks"][household_id] = desk.model_dump()

    # Family pairing codes
    def create_family_code(self, household_id: str, caretaker_name: str = "", parent_name: str = "") -> FamilyLinkRecord:
        code = make_family_code()
        record = FamilyLinkRecord(
            code=code,
            household_id=household_id,
            caretaker_name=caretaker_name,
            parent_name=parent_name,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        client = self.client
        if client and not self._use_fallback:
            try:
                client.collection("family_codes").document(code).set(record.model_dump())
                return record
            except GoogleAPICallError as exc:
                logger.error("Firestore create_family_code error: %s; falling back to in-memory", exc)
                self._use_fallback = True
        self._fallback_store["family_codes"][code] = record.model_dump()
        return record

    def find_family_code(self, code: str) -> Optional[FamilyLinkRecord]:
        norm = normalize_code(code)
        client = self.client
        if client and not self._use_fallback:
            try:
                doc = client.collection("family_codes").document(norm).get()
                if doc.exists:
                    return FamilyLinkRecord(**doc.to_dict())
            except GoogleAPICallError as exc:
                logger.error("Firestore find_family_code error: %s; falling back to in-memory", exc)
                self._use_fallback = True
        data = self._fallback_store["family_codes"].get(norm)
        return FamilyLinkRecord(**data) if data else None

    def mark_family_code_joined(self, code: str, joined_name: str) -> Optional[FamilyLinkRecord]:
        record = self.find_family_code(code)
        if not record:
            return None
        record.joined_at = datetime.now(timezone.utc).isoformat()
        record.joined_name = joined_name
        client = self.client
        if client and not self._use_fallback:
            try:
                client.collection("family_codes").document(record.code).update(record.model_dump())
                return record
            except GoogleAPICallError as exc:
                logger.error("Firestore mark_family_code_joined error: %s; falling back to in-memory", exc)
                self._use_fallback = True
        self._fallback_store["family_codes"][record.code] = record.model_dump()
        return record


# Global repository singleton
_repo: Optional[FirestoreRepository] = None


def get_repository() -> FirestoreRepository:
    global _repo
    if _repo is None:
        _repo = FirestoreRepository()
    return _repo
