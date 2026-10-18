# One-time Google Cloud setup that deploy.ps1 does not do. Safe to run again.
#
#   1. Secret Manager secret saathi-link-signing (signs the 30-minute private file links). A new random value is
#      generated here and never printed. Any private link already handed out stops working.
#   2. The runtime service account may read that secret.
#   3. The runtime service account may act as itself. Cloud Tasks needs this to attach the OIDC token that the
#      worker checks; without it every enqueue fails and the API runs the pipeline in-process.
#   4. Cloud Scheduler jobs, OIDC-signed as the same account:
#        saathi-tick       every minute, UTC   -> worker /internal/tick       (check-ins and due reminders)
#        saathi-retention  daily 21:30 UTC     -> worker /internal/retention  (7-day transcripts, 30-day analytics)
#   5. Moves an existing plain LINK_SIGNING_SECRET environment variable on the two services to the secret.
#   6. The runtime account may use Firestore and send FCM in saathi-511717. Cloud Run, Hosting,
#      Auth, and Firestore are the same project; without these roles every Firestore call gets 403.
#
# Usage, from the repo root, after the services exist:
#   powershell -File deployment/scripts/setup_cloud.ps1 -DryRun
#   powershell -File deployment/scripts/setup_cloud.ps1
# Then run deploy.ps1, which reads the secret and gives the worker its own URL and invoker account.

[CmdletBinding()]
param(
    [string]$GcpProject = "saathi-511717",
    [string]$FirebaseProject = "saathi-511717",
    [string]$Region = "us-central1",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

if ($FirebaseProject -ne $GcpProject) {
    Write-Warning "Firebase project $FirebaseProject is not $GcpProject. Using $GcpProject."
    $FirebaseProject = $GcpProject
}
$ServiceAccount = "backend-dev@$GcpProject.iam.gserviceaccount.com"
$Secret = "saathi-link-signing"

# gcloud.cmd, not gcloud.ps1: the .ps1 wrapper turns gcloud's stderr into terminating errors.
$Gcloud = (Get-Command gcloud.cmd -ErrorAction SilentlyContinue).Source
if (-not $Gcloud) { $Gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source }
if (-not $Gcloud) {
    $Gcloud = Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    if (-not (Test-Path -LiteralPath $Gcloud)) { throw "gcloud was not found." }
}

function Run {
    param([string[]]$GcloudArgs, [switch]$Quiet)
    Write-Host ("gcloud " + ($GcloudArgs -join " "))
    if ($DryRun) { return }
    if ($Quiet) { & $script:Gcloud @GcloudArgs | Out-Null } else { & $script:Gcloud @GcloudArgs }
    if ($LASTEXITCODE -ne 0) { throw "gcloud failed ($LASTEXITCODE): $($GcloudArgs[0]) $($GcloudArgs[1]) $($GcloudArgs[2])" }
}

function Exists {
    param([string[]]$GcloudArgs)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $script:Gcloud @GcloudArgs 2>$null | Out-Null } catch { } finally { $ErrorActionPreference = $previous }
    return $LASTEXITCODE -eq 0
}

Write-Host "Saathi cloud setup for $GcpProject ($Region), runtime account $ServiceAccount"
Run @("services", "enable", "secretmanager.googleapis.com", "cloudscheduler.googleapis.com", "cloudtasks.googleapis.com", "--project", $GcpProject)

# 1. The secret. The value goes from memory to gcloud's stdin, not to the screen, a file, or the command line.
if (Exists @("secrets", "describe", $Secret, "--project", $GcpProject)) {
    Write-Host "Secret $Secret exists; keeping its value."
}
else {
    Write-Host "gcloud secrets create $Secret --data-file=-   (new random value, not printed)"
    if (-not $DryRun) {
        $bytes = New-Object byte[] 48
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $value = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
        $value | & $Gcloud secrets create $Secret --project $GcpProject --replication-policy=automatic --data-file=- | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not create secret $Secret." }
        $value = $null
    }
}

