"""Vertex Gemini client. Authentication is Application Default Credentials."""

import logging
from functools import lru_cache

from google import genai

from saathi.config import load_settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_genai_client() -> genai.Client:
    """Return a Vertex client for the billed Google Cloud project."""
    settings = load_settings()
    project = settings.google_cloud_project
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is empty")
    location = settings.cloud_region or "us-central1"
    logger.info("Creating Vertex Gemini client for %s in %s", project, location)
    return genai.Client(vertexai=True, project=project, location=location)
