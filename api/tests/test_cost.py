from saathi.cost import (
    EXPLICIT_CACHE_MIN_TOKENS,
    MIN_INSTANCES,
    SESSION_CAP_SECONDS,
    VECTOR_NEIGHBORS,
    use_explicit_context_cache,
)


def test_live_sessions_stay_short_and_idle_instances_stay_off() -> None:
    assert SESSION_CAP_SECONDS == 240
    assert MIN_INSTANCES == 0
    assert VECTOR_NEIGHBORS <= 5


def test_explicit_cache_is_only_for_a_prefix_large_enough_to_discount() -> None:
    assert EXPLICIT_CACHE_MIN_TOKENS == 4096
    assert use_explicit_context_cache(EXPLICIT_CACHE_MIN_TOKENS - 1) is False
    assert use_explicit_context_cache(EXPLICIT_CACHE_MIN_TOKENS) is True
