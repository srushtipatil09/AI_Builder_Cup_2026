"""Insight agent workflow orchestrator."""

from typing import Optional

from saathi.analytics.drift import DriftEvaluationResult
from saathi.insights.tools import InsightOutput, compose_family_insight, get_recent_metrics, send_alert


def run_insight_workflow(
    household_id: str,
    drift_result: DriftEvaluationResult,
    shift_card: Optional[dict] = None,
) -> InsightOutput:
    """Orchestrates insight generation using the three tools and SafetyGuard."""
    metrics = get_recent_metrics(household_id)
    parent_name = metrics.get("parent_name", "Kamla")

    # If family shift was detected
    if shift_card:
        headline = f"Update regarding conversations about {shift_card.get('person', 'family')}"
        body = (
            f"Mentions of {shift_card.get('person')} changed between {shift_card.get('earlier_date')} "
            f"(\"{shift_card.get('earlier_quote')}\") and {shift_card.get('later_date')} "
            f"(\"{shift_card.get('later_quote')}\"). A call with him, or consulting a family counselor, "
            f"is a suggested next step. Resource: Elderline 14567."
        )
        insight = compose_family_insight(
            household_id=household_id,
            draft_headline=headline,
            draft_body=body,
            metric_fact=f"mentions of {shift_card.get('person')}",
            parent_name=parent_name,
        )
        send_alert(household_id=household_id, tier=2, message=insight.body, action="Suggest family call")
        return insight

    # If behavioral drift candidate
    if drift_result.is_candidate:
        headline = "Noticeable change in response pauses"
        body = (
            f"Over the last three days, response pauses averaged {drift_result.recent_mean}ms "
            f"compared to her usual {drift_result.baseline_mean}ms. "
            f"Suggested next step: Call {parent_name} to check in."
        )
        insight = compose_family_insight(
            household_id=household_id,
            draft_headline=headline,
            draft_body=body,
            metric_fact="response pause timing",
            parent_name=parent_name,
        )
        send_alert(household_id=household_id, tier=2, message=insight.body, action="Call parent")
        return insight

    # Default quiet digest (Tier 1)
    headline = "Daily routine check-in completed"
    body = f"Conversations with {parent_name} were consistent with her usual baseline routine."
    return compose_family_insight(
        household_id=household_id,
        draft_headline=headline,
        draft_body=body,
        metric_fact="routine conversation",
        parent_name=parent_name,
    )
