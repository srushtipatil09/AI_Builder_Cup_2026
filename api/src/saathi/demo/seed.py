"""Labeled synthetic households for the demo and for checking the drift rule (master plan section 11.1).

Every row written here carries synthetic=true. Only household ids that start with "demo-" may be seeded.
"""

from datetime import date, timedelta
from typing import Optional

from saathi.analytics.drift import DailyMetricRecord
from saathi.memory.extract import FamilyEpisode
from saathi.memory.vectors import FamilyEpisodeVectorIndex
from saathi.pipeline import evaluate_and_publish, local_date_of, save_daily_record
from saathi.providers.firestore import get_repository

SCENARIOS = ("stable", "changing", "fasting", "family")
DAYS = 16

# Ordinary day-to-day wobble around 450 ms, fixed so every run gives the same answer.
WOBBLE = [0, 30, -20, 45, -35, 10, 25, -40, 15, -10, 35, -25, 5, 20, -15, 40]


def scenario_records(scenario: str, end: Optional[date] = None) -> list[DailyMetricRecord]:
    if scenario not in SCENARIOS:
        raise ValueError(f"Unknown scenario {scenario}")
    end = end or date.fromisoformat(local_date_of())
    records: list[DailyMetricRecord] = []
    for i in range(DAYS):
        day = end - timedelta(days=DAYS - 1 - i)
        n = i + 1
        rec = DailyMetricRecord(
            local_date=day.isoformat(),
            response_gap_ms=450.0 + WOBBLE[i],
            speaking_rate_wpm=110.0 + WOBBLE[(i + 3) % DAYS] / 5,
            meals_reported=3,
            family_contact=(n % 3 != 0),
            mood="Okay" if n % 4 == 0 else None,
        )
        if scenario == "changing" and n >= 13:
            rec.response_gap_ms = 1300.0 + WOBBLE[i]
            if n in (14, 15):
                rec.meals_reported, rec.meals_skipped = 2, 1
        if scenario == "fasting" and n >= 14:
            if n in (14, 15):
                rec.meals_reported, rec.meals_skipped, rec.is_fasting = 2, 1, True
            else:
                rec.is_ill = True
        if scenario == "family":
            rec.family_contact = n < 12
        records.append(rec)
    return records


def seed_household(household_id: str, scenario: str) -> dict:
    """Write the scenario's 16 days to Firestore and BigQuery, then evaluate and publish like a real run."""
    if not household_id.startswith("demo-"):
        raise ValueError("Only demo households can be seeded")
    repo = get_repository()
    records = scenario_records(scenario)
    bq_rows = 0
    for rec in records:
        if save_daily_record(household_id, rec, session_count=1, synthetic=True):
            bq_rows += 1

    shift = None
    evidence = [f"daily:{r.local_date}" for r in records[-3:]]
    if scenario == "family":
        idx = FamilyEpisodeVectorIndex(household_id)
        early = FamilyEpisode(
            id="seed-family-2", person_name="Rahul", relation="Son", reported_last_contact="today",
            what_was_said="Rahul roz phone karta hai.", evidence_quote="Rahul roz phone karta hai.", date=records[1].local_date,
        )
        late = FamilyEpisode(
            id="seed-family-12", person_name="Rahul", relation="Son", where_they_are="unknown",
            what_was_said="Pata nahi kahan hain, phone nahi utha rahe.",
            evidence_quote="Pata nahi kahan hain, phone nahi utha rahe.", date=records[11].local_date,
        )
        idx.index_episode(early)
        idx.index_episode(late)
        shift = idx.evaluate_family_shift()
        evidence = [early.id, late.id]

    repo.doc_set(f"households/{household_id}/meta/seed", {"scenario": scenario, "synthetic": True, "days": DAYS})
    published = evaluate_and_publish(household_id, records[-1].local_date, "", shift, evidence)
    return {
        "household": household_id,
        "scenario": scenario,
        "days": len(records),
        "bigqueryRows": bq_rows,
        "drift": published["drift"],
        "insight": published["insight"],
        "familyShift": shift is not None,
    }


SEEDED_TRANSCRIPT = [
    {"speaker": "assistant", "text": "Namaste Kamla ji, aaj subah ka khana ho gaya?"},
    {"speaker": "parent", "text": "Haan, maine subah roti aur sabzi khayi."},
    {"speaker": "assistant", "text": "Rahul se kab baat hui thi?"},
    {"speaker": "parent", "text": "Rahul roz phone karta hai, par aaj baat nahi hui, pata nahi kahan hain."},
    {"speaker": "assistant", "text": "Achha. Aur tabiyat kaisi hai?"},
    {"speaker": "parent", "text": "Theek hoon, bas thoda akela lagta hai."},
]
