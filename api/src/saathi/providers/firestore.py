"""Firestore client and data repository."""

import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
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


def _check_path(path: str) -> None:
    """An empty segment (a missing household id) would be a 400 from Firestore. Refuse it here."""
    if not path or any(part == "" for part in path.split("/")):
        raise ValueError(f"Malformed Firestore path: {path!r}")


class FirestoreRepository:
    def __init__(self, client: Optional[firestore.Client] = None):
        self._settings = load_settings()
        self._client = client
        self._fallback_store: dict[str, dict] = {
            "households": {},
            "desks": {},
            "family_codes": {},
        }
        # Generic documents by path ("households/h/sessions/s") when Firestore is unreachable.
        self._docs: dict[str, dict] = {}
        self._use_fallback = False
        # Desks are read on every call start; keep them in memory for a short time.
        self._desk_cache: dict[str, tuple[float, Desk]] = {}

    def _fall_back(self, exc: Exception) -> None:
        """Local runs switch to the in-memory store. On Cloud Run the error surfaces instead: one bad call must not
        turn the whole process into a store that answers "saved" and keeps nothing."""
        if os.environ.get("K_SERVICE"):
            raise exc
        self._use_fallback = True

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
                self._fall_back(exc)
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
                self._fall_back(exc)
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
                self._fall_back(exc)
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
                self._fall_back(exc)
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
                self._fall_back(exc)
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
                self._fall_back(exc)
        data = self._fallback_store["family_codes"].get(norm)
        return FamilyLinkRecord(**data) if data else None

    def household_family_codes(self, household_id: str) -> list[FamilyLinkRecord]:
        """Every code made for this household, newest first."""
        client = self.client
        rows: list[dict] = []
        if client and not self._use_fallback:
            try:
                for doc in client.collection("family_codes").where(filter=FieldFilter("household_id", "==", household_id)).stream():
                    rows.append(doc.to_dict() or {})
            except GoogleAPICallError as exc:
                logger.error("Firestore household_family_codes error: %s; falling back to in-memory", exc)
                self._fall_back(exc)
        if not rows:
            rows = [r for r in self._fallback_store["family_codes"].values() if r.get("household_id") == household_id]
        records = [FamilyLinkRecord(**r) for r in rows]
        return sorted(records, key=lambda r: r.created_at, reverse=True)

    def revoke_family_codes(self, household_id: str, keep: str = "") -> None:
        """A new code replaces the old ones, so a code the family stopped using cannot be used to join."""
        for record in self.household_family_codes(household_id):
            if record.code == keep:
                continue
            client = self.client
            if client and not self._use_fallback:
                try:
                    client.collection("family_codes").document(record.code).delete()
                except GoogleAPICallError as exc:
                    logger.error("Firestore revoke_family_codes error: %s", exc)
            self._fallback_store["family_codes"].pop(record.code, None)

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
                self._fall_back(exc)
        self._fallback_store["family_codes"][record.code] = record.model_dump()
        return record


    # Generic documents. Paths are "collection/doc/collection/doc...". Falls back to memory offline.
    def doc_get(self, path: str) -> Optional[dict]:
        _check_path(path)
        client = self.client
        if client and not self._use_fallback:
            try:
                doc = client.document(path).get()
                return doc.to_dict() if doc.exists else None
            except GoogleAPICallError as exc:
                logger.error("Firestore doc_get %s: %s; falling back to in-memory", path, exc)
                self._fall_back(exc)
        data = self._docs.get(path)
        return dict(data) if data is not None else None

    def doc_set(self, path: str, data: dict, merge: bool = True) -> None:
        _check_path(path)
        client = self.client
        if client and not self._use_fallback:
            try:
                client.document(path).set(data, merge=merge)
                return
            except GoogleAPICallError as exc:
                logger.error("Firestore doc_set %s: %s; falling back to in-memory", path, exc)
                self._fall_back(exc)
        current = self._docs.get(path, {}) if merge else {}
        self._docs[path] = {**current, **data}

    def doc_delete(self, path: str) -> None:
        _check_path(path)
        client = self.client
        if client and not self._use_fallback:
            try:
                client.document(path).delete()
                return
            except GoogleAPICallError as exc:
                logger.error("Firestore doc_delete %s: %s", path, exc)
                self._fall_back(exc)
        self._docs.pop(path, None)

    def col_list(self, path: str, limit: int = 100) -> list[dict]:
        """Documents of one collection, each with its id under "_id"."""
        _check_path(path)
        client = self.client
        if client and not self._use_fallback:
            try:
                rows = []
                for doc in client.collection(path).limit(limit).stream():
                    row = doc.to_dict() or {}
                    row["_id"] = doc.id
                    rows.append(row)
                return rows
            except GoogleAPICallError as exc:
                logger.error("Firestore col_list %s: %s; falling back to in-memory", path, exc)
                self._fall_back(exc)
        prefix = path.rstrip("/") + "/"
        rows = []
        for key, value in self._docs.items():
            if key.startswith(prefix) and "/" not in key[len(prefix):]:
                rows.append({**value, "_id": key[len(prefix):]})
        return rows[:limit]

    def list_doc_ids(self, path: str) -> list[str]:
        """Ids of every document in a collection, including ones that only have subcollections."""
        client = self.client
        if client and not self._use_fallback:
            try:
                return [ref.id for ref in client.collection(path).list_documents()]
            except GoogleAPICallError as exc:
                logger.error("Firestore list_doc_ids %s: %s; falling back to in-memory", path, exc)
                self._fall_back(exc)
        prefix = path.rstrip("/") + "/"
        ids = {key[len(prefix):].split("/", 1)[0] for key in self._docs if key.startswith(prefix)}
        ids |= set(self._fallback_store["desks"].keys()) if path == "households" else set()
        return sorted(ids)

    def increment(self, path: str, field: str, amount: float) -> float:
        """Add to a numeric field and return the new total."""
        client = self.client
        if client and not self._use_fallback:
            try:
                ref = client.document(path)
                ref.set({field: firestore.Increment(amount)}, merge=True)
                return float((ref.get().to_dict() or {}).get(field, amount))
            except GoogleAPICallError as exc:
                logger.error("Firestore increment %s: %s; falling back to in-memory", path, exc)
                self._fall_back(exc)
        row = self._docs.setdefault(path, {})
        row[field] = float(row.get(field, 0)) + amount
        return row[field]


# Global repository singleton
_repo: Optional[FirestoreRepository] = None


def get_repository() -> FirestoreRepository:
    global _repo
    if _repo is None:
        _repo = FirestoreRepository()
    return _repo
