"""Hand-off of post-call work to the private worker through Cloud Tasks.

One task per session id: the task name is derived from the session id, so a second enqueue for the same
session is a no-op (AlreadyExists). With no WORKER_URL configured the pipeline runs in this process instead,
which is what local development and the tests use.
"""

import hashlib
import json
import logging
import threading

from saathi.config import load_settings

logger = logging.getLogger(__name__)


def task_name(session_id: str, stage: str = "") -> str:
    """One name per session and stage. Cloud Tasks refuses a reused name for about an hour, so the start that comes
    with the saved transcript has its own stage name and is not dropped as a duplicate of the /complete start."""
    return "post-call-" + hashlib.sha256((session_id + (":" + stage if stage else "")).encode("utf-8")).hexdigest()[:32]


def build_task(session_id: str, household_id: str, worker_url: str, invoker_email: str, queue_path: str, stage: str = "") -> dict:
    """The Cloud Tasks request body. Kept separate so it can be checked without calling Google."""
    url = worker_url.rstrip("/") + "/internal/process-session"
    task: dict = {
        "name": f"{queue_path}/tasks/{task_name(session_id, stage)}",
        "http_request": {
            "http_method": "POST",
            "url": url,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"sessionId": session_id, "householdId": household_id}).encode("utf-8"),
        },
    }
    if invoker_email:
        task["http_request"]["oidc_token"] = {"service_account_email": invoker_email, "audience": worker_url.rstrip("/")}
    return task


def _run_in_process(household_id: str, session_id: str) -> None:
    from saathi.pipeline import run_post_call

    try:
        run_post_call(household_id, session_id)
    except Exception as exc:
        logger.error("Post-call pipeline failed for %s: %s", session_id, exc)


def enqueue_post_call(household_id: str, session_id: str, stage: str = "") -> str:
    """Returns "cloud_tasks", "already_queued", or "in_process"."""
    s = load_settings()
    if s.worker_url and s.task_queue and s.google_cloud_project:
        try:
            from google.api_core.exceptions import AlreadyExists
            from google.cloud import tasks_v2

            client = tasks_v2.CloudTasksClient()
            queue_path = client.queue_path(s.google_cloud_project, s.cloud_region, s.task_queue)
            task = build_task(session_id, household_id, s.worker_url, s.task_invoker_email, queue_path, stage)
            try:
                client.create_task(request={"parent": queue_path, "task": task})
                return "cloud_tasks"
            except AlreadyExists:
                return "already_queued"
        except Exception as exc:
            logger.warning("Cloud Tasks enqueue failed (%s); running the pipeline in this process", exc)

    threading.Thread(target=_run_in_process, args=(household_id, session_id), daemon=True).start()
    return "in_process"
