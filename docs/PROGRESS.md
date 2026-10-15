# Progress

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

The parent's chat always shows a **Family** button (filled before joining, outlined after). `web/src/pages/FamilySheet.tsx` replaces the join-only sheet: before joining it shows the join form; after joining it shows the code, who looks after them, and the join date, with Change code (Cancel returns). The Kamla demo shows it with a Demo tag and a synthetic family (code KMR-4F7) held in memory, so trying Change code writes nothing. The demo's top bar uses the preferred name "Kamla" so the button and Leave fit at 360px. Checked at 360x760 for the demo and for a real parent: join, view, change, cancel. `npm run build` exit code 0.