# 2 and 3. Narrow grants on one secret and on the account itself.
Run -Quiet @("secrets", "add-iam-policy-binding", $Secret, "--project", $GcpProject,
    "--member", "serviceAccount:$ServiceAccount", "--role", "roles/secretmanager.secretAccessor")
Run -Quiet @("iam", "service-accounts", "add-iam-policy-binding", $ServiceAccount, "--project", $GcpProject,
    "--member", "serviceAccount:$ServiceAccount", "--role", "roles/iam.serviceAccountUser")
Run -Quiet @("projects", "add-iam-policy-binding", $GcpProject,
    "--member", "serviceAccount:$ServiceAccount", "--role", "roles/cloudtasks.enqueuer", "--condition=None")

# 4. Scheduler jobs. The audience is the worker URL, which the worker compares with its WORKER_URL.
$WorkerUrl = (& $Gcloud run services describe saathi-worker --project $GcpProject --region $Region --format "value(status.url)").Trim()
if (-not $WorkerUrl) { throw "Deploy saathi-worker first; its URL is the token audience." }

$jobs = @(
    @{ Name = "saathi-tick"; Schedule = "* * * * *"; Path = "/internal/tick" },
    @{ Name = "saathi-retention"; Schedule = "30 21 * * *"; Path = "/internal/retention" }
)
foreach ($job in $jobs) {
    $verb = "create"
    $headerFlag = "--headers"
    if (Exists @("scheduler", "jobs", "describe", $job.Name, "--project", $GcpProject, "--location", $Region)) {
        $verb = "update"
        $headerFlag = "--update-headers"
    }
    Run -Quiet @("scheduler", "jobs", $verb, "http", $job.Name,
        "--project", $GcpProject, "--location", $Region,
        "--schedule", $job.Schedule, "--time-zone", "Etc/UTC",
        "--uri", "$WorkerUrl$($job.Path)", "--http-method", "POST",
        $headerFlag, "Content-Type=application/json", "--message-body", "{}",
        "--oidc-service-account-email", $ServiceAccount, "--oidc-token-audience", $WorkerUrl,
        "--attempt-deadline", "300s")
}

# 5. A plain environment variable and a secret cannot share a name, so remove the plain one first.
foreach ($service in @("saathi-api", "saathi-worker")) {
    $names = & $Gcloud run services describe $service --project $GcpProject --region $Region --format "value(spec.template.spec.containers[0].env[].name)"
    if ($names -match "LINK_SIGNING_SECRET") {
        $fromSecret = & $Gcloud run services describe $service --project $GcpProject --region $Region --format "value(spec.template.spec.containers[0].env[].valueFrom.secretKeyRef.name)"
        if (-not ($fromSecret -match $Secret)) {
            Run -Quiet @("run", "services", "update", $service, "--project", $GcpProject, "--region", $Region, "--remove-env-vars", "LINK_SIGNING_SECRET")
            Run -Quiet @("run", "services", "update", $service, "--project", $GcpProject, "--region", $Region, "--set-secrets", "LINK_SIGNING_SECRET=${Secret}:latest")
        }
    }
}

# 6. Firestore and FCM in the same project as Cloud Run.
Run -Quiet @("projects", "add-iam-policy-binding", $FirebaseProject,
    "--member", "serviceAccount:$ServiceAccount", "--role", "roles/datastore.user", "--condition=None")
Run -Quiet @("projects", "add-iam-policy-binding", $FirebaseProject,
    "--member", "serviceAccount:$ServiceAccount", "--role", "roles/firebasecloudmessaging.admin", "--condition=None")

Write-Host ""
Write-Host "Done. Next: powershell -File deployment/scripts/deploy.ps1 -Target api   (gives the worker WORKER_URL and TASK_INVOKER_EMAIL)"
Write-Host "Then: python scripts/smoke_cloud.py --invoke"
Write-Host "Remove LINK_SIGNING_SECRET from your local .env if it held the production value."
