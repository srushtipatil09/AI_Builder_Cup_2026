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
