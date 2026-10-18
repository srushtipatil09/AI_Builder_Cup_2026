# Test cases

What is tested, how to run it, and what each case proves. Every number below was counted from the repository on 18 Oct 2026.

| Suite | Count | What it checks | Calls a cloud service? |
| --- | --- | --- | --- |
| API tests (`api/tests`) | **111 passed** (88 test functions; two parametrized SafetyGuard tests expand to 25 cases) | Safety, drift, voice bridge, reminders, nearby help, access rules, retention, scheduling | No, see [How the API tests run](#how-the-api-tests-run) |
| Extraction eval (`eval/`) | **30 / 30** labeled cases in 12 groups | That Gemini Flash reads a Roman-script Hindi, Hinglish, or English transcript into correct observations | Yes, one Gemini Flash call per case |
| Deployed smoke check (`scripts/smoke_cloud.py`) | **8 checks** (a 9th runs with `--invoke`) | That the live site, API, and private worker answer and refuse correctly | Yes, reads the live URLs |

The web app has no automated test suite in this repository. The phone and care desk are checked by hand against the live app.

## Run it

```bash
cd api && python -m pytest tests                  # 111 passed, about 33 s
python scripts/eval_extraction.py                 # writes eval/report.json (calls Gemini Flash)
python scripts/smoke_cloud.py                     # outside checks on the deployed services
python scripts/smoke_cloud.py --invoke            # also calls the worker tick with an ID token
```

`make test` runs the same API tests.

## How the API tests run

`api/tests/conftest.py` runs every test against the **in-memory store**, with BigQuery switched off, household sign-in relaxed, and caches off. Nothing is written to Firestore or BigQuery. Setting `SAATHI_LIVE_TESTS=1` turns this isolation off.

Two things the offline suite does not prove:

- The Gemini Live audio stream is not exercised. `test_websocket_live_voice_bridge` removes the Gemini client and checks the bridge's text path, the ready message, the 240-second cap, and the distress reply.
- `extract_session` tries Gemini first and falls back to a rule parser when the model is unavailable. The two extraction unit tests pass either way. The **30-case eval** is the run that checks the model itself.

## API tests, file by file

### Safety: what the family reads

| Test | What it proves |
| --- | --- |
| `test_safety.py::test_safety_guard_blocks_forbidden_claims` (18 cases) | SafetyGuard rejects every one of these: 6 diagnoses ("early dementia", "Alzheimer's", "severe depression", "cognitive decline", "psychosis", and the Hindi "dimagi bimari"), 5 dose or treatment instructions (take another dose, 20 mg of paracetamol, stop the morning pill, increase the dose by 5 mg, an extra tablet), 4 orders to see a specialist or enter counselling, and 3 false-certainty phrases ("definitely has", "confirms a diagnosis", "definitely suffering"). |
| `test_safety.py::test_safety_guard_allows_safe_factual_claims` (7 cases) | Facts built from stored data pass: pause averages against a baseline, lunch and a walk, a call from Rahul, feeling tired, a time-stamped tea reminder, "a call would be a gentle next step", and the Elderline 14567 helpline. |
| `test_pipeline.py::test_safety_alarm_and_ungrounded_rules` | An "emergency" or "She fell" below the top alert tier is unsafe, and a number such as "900 ms" is unsafe without stored evidence and safe with it. |
| `test_read_note.py::test_a_dose_stays_on_the_routine_and_leaves_the_family_summary` | A dose read from a prescription goes to the routine (40 mg, 08:30) and never into the family summary. |
| `test_read_note.py::test_a_diagnosis_is_replaced_and_an_unreadable_page_adds_nothing` | A diagnosis on a page is replaced with a "Confirm" line. An unreadable page adds no routine and says "Nothing was added". |
| `test_read_note.py::test_only_a_prescription_or_report_is_read` | Only prescriptions and medical reports in an image or PDF format are read. Medicine photos and plain text are not. |
| `test_read_note.py::test_the_second_summary_follows_the_parent_language` | A Tamil parent gets a Tamil second summary, an English parent gets none, and an unreadable page gets a Bengali "could not be read" line. |
| `test_scheduling.py::test_reminder_copy_speaks_the_family_line_and_hides_a_dose` | A notification shows the family's wording and hides the dose ("5mg" and "10" never appear). A spoken "haan ja raha hoon, kar lunga" counts as agreement. "nahi, baad mein" and a bare "ji" do not. |

### Distress and impact

| Test | What it proves |
| --- | --- |
| `test_distress.py::test_distress_keywords_and_negation` | "Chot lag gayi" is distress. "main gir nahi gayi" and "I did not fall" are negated, not distress. |
| `test_distress.py::test_impact_classification_rules` | A door closing is ordinary noise and starts no check. A thud and a dropped plate is a possible impact and starts a spoken check. |
| `test_distress.py::test_classify_impact_endpoint` | The classify-impact route returns `possible_impact` and a spoken check for "loud thud on floor". |
| `test_pipeline.py::test_distress_words_and_negation` | "bachao, main gir gayi" is an explicit help request. "ouch" is distress but not explicit help. "I did not fall, I am fine" is neither. |
| `test_pipeline.py::test_alert_cooldown_appends_evidence` | A second alert inside the cooldown adds evidence to the first instead of a duplicate. A new explicit help request ignores the cooldown. |

### Drift and family shift

| Test | What it proves |
| --- | --- |
| `test_drift.py::test_drift_sparse_history_returns_learning` | Four days of history gives "Learning usual routine" and no alert. |
| `test_drift.py::test_drift_stable_history_no_candidate` | 14 ordinary days stay below a z-score of 2.0 and raise nothing. |
| `test_drift.py::test_drift_changing_history_triggers_candidate` | 11 days at 400 ms then 3 days at 1100 ms raise a candidate (z-score 2.0 or more) with "response pauses averaged" in the explanation. |
| `test_drift.py::test_drift_fasting_trap_suppresses_alert` | Three fasting days with skipped meals raise no alert and say "Fasting context noted". |
| `test_pipeline.py::test_drift_fixtures_disagree_as_expected` | The stable, changing, and fasting scenarios disagree as designed. The changing one flags `response_gap_ms`. Pace falls by more than 20 words a minute. The fasting one stores its context and sends no meal follow-up. |
| `test_pipeline.py::test_story_seed_slows_speech_and_drops_family_contact` | The demo story slows speech and ends with family contact going from true to false. The line it writes names words per minute and seconds. |
| `test_pipeline.py::test_drift_needs_a_week_of_baseline` | Too little baseline returns "Learning usual routine". |
| `test_memory_extraction.py::test_family_shift_rule` | Two quotes about Rahul ("roz phone karta hai", then "phone nahi utha rahe") trigger the `family_shift` rule, carry both quotes, and include Elderline 14567. |

### Post-call pipeline and memory

| Test | What it proves |
| --- | --- |
| `test_pipeline.py::test_pipeline_is_idempotent_and_writes_everything` | A session is processed once. A repeat returns `already_processed`. One daily metric and one family episode are written, with a 640 ms gap, one meal, and a tier-1 insight. |
| `test_pipeline.py::test_noisy_session_gap_is_not_a_confident_number` | A noisy session stores no response-gap number. |
| `test_pipeline.py::test_task_name_is_stable_per_session` | The Cloud Tasks task name is the same for a session and different between sessions. The task carries an OIDC token and the worker URL. |
| `test_pipeline.py::test_worker_rejects_unauthenticated_calls_when_invoker_is_configured` | The worker answers 401 without a valid token. |
| `test_memory_extraction.py::test_extraction_meals_and_negation` | "roti aur daal kha li thi" is a meal with its quote. "main aaj nahi gayi" is not recorded as a walk. |
| `test_memory_extraction.py::test_extraction_correction_and_family` | "Meena meri behen hain, beti nahi" becomes a memory correction. A phone call with Rahul becomes a family contact. |
| `test_memory_extraction.py::test_worker_process_session` | The worker's `process-session` route accepts a session and returns `processed`. |

### Live voice and reminders

| Test | What it proves |
| --- | --- |
| `test_live.py::test_build_system_instruction_contains_core_rules` | The prompt holds the parent, persona, son, memory, and medicine, plus "Ask only ONE question at a time" and "NEVER diagnose any medical condition". |
| `test_live.py::test_text_session_turn` | A Hindi text turn returns a reply for the right session. |
| `test_live.py::test_complete_session` | Completing a session stores duration, response gap, and speaking pace and returns `completed`. |
| `test_live.py::test_websocket_live_voice_bridge` | The socket sends `ready` with the 240-second cap, replies to a transcript, answers a distress signal with "Kya hua? Gir gaye kya?", and closes cleanly. |
| `test_reminders.py::test_prepare_reminder_readback` | A reminder without a time gets a question ("samay"). A complete daily one is read back as "har din 08:30 ... save kar doon". |
| `test_reminders.py::test_confirm_and_save_reminder` | A confirmed reminder is saved as a once-only 10:00 Vitamin D. |
| `test_reminders.py::test_evaluate_medicine_report_uncertain` | "Yaad nahi" is `uncertain`, escalates, and says not to take another medicine. It never advises a dose. |
| `test_reminders.py::test_evaluate_medicine_report_taken` | A spoken "done" is `reported_done` with no escalation. |
| `test_scheduling.py::test_invitation_lifecycle_states` | The check-in moves through device unavailable, responded, snoozed, awaiting retry, and unanswered after the second silence. A device failure is not the same as no reply. |
| `test_pipeline.py::test_demo_clock_unanswered_versus_device_unavailable` | An unanswered check-in is a tier-2 welfare check. A device failure is tier 1 and says it is different from no reply. |
| `test_pipeline.py::test_tick_fires_a_check_in_once_and_respects_quiet_hours` | A due check-in fires once. A claim is leased, a snooze works, and quiet hours (including those that cross midnight) are respected. |
| `test_scheduling.py::test_send_fcm_notification_mock` | A push send reports success. |
| `test_scheduling.py::test_notification_link_is_https` | A notification link is always the https site, even from a local origin. |
| `test_scheduling.py::test_worker_scheduler_tick` | The worker tick route returns `tick_processed` with `dueEvents`. |

### Ask Saathi (caretaker changes)

| Test | What it proves |
| --- | --- |
| `test_pipeline.py::test_ask_proposal_confirm_and_hash` | A typed change waits for confirmation with a read-back ("8:30 AM"). A wrong hash is refused. A repeat confirm does not add a second reminder. |
| `test_pipeline.py::test_ask_drops_a_dose_the_caretaker_did_not_type` | A dose the caretaker did not type is dropped. |
| `test_pipeline.py::test_ask_missing_time_is_a_question_not_a_guess` | A missing time becomes a question. |
| `test_pipeline.py::test_ask_refuses_medical_advice` | A request for medical advice becomes a question about the dose, not an answer. |

### Nearby help and calls

| Test | What it proves |
| --- | --- |
| `test_nearby.py::test_position_is_rounded_and_validated` | A saved position is rounded. 0,0 and out-of-range values return 400. A position can be deleted. |
| `test_nearby.py::test_overview_lists_places_people_and_helplines` | The overview returns hospital, pharmacy, grocery, park, and restaurant, a trusted person with a number, and the 112 and 108 helplines. |
| `test_nearby.py::test_lookup_failure_still_returns_helplines` | If the lookup fails, helplines are still returned and places are empty. |
| `test_nearby.py::test_parent_grocery_lookup_is_what_the_caretaker_sees` | A lookup made on the parent's phone is the one the care desk shows, with one search. |
| `test_nearby.py::test_a_recent_saved_list_is_reused_for_a_spoken_question` | A list saved in the last day answers a spoken question with no new search. |
| `test_nearby.py::test_a_temple_question_uses_one_text_search_and_then_the_saved_list` | A named place costs one text search, then the saved list. |
| `test_nearby.py::test_phone_is_safe_for_a_tel_link` | Only digits and a leading plus survive in a number. `javascript:` and shell characters are stripped. |
| `test_nearby.py::test_voice_tools_find_and_offer_a_call` | `find_nearby` returns a card and a "call 112 first" note for a hospital. `offer_call` returns a Call button with a stored number for a place, a trusted person, and 112, and `no_number` for a stranger. |
| `test_nearby.py::test_no_park_suggestion_late_at_night` | A park is refused late at night. A hospital is still answered. |
| `test_calendar.py` (3 tests) | The next festival after 18 Oct 2026 is Karwa Chauth on 29 Oct. A stored park is part of the invitation by day and left out at night. A calendar holiday joins the built-in festivals without replacing them. |

### Access, accounts, and storage

| Test | What it proves |
| --- | --- |
| `test_access.py::test_family_code_is_limited_to_phone_routes` | A family code opens desk read, heartbeat, and invitation. It gets 401 on desk write, files, file links, pairing, updates, and classify-impact, and on any other household. |
| `test_access.py::test_cors_allows_only_known_origins` | Local dev origins are allowed. `evil.example.com` and a look-alike are not. |
| `test_pipeline.py::test_household_access_rules` | The demo household is open, an owner reaches their own, another account does not, and a parent device reaches only its household through the family code. |
| `test_households.py::test_get_demo_desk` | The demo desk is Kamla, Hindi, with Rahul and a BP tablet. |
| `test_households.py::test_household_crud_and_pairing_flow` | Create a household, read the desk, add a memory and medicine, make a seven-character family code, look it up, and join as the parent. |
| `test_family_members.py::test_add_and_list_family_members` | A caretaker adds a second person, sees both in order, and opens the new desk. Another caretaker gets 403. |
| `test_family_members.py::test_profile_save_cannot_add_households_or_point_elsewhere` | A profile save cannot add households or point at one that is not theirs. |
| `test_files.py` (4 tests) | The file path layout is fixed. A link key works at 29 minutes and fails at 31. A tampered key is rejected. Only public folders are served without sign-in, and `..` paths are refused. |
| `test_store_errors.py::test_empty_path_segment_is_refused` | A blank household id is refused. |
| `test_store_errors.py::test_cloud_run_error_does_not_switch_to_memory` | A Firestore error on Cloud Run does not silently switch to a memory store. |
| `test_store_errors.py::test_parent_phone_registers_push_with_family_code` | A parent phone registers its push token with the family code. A caretaker token from that phone is refused. |

### Cost, retention, and health

| Test | What it proves |
| --- | --- |
| `test_cost.py::test_live_sessions_stay_short_and_idle_instances_stay_off` | The session cap is 240 seconds, minimum instances are 0, and vector neighbours are 5 or fewer. |
| `test_cost.py::test_explicit_cache_is_only_for_a_prefix_large_enough_to_discount` | Explicit context caching starts at 4096 tokens and not below. |
| `test_retention.py::test_transcripts_after_7_days_and_observations_after_30` | Old transcript words and old observations and daily numbers are cleared. Recent ones and the response-gap number stay. |
| `test_retention.py::test_demo_visitor_gets_three_voice_sessions` | A demo visitor gets three voice sessions a day, then a message. A different visitor is not blocked. |
| `test_retention.py::test_simulated_inactivity_creates_an_invitation_for_the_demo_only` | Simulated inactivity works only on the demo household and is labeled "Simulated." |
| `test_quota.py` (7 tests) | Repeated reads and writes stay cheap: query filtering, one heartbeat write per window, a remembered "no invitation", an older cache copy served when a rebuild fails, a Firestore quota error becomes 503 with `Retry-After: 60`, the scheduler opens a desk only when a check-in is due, and an access "yes" is remembered then forgotten on demand. |
| `test_demo.py` (2 tests) | The demo status names the Kamla household. The demo clock advances 30 minutes and resets. |
| `test_health.py` (2 tests) | The API reports `saathi-api`, request-based CPU, 0 minimum instances, and a 240-second cap. The worker reports `saathi-worker`. |

## Extraction eval: 30 labeled cases

`eval/cases/extraction.jsonl` holds the cases. `scripts/eval_extraction.py` sends each transcript to Gemini Flash through the same `extract_session` the worker uses and checks the result against the case's `expect` block. A failure is printed with what the model returned and nothing is retried. The last run is in `eval/report.json`: **30 of 30**.

| Group | Passed | What a case checks |
| --- | --- | --- |
| negation | 6 / 6 | "Main giri nahi" and "I did not fall today" record no discomfort or fall |
| someone_else | 5 / 5 | A neighbour's fever or Sharma ji's fall is not recorded as the parent's |
| family | 3 / 3 | Rahul is picked up as a family person, both when he calls daily and when he stops answering |
| correction | 2 / 2 | "Meena meri behen hai, beti nahi" and a change of city become corrections |
| fasting | 2 / 2 | An ekadashi vrat and a roza are recorded as fasting |
| hypothetical | 2 / 2 | "If I fall..." and "maybe I will get a fever" are not recorded as events |
| illness | 2 / 2 | "Do din se bukhar hai" and a cold are recorded as illness |
| meal | 2 / 2 | A reported meal of roti and dal, or khichdi, is recorded as eaten |
| mood | 2 / 2 | "Bahut akela lagta hai" and "bahut khush hoon" set a mood |
| unknown | 2 / 2 | "Sab theek hai" and "Pata nahi, yaad nahi" add no family episode or discomfort |
| declined | 1 / 1 | A topic the parent declines ("chhodo") records no discomfort |
| discomfort | 1 / 1 | "Kamar mein dard" is recorded as discomfort |

The set is small and written by the team, so it shows the rules hold on these cases and not that the model is accurate in general.

## Deployed smoke check

`scripts/smoke_cloud.py` reads the live services. The eight checks:

1. The site returns 200 and HTML.
2. The manifest has the right content type.
3. The API `/health` returns `status: ok`.
4. The API allows CORS for the site origin.
5. The API refuses CORS for another origin.
6. The demo status route returns 200.
7. The worker's `/health` is private (401 or 403).
8. The worker rejects an anonymous tick.

With `--invoke`, a ninth check calls the worker tick with an ID token for the invoker account and expects 200. The last recorded result, 8 of 8 on 16 Oct 2026, is in [ENVIRONMENT.md](ENVIRONMENT.md).

## Not tested automatically

- A real Hindi conversation on the public site from a second browser, and FCM on a real phone. These are recorded as unchecked in [PROGRESS.md](PROGRESS.md).
- Any language by an automated voice test (Hindi and Marathi were checked by hand by the team), a native-script distress word, and extraction outside Roman-script Hindi, Hinglish, and English. See [LANGUAGES.md](LANGUAGES.md).
- Audio quality and the reply pause. The pause is measured in the browser during test sessions, and the figure is a sample.
- The web app's screens and the installable phone app.
