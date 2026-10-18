# Progress

The product a judge should read is [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), and the README. Those describe the finished app.

Finished and in the running system: Live voice with the household already in the prompt, a socket that opens before Talk, gapless playback and barge-in, memories and family episodes, BigQuery drift, SafetyGuard, proactive check-in, Firebase push, a spoken yes that confirms a due reminder, Ask Saathi, nearby help, ten languages, up to 10 family members, Redux with versioned localStorage, accounts, private files, and the installable phone app.

The notes under this line are the build log. Where an older note says a feature was still open, the opening of this file replaces it.

## 15 Oct 2026 — repository scaffold

Created the app layout from the master plan.

| Path | What it is |
| --- | --- |
| `api/src/saathi/main.py` | Public FastAPI app, `GET /health` reports the billing shape |
| `api/src/saathi/cost.py` | Session cap, scale-to-zero, Flash and cache limits, BigQuery byte cap |
| `api/src/saathi/worker.py` | Worker app, `GET /health` |
| `web/src/pages/` | Landing page, care desk, companion chat |
| `web/public/manifest.webmanifest` | PWA manifest, `start_url` `/app` |
| `docs/` | Spec, architecture, plan, decisions, demo, privacy |

Not done: Gemini, Firebase Auth, Firestore writes, BigQuery, Cloud Tasks, notifications, and the install prompt behavior. The landing form does not create an account yet.

### Next action

Select the Google Cloud and Firebase project id, put it in `.env`, and run the model smoke for M01. Until that id exists, keep building the voice bridge against the local API.

### Commands run on 15 Oct 2026

```text
python -m pip install -e "api[dev]"
python -m pytest api/tests
```

Result: 2 passed. The machine used Python 3.13, which satisfies `requires-python >= 3.12`.

```text
npm install --prefix web
npm run build --prefix web
```

Result: `tsc --noEmit` and the Vite production build finished with exit code 0.

Local check in a browser: the landing page opens, Create account reveals the parent-name field, the demo link reaches `/app?demo=1`, the health line reads `saathi-api is ok (scaffold)`, a wide window shows the care desk, and a 390px window shows Talk plus a Care desk button. No application console errors.

## 15 Oct 2026 — UI pass and the phone install path (M15, partial)

The landing page, Log in, Create account, care desk, and phone chat share one warm theme. The care desk shows the seven cards from the spec in order, with empty states. The demo shows only the synthetic facts the plan states.

| Path | What changed |
| --- | --- |
| `web/public/manifest.webmanifest` | `start_url` and `id` are `/app`, `scope` `/`, three PNG icons including a maskable one |
| `web/public/icons/` | 192, 512, maskable 512, 180 apple-touch, 32 favicon |
| `web/index.html` | Apple touch icon, standalone meta tags, `viewport-fit=cover` |
| `web/public/sw.js` | App-shell cache. Pages are network first; the cached `/app` opens offline |
| `web/src/install.ts` | Catches `beforeinstallprompt` before React renders. Hidden when standalone or after `appinstalled` |
| `web/src/pages/InstallSheet.tsx` | Chrome: an Install Saathi sheet that calls the browser prompt. iPhone: Share, then Add to Home Screen, in four pictures |

Not done: FCM and the notification tap, and the demo panel buttons (shown disabled).

### Checks run on 15 Oct 2026

`npm run build --prefix web`: exit code 0.

In a 375px browser window: a synthetic `beforeinstallprompt` event showed the Install Saathi sheet, the button called `prompt()`, and the sheet closed. With an iPhone user agent, the sheet showed the four steps. Done hid it and left an "Install Saathi on this phone" link. No horizontal scroll.

Not tested: a real install on an Android phone or an iPhone. The service worker registers only in a production build and has not been checked on a deployed URL.

## 15 Oct 2026 — phone screens feel like an app

On a phone, Chrome reported "This app cannot be installed" through a dev tunnel. Two causes were fixed: the manifest link now sends credentials (`crossorigin="use-credentials"`), so a signed-in tunnel serves the manifest instead of its login page; and the service worker now registers on the dev server too, as a pass-through with no cache.

Phone screens changed:

- Log in and Create account drop the site header, footer, and side panel. They show the app icon on teal, then the form on a sheet. The status bar is tinted teal on those screens.
- The signed-in app has one compact bar: avatar, name, and a **Care desk** text button that switches to **Back to chat**. Leave demo / Log out sits at the end of the page.
- Talk, Stop, Pause, and Contact family stay docked at the bottom while the chat scrolls.
- Taps have no grey highlight and a small press effect. The installed app does not pull-to-refresh.

Checked in a 375px browser window and with `npm run build`. A real install on a phone has not been confirmed yet.

## 15 Oct 2026 — care desk in five tabs, desktop only

Decision (team, 15 Oct): the care desk is not shown on a phone. The phone is the parent's chat only. `docs/SPEC.md` and `docs/DECISIONS.md` D8 are updated.

