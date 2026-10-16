"""Private worker. Scheduler and Cloud Tasks will call this service later."""

from fastapi import FastAPI

from saathi import __version__

app = FastAPI(title="Saathi Worker", version=__version__)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "service": "saathi-worker",
        "status": "ok",
        "version": __version__,
        "stage": "scaffold",
    }
