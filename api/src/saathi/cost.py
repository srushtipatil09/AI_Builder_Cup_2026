"""Spend limits for the prototype.

Gemini 3 implicit context caching is on for every Google Cloud project and
discounts repeated input when the shared prefix is at least 4,096 tokens.
This module does not pad prompts to reach that floor. A short persona stays
uncached, which is cheaper than paying to store an explicit cache.

These numbers are product settings, not clinical thresholds.
"""

SESSION_CAP_SECONDS = 240
API_REQUEST_TIMEOUT_SECONDS = 600
MIN_INSTANCES = 0
API_CONCURRENCY = 8
API_MAX_INSTANCES = 3
API_CPU = "1"
API_MEMORY = "512Mi"
WORKER_CONCURRENCY = 1
WORKER_MAX_INSTANCES = 1
WORKER_CPU = "1"
WORKER_MEMORY = "1Gi"
MAX_DAILY_LIVE_MINUTES = 120
MAX_DAILY_EXTRACT_CALLS = 500
DEMO_SESSIONS_PER_VISITOR = 3
INSIGHT_MAX_TOOL_CALLS = 6
INSIGHT_DEADLINE_SECONDS = 30
VECTOR_NEIGHBORS = 5
BIGQUERY_MAX_BYTES_BILLED = 100 * 1024 * 1024
EXPLICIT_CACHE_MIN_TOKENS = 4096


def use_explicit_context_cache(prefix_tokens: int) -> bool:
    """Explicit caches have a storage charge. Use one only when the discount can apply."""
    return prefix_tokens >= EXPLICIT_CACHE_MIN_TOKENS
