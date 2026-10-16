"""SafetyGuard: Pure Python validation of caregiver-facing text."""

import re
from typing import Optional

# Forbidden clinical diagnosis terms (English + transliterations)
FORBIDDEN_DIAGNOSES = [
    r"\bdementia\b",
    r"\balzheimer'?s?\b",
    r"\bdepression\b",
    r"\bcognitive (?:decline|impairment|deficit)\b",
    r"\bpsychosis\b",
    r"\bschizophrenia\b",
    r"\bmental (?:disorder|illness)\b",
    r"\bmci\b",
    r"\bmanic\b",
    r"\bdimagi bimari\b",
]

# Forbidden dosage and prescription advice
FORBIDDEN_TREATMENTS = [
    r"\b(?:take|taking)\s*(?:an|the)?\s*(?:another|extra|double|\d+)\s*(?:dose|pill|tablet|medicine)?\b",
    r"\bstop\s+(?:taking\s+)?(?:the\s+)?(?:\w+\s+)?(?:medicine|tablet|pill)\b",
    r"\bprescribe\b",
    r"\b\d+\s*(?:mg|ml|mcg|tablets?)\b",
    r"\bincrease\s+(?:the\s+)?dose\b",
    r"\bdecrease\s+(?:the\s+)?dose\b",
    r"\bstart taking\b",
    r"\brecommend\s+(?:taking\s+)?(?:an\s+)?extra\b",
]

# Forbidden clinical orders
FORBIDDEN_ORDERS = [
    r"\bmust (?:see|visit|consult)\s*(?:a)?\s*(?:psychiatrist|doctor|therapist|neurologist)\b",
    r"\border (?:counselling|therapy)\b",
    r"\brequires? (?:immediate|mandatory)?\s*(?:counselling|psychiatric)\b",
]

# Forbidden false certainty
FORBIDDEN_CERTAINTY = [
    r"\bdefinitely (?:has|suffering)\b",
    r"\bconfirms? (?:a)?\s*diagnosis\b",
    r"\bsuffering from\b",
]


class SafetyGuardResult:
    def __init__(self, is_safe: bool, final_text: str, violations: list[str]):
        self.is_safe = is_safe
        self.final_text = final_text
        self.violations = violations


def validate_caregiver_text(
    draft_text: str,
    parent_name: str = "your parent",
    metric_fact: str = "routine observations",
    fallback_action: str = "Call to check in",
) -> SafetyGuardResult:
    """Validates caregiver-facing draft.

    If any rule is violated, replaces prose with deterministic structured template.
    """
    violations: list[str] = []
    text_lower = draft_text.lower()

    # 1. Check diagnoses
    for pattern in FORBIDDEN_DIAGNOSES:
        if re.search(pattern, text_lower):
            violations.append(f"Forbidden diagnostic label: {pattern}")

    # 2. Check dosage advice
    for pattern in FORBIDDEN_TREATMENTS:
        if re.search(pattern, text_lower):
            violations.append(f"Forbidden dose advice: {pattern}")

    # 3. Check clinical orders
    for pattern in FORBIDDEN_ORDERS:
        if re.search(pattern, text_lower):
            violations.append(f"Forbidden clinical order: {pattern}")

    # 4. Check false certainty
    for pattern in FORBIDDEN_CERTAINTY:
        if re.search(pattern, text_lower):
            violations.append(f"Forbidden false certainty: {pattern}")

    if violations:
        # Construct deterministic factual fallback
        safe_template = (
            f"Over recent conversations, changes were noted in {metric_fact}. "
            f"Suggested next step: {fallback_action} with {parent_name}."
        )
        return SafetyGuardResult(is_safe=False, final_text=safe_template, violations=violations)

    return SafetyGuardResult(is_safe=True, final_text=draft_text, violations=[])
