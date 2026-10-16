"""Comprehensive pytest suite for SafetyGuard rules."""

import pytest
from saathi.insights.safety import validate_caregiver_text

# Dangerous / forbidden sentences that MUST be blocked by SafetyGuard
FORBIDDEN_TEST_CASES = [
    # Diagnoses
    "She is showing clear signs of early dementia.",
    "This pause pattern confirms Alzheimer's disease.",
    "Parent is suffering from severe depression.",
    "Acoustic analysis detected cognitive decline.",
    "Patient shows signs of psychosis.",
    "Her dimagi bimari is getting worse.",
    # Dose & treatment advice
    "Please tell her to take another dose of BP tablet.",
    "She should take 20mg of paracetamol tonight.",
    "Advise parent to stop taking the morning pill.",
    "You should increase the dose by 5mg.",
    "Recommend taking an extra tablet before sleep.",
    # Clinical orders
    "She must see a psychiatrist immediately.",
    "We order counselling for this patient.",
    "Parent requires mandatory psychiatric therapy.",
    "She must consult a neurologist tomorrow.",
    # False certainty
    "This definitely has affected her memory.",
    "The test confirms a diagnosis of decline.",
    "She is definitely suffering from memory loss.",
]

# Safe sentences that MUST pass SafetyGuard untouched
SAFE_TEST_CASES = [
    "Over the last three days, response pauses averaged 850ms compared to baseline 500ms.",
    "Kamla mentioned having lunch and going for a morning walk in the garden.",
    "Rahul called today in the afternoon and spoke about his work.",
    "She reported feeling a little tired in the evening.",
    "Between Monday and Thursday, she mentioned her morning tea was on time.",
    "A call with Rahul or a family member would be a gentle next step.",
    "Resource: Elderline 14567 is available as a helpline for seniors in India.",
]


@pytest.mark.parametrize("unsafe_text", FORBIDDEN_TEST_CASES)
def test_safety_guard_blocks_forbidden_claims(unsafe_text: str) -> None:
    res = validate_caregiver_text(
        draft_text=unsafe_text,
        parent_name="Kamla",
        metric_fact="response pauses",
    )
    assert res.is_safe is False
    assert len(res.violations) >= 1
    # Check that forbidden text is replaced by safe fallback template
    assert "dementia" not in res.final_text.lower()
    assert "alzheimer" not in res.final_text.lower()
    assert "dose" not in res.final_text.lower()
    assert "psychiatrist" not in res.final_text.lower()
    assert "Suggested next step:" in res.final_text


@pytest.mark.parametrize("safe_text", SAFE_TEST_CASES)
def test_safety_guard_allows_safe_factual_claims(safe_text: str) -> None:
    res = validate_caregiver_text(
        draft_text=safe_text,
        parent_name="Kamla",
    )
    assert res.is_safe is True
    assert len(res.violations) == 0
    assert res.final_text == safe_text
