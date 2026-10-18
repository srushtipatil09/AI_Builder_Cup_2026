"""A stored note is copied, and clinical additions are dropped before the family sees them."""

from saathi.files.read_note import PageRead, PageRoutine, can_read_note, prepare_page_read


def test_only_a_prescription_or_report_is_read() -> None:
    assert can_read_note("prescriptions", "image/jpeg") is True
    assert can_read_note("medical_reports", "application/pdf") is True
    assert can_read_note("medicine_photos", "image/jpeg") is False
    assert can_read_note("prescriptions", "text/plain") is False


def test_a_dose_stays_on_the_routine_and_leaves_the_family_summary() -> None:
    prepared = prepare_page_read(PageRead(
        reportTitle="Follow-up",
        plainSummary="Continue Telmisartan 40 mg every morning and walk.",
        localSummary="",
        prescribedRoutines=[PageRoutine(kind="medicine", name="Telmisartan", dose="40mg", time="08:30")],
        clinicalObservations=["Blood pressure written as 134/86."],
        source="page",
    ))
    assert prepared.source == "page"
    assert "40" not in prepared.plainSummary
    assert prepared.prescribedRoutines[0].dose == "40mg"
    assert prepared.prescribedRoutines[0].time == "08:30"


def test_a_diagnosis_is_replaced_and_an_unreadable_page_adds_nothing() -> None:
    diagnosed = prepare_page_read(PageRead(
        plainSummary="This confirms dementia and a double dose.",
        prescribedRoutines=[PageRoutine(kind="medicine", name="Tablet", dose="500mg")],
        source="page",
    ))
    assert "dementia" not in diagnosed.plainSummary.lower()
    assert "Confirm" in diagnosed.plainSummary

    blank = prepare_page_read(PageRead(source="unreadable"))
    assert blank.source == "unreadable"
    assert blank.prescribedRoutines == []
    assert "Nothing was added" in blank.plainSummary


def test_the_second_summary_follows_the_parent_language() -> None:
    tamil = prepare_page_read(PageRead(plainSummary="Walk every morning.", localSummary="தினமும் காலை நடக்கவும்.", source="page"), "Tamil")
    assert tamil.localLanguage == "Tamil"
    assert tamil.localSummary

    english = prepare_page_read(PageRead(plainSummary="Walk every morning.", localSummary="Walk every morning.", source="page"), "English")
    assert english.localLanguage == ""
    assert english.localSummary == ""

    blank = prepare_page_read(PageRead(source="unreadable"), "Bengali")
    assert blank.localLanguage == "Bengali"
    assert "পড়া যায়নি" in blank.localSummary
