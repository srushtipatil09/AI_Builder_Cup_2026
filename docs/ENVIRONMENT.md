# Environment

Fill this file when a command actually succeeds. Do not invent a project id or a model result.

| Item | Value |
| --- | --- |
| Date checked | 16 Oct 2026 |
| Google Cloud project | `saathi-511717` |
| Firebase project | `saathi-5afcf` |
| Region | `us-central1` |
| BigQuery location | `US` |
| Live model | `gemini-3.8-live` |
| Extract and insight model | `gemini-3.8-flash` |
| Embedding model | `text-multilingual-embedding-002` |
| API URL | `http://127.0.0.1:8080` (FastAPI Cloud Run service `saathi-api`) |
| Web URL | `http://127.0.0.1:5173` (Vite PWA on Firebase Hosting) |
| Git revision | Backend full implementation (55 passing tests) |
| Billing shape | Request-based Cloud Run CPU, min instances 0, session cap 240 seconds, max bytes billed 100 MiB |


Names for `.env` are listed in `.env.example`.
