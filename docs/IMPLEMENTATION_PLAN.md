# Implementation plan

Order of work for 15 to 18 Oct 2026. Behavior is in [SPEC.md](SPEC.md). The system is in [ARCHITECTURE.md](ARCHITECTURE.md). Priority is in [MASTER_PLAN.md](MASTER_PLAN.md).

```mermaid
flowchart LR
  thu[Thu 15: voice skeleton] --> fri[Fri 16: memory and drift]
  fri --> sat[Sat 17: desk, chat, distress]
  sat --> sun[Sun 18: video and submit]
```

| Day | Build | Stop when |
| --- | --- | --- |
| Thu 15 Oct | Project skeleton, health on a public URL, one Hindi turn, worker rejects an anonymous call | `docs/ENVIRONMENT.md` has the model ids that passed |
| Fri 16 Oct | Extraction, caretaker and chat memory, family episodes and embeddings, pause measurement, BigQuery drift, SafetyGuard, three ADK tools | One session writes an observation, a nearest episode, a BigQuery row, and an insight that passes the guard |
| Sat 17 Oct | Proactive greeting, distress check, once or daily reminder with a spoken confirm, both fronts, install path, notification tap | A parent opens `/app` and a caretaker opens `/care`. A caretaker memory shows up in the next greeting. "Ouch" asks "Kya hua?" |
| Sun 18 Oct | Feature freeze in the morning. Demo isolation, video, PDF, public repo, second browser | Receipt saved. Leave hours before the portal cutoff |

If Thursday's voice session does not connect, Friday morning is still voice.

## Status

The product in [SPEC.md](SPEC.md) is finished and deployed. Milestones M01 through M13 and M15 are complete. M14 is the form itself: this repository, the English docs, and the tests are in place. The deck PDF and the three-minute video are the two files the form asks for beside the repository. M16, a Nest speaker, is later work.

| Id | Result | State |
| --- | --- | --- |
| M01 | Cloud project, local API and web, `/health` reports `stage: connected`, public deploy | Complete |
| M02 | Household, consent, pairing, judge demo without an account form | Complete |
| M03 | Hindi Live bridge, Talk / Stop / Pause / Contact family. The socket opens before Talk | Complete |
| M04 | Extraction, memory, family episodes, vector index | Complete |
| M05 | Browser pause measurement. Speaking rate is a stored field the live chat does not fill | Complete |
| M06 | Proactive invitation, snooze, unanswered versus device unavailable, FCM push | Complete |
| M07 | Reminder records, once and daily, medicine and the other kinds, from the care desk | Complete |
| M08 | Voice create and confirm, and a spoken "I have done it" on a reminder that is already due | Complete |
| M09 | BigQuery daily rows and the SQL drift rule | Complete |
| M10 | SafetyGuard, ADK insight, immediate contact path | Complete |
| M11 | Care desk, caretaker memories, Ask Saathi, nearby help, several family members | Complete |
| M12 | In-app alert and FCM. The service worker shows the notice and speaks it when the app is open | Complete |
| M13 | Labeled synthetic household and demo clock | Complete |
| M14 | Public repo and English docs are here. Deck PDF and video go with the form | Submission files |
| M15 | PWA manifest, install sheet or iPhone instructions, notification opens the chat. Redux and localStorage keep the desk on the phone | Complete |
| M16 | Nest speaker | After submission |

## Milestones

| Id | Result |
| --- | --- |
| M01 | Cloud project checked. API and web run locally and `/health` reports `stage: connected`. A public deploy is a separate check and is not recorded as done |
| M02 | Household, consent, pairing, judge demo without an account form |
| M03 | Hindi Live bridge, Talk / Stop / Pause / Contact family |
| M04 | Extraction, memory, family episodes, vector index |
| M05 | Browser pause measurement. Speaking rate is a stored field the live chat does not fill |
| M06 | Proactive invitation, snooze, unanswered versus device unavailable |
| M07 | Reminder records, once and daily, from the care desk |
| M08 | Voice create and confirm |
| M09 | BigQuery daily rows and the SQL drift rule |
| M10 | SafetyGuard, ADK insight, immediate contact path |
| M11 | Care desk cards, including caretaker memories |
| M12 | In-app alert, then FCM if the in-app path is solid |
| M13 | Labeled synthetic household and demo clock |
| M14 | Video, deck, public repo, submission receipt |
| M15 | PWA manifest, install sheet or iPhone instructions, notification opens the chat |
| M16 | Nest speaker. Starts only after M14 is submitted |

M01 through M05, M09, M10, M11, M13, and M14 are the P0 line, together with the landing page and both layouts. M06, M07, M08, M12, and M15 are P1. M16 is after Sunday.

The original fourteen-milestone note used M01 to M14 for a deeper reminder and notification design. This calendar keeps those numbers and adds M15 for the installable phone app and M16 for Nest, which the master plan already set aside.

## Checks after each slice

Write the command and the real result in [PROGRESS.md](PROGRESS.md). Do not mark a browser check passed by reading the code.

| Check | Proves |
| --- | --- |
| `python -m pytest api/tests` | Health, safety, drift, live, pipeline, scheduling, files, nearby, family members, quota, and household access. 100 tests collected on 17 Oct 2026; the last recorded green run is 80 passed on 16 Oct 2026 |
| Safety tests | Diagnosis, dose advice, and an order to enter counselling are rejected |
| Drift fixtures | Stable, changing, fasting, and family-shift histories |
| A real browser | Hindi audio, parent chat versus caretaker desk, and the health line on the demo page |

## Submission pack

- Deployed URL that opens in a fresh window on a phone and on a laptop
- Public GitHub repo, English README, green tests
- PDF deck
- Public video under 3 minutes
- Theme on the form: Sustainability and Social Impact