The desk is five tabs: Profile, Daily, Medicines, Tell Saathi, Emergency. Files: `web/src/pages/CareDesk.tsx`, `web/src/pages/desk/`, `web/src/desk.ts`, `web/src/demoHistory.ts`.

| Works now | Not connected yet |
| --- | --- |
| Profile, people, memories, medicines, and contacts save in this browser, per household | Firestore writes and sync between devices |
| Daily shows the demo's synthetic Day 1 to Day 14 history, labeled, with hover values and a table view | Real daily metrics from BigQuery. A signed-in household shows "Learning usual routine" |
| Tell Saathi takes a typed message and can keep it as a memory | Reading the message into a change, read-back, and confirm. The microphone button is disabled until the Live connection exists |

Checked in a 1366px browser window: added a memory, kept a Tell Saathi message as a memory, both stored with the author; four charts render with tooltips. At 360px the care desk is not in the page and the chat fits. `npm run build` exit code 0.

## 15 Oct 2026 — separate caretaker app and caretaker demo

- `/care` is the caretaker app (`web/src/pages/CareApp.tsx`). Wide window: a sidebar with the parent card, five tabs, API status, and Leave. Phone: a top bar, one section at a time, and a bottom tab bar. A "Finish setting up" checklist on Profile links to the tab that completes each step.
- `/app` is the parent's phone. A signed-in caretaker on a wide window is sent to `/care`. The parent demo on a computer shows the phone in a frame.
- The landing page, header, footer, and login offer both demos: Kamla's phone and the caretaker app. `/login?next=/care` returns to the caretaker app; no other return path is accepted.

Checked in the browser at 1366px (caretaker sidebar, framed parent demo, home page demo cards) and 360px (caretaker top bar and tab bar, Daily, Tell Saathi, login demo links). `npm run build` exit code 0. Not tested on a real phone.

## 15 Oct 2026 — caretaker tab bar and tab names

Tabs are now, in order: Profile, Routine, Ask Saathi, Reminders, Trusted Contacts (same content as Profile, Daily, Tell Saathi, Medicines, Emergency). On a phone the bottom bar is curved: the active tab's icon rises into a floating circle cradled by a bump, and both slide to the chosen tab. Checked at 390px: the circle and icon line up on the first, middle, and last tab, and the Ask Saathi message box stays clear of the circle. `npm run build` exit code 0.

## 15 Oct 2026 — home page styles restored, caretaker desktop rail

- Fixed: an earlier stylesheet cleanup deleted the landing page rules (hero, promises, offers, day band). They are restored from the session's last good version; the home page measures 1140px sections and a two-column hero again.
- Caretaker desktop at 1280px and wider has a right-hand "at a glance" rail: the parent card (photo in the demo), check-in time, quiet hours, counts that jump to their tab, the family-mention card (demo), and a phone preview link (demo only, because a signed-in caretaker on a wide window is sent back from /app).
- The header shows today's date. Panel layout now follows the content width (container queries), so forms are not squeezed by the rails.
- Fixed: on phones, hidden screen-reader labels stretched the page to 1540px; the content area is now their positioning context. All five tabs measure exactly one screen at 390x844.

## 15 Oct 2026 — urgent reminders on Routine

Routine now opens with "Needs attention now" when a reminder is due within 60 minutes, or came due in the last 3 hours and is not yet confirmed (status reporting is not connected, so every reminder is unconfirmed for now). It updates each minute and links to Reminders. Wording is "Not yet confirmed", never "missed dose", and no dose advice. The demo seeds one synthetic "BP tablet" reminder 20 minutes after the demo opens; the demo store key moved to `saathi.desk.demo.v2` so earlier visitors get it. Checked: a reminder 30 minutes past shows, one 2 hours ahead and one 5 hours past do not. 1440px and 360px layouts checked. `npm run build` exit code 0.

## 15 Oct 2026 — Ask Saathi on desktop

On a wide window Ask Saathi fills the window height: a chat header, a thread that grows, and the message box at the bottom. Beside it, a guide replaces the at-a-glance rail: "Try saying" examples grouped by Memories, People, Check-in, and Reminders (a tap fills the box), "How it works" in three steps, and the last three memories added. Phones keep the single chat with one row of examples. Checked at 1440x900 (page does not scroll; an example, Send, and Keep as a memory show up under Recently added) and 390x844 (chat fills the screen above the tab bar). `npm run build` exit code 0.

## 15 Oct 2026 — Ask Saathi guide in the right rail, phone chat

- Desktop (1280px and wider): on Ask Saathi the full-height right rail holds the guide (Try saying, How it works, Recently added) in place of the at-a-glance cards. The tab renders it there through a React portal, so tapping an example still fills the message box.
- Phone: Ask Saathi is a full-screen chat with no card around it: a chat header, the thread on the page background, one row of examples, and the message box clear of the tab bar circle. The page heading is visually hidden on that tab and stays available to screen readers. Every tab's heading is more compact (greeting and date on one line).
- Checked at 1440x900 and 360x760: neither page scrolls, the example fills the box, and the message box ends 14px above the circle. `npm run build` exit code 0.

