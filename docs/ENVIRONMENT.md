# Environment

Fill this file when a command actually succeeds. Do not invent a project id or a model result.

| Item | Value |
| --- | --- |
| Date checked | 16 Oct 2026 |
| Google Cloud project | `saathi-511717` |
| Firebase project | `saathi-5afcf` |
| Vertex / Live region | `us-central1` (`CLOUD_REGION` default) |
| Media bucket location | `asia-south1`, as recorded for `saathi-511717-media` in [PROGRESS.md](PROGRESS.md). The code does not set the bucket region |
| BigQuery location | `US` |
| Live model | `gemini-live-2.5-flash-native-audio` (default in `config.py`; voice `Aoede`) |
| Extract and insight model | `gemini-2.5-flash` |
| Embedding model | `text-multilingual-embedding-002` |
| Uploads bucket | `UPLOADS_BUCKET`, or `{project}-media` when empty. Progress records `saathi-511717-media`. The earlier `saathi-511717-private` bucket is unused |
| API URL | https://saathi-api-ikr6m7lina-uc.a.run.app (Cloud Run `saathi-api`, us-central1). `/health` returned 200 on 16 Oct 2026 |
| Web URL | https://saathi-5afcf.web.app (Firebase Hosting). Built with `VITE_API_URL` set to the API URL. The caretaker demo loaded and called the API on 16 Oct 2026 |
| Git revision | Deployed API revision `saathi-api-00003` predates the 16 Oct evening commits on `dev`; redeploy with `deploy.ps1` |
| Billing shape | Request-based Cloud Run CPU, min instances 0, session cap 240 seconds, max bytes billed 100 MiB |
| Household auth | `REQUIRE_HOUSEHOLD_AUTH=true` on Cloud Run. Code default is false for local runs. Demo households stay open |
| Post-call worker | https://saathi-worker-ikr6m7lina-uc.a.run.app, private (anonymous calls get 403). Queue `saathi-pipeline` RUNNING. On 16 Oct 2026 every enqueue failed (`iam.serviceAccounts.actAs` missing for `backend-dev@`) and the API ran the pipeline in-process; the worker also lacked `TASK_INVOKER_EMAIL` and `WORKER_URL`. `setup_cloud.ps1` and the updated `deploy.ps1` fix both; not yet run |
| Runtime service account | `backend-dev@saathi-511717.iam.gserviceaccount.com` for both services, and the Tasks and Scheduler OIDC identity |
| Signing secret | Secret Manager `saathi-link-signing`, mounted as `LINK_SIGNING_SECRET`. Created by `setup_cloud.ps1`; until it runs, the API still holds a plain environment value |
| Scheduler | `saathi-tick` every minute UTC and `saathi-retention` 21:30 UTC, both created by `setup_cloud.ps1`. None existed on 16 Oct 2026 |
| Extraction eval | 30/30 labeled cases on `gemini-2.5-flash`, 16 Oct 2026 (`eval/report.json`) |

Names for `.env` are listed in `.env.example`. Do not copy secret values into this file. `LINK_SIGNING_SECRET` in a local `.env` is for local runs only; production reads Secret Manager.
