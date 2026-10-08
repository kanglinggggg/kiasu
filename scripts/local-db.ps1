$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$clusterPath = Join-Path $projectRoot '.local-data\postgres'
$binaryPath = 'C:\Program Files\PostgreSQL\17\bin'
if (!(Test-Path -LiteralPath "$binaryPath\pg_ctl.exe")) { throw 'PostgreSQL 17 binaries not found. Set DATABASE_URL for an existing local PostgreSQL database instead.' }
if (!(Test-Path -LiteralPath "$clusterPath\PG_VERSION")) {
  New-Item -ItemType Directory -Path (Split-Path $clusterPath -Parent) -Force | Out-Null
  $dbPassword = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
  $passwordFile = Join-Path $projectRoot '.local-data\init-password'
  [IO.File]::WriteAllText($passwordFile, $dbPassword)
  & "$binaryPath\initdb.exe" -D $clusterPath -U remix_local --pwfile=$passwordFile --auth=scram-sha-256 --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
  Remove-Item -LiteralPath $passwordFile
  Add-Content -LiteralPath "$clusterPath\postgresql.conf" -Value "`nlisten_addresses = '127.0.0.1'`nport = 55432"
  $envPath = Join-Path $projectRoot '.env.local'
  Add-Content -LiteralPath $envPath -Value "`nDATABASE_URL=postgresql://remix_local:$dbPassword@127.0.0.1:55432/remix_drop`nLOCAL_DEMO=true"
}
& "$binaryPath\pg_ctl.exe" -D $clusterPath status *> $null
if ($LASTEXITCODE -ne 0) {
  # pg_ctl detaches PostgreSQL without opening an interactive window.
  & "$binaryPath\pg_ctl.exe" -D $clusterPath -l (Join-Path $projectRoot '.local-data\postgres.log') -w start
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL failed to start' }
}
Write-Output 'Project PostgreSQL is listening on 127.0.0.1:55432. Credentials stay in ignored .env.local.'