## 15 Oct 2026 — care desk data entry completed

Audit of every tab on desktop (1440px) and phone (360px), then added what was missing:

| Tab | Added |
| --- | --- |
| Profile | Quiet hours as two time pickers (both or neither); Edit for people who matter; Edit for memories, shown as "edited"; memory field is a text area that stacks on phones |
| Routine | "Mark confirmed" on each urgent reminder; a confirmed reminder leaves the card |
| Reminders | A required date for "Once"; a read-back ("Saathi will say …") with Confirm and save, per the spec's save-only-after-confirm rule; Edit; Mark confirmed / Undo, recorded as "Confirmed today · <name>" |
| Trusted Contacts | Edit, shown as "Add phone" when no number is set; phone check (8 to 13 digits, + allowed); a message for an empty name; a reminder to add someone who lives nearby |

Ask Saathi and the Routine charts are read-only by design. Checked in the browser: every new input saves, validates, and shows up in At a glance, the urgent card, and the setup checklist. `npm run build` exit code 0.

## 15 Oct 2026 — account roles and the family code

- Create account asks "Who is this account for?" first, then shows only that role's fields. Log in has a Caretaker / For myself switch and a link to join with a code.
- `web/src/family.ts`: six-character family codes (`KMR-4F7`, no look-alike characters), join links that carry only the code, join status, and a new-code action. `web/src/pages/JoinPage.tsx` at `/join` and `/join/:code`. `web/src/pages/desk/FamilyCard.tsx` on Profile, with Copy join link, Share where the browser supports it, and the status.
- Sessions carry a role. A parent goes to `/app` and is sent away from `/care`; a caretaker goes to `/care` from `/app` on any screen. A parent on a computer sees the phone screen centred.
- Checked in the browser: caretaker signup to `/care`, create a code, open `/join/pcn2jt` at 360px (normalised and recognised, name prefilled), join to `/app` with no password, the desk then shows "Joined" and ticks the first setup step; parent signup with a bad code shows a message and a good one links to the household. `npm run build` exit code 0.
- Not done: codes are kept in this browser, so pairing across two real devices needs Firestore.

## 15 Oct 2026 — role stays with the account; joining is a step after sign-in

- Log in has no role switch and no join link. `web/src/session.ts` remembers each account made in this browser by email, with its role; an email this browser has not seen signs in as a caretaker until Firebase Auth can look it up.
- Parent signup no longer asks for a code. After a parent signs up or logs in without a family, `/join` shows once with **Skip for now**. A join link opened without an account goes to signup with the parent option preselected, then to `/join/<code>` with the code filled in.
- The parent's chat shows **Join family** until they join; it opens `JoinSheet` with the same `JoinForm`. Escape and Not now close it.
- Checked at 360x760: caretaker signup and code; link with no account to signup to the join step (code prefilled, "Found Rahul's code"); join to the chat, subtitle "With Rahul's family"; email and password login sends each role home; a second parent skips, logs in again straight to the chat, and joins from the sheet (a bad code shows a message). `npm run build` exit code 0.

## 15 Oct 2026 — Family button in the parent's app

The parent's chat always shows a **Family** button (filled before joining, outlined after). `web/src/pages/FamilySheet.tsx` replaces the join-only sheet: before joining it shows the join form; after joining it shows the family code, who looks after them, and the join date, with Change code (Cancel returns). The Kamla demo shows it with a Demo tag and a synthetic family (code KMR-4F7) held in memory, so trying Change code writes nothing. The demo's top bar uses the preferred name "Kamla" so the button and Leave fit at 360px. Checked at 360x760 for the demo and for a real parent: join, view, change, cancel. `npm run build` exit code 0.

## 16 Oct 2026 — Backend features end-to-end implementation

Implemented all 8 core backend features matching the approved plan, architecture, and constraints:

1. **Contracts & Firestore Data Layer (`saathi.contracts`, `saathi.providers.firestore`)**:
   - Typed Pydantic schemas for `Identity`, `Profile`, `People`, `Memories`, `Medicines`, `Contacts`, `Desk`, `Reminders`.
   - Firestore repository with Google Cloud Firestore client (`google-cloud-firestore`) and automated in-memory fallback for offline test isolation.
   - Household pairing code generator (`KMR-4F7`) and join exchange.
   - Web API client (`web/src/lib/api.ts`) wired to `/api/v1/households`, `/api/v1/desk`, `/api/v1/pair`.

2. **Live Voice Bridge (`saathi.live`)**:
   - Bidirectional audio WebSocket bridge at `/api/v1/sessions/{session_id}/live` with authentication and 240-second cap. The running default is `gemini-live-2.5-flash-native-audio`, not the earlier candidate id `gemini-3.8-live`.
   - Persona prompts (Saathi / Rakshak) with local time, caretaker memories, and verified family episodes.
   - Speech synthesis, speech recognition, and fallback text turns at `/api/v1/sessions/{session_id}/text`.

