# Environment

Fill this file when a command actually succeeds. Do not invent a project id or a model result.

| Item | Value |
| --- | --- |
| Date checked | 16 Oct 2026 |
| Google Cloud project | `saathi-511717` |
| Firebase project | `saathi-511717` (Hosting, Auth, and Firestore are this project; not a second Firebase project) |
| Vertex / Live region | `us-central1` (`CLOUD_REGION` default) |
| Media bucket location | `asia-south1`, as recorded for `saathi-511717-media` in [PROGRESS.md](PROGRESS.md). The code does not set the bucket region |
| BigQuery location | `US` |
| Live model | `gemini-live-2.5-flash-native-audio` (default in `config.py`; voice `Aoede`) |
| Extract and insight model | `gemini-2.5-flash` |
| Embedding model | `text-multilingual-embedding-002` |
| Uploads bucket | `UPLOADS_BUCKET`, or `{project}-media` when empty. Progress records `saathi-511717-media`. The earlier `saathi-511717-private` bucket is unused |
| API URL | https://saathi-api-ikr6m7lina-uc.a.run.app (Cloud Run `saathi-api`, us-central1). `/health` returned 200 on 16 Oct 2026 |
| Web URL | https://saathi-511717.web.app (Firebase Hosting). Built with `VITE_API_URL` set to the API URL. |
| Git revision | `saathi-api-00007-l7g` and `saathi-worker-00008-drj` (16 Oct 2026, about 18:20 UTC), code from `dev`. `smoke_cloud.py`: 8/8 outside checks pass |
| Billing shape | Request-based Cloud Run CPU, min instances 0, session cap 240 seconds, max bytes billed 100 MiB |
| Household auth | `REQUIRE_HOUSEHOLD_AUTH=true` on Cloud Run. Code default is false for local runs. Demo households stay open |
| Post-call worker | https://saathi-worker-ikr6m7lina-uc.a.run.app, private. End to end on production at 18:22 UTC: seeded demo session `seed-1461db86` → `handoff: cloud_tasks` → worker `process-session` 200 → `pipeline_status: processed`, observation and summary saved in Firestore, `/updates` shows 1 session processed. The worker also answers at `https://saathi-worker-230166691680.us-central1.run.app`, but it accepts only tokens for the first URL |
| Firestore access | On 16 Oct 2026, revisions 00001 to 00006 could not reach a separate Firebase project, so data stayed in per-process memory. As of 18 Oct 2026 Cloud Run uses Firestore in `saathi-511717`: `FIREBASE_PROJECT_ID=saathi-511717` on `saathi-api-00015-lhw` and `saathi-worker-00016-xmj`. `backend-dev@saathi-511717` has `roles/datastore.user` on that project. A container that hits a 403 stays in memory mode until it restarts |
| Runtime service account | `backend-dev@saathi-511717.iam.gserviceaccount.com` for both services, and the Tasks and Scheduler OIDC identity |
| Signing secret | Secret Manager `saathi-link-signing`, mounted as `LINK_SIGNING_SECRET` on both services from revision 00005 |
| Scheduler | `saathi-tick` every minute UTC and `saathi-retention` 21:30 UTC, both OIDC as `backend-dev@` with the worker's primary URL as audience. Tick returned 200 on revision 00005 |
| Extraction eval | 30/30 labeled cases on `gemini-2.5-flash`, 16 Oct 2026 (`eval/report.json`) |
| Code after that cloud check | Nearby help, ten language prompts, reminder seen versus confirmed, Ask Saathi answers, and up to 10 family members are in the repository as of 17 Oct 2026. They are specified in [SPEC.md](SPEC.md). This file does not record a new Cloud Run revision for them |

Names for `.env` are listed in `.env.example`. Do not copy secret values into this file. `LINK_SIGNING_SECRET` in a local `.env` is for local runs only; production reads Secret Manager.
