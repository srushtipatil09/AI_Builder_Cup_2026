"""Photos and documents kept for the parent: profile photo, prescriptions, bills, identity proofs.

Objects live in one Cloud Storage bucket under this layout:

    <caretaker|person>/<public|private>/<user-id>/<category>/<name>-<10 random characters>.<ext>

The first folder says who uploaded (a caretaker, or the person themself), the second says who may read it, the third
is the uploader's account id, the fourth is the category. A private object is never read straight from the bucket. A signed-in member of the
household asks this API for a link; the link carries an expiry and a signature and stops working after 30 minutes.
A public object (a photo the family chose to share) is read without sign-in through /api/v1/files/public/<path>,
which serves only paths under caretaker/public/ and person/public/. The bucket itself stays private: Google does not
allow IAM conditions on allUsers grants, so folder-level public access is enforced here, not in bucket IAM. Metadata is in Firestore under households/<id>/files.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import string
import time
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from google.cloud import storage
from pydantic import BaseModel

from saathi.auth.firebase import ensure_household_access, get_current_actor, is_demo_household
from saathi.config import load_settings
from saathi.contracts.identity import ActorContext
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/households/{household_id}/files", tags=["files"])
link_router = APIRouter(prefix="/api/v1/files", tags=["files"])

MAX_BYTES = 8 * 1024 * 1024
MAX_FILES = 60
LINK_SECONDS = 30 * 60
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}
# One entry per category: what the dashboard shows, and whether files in it may ever be public.
# Medical and identity records are always stored under the private folder, whatever the request says.
CATEGORIES: dict[str, dict] = {
    "profile_photo": {"title": "Profile photo", "hint": "One clear, recent photo of the parent. Replaces the old one.", "private_only": False, "single": True},
    "family_photos": {"title": "Family photos", "hint": "Photos of family and friends that Saathi's family may want to recognise.", "private_only": False},
    "prescriptions": {"title": "Prescriptions", "hint": "Doctor's prescriptions, copied exactly as written.", "private_only": True},
    "medical_reports": {"title": "Medical reports", "hint": "Lab results, discharge summaries, scans.", "private_only": True},
    "medical_bills": {"title": "Medical bills", "hint": "Bills and receipts from clinics, pharmacies, and hospitals.", "private_only": True},
    "medicine_photos": {"title": "Medicine strips", "hint": "A photo of each strip or bottle, so the family can check the name.", "private_only": True},
    "identity_proofs": {"title": "Identity proofs", "hint": "Aadhaar, PAN, voter ID, or any ID that identifies the parent.", "private_only": True},
    "insurance": {"title": "Insurance and benefits", "hint": "Health insurance cards, policies, pension papers.", "private_only": True},
    "other": {"title": "Other", "hint": "Anything else the family wants to keep.", "private_only": False},
}
Category = Literal[
    "profile_photo", "family_photos", "prescriptions", "medical_reports", "medical_bills",
    "medicine_photos", "identity_proofs", "insurance", "other",
]
Visibility = Literal["public", "private"]
ALWAYS_PRIVATE = {k for k, v in CATEGORIES.items() if v["private_only"]}
_ALPHABET = string.ascii_lowercase + string.digits


class FileRecord(BaseModel):
    id: str
    category: Category
    name: str
    label: str = ""
    contentType: str
    size: int
    uploadedBy: str = ""
    createdAt: str
    visibility: Visibility = "private"
    path: str = ""
    # Set only for public files: a direct link that needs no sign-in.
    publicUrl: str = ""


class FileLink(BaseModel):
    url: str
    expiresAt: Optional[str] = None
    expiresInSeconds: Optional[int] = None


def _bucket_name() -> str:
    settings = load_settings()
    return settings.uploads_bucket or f"{settings.google_cloud_project}-media"


@lru_cache(maxsize=1)
def _bucket() -> storage.Bucket:
    settings = load_settings()
    return storage.Client(project=settings.google_cloud_project).bucket(_bucket_name())


@lru_cache(maxsize=1)
def _secret() -> bytes:
    configured = load_settings().link_signing_secret
    if configured:
        return configured.encode()
    # No secret configured: links last only until this process restarts.
    logger.warning("LINK_SIGNING_SECRET is empty; file links will stop working when the API restarts.")
    return secrets.token_bytes(32)


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^\w.\- ]+", "", name).strip()
    return cleaned[:80] or "file"


def object_path(owner: str, visibility: str, user_id: str, category: str, name: str, content_type: str) -> str:
    """<caretaker|person>/<public|private>/<user-id>/<category>/<name>-<10 random chars>.<ext>"""
    stem = re.sub(r"[^a-z0-9]+", "-", name.rsplit(".", 1)[0].lower()).strip("-")[:40] or "file"
    suffix = "".join(secrets.choice(_ALPHABET) for _ in range(10))
    uid = re.sub(r"[^A-Za-z0-9_-]", "", user_id) or "anonymous"
    return f"{owner}/{visibility}/{uid}/{category}/{stem}-{suffix}.{EXTENSIONS[content_type]}"


def _owner_folder(actor: ActorContext) -> str:
    return "person" if actor.role == "parent" else "caretaker"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(path: str, content_type: str, seconds: int = LINK_SECONDS, now: Optional[float] = None) -> tuple[str, int]:
    """A link key: the object path and an expiry, signed. Returns (token, expiry as a unix time)."""
    expires = int((now if now is not None else time.time()) + seconds)
    payload = _b64(json.dumps({"p": path, "t": content_type, "e": expires}, separators=(",", ":")).encode())
    signature = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}", expires


def read_token(token: str, now: Optional[float] = None) -> dict:
    """The payload of a valid, unexpired link key. Raises 403 otherwise."""
    try:
        payload, signature = token.split(".", 1)
        expected = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        data = json.loads(_unb64(payload))
        if data["e"] < (now if now is not None else time.time()):
            raise ValueError("expired")
        return data
    except Exception:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This link has expired or is not valid.")


def _guard(actor: ActorContext, household_id: str) -> None:
    if is_demo_household(household_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Uploads are off in the demo household.")
    ensure_household_access(actor, household_id)


@router.get("", response_model=list[FileRecord])
def list_files(household_id: str, actor: ActorContext = Depends(get_current_actor)) -> list[FileRecord]:
    if is_demo_household(household_id):
        return []
    ensure_household_access(actor, household_id)
    rows = get_repository().col_list(f"households/{household_id}/files", limit=MAX_FILES)
    records = [FileRecord(**r) for r in rows]
    return sorted(records, key=lambda r: r.createdAt, reverse=True)


@router.post("", response_model=FileRecord)
async def upload_file(
    household_id: str,
    request: Request,
    category: Category = Query("other"),
    name: str = Query("file"),
    label: str = Query("", max_length=80),
    visibility: Visibility = Query("private"),
    actor: ActorContext = Depends(get_current_actor),
) -> FileRecord:
    """The request body is the raw file. Its Content-Type must be an image or a PDF."""
    _guard(actor, household_id)
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a JPEG, PNG or WebP image, or a PDF.")
    declared = int(request.headers.get("content-length") or 0)
    if declared > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Files can be up to 8 MB.")
    data = await request.body()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Files can be up to 8 MB.")

    repo = get_repository()
    existing = repo.col_list(f"households/{household_id}/files", limit=MAX_FILES + 1)
    if len(existing) >= MAX_FILES:
        raise HTTPException(status.HTTP_409_CONFLICT, "This household has reached its file limit.")

    file_id = uuid.uuid4().hex[:16]
    # Medical and identity files are never public. Anything else is private unless the family asks.
    chosen: Visibility = "private" if category in ALWAYS_PRIVATE else visibility
    path = object_path(_owner_folder(actor), chosen, actor.uid, category, name, content_type)
    record = FileRecord(
        id=file_id,
        category=category,
        name=_safe_name(name),
        label=label.strip(),
        contentType=content_type,
        size=len(data),
        uploadedBy=actor.email or actor.uid,
        createdAt=datetime.now(timezone.utc).isoformat(),
        visibility=chosen,
        path=path,
        publicUrl=f"/api/v1/files/public/{path}" if chosen == "public" else "",
    )

    def _store() -> None:
        _bucket().blob(path).upload_from_string(data, content_type=content_type)

    await asyncio.get_running_loop().run_in_executor(None, _store)

    # One profile photo at a time: the previous one is removed.
    if CATEGORIES[category].get("single"):
        for old in existing:
            if old.get("category") == category:
                _remove(household_id, old["id"])
    repo.doc_set(f"households/{household_id}/files/{file_id}", record.model_dump(), merge=False)
    return record


@router.get("/{file_id}/link", response_model=FileLink)
def file_link(
    household_id: str,
    file_id: str,
    actor: ActorContext = Depends(get_current_actor),
) -> FileLink:
    """A link to open this file. Private files get a key that expires in 30 minutes."""
    _guard(actor, household_id)
    meta = get_repository().doc_get(f"households/{household_id}/files/{file_id}")
    if not meta or not meta.get("path"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    if meta.get("visibility") == "public" and meta.get("publicUrl"):
        return FileLink(url=meta["publicUrl"])
    token, expires = make_token(meta["path"], meta.get("contentType", "application/octet-stream"))
    return FileLink(
        url=f"/api/v1/files/open/{token}",
        expiresAt=datetime.fromtimestamp(expires, timezone.utc).isoformat(),
        expiresInSeconds=LINK_SECONDS,
    )


@link_router.get("/categories")
def list_categories() -> list[dict]:
    """The file categories, in the order the dashboard shows them."""
    return [{"id": k, "title": v["title"], "hint": v["hint"], "privateOnly": v["private_only"]} for k, v in CATEGORIES.items()]


@link_router.get("/open/{token}")
async def open_with_key(token: str) -> Response:
    """Open a private file with an unexpired link key. The key is the credential, so no sign-in is needed."""
    data = read_token(token)

    def _read() -> Optional[bytes]:
        blob = _bucket().blob(data["p"])
        return blob.download_as_bytes() if blob.exists() else None

    content = await asyncio.get_running_loop().run_in_executor(None, _read)
    if content is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    return Response(
        content=content,
        media_type=data.get("t", "application/octet-stream"),
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
            "Referrer-Policy": "no-referrer",
        },
    )


PUBLIC_PATH = re.compile(r"^(caretaker|person)/public/[A-Za-z0-9_-]+/[a-z_]+/[a-z0-9-]+-[a-z0-9]{10}\.(jpg|png|webp|pdf)$")


@link_router.get("/public/{path:path}")
async def open_public(path: str) -> Response:
    """Serve an object from a public folder. Anything outside caretaker/public/ and person/public/ is refused."""
    if not PUBLIC_PATH.match(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")

    def _read() -> Optional[tuple[bytes, str]]:
        blob = _bucket().blob(path)
        return (blob.download_as_bytes(), blob.content_type or "application/octet-stream") if blob.exists() else None

    found = await asyncio.get_running_loop().run_in_executor(None, _read)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.")
    content, content_type = found
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


def _remove(household_id: str, file_id: str) -> None:
    meta = get_repository().doc_get(f"households/{household_id}/files/{file_id}") or {}
    try:
        if meta.get("path"):
            blob = _bucket().blob(meta["path"])
            if blob.exists():
                blob.delete()
    except Exception as exc:
        logger.warning("Could not delete stored file %s (%s)", file_id, exc)
    get_repository().doc_delete(f"households/{household_id}/files/{file_id}")


@router.delete("/{file_id}")
async def delete_file(
    household_id: str,
    file_id: str,
    actor: ActorContext = Depends(get_current_actor),
) -> dict[str, str]:
    _guard(actor, household_id)
    await asyncio.get_running_loop().run_in_executor(None, _remove, household_id, file_id)
    return {"status": "deleted", "id": file_id}