3. **Post-Call Gemini Flash Extraction & Vector Memory (`saathi.memory`)**:
   - Structured observation extraction (`gemini-2.5-flash` by default in `config.py`) for meals, mood, discomfort, family episodes, and memory corrections.
   - Multilingual vector embeddings (`text-multilingual-embedding-002`) and Firestore Vector Search with cosine similarity.
   - Deterministic Family Shift Rule comparing earlier and later episodes, generating non-diagnostic caregiver card linking Elderline 14567.

4. **In-Session Distress & Loud Impact Audio Classification (`saathi.live.distress`)**:
   - Keyword backstop in Hindi/English ("ouch", "bachao", "gir gayi") and negation handling ("I did not fall").
   - Gemini Flash impact audio classifier distinguishing `possible_impact` vs `ordinary_noise` (doors, dropped spoons).
   - Instant spoken check ("Kya hua? Gir gaye kya? Main yahin hoon.") and Level 3 escalation.

5. **BigQuery Behavioral Drift Engine & ADK SafetyGuard (`saathi.analytics`, `saathi.insights`)**:
   - SQL drift comparison (D-2..D vs D-13..D-3 baseline with variance floor 250ms).
   - Intentional fasting detection excluding planned skipped meals from escalation.
   - Pure Python **SafetyGuard** with 25+ test cases forbidding diagnoses (dementia, depression), dosage advice, and clinical orders.

6. **Dual-Channel Reminders (`saathi.reminders.voice`)**:
   - Verbal read-back and confirmation before committing reminders.
   - Medicine uncertainty handling ("yaad nahi" -> `uncertain`, never suggests extra dose).

7. **Proactive Check-in Scheduler & FCM (`saathi.scheduling.service`, `saathi.worker`)**:
   - Worker `/internal/tick` for minute-by-minute check-ins.
   - Unanswered check-in lifecycle (30s listen, 5m retry, 15m Level 2 welfare check; device offline -> `device_unavailable`).
   - Generic lock-screen push notification formatting.

8. **Demo Isolation & Testing Harness (`saathi.demo.routes`)**:
   - Logical clock advance (`POST /api/v1/demo/advance`) scoped to demo household.
   - Demo panel controls on CompanionChat (distress clip, door clip, seeded session).

### Commands run:
```bash
make test
# Result: 55 passed in 0.93s

make web-build
# Result: tsc --noEmit && vite build: 0 errors (built in 423ms)
```


## 16 Oct 2026 — real Live voice, Google sign-in, household wiring

| Area | What changed |
| --- | --- |
| Voice | `live/bridge.py` streams the microphone (16 kHz PCM) to Vertex Live (`gemini-live-2.5-flash-native-audio`, voice Aoede) and sends 24 kHz audio plus captions back. The line opens when the chat page loads; the greeting starts about 1 s after Talk. No microphone falls back to browser speech through a `text_mode` message |
| Browser audio | `web/public/pcm-worklet.js` and `web/src/lib/liveAudio.ts`: capture, gapless playback, interruption, and the pause between the parent's last loud frame and the first reply audio (median sent to `/complete`) |
| Sign-in | Continue with Google on Log in and Create account, through Firebase Auth (`web/src/lib/firebase.ts`). The ID token is sent to the API |
| Household | The parent's chat used the household id `current`, so real households never reached Gemini with their desk. It now resolves the caretaker's household from the family code. The greeting asks about the first caretaker memory |
| Family code | API links (snake_case) are mapped to the web's `FamilyLink`. Join checks the API when the code is not in this browser, and rejects an unknown code |
| Firestore | Desk cache of 120 s, session records use merge so the browser's `/complete` measurements survive, warm-up at startup |

Checks run: `python -m pytest` 55 passed. `tsc --noEmit` and `vite build` exit code 0. A live session against Vertex returned Hindi audio and captions. A household with a family code, a desk memory, and a session was written to Firestore, read back, and deleted.

Not checked: Google sign-in completion (the browser pane blocks popups), a real microphone, a deployed Cloud Run URL. The access and account gaps in the next sentence were closed later the same day: household routes check the caller, and email/password accounts use Firebase Auth. See the gap pass and the real-accounts entry below.


## 16 Oct 2026 — gap pass against the master plan (P0 pipeline, then P1)

Compared `.sources/Saathi App Master Plan.md` with the code. The main P0 hole: `/complete` never ran extraction, nothing wrote BigQuery rows, the insight was never stored or shown, and the family-shift card contained invented quotes. Implemented in order:

