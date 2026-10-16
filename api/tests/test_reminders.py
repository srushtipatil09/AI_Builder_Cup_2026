"""Tests for voice reminders and medicine reporting."""

from saathi.contracts.reminders import ReminderProposal
from saathi.reminders.voice import (
    confirm_and_save_reminder,
    evaluate_medicine_report,
    prepare_reminder_readback,
)


def test_prepare_reminder_readback() -> None:
    # 1. Missing time -> asks clarifying question
    incomplete = ReminderProposal(name="BP tablet", time="")
    ok, text = prepare_reminder_readback(incomplete)
    assert ok is False
    assert "samay" in text.lower()

    # 2. Complete daily proposal -> generates spoken confirmation
    complete = ReminderProposal(name="BP tablet", dose="5mg", schedule="Daily", time="08:30", note="after breakfast")
    ok, text = prepare_reminder_readback(complete)
    assert ok is True
    assert "har din 08:30" in text
    assert "BP tablet" in text
    assert "save kar doon" in text


def test_confirm_and_save_reminder() -> None:
    proposal = ReminderProposal(name="Vitamin D", dose="60k", schedule="Once", date="2026-10-25", time="10:00")
    med = confirm_and_save_reminder("test-reminder-hh", proposal)
    assert med.name == "Vitamin D"
    assert med.schedule == "Once"
    assert med.time == "10:00"


def test_evaluate_medicine_report_uncertain() -> None:
    # "Yaad nahi" -> status: uncertain, never advises extra dose
    report = evaluate_medicine_report("BP tablet", "Mujhe yaad nahi ki maine subah dawai li ya nahi")
    assert report["status"] == "uncertain"
    assert report["escalation_needed"] is True
    assert "doosri dawai mat lijiye" in report["spoken_feedback"].lower()


def test_evaluate_medicine_report_taken() -> None:
    report = evaluate_medicine_report("BP tablet", "Haan, maine subah dawai kha li thi")
    assert report["status"] == "reported_done"
    assert report["escalation_needed"] is False
