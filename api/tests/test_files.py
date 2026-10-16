"""File paths and the 30-minute link keys. No cloud calls."""

import re
import time

import pytest
from fastapi import HTTPException

from saathi.files import routes as fr

LAYOUT = re.compile(r"^(caretaker|person)/(public|private)/[A-Za-z0-9_-]+/[a-z_]+/[a-z0-9-]+-[a-z0-9]{10}\.(jpg|png|webp|pdf)$")


def test_object_path_layout() -> None:
    path = fr.object_path("caretaker", "private", "uid_123", "identity_proofs", "Aadhaar Front.PNG", "image/png")
    assert LAYOUT.match(path)
    assert path.startswith("caretaker/private/uid_123/identity_proofs/aadhaar-front-")
    assert fr.object_path("person", "public", "uid_123", "other", "x", "application/pdf").endswith(".pdf")


def test_link_key_expires_after_thirty_minutes() -> None:
    token, _ = fr.make_token("caretaker/private/u/other/a-abcdefghij.png", "image/png")
    assert fr.read_token(token, now=time.time() + 29 * 60)["p"].startswith("caretaker/private/")
    with pytest.raises(HTTPException) as late:
        fr.read_token(token, now=time.time() + 31 * 60)
    assert late.value.status_code == 403


def test_tampered_link_key_is_rejected() -> None:
    token, _ = fr.make_token("caretaker/private/u/other/a-abcdefghij.png", "image/png")
    with pytest.raises(HTTPException):
        fr.read_token(token[:-2] + "xx")
    with pytest.raises(HTTPException):
        fr.read_token("not-a-key")


def test_only_public_folders_are_served_without_sign_in() -> None:
    assert fr.PUBLIC_PATH.match("caretaker/public/uid_1/family_photos/garden-abcdefghij.jpg")
    assert fr.PUBLIC_PATH.match("person/public/uid_1/family_photos/garden-abcdefghij.png")
    assert not fr.PUBLIC_PATH.match("caretaker/private/uid_1/identity_proofs/id-abcdefghij.png")
    assert not fr.PUBLIC_PATH.match("caretaker/public/../private/uid_1/identity_proofs/id-abcdefghij.png")
    assert not fr.PUBLIC_PATH.match("other/public/uid_1/other/x-abcdefghij.png")
