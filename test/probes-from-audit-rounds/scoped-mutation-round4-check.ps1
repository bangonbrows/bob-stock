$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outPath = Join-Path $root ("test\scoped-mutation-round4-check-$stamp.out.txt")
$errPath = Join-Path $root ("test\scoped-mutation-round4-check-$stamp.err.txt")
$exitPath = Join-Path $root ("test\scoped-mutation-round4-check-$stamp.exit.txt")

Set-Location -LiteralPath $root
$env:SABOTEUR_ONLY = 'S-276,S-276b,S-277,S-278,S-278b,S-278c,S-279,S-279b,S-280,S-280b,S-281,S-281b,S-281c,S-281d,S-281e,S-281g,S-282,S-282b,S-282c,S-282d,S-108,S-262,S-150b,S-70,S-174,S-185'
$env:SABOTEUR_CONCURRENCY = '5'

try {
  & node test/saboteur-runner.js > $outPath 2> $errPath
  $code = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
} catch {
  $_ | Out-File -LiteralPath $errPath -Append -Encoding utf8
  $code = 1
}

Set-Content -LiteralPath $exitPath -Value $code -Encoding ascii
Write-Output "out=$outPath"
Write-Output "err=$errPath"
Write-Output "exit=$exitPath"
