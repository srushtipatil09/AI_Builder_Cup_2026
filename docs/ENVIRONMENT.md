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
| API URL | `http://127.0.0.1:8080` (local FastAPI). A public Cloud Run URL is not recorded as verified |
| Web URL | `http://127.0.0.1:5173` (local Vite). A public Hosting URL is not recorded as verified. `VITE_API_URL` is for a build that is not behind the Vite proxy |
| Git revision | `dev` at `4776be2`. 75 tests collected on 16 Oct 2026. The last recorded green run in PROGRESS is 71 passed. This docs pass did not re-run the suite |
| Billing shape | Request-based Cloud Run CPU, min instances 0, session cap 240 seconds, max bytes billed 100 MiB |
| Household auth | Code default `REQUIRE_HOUSEHOLD_AUTH` is false. `.env.example` sets it true. Demo households stay open either way |
| Post-call worker | `TASK_QUEUE` default `saathi-pipeline`. Empty `WORKER_URL` runs the pipeline in the API process. Progress records that the Cloud Tasks queue, worker service, and Scheduler job were not created |

Names for `.env` are listed in `.env.example`, including `LIVE_VOICE`, `UPLOADS_BUCKET`, `LINK_SIGNING_SECRET`, `REQUIRE_HOUSEHOLD_AUTH`, `TASK_QUEUE`, and `WORKER_URL`. Do not copy secret values into this file. `.env.example` still lists the older candidate ids `gemini-3.8-live` and `gemini-3.8-flash`. An unset model variable uses the 2.5 defaults in `config.py`.
