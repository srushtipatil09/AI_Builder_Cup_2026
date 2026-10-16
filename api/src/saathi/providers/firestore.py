"""Firestore client and data repository."""

import logging
import os
import re
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
# The shared demo desk is edited from several browsers and served by several instances, so it is always read fresh: a
# copy kept on another instance would show an edit as undone. It costs one read per open page per poll, which is small.
DEMO_DESK_CACHE_SECONDS = 0

# One small document lists every household's check-in and reminder times, so the minute tick reads one document
# instead of one desk per household. save_desk keeps it current.
SCHEDULE_INDEX = "_schedule/index"


def schedule_key(household_id: str) -> str:
    return "h_" + re.sub(r"[^A-Za-z0-9_-]", "_", household_id)


def schedule_entry(household_id: str, desk: Desk) -> dict:
    return {
        "id": household_id,
        "checkIn": desk.profile.checkIn or "",
        "times": sorted({m.time for m in desk.medicines if m.time}),
    }

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


def _matches(have, op: str, want) -> bool:
    if have is None:
        return False
    if op == "in":
        return have in want
    if op == "<":
        return have < want
    if op == "<=":
        return have <= want
    if op == ">":
        return have > want
    if op == ">=":
        return have >= want
    return have == want


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
        self._schedule_seen: dict[str, dict] = {}

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
    def get_desk(self, household_id: str, fresh: bool = False) -> Optional[Desk]:
        hit = None if fresh else self._desk_cache.get(household_id)
        # The shared demo accounts are edited by many people on several instances: keep their copy only briefly.
        ttl = DEMO_DESK_CACHE_SECONDS if household_id.startswith("demo-") else DESK_CACHE_SECONDS
        if hit and time.monotonic() - hit[0] < ttl:
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
                self.note_schedule(household_id, desk)
                return
            except GoogleAPICallError as exc:
                logger.error("Firestore save_desk error: %s; falling back to in-memory", exc)
                self._fall_back(exc)
        self._fallback_store["desks"][household_id] = desk.model_dump()
        self.note_schedule(household_id, desk)

    def note_schedule(self, household_id: str, desk: Desk, known: Optional[dict] = None) -> None:
        """Keep this household's times in the schedule index. Writes only when they changed, and never fails a save."""
        entry = schedule_entry(household_id, desk)
        if (known if known is not None else self._schedule_seen.get(household_id)) == entry:
            self._schedule_seen[household_id] = entry
            return
        try:
            self.doc_set(SCHEDULE_INDEX, {schedule_key(household_id): entry})
            self._schedule_seen[household_id] = entry
        except Exception as exc:
            self._schedule_seen.pop(household_id, None)
            logger.warning("Schedule index not updated for %s (%s); the hourly check repairs it", household_id, exc)

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

    def col_query(
        self,
        path: str,
        field: Optional[str] = None,
        op: str = "==",
        value=None,
        order_by: Optional[str] = None,
        descending: bool = False,
        limit: int = 100,
    ) -> list[dict]:
        """One filter (== or in) and/or one ordering, so a read costs only the documents it returns.

        Firestore bills a read for every document returned. A list of the whole collection, repeated every few
        seconds by an open page, is what used up the free daily quota. Each row carries its id under "_id".
        """
        _check_path(path)
        client = self.client
        if client and not self._use_fallback:
            try:
                query = client.collection(path)
                if field:
                    query = query.where(filter=FieldFilter(field, op, value))
                if order_by:
                    query = query.order_by(
                        order_by, direction=firestore.Query.DESCENDING if descending else firestore.Query.ASCENDING
                    )
                rows = []
                for doc in query.limit(limit).stream():
                    row = doc.to_dict() or {}
                    row["_id"] = doc.id
                    rows.append(row)
                return rows
            except GoogleAPICallError as exc:
                logger.error("Firestore col_query %s: %s; falling back to in-memory", path, exc)
                self._fall_back(exc)
        rows = self._memory_rows(path)
        if field:
            rows = [r for r in rows if _matches(r.get(field), op, value)]
        if order_by:
            rows = sorted((r for r in rows if r.get(order_by) is not None), key=lambda r: r[order_by], reverse=descending)
        return rows[:limit]

    def col_count(self, path: str, order_by: Optional[str] = None) -> int:
        """How many documents a collection holds (only those that have `order_by`, when given). Billed as one read
        per thousand entries, not per document."""
        _check_path(path)
        client = self.client
        if client and not self._use_fallback:
            try:
                query = client.collection(path)
                if order_by:
                    query = query.order_by(order_by)
                return int(query.count().get()[0][0].value)
            except GoogleAPICallError as exc:
                logger.error("Firestore col_count %s: %s; falling back to in-memory", path, exc)
                self._fall_back(exc)
        return len([r for r in self._memory_rows(path) if not order_by or r.get(order_by) is not None])

    def _memory_rows(self, path: str) -> list[dict]:
        prefix = path.rstrip("/") + "/"
        return [
            {**value, "_id": key[len(prefix):]}
            for key, value in self._docs.items()
            if key.startswith(prefix) and "/" not in key[len(prefix):]
        ]

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
        """Add to a numeric field. One write; the new total is not read back (nothing used it, and a read costs quota)."""
        client = self.client
        if client and not self._use_fallback:
            try:
                client.document(path).set({field: firestore.Increment(amount)}, merge=True)
                return amount
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