| Slice | What changed | Where |
| --- | --- | --- |
| Post-call pipeline | One idempotent run per session id: Flash extraction (quotes must occur in the parent's words), family episodes with Vertex embeddings, observation, daily metric (recomputed per day), BigQuery upsert, drift, insight, alerts | `api/src/saathi/pipeline.py` |
| Cloud Tasks hand-off | `/complete` enqueues one task named by session id; with no `WORKER_URL` it runs in-process. Worker checks the OIDC invoker when `TASK_INVOKER_EMAIL` is set | `taskqueue.py`, `worker.py` |
| BigQuery | Creates `daily_metrics`, MERGE upsert (household id hashed), SQL drift rule (D-2..D vs D-13..D-3, floors 250 ms and 5 wpm, two successive dates), meals rule, 100 MiB cap; Python rule as fallback | `analytics/bq.py`, `analytics/drift.py` |
| Family shift | Rule runs per person on stored episodes. Removed the hard-coded Rahul quotes that were shown when a quote was missing | `memory/vectors.py` |
| Firestore vector search | Native `find_nearest` with a vector index on `familyEpisodes.embedding` (768, cosine), cosine fallback | `firestore.indexes.json`, index created |
| Insight | SafetyGuard also checks alarm words below Level 3, ungrounded falls, numbers with no evidence id; tier chosen by code; evidence ids stored; model drafts, template on failure | `insights/` |
| Alerts | Level 3 on said-help keywords, Contact family, or distress/impact followed by 20 s of silence (wording says no reply, not a fall); 24 h cooldown appends evidence for Level 2 | `notify.py`, `live/bridge.py` |
| Impact clips | Browser watches mic energy while Saathi is silent and sends about 3 s to Flash for a label; labeled door and thud clips in the demo panel | `liveAudio.ts`, `live/distress.py` |
| Prompt context | Last 3 summaries, declined topics, one family thread from nearest episodes, caretaker facts before conversation facts, 6,000 character budget. Removed the invented default "Rahul, son" | `live/context.py`, `live/prompts.py` |
| Voice reminders | Live tools `propose_reminder`, `confirm_reminder`, `get_family_context`; saved only after the parent's own yes | `live/bridge.py` |
| Ask Saathi | Typed or dictated note becomes one proposal with a server-built read-back and payload hash; saved on confirm; doses the caretaker did not type are dropped; dose or diagnosis questions are refused | `asks/service.py`, `TellSaathiTab.tsx` |
| Care desk | Routine tab reads real data every 10 s: alerts, insight, family card, drift status, charts, summaries; banner on other tabs for Level 2 and 3; demo controls to seed the four labeled scenarios, run a seeded session, and simulate unanswered versus device unavailable | `RoutineTab.tsx`, `households/updates.py`, `demo/` |
| Invitations | Tick scans all households, fires each check-in once, honours quiet hours; open chat heartbeats and polls, claims a lease, plays, Later counts as a response, blocked mic is `device_unavailable`, two played and unanswered for 15 min is a Level 2 welfare check | `scheduling/service.py`, `CompanionChat.tsx` |
| FCM | Token registration, generic push text, service worker push and click handlers; API calls are no longer cached by the service worker | `lib/push.ts`, `public/sw.js` |
| Access | Household checks on desk, pairing, sessions, WebSocket and new routes: verified email equals household id, uid owner or member, or a joined family code. Off-by-default strict mode `REQUIRE_HOUSEHOLD_AUTH` | `auth/firebase.py` |
| Spend caps | Daily extraction calls and Live minutes counted in Firestore | `usage.py` |

### Commands and real results

```text
python -m pytest -q            (api/)  71 passed in 29.68s
npx tsc --noEmit               (web/)  exit 0
npx vite build                 (web/)  built in 1.77s
```

- Live drift check on real BigQuery and Firestore, four labeled households (stable, changing, fasting, family): BigQuery and the Python rule agreed. Stable: no candidate, tier 1. Changing: candidate on response gap, z 3.15, tier 2, evidence ids. Fasting: no candidate, fast and illness context stored. Family: card with both quotes. All test households and BigQuery rows deleted.
- Live end-to-end on a local API (port 8082) with real Vertex Live: greeting audio, door clip labeled `ordinary_noise` (no alert), thud clip labeled `possible_impact`, spoken check, no reply, Level 3 alert written. `/complete` ran the pipeline in about 12.7 s: observation, daily row, BigQuery row, drift through BigQuery, insight, summary. Test data deleted.
- Voice reminder: after the parent's request the read-back came first and nothing was saved; after "Haan, save kar do" one Daily 08:00 reminder with the dose as said was saved. Deleted.
- Ask Saathi against Gemini: memory, check-in time, quiet hours, person, reminder, dose question (refused). Found and fixed an empty-enum schema error that had silently sent every note down the fallback.
- Firestore native `find_nearest` returned the expected neighbours once the vector index was READY.
- Browser pane: Routine tab on the caretaker demo showed live data and the family card after pressing Family.

### Left from this pass
- Cloud Tasks queue `saathi-pipeline`, worker deploy, Cloud Scheduler job: code is ready, none created, so the task path is checked only by a unit test of the request body.
- Not checked in a browser: FCM token and a real push, a real microphone impact clip, Google sign-in, the invitation banner on a phone, real installed PWA.
- Email and password accounts still have no Firebase identity, so strict access mode would lock them out. Superseded the same day: Create account and Log in use Firebase Email/Password, and the profile is stored at `users/<uid>`.
- ADK `root_agent` is not wired (`google-adk` not installed); the three tools run in a fixed order. Superseded by the ADK subsection below: the agent is optional, and the fixed order remains the fallback.
- Desk is saved as a whole document, so a conversation correction written by the pipeline can be overwritten by a stale browser save.
- In-process fallback on Cloud Run with request-billed CPU can stall after the response; use the Cloud Tasks path there.
- Seeded demo history for `demo-kamla-sharma` now exists in Firestore and BigQuery (labeled synthetic).

### ADK insight agent
- `insights/agent.py` now defines a real Google ADK `root_agent` (`LlmAgent`, gemini-2.5-flash on Vertex) with the three tools `adk_get_recent_metrics`, `adk_compose_family_insight`, `adk_send_alert`. Household id, tier, evidence ids and issue key sit in ADK session state set by code, so the model supplies wording only; every draft goes through `compose_family_insight` (SafetyGuard) and the Level 2 alert is guaranteed by code even if the model skips the tool.
- `google-adk` is an optional extra (`pip install "saathi[adk]"`); the import is guarded. Without it, or with `INSIGHT_USE_ADK=0`, or on any agent failure, the fixed-order path runs unchanged. Tier 1 (no change) stays deterministic and does not call the agent.
- Checked in an isolated venv (google-adk 2.12.0) on real Vertex with the seeded `changing` scenario: tier 2, agent-worded body, safety passed, evidence ids, one alert. Test data deleted. Main env `python -m pytest -q`: 71 passed.

## 16 Oct 2026 — real accounts, private photos and documents

| Area | What changed |
| --- | --- |
| Accounts | Create account and Log in use Firebase Email/Password (and Google). The role, names, language and family code are saved in Firestore at `users/<uid>` through `GET/PUT /api/v1/me`, so a new device restores them. A wrong password is now rejected; before, any password of 8 characters worked |
| Strict access | This machine's `.env` set `REQUIRE_HOUSEHOLD_AUTH=true`. The code default in `config.py` is false; `.env.example` sets true. A real household then needs a verified Firebase identity or a joined family code; demo households stay open. Token checks allow 60 s of clock skew |
| Photos and documents | `api/src/saathi/files/routes.py`: profile photo, prescriptions, identity proofs, photos, other. First stored in `saathi-511717-private`. That bucket was emptied the same day and replaced by `saathi-511717-media` (see the file-layout entry). Only the API reads them, after a household access check. JPEG, PNG, WebP or PDF, up to 8 MB, 60 files per household. The care desk Profile tab has a Photos and documents card; the profile photo shows on the parent's card |
| ADK | Optional: `pip install -e "api[adk]"`. Without it the fixed-order insight path runs |

Checked: backend upload, list, download, wrong type (415), demo (403) and delete against real Cloud Storage and Firestore. In the browser: signup, upload of a profile photo and an identity proof, log out, log in with a cleared browser and get the same names back, and a wrong password shows a message. `python -m pytest` 71 passed, `tsc --noEmit` and `vite build` clean. Test users, Firestore trees and bucket objects were deleted.

Not checked: Google sign-in completion (the pane blocks popups), a parent signing in on a phone with a family code under strict mode, files opened from a phone. Accounts made before this change exist only in one browser and must be created again.

## 16 Oct 2026 — file layout and 30-minute links

- Bucket `saathi-511717-media` (asia-south1, uniform access). Object path at this moment omitted the category folder. The next entry adds it: `<caretaker|person>/<public|private>/<user-id>/<category>/<name>-<10 random characters>.<ext>`. The code default bucket name is `{project}-media` unless `UPLOADS_BUCKET` is set.
- Prescriptions, bills, and identity proofs are always stored under `private`, whatever the request says.
- A private file is opened with a link key that the API makes for a signed-in household member (`GET .../files/{id}/link`). The key is signed with `LINK_SIGNING_SECRET` and stops working after 30 minutes (`/api/v1/files/open/<key>`). A tampered or expired key returns 403.
- A public file (a photo the family chose to share) is served without sign-in at `/api/v1/files/public/<path>`, and only for paths under `caretaker/public/` and `person/public/`. The bucket stays fully private: Google rejects IAM conditions on `allUsers` grants ("Conditions are not allowed on public resources"), so no public grant was made. For direct bucket URLs, use a second bucket that is public as a whole.
- The earlier bucket `saathi-511717-private` is empty and no longer used.
- Checked: layout, 29-minute and 31-minute keys, tampered key, real upload, open, and delete against the new bucket. `python -m pytest` and the web build pass.

## 16 Oct 2026 — categories in the file path, dashboard upload forms

- Object path is now `<caretaker|person>/<public|private>/<user-id>/<category>/<name>-<10 random characters>.<ext>`. Categories (`GET /api/v1/files/categories`): profile_photo, family_photos, prescriptions, medical_reports, medical_bills, medicine_photos, identity_proofs, insurance, other. Prescriptions, reports, bills, medicine strips, identity proofs, and insurance are always private. Profile photo keeps one file.
- The Profile tab of the care desk has one upload form and one list per category, with thumbnails, Open, Delete, and an opt-in "anyone with the link" box for photos and Other. Errors (wrong file type, no file, offline) show under the form.
- All 17 non-file dashboard endpoints (`/me`, desk, pairing, metrics, updates, devices, ask, ask/confirm, contact-family, alert ack, heartbeat, invitation) and every file category were called as a real signed-in caretaker with strict access on; all returned as expected. Test users, Firestore data, and bucket objects were deleted.

## 16 Oct 2026 — docs aligned to the code

Compared the clean `dev` tree at `4776be2` with `docs/`. The product docs now match these facts:

- Fronts are chosen by role (`/care` and `/app`), not by window width.
- Model defaults are Live `gemini-live-2.5-flash-native-audio`, Flash `gemini-2.5-flash`, embeddings `text-multilingual-embedding-002`.
- Accounts and family codes live in Firestore. Uploads live in Cloud Storage with 30-minute private links.
- ADK is optional. Empty `WORKER_URL` keeps post-call work in the API process.
- `python -m pytest api/tests --collect-only -q` collected 75 tests. The suite was not re-run, so the last recorded green result remains 71 passed.
- A later check against the code corrected three product claims: a signed-in caretaker is sent from `/app` to `/care` at any width; the browser pause is the wait from the parent's last loud frame to the first reply audio, and the live chat does not send speaking rate; the monthly budget alert is not created by the app. The same note said `DEMO_SESSIONS_PER_VISITOR` was not enforced; the entry below enforces it when Talk starts.
- A public Hosting or Cloud Run URL is still not recorded as verified. Cloud Tasks, the worker service, and Cloud Scheduler are still not recorded as created.

## 16 Oct 2026 — access gaps closed: family code scope, classify-impact, CORS

- A joined family code (`X-Family-Code`, or `familyCode` on the WebSocket) now opens only what the parent's phone needs: the live session, text turn, session complete, heartbeat, invitation and its events, Contact family, and reading the desk. Files, private links, pairing, desk writes, updates, metrics, alerts, Ask Saathi, and devices need a verified member. `has_household_access(..., allow_family_code=True)` marks the phone routes. A parent who signed in with Firebase and joined is still a member and keeps full access. The web phone calls (`CompanionChat`: complete, text, heartbeat, invitation, contact-family; live WebSocket) all land on allowed routes; the parent's phone does not call desk writes or files.
- `POST /api/v1/sessions/{id}/classify-impact` now needs household access and counts one call against the daily extraction limit (429 when spent). The web app does not call it; the live bridge classifies over the WebSocket.
- CORS no longer allows any `https://` origin with credentials. Allowed: `WEB_ORIGIN`, `https://<project>.web.app`, `https://<project>.firebaseapp.com` (project from `FIREBASE_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT`), comma-separated `CORS_EXTRA_ORIGINS`, and `http://localhost:<port>` / `127.0.0.1:<port>`. A deployed API must have one of those project variables or `WEB_ORIGIN` set, or the hosted web app is refused.
- Checked: `python -m pytest api/tests` 77 passed, including `api/tests/test_access.py` (family code under strict mode: desk read, heartbeat, invitation 200; desk write, files, file link, pairing, updates, classify-impact 401; another household's desk 401; an unknown https origin gets no CORS header). Not deployed; not checked in a browser or against real Firestore.

## 16 Oct 2026 — pending items from the master plan, and two production faults

Checked the deployed services from outside: the site, `/health`, and the demo API answer; the worker refuses anonymous calls (403); CORS allows only `https://saathi-511717.web.app`.

Two faults found in production logs and settings:

- Cloud Tasks enqueue failed on every session: `backend-dev@` lacked `iam.serviceAccounts.actAs` on itself, so the API ran each pipeline in-process (request-billed CPU can stall that work after the response).
- The worker had no `TASK_INVOKER_EMAIL` or `WORKER_URL`, so its own check would have refused every Tasks and Scheduler call with 403 even after the first fault was fixed.
- No Cloud Scheduler job existed, so scheduled check-ins and reminders never fired. `LINK_SIGNING_SECRET` was a plain environment variable on both services.

| Slice | What changed | Where |
| --- | --- | --- |
| Security merge | Family code limited to the phone's routes, `classify-impact` needs household access and counts against the extraction cap, CORS narrowed | merge of `claude/recursing-chatterjee-74a940` |
| Retention | `/internal/retention`: transcripts cleared after 7 days (measurements kept); observations, Firestore daily numbers, and BigQuery rows deleted after 30 | `retention.py`, `worker.py` |
| Demo limit | Three demo voice sessions per visitor a day, counted when Talk starts the session; `DEMO_SESSIONS_PER_VISITOR=0` turns it off for recording | `usage.py`, `live/routes.py`, `live/bridge.py` |
| Inactivity simulation | Demo chat button, labeled simulated, creates the same invitation the scheduler sends | `demo/routes.py`, `CompanionChat.tsx` |
| Consent | Create account requires an agreement box; `consentAt` stored at `users/<uid>` and kept on later saves | `SignupPage.tsx`, `accounts/routes.py` |
| Expired sign-in | The care desk sends a 401 to Log in instead of retrying every 20 seconds | `desk.ts` |
| Repo pack | Apache-2.0 `LICENSE`, CI (pytest and web build), `infra/create_bigquery.sql`, smoke and seed scripts, Make targets `lint`, `check`, `eval`, `seed-demo`, `smoke-cloud`, `deploy` | |
| Eval | 30 labeled extraction cases. First run on `gemini-2.5-flash`: 30/30 | `eval/`, `scripts/eval_extraction.py` |
| Deploy | `deploy.ps1` gives the worker its invoker settings and mounts the secret; `setup_cloud.ps1` creates the secret, the grants, and the two Scheduler jobs | `deployment/scripts/` |

Checks: `python -m pytest api/tests` 80 passed. `tsc --noEmit` exit 0. Both PowerShell scripts parse and dry-run.

Not done here: `setup_cloud.ps1` creates a secret and IAM grants, which this agent was not permitted to run; the redeploy waits on it. CI has not run on GitHub yet. Deck and video are not started. The cloud check that followed is recorded in [ENVIRONMENT.md](ENVIRONMENT.md): site, API, private worker, Tasks hand-off, and both Scheduler jobs answered on 16 Oct 2026.

## 17 Oct 2026 — docs aligned to the tree

Compared `docs/` and `README.md` with the source. The product docs now also describe what landed after the 16 Oct entries:

| Area | What the code does | Where |
| --- | --- | --- |
| Nearby help | Hospitals, medical shops, grocery stores, parks, and food from the Places API (New), within 5 km, at most 5, cached one hour. A list the parent opens is stored at `households/<id>/nearbyChecks/<kind>` and the care desk shows that list. Helplines 112, 108, and Elderline 14567, and trusted contacts, still return if Places fails. The parent taps Call. After 9 pm a park lookup is refused | `nearby/`, `live/bridge.py` `find_nearby` and `offer_call`, `NearbyPanel.tsx`, `NearbyCard.tsx` |
| Position | One point rounded to three decimals, saved only after Allow location. The shared demo does not store it. The city on the desk is the fallback. The family can delete it | `PUT/DELETE .../location` |
| Languages | Ten languages in the Live prompt and in the server's distress, listening, yes, no, help, and fine phrases. Hindi remains the demo language | `languages.py`, `live/prompts.py` |
| Several family members | A caretaker adds up to 10 households. Each has a desk and a family code. A profile save cannot attach a household the account does not own | `accounts/routes.py`, `FamilySwitcher.tsx` |
| Ask Saathi questions | A question is answered from stored summaries, daily numbers, and alerts (1 to 14 days), then SafetyGuard. A missing day stays missing | `asks/answer.py` |
| Reminders | Kinds medicine, exercise, call, meal, other. A push sets `seenOn`. The parent's own agreement sets `confirmedOn`. The lock screen has no dose | `scheduling/notice.py`, `MedicineTab.tsx` |
| Late night | From 9 pm to 5 am the prompt drops memories, family threads, and outings | `live/prompts.py` |
| Quota | Short-lived read cache, slower polls when the tab is idle, HTTP 503 with `Retry-After` when Firestore quota is exhausted | `cache.py`, `web/src/lib/activity.ts`, `main.py`, `worker.py` |
| Google sign-up | `/details` asks for the name, language, and city once | `DetailsPage.tsx` |
| Demo cap | Three demo voice sessions a visitor a day, counted when Talk starts | `usage.py`, `live/routes.py` |

Corrected in the same pass: the public URL, the worker, Cloud Tasks, and both Scheduler jobs are recorded as checked in `docs/ENVIRONMENT.md` (the architecture intro had still said they were not). The demo session cap is enforced. Marathi is one of the ten selectable languages; a speaker check for it is not recorded.

```text
.venv/bin/python -m pytest api/tests -q
```

Result: 100 passed, 2 warnings in 29.60s on 17 Oct 2026. The full suite covering access control, safety guardrails, drift comparison, reminders, nearby help, accounts, and quota checks is green.

Web TypeScript check:
```text
cd web && npx tsc --noEmit -p .
```

Result: exit code 0, 0 errors.

Created `docs/PROJECT_OVERVIEW.md` as the unified project submission overview detailing the architecture and how Saathi leverages Firebase (Hosting, Auth, FCM), Firestore (NoSQL + serverless vector search), Cloud Run (API and Worker dual-service container), and Gemini (Live low-latency voice, Flash fact extraction/distress classification, Vertex multilingual embeddings). Aligned project lead naming across documentation (Srushti Patil and Vibhuti Singh).

Still not recorded from a device: a Hindi turn on the public URL from a second browser, FCM on a real phone, a real PWA install, and a speaker check for any language other than the Hindi path used in development. The deck, the video, and the submission receipt are still the Sunday pack.

