"""A small in-process cache with a time limit.

Pages that refresh every few seconds would otherwise read the same Firestore documents again and again. The free
daily Firestore quota is 50,000 reads, and one open care desk used to use it up in about an hour.
"""

import logging
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)

ENABLED = True
RETRY_AFTER_ERROR_SECONDS = 30
_store: dict[str, tuple[float, Any]] = {}


def cached(key: str, ttl: float, build: Callable[[], Any], fresh: bool = False) -> Any:
    """The value built less than `ttl` seconds ago. `fresh` rebuilds now (and refreshes the copy others get).

    If rebuilding fails (for example Firestore says the quota is used up) and an older copy exists, that copy is
    served and the rebuild is tried again in a short while, so an open page keeps working instead of showing an error.
    """
    if not ENABLED:
        return build()
    hit = _store.get(key)
    now = time.monotonic()
    if hit and not fresh and now - hit[0] < ttl:
        return hit[1]
    try:
        value = build()
    except Exception as exc:
        if hit is None:
            raise
        logger.warning("Serving an older copy of %s (%s)", key, exc)
        _store[key] = (now - ttl + min(ttl, RETRY_AFTER_ERROR_SECONDS), hit[1])
        return hit[1]
    _store[key] = (now, value)
    return value


def forget(prefix: str) -> None:
    for key in [k for k in _store if k.startswith(prefix)]:
        _store.pop(key, None)
