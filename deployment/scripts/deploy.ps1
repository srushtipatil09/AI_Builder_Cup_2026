# Deploy Saathi.
#
# Cloud project and Firebase project come from .env (GOOGLE_CLOUD_PROJECT, FIREBASE_PROJECT_ID).
# Cloud Run, Artifact Registry, and Cloud Tasks use the Cloud project.
# Hosting, Auth, and Firestore use the Firebase project.
#
# The image is built with Cloud Build from api/Dockerfile and pushed to
# us-central1-docker.pkg.dev/saathi-511717/saathi/api. One image, two services:
# APP_MODULE=main:app (public) and APP_MODULE=worker:app (private).
#
# Usage, from the repo root:
#   powershell -File deployment/scripts/deploy.ps1 -DryRun
#   powershell -File deployment/scripts/deploy.ps1
#   powershell -File deployment/scripts/deploy.ps1 -Target web
#   powershell -File deployment/scripts/deploy.ps1 -Target api
#
# -Target web rebuilds the site and deploys Hosting. It does not build the image.
# -Target api builds and deploys Cloud Run only.
# Default is both. -DryRun prints the plan and does not call Cloud Build or Firebase.
#
# Requires gcloud already logged in. Firebase CLI is used if it is on PATH,
# otherwise npx firebase-tools (needs `npx firebase-tools login` once).

[CmdletBinding()]
param(
    [ValidateSet("all", "web", "api")]
    [string]$Target = "all",
    [string]$GcpProject = "saathi-511717",
    [string]$FirebaseProject = "saathi-5afcf",
    [string]$Region = "us-central1",
    [string]$Tag = "latest",
    [switch]$SkipFirestore,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SigningSecret = "saathi-link-signing"

function Find-Cmd {
    param([string]$Name)
    # PowerShell's npm.ps1 / npx.ps1 re-parse the call and drop the first letters
    # of the arguments ("npm run" becomes the command "pm"). The .cmd shims do not.
    $cmd = Get-Command "$Name.cmd" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $fallback = Get-Command $Name -ErrorAction SilentlyContinue
    if ($fallback) { return $fallback.Source }
    throw "$Name was not found on PATH."
}

function Find-Gcloud {
    $cmd = Get-Command gcloud -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidate = Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    throw "gcloud was not found. Install the Google Cloud SDK and run 'gcloud auth login'."
}

function Read-DotEnv {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $map }
    foreach ($raw in Get-Content -LiteralPath $Path) {
        $line = $raw.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith("#")) { continue }
        $idx = $line.IndexOf("=")
        if ($idx -lt 1) { continue }
        $key = $line.Substring(0, $idx).Trim()
        $value = $line.Substring($idx + 1).Trim()
        if ($value.Length -ge 2) {
            $quote = $value.Substring(0, 1)
            if (($quote -eq '"' -or $quote -eq "'") -and $value.EndsWith($quote)) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $map[$key] = $value
    }
    return $map
}

function Env-Or {
    param([hashtable]$Map, [string]$Key, [string]$Fallback)
    if ($Map.ContainsKey($Key) -and $Map[$Key]) { return [string]$Map[$Key] }
    return $Fallback
}

function ConvertTo-YamlScalar {
    param([string]$Value)
    $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
    return '"' + $escaped + '"'
}

function Write-EnvFile {
    param([string]$Path, [System.Collections.Specialized.OrderedDictionary]$Vars)
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($key in $Vars.Keys) {
        $lines.Add(("{0}: {1}" -f $key, (ConvertTo-YamlScalar ([string]$Vars[$key]))))
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($Path, $lines, $utf8)
}

function Invoke-Gcloud {
    param([string[]]$GcloudArgs)
    Write-Host ("gcloud " + ($GcloudArgs -join " "))
    if ($DryRun) { return "" }
    & $script:Gcloud @GcloudArgs
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud failed ($LASTEXITCODE): $($GcloudArgs[0]) $($GcloudArgs[1])"
    }
}

