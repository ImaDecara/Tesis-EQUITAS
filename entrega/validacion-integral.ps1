param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$CandidateSha,
    [string]$OutputDirectory = '.quality/validacion-integral',
    [long]$MainRunId = 0,
    [long]$PreviewRunId = 0,
    [long]$LoadRunId = 0,
    [long]$SmokeRunId = 0
)
# Controlador local: usa instalaciones nuevas de Actions y secretos ya configurados.
# No mueve ramas ni publica en produccion. Las dos referencias deben estar alineadas.
$ErrorActionPreference = 'Stop'
$repo = 'ImaDecara/Tesis-EQUITAS'
$started = [DateTimeOffset]::UtcNow
$deadline = $started.AddMinutes(40)
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Gh([string[]]$Arguments) {
    $response = & gh @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Fallo de GitHub CLI; revisar autenticacion/conectividad.' }
    return ($response -join "`n" | ConvertFrom-Json)
}
function Start-Run([string]$Workflow, [string]$Branch) {
    & gh workflow run $Workflow --ref $Branch --repo $repo | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar $Workflow." }
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $runs = Read-Gh -Arguments @('api', "repos/$repo/actions/workflows/$Workflow/runs?per_page=50")
        $match = @($runs.workflow_runs | Where-Object {
            $_.head_sha -eq $CandidateSha -and $_.head_branch -eq $Branch -and
            $_.event -eq 'workflow_dispatch' -and [DateTimeOffset]$_.created_at -ge $started.AddSeconds(-2)
        })
        if ($match.Count -gt 0) { return [long]$match[0].id }
        Start-Sleep -Seconds 10
    }
    throw "No aparecio la ejecucion $Workflow."
}
function Wait-Run([long]$Id, [string]$Workflow, [string]$Branch, [string[]]$Jobs) {
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $run = Read-Gh -Arguments @('api', "repos/$repo/actions/runs/$Id")
        if ($run.head_sha -ne $CandidateSha -or $run.path -ne ".github/workflows/$Workflow" -or
            $run.head_repository.full_name -ne $repo -or ($Branch -and $run.head_branch -ne $Branch)) {
            throw "Procedencia incorrecta en run $Id."
        }
        if ($run.status -eq 'completed') {
            if ($run.conclusion -ne 'success') { throw "Run $Id termino en $($run.conclusion)." }
            $jobData = Read-Gh -Arguments @('api', "repos/$repo/actions/runs/$Id/jobs?per_page=100")
            foreach ($name in $Jobs) {
                $matches = @($jobData.jobs | Where-Object { $_.name -eq $name -and $_.conclusion -eq 'success' })
                if ($matches.Count -ne 1) { throw "Job obligatorio ausente o no aprobado: $name." }
            }
            Write-Host "Aprobado: $($run.html_url)"
            return [ordered]@{ id = $Id; sha = $run.head_sha; branch = $run.head_branch;
                url = $run.html_url; event = $run.event; conclusion = $run.conclusion;
                jobs = @($jobData.jobs | Select-Object name, conclusion, started_at, completed_at) }
        }
        Start-Sleep -Seconds 10
    }
    throw "Tiempo agotado esperando run $Id."
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$record = [ordered]@{ source_sha = $CandidateSha; started_at_utc = $started.ToString('o'); passed = $false }
try {
    foreach ($branch in @('main', 'quality/tp-testing')) {
        $ref = Read-Gh -Arguments @('api', "repos/$repo/git/ref/heads/$branch")
        if ($ref.object.sha -ne $CandidateSha) { throw "Alinear $branch con el candidato antes de ejecutar." }
    }
    if (-not $MainRunId) { $MainRunId = Start-Run 'quality-ci.yml' 'main' }
    if (-not $PreviewRunId) { $PreviewRunId = Start-Run 'quality-ci.yml' 'quality/tp-testing' }
    $required = @('Frontend - pruebas, build y analisis', 'Backend - pruebas, cobertura y Ruff',
        'Supabase - integracion real Auth y RLS', 'Quality gates y resumen')
    $record.main = Wait-Run $MainRunId 'quality-ci.yml' 'main' $required
    $record.preview = Wait-Run $PreviewRunId 'quality-ci.yml' 'quality/tp-testing' $required
    if (-not $LoadRunId) { $LoadRunId = Start-Run 'load-tests.yml' 'main' }
    if (-not $SmokeRunId) {
        while ([DateTimeOffset]::UtcNow -lt $deadline) {
            $runs = Read-Gh -Arguments @('api', "repos/$repo/actions/workflows/preview-smoke.yml/runs?per_page=50")
            $smokes = @($runs.workflow_runs | Where-Object {
                $_.head_sha -eq $CandidateSha -and $_.event -eq 'workflow_run' -and
                [DateTimeOffset]$_.created_at -ge [DateTimeOffset]$record.preview.jobs[0].started_at
            })
            if ($smokes.Count -gt 0) { $SmokeRunId = [long]$smokes[0].id; break }
            Start-Sleep -Seconds 10
        }
        if (-not $SmokeRunId) { throw 'No aparecio el smoke posterior al CI de Preview.' }
    }
    $record.smoke = Wait-Run $SmokeRunId 'preview-smoke.yml' '' @('Preview Vercel - navegador y datos de testing')
    $record.load = Wait-Run $LoadRunId 'load-tests.yml' 'main' @('Exigir calidad del mismo commit', 'API aislada - stress', 'API aislada - soak')
    foreach ($kind in @('main', 'preview', 'smoke', 'load')) {
        $directory = Join-Path $OutputDirectory $kind
        if (Test-Path -LiteralPath $directory) { throw "Usar una salida nueva: $directory ya existe." }
        & gh run download $record[$kind].id --repo $repo --dir $directory
        if ($LASTEXITCODE -ne 0) { throw "No se descargaron artefactos de $kind." }
    }
    $smokeFile = @(Get-ChildItem -LiteralPath (Join-Path $OutputDirectory 'smoke') -Recurse -Filter smoke.json)
    if ($smokeFile.Count -ne 1) { throw 'Falta smoke.json unico.' }
    $smoke = Get-Content -LiteralPath $smokeFile[0].FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $smoke.passed -or $smoke.source_sha -ne $CandidateSha -or
        [long]$smoke.quality_run_id -ne $PreviewRunId -or $smoke.build_info.sourceSha -ne $CandidateSha -or
        $smoke.build_info.environment -ne 'preview' -or $smoke.build_info.supabaseProjectRef -ne 'iylwghgvtydpmwidojdo') {
        throw 'El smoke descargado no acredita el candidato/CI/entorno requerido.'
    }
    $record.deployment_url = $smoke.url
    $record.passed = $true
    $record.scope = 'CI completo e instalaciones nuevas, Supabase real de testing, Preview/smoke y cargas de FastAPI con fuente sintetica local. La defensa humana se confirma aparte.'
} catch {
    $record.error = $_.Exception.Message
    Write-Host $record.error
} finally {
    $record.finished_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
    [System.IO.File]::WriteAllText((Join-Path (Resolve-Path $OutputDirectory) 'ejecucion.json'),
        ($record | ConvertTo-Json -Depth 15), $utf8)
}
if (-not $record.passed) { exit 1 }
Write-Host 'Validacion tecnica integral aprobada. Revisar y conservar los reportes descargados.'