function Get-RunUrl {
    param([string]$Service)
    # Read-only. Safe during -DryRun, and after a real deploy it returns the URL just shipped.
    $url = & $script:Gcloud run services describe $Service `
        --project $GcpProject `
        --region $Region `
        --format "value(status.url)"
    if ($LASTEXITCODE -ne 0 -or -not $url) {
        throw "Could not read the URL for Cloud Run service $Service."
    }
    return $url.Trim()
}

$Gcloud = Find-Gcloud
$Npm = Find-Cmd "npm"
$DotEnv = Read-DotEnv (Join-Path $Root ".env")
if (-not $PSBoundParameters.ContainsKey("GcpProject")) {
    $GcpProject = Env-Or $DotEnv "GOOGLE_CLOUD_PROJECT" $GcpProject
}
if (-not $PSBoundParameters.ContainsKey("FirebaseProject")) {
    $FirebaseProject = Env-Or $DotEnv "FIREBASE_PROJECT_ID" $FirebaseProject
}
$ServiceAccount = "backend-dev@$GcpProject.iam.gserviceaccount.com"
$Image = "$Region-docker.pkg.dev/$GcpProject/saathi/api:$Tag"
$HostingUrl = "https://$FirebaseProject.web.app"

Write-Host ""
Write-Host "Saathi deploy"
Write-Host "  Cloud project   $GcpProject"
Write-Host "  Firebase        $FirebaseProject"
Write-Host "  Region          $Region"
Write-Host "  Image           $Image"
Write-Host "  Hosting         $HostingUrl"
Write-Host "  Target          $Target"
if ($DryRun) { Write-Host "  Mode            dry run" }
Write-Host ""

$activeAccount = (& $Gcloud auth list --filter="status:ACTIVE" --format="value(account)").Trim()
if (-not $activeAccount) { throw "gcloud is not logged in. Run 'gcloud auth login'." }
Write-Host "  Account         $activeAccount"

$deployApi = $Target -eq "all" -or $Target -eq "api"
$deployWeb = $Target -eq "all" -or $Target -eq "web"

if ($deployApi) {
    Write-Host "Building $Image from api/ ..."
    Invoke-Gcloud @(
        "builds", "submit", (Join-Path $Root "api"),
        "--project", $GcpProject,
        "--tag", $Image
    )

    # The worker checks that each Cloud Tasks or Scheduler call is an ID token for the invoker account with
    # this worker's URL as audience, so it needs its own URL. The URL is stable, so read it before deploying.
    $knownWorkerUrl = ""
    try { $knownWorkerUrl = Get-RunUrl "saathi-worker" } catch { $knownWorkerUrl = "" }

    # LINK_SIGNING_SECRET comes from Secret Manager (setup_cloud.ps1 creates it), never from .env.
    $secretArgs = @()
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $script:Gcloud secrets describe $SigningSecret --project $GcpProject --format "value(name)" 2>$null | Out-Null } catch { } finally { $ErrorActionPreference = $previous }
    if ($LASTEXITCODE -eq 0) {
        $secretArgs = @("--set-secrets", "LINK_SIGNING_SECRET=${SigningSecret}:latest")
    }
    else {
        Write-Warning "Secret $SigningSecret not found. Run deployment/scripts/setup_cloud.ps1 first; private file links will not work."
    }

    Write-Host "Deploying saathi-worker ..."
    $workerEnv = [ordered]@{
        GOOGLE_CLOUD_PROJECT       = $GcpProject
        FIREBASE_PROJECT_ID        = $FirebaseProject
        CLOUD_REGION               = $Region
        GOOGLE_GENAI_USE_VERTEXAI  = "true"
        EXTRACT_MODEL              = (Env-Or $DotEnv "EXTRACT_MODEL" "gemini-2.5-flash")
        INSIGHT_MODEL              = (Env-Or $DotEnv "INSIGHT_MODEL" "gemini-2.5-flash")
        EMBED_MODEL                = (Env-Or $DotEnv "EMBED_MODEL" "text-multilingual-embedding-002")
        APP_MODULE                 = "worker:app"
        TASK_QUEUE                 = (Env-Or $DotEnv "TASK_QUEUE" "saathi-pipeline")
        UPLOADS_BUCKET             = (Env-Or $DotEnv "UPLOADS_BUCKET" "$GcpProject-media")
        REQUIRE_HOUSEHOLD_AUTH     = (Env-Or $DotEnv "REQUIRE_HOUSEHOLD_AUTH" "true")
        TASK_INVOKER_EMAIL         = $ServiceAccount
    }
    if ($knownWorkerUrl) { $workerEnv["WORKER_URL"] = $knownWorkerUrl }

    $workerFile = Join-Path $env:TEMP "saathi-worker-env.yaml"
    try {
        if (-not $DryRun) { Write-EnvFile $workerFile $workerEnv }
        Write-Host ("  worker env keys: " + ($workerEnv.Keys -join ", "))
        Invoke-Gcloud -GcloudArgs (@(
            "run", "deploy", "saathi-worker",
            "--project", $GcpProject,
            "--region", $Region,
            "--image", $Image,
            "--service-account", $ServiceAccount,
            "--no-allow-unauthenticated",
            "--cpu-throttling",
            "--cpu-boost",
            "--min-instances", "0",
            "--max-instances", "1",
            "--concurrency", "1",
            "--timeout", "300",
            "--cpu", "1",
            "--memory", "1Gi",
            "--port", "8080",
            "--env-vars-file", $workerFile
        ) + $secretArgs)
        Invoke-Gcloud @(
            "run", "services", "add-iam-policy-binding", "saathi-worker",
            "--project", $GcpProject,
            "--region", $Region,
            "--member", "serviceAccount:$ServiceAccount",
            "--role", "roles/run.invoker"
        )
    }
    finally {
        if (Test-Path -LiteralPath $workerFile) { Remove-Item -LiteralPath $workerFile -Force }
    }

    $workerUrl = Get-RunUrl "saathi-worker"
    Write-Host "Worker URL: $workerUrl"
    if (-not $knownWorkerUrl) {
        # First deploy: the URL exists only now.
        Invoke-Gcloud @(
            "run", "services", "update", "saathi-worker",
            "--project", $GcpProject, "--region", $Region,
            "--update-env-vars", "WORKER_URL=$workerUrl"
        )
    }

    Write-Host "Deploying saathi-api ..."
    $apiEnv = [ordered]@{
        GOOGLE_CLOUD_PROJECT       = $GcpProject
        FIREBASE_PROJECT_ID        = $FirebaseProject
        CLOUD_REGION               = $Region
        GOOGLE_GENAI_USE_VERTEXAI  = "true"
        EXTRACT_MODEL              = $workerEnv["EXTRACT_MODEL"]
        INSIGHT_MODEL              = $workerEnv["INSIGHT_MODEL"]
        EMBED_MODEL                = $workerEnv["EMBED_MODEL"]
        APP_MODULE                 = "main:app"
        DEMO_ENABLED               = (Env-Or $DotEnv "DEMO_ENABLED" "true")
        TASK_QUEUE                 = $workerEnv["TASK_QUEUE"]
        WORKER_URL                 = $workerUrl
        TASK_INVOKER_EMAIL         = $ServiceAccount
        UPLOADS_BUCKET             = $workerEnv["UPLOADS_BUCKET"]
        REQUIRE_HOUSEHOLD_AUTH     = $workerEnv["REQUIRE_HOUSEHOLD_AUTH"]
        WEB_ORIGIN                 = $HostingUrl
    }

    $apiFile = Join-Path $env:TEMP "saathi-api-env.yaml"
    try {
        if (-not $DryRun) { Write-EnvFile $apiFile $apiEnv }
        Write-Host ("  api env keys: " + ($apiEnv.Keys -join ", "))
        Invoke-Gcloud -GcloudArgs (@(
            "run", "deploy", "saathi-api",
            "--project", $GcpProject,
            "--region", $Region,
            "--image", $Image,
            "--service-account", $ServiceAccount,
            "--allow-unauthenticated",
            "--cpu-throttling",
            "--cpu-boost",
            "--min-instances", "0",
            "--max-instances", "3",
            "--concurrency", "8",
            "--timeout", "600",
            "--cpu", "1",
            "--memory", "512Mi",
            "--port", "8080",
            "--env-vars-file", $apiFile
        ) + $secretArgs)
    }
    finally {
        if (Test-Path -LiteralPath $apiFile) { Remove-Item -LiteralPath $apiFile -Force }
    }

    $script:ApiUrl = Get-RunUrl "saathi-api"
    Write-Host "API URL: $script:ApiUrl"
}

if ($deployWeb) {
    if (-not $script:ApiUrl) {
        Write-Host "Reading the existing API URL ..."
        $script:ApiUrl = Get-RunUrl "saathi-api"
    }
    # API_BASE_URL is read by the API process, not the browser. Set it when we
    # already deployed the API in this run. A web-only deploy leaves Cloud Run alone.
    Write-Host "Web build will call $script:ApiUrl"

    $firebaseJson = Join-Path $Root "firebase.json"
    $firebaseRc = Join-Path $Root ".firebaserc"
    if (-not (Test-Path -LiteralPath $firebaseJson)) { throw "Missing $firebaseJson" }
    if (-not (Test-Path -LiteralPath $firebaseRc)) { throw "Missing $firebaseRc" }

    if (-not (Test-Path -LiteralPath (Join-Path $Root "web\node_modules"))) {
        Write-Host "Installing web dependencies ..."
        if (-not $DryRun) {
            & $script:Npm ci --prefix (Join-Path $Root "web")
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)" }
        }
    }

    Write-Host "Building the web app ..."
    $previousApi = $env:VITE_API_URL
    try {
        $env:VITE_API_URL = $script:ApiUrl
        if ($DryRun) {
            Write-Host "npm run build --prefix web   (VITE_API_URL=$script:ApiUrl)"
        }
        else {
            & $script:Npm run build --prefix (Join-Path $Root "web")
            if ($LASTEXITCODE -ne 0) { throw "web build failed ($LASTEXITCODE)" }
        }
    }
    finally {
        if ($null -eq $previousApi) { Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue }
        else { $env:VITE_API_URL = $previousApi }
    }

    $firebaseExe = $null
    $firebasePrefix = @()
    $firebaseCmd = Get-Command firebase -ErrorAction SilentlyContinue
    if ($firebaseCmd) {
        $firebaseExe = $firebaseCmd.Source
    }
    else {
        $firebaseExe = Find-Cmd "npx"
        $firebasePrefix = @("--yes", "firebase-tools")
    }

    $only = "hosting"
    if (-not $SkipFirestore) { $only = "hosting,firestore:rules,firestore:indexes" }
    Write-Host "Deploying Firebase ($only) to $FirebaseProject ..."
    if ($DryRun) {
        Write-Host "$firebaseExe $($firebasePrefix -join ' ') deploy --only $only --project $FirebaseProject --non-interactive"
    }
    else {
        Push-Location $Root
        try {
            & $firebaseExe @firebasePrefix deploy --only $only --project $FirebaseProject --non-interactive
            if ($LASTEXITCODE -ne 0) {
                throw "firebase deploy failed ($LASTEXITCODE). If this is an auth error, run: npx firebase-tools login"
            }
        }
        finally {
            Pop-Location
        }
    }
    Write-Host "Site: $HostingUrl"
}

Write-Host ""
Write-Host "Done."
if ($deployWeb) { Write-Host "Open $HostingUrl" }
if ($script:ApiUrl) { Write-Host "API  $($script:ApiUrl)/health" }
