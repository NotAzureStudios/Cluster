# Authenticode signing helper. This command signs copies of existing Windows PE
# files; it cannot sign other EXEs already embedded inside an installer.
# Use a private signing workstation, not a generic PR/CI build runner.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string[]] $Files,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-fA-F0-9]{40}$')]
  [string] $CertificateThumbprint,
  [string] $OutputDirectory = "",
  [string] $SignToolPath = "signtool.exe",
  [string] $TimestampUrl = "http://timestamp.digicert.com",
  [switch] $MachineStore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") { throw "Authenticode signing requires Windows and Windows SDK SignTool." }
if ($Files.Count -eq 0) { throw "Provide at least one .exe or .dll file." }
$thumb = $CertificateThumbprint.ToUpperInvariant()
$storePath = if ($MachineStore) { "Cert:\LocalMachine\My\$thumb" } else { "Cert:\CurrentUser\My\$thumb" }
$certificate = Get-Item -LiteralPath $storePath -ErrorAction SilentlyContinue
if ($null -eq $certificate) { throw "Certificate $thumb not found in $storePath" }
if (-not $certificate.HasPrivateKey) { throw "Signing certificate has no available private key." }
if ($certificate.NotAfter -le (Get-Date)) { throw "Signing certificate has expired." }
if ($certificate.NotBefore -gt (Get-Date)) { throw "Signing certificate is not yet valid." }
$codeSigningUsage = @($certificate.EnhancedKeyUsageList | Where-Object {
  $_.ObjectId -eq "1.3.6.1.5.5.7.3.3"
})
if ($codeSigningUsage.Count -eq 0) { throw "Certificate lacks Code Signing EKU (1.3.6.1.5.5.7.3.3)." }

if (-not $OutputDirectory) { $OutputDirectory = Join-Path (Get-Location).Path "signed-artifacts" }
$destination = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $destination | Out-Null

$tool = (Get-Command $SignToolPath -ErrorAction SilentlyContinue)
if (-not $tool) {
  throw "SignTool not found. Install the Windows SDK, open a Developer PowerShell, or pass -SignToolPath."
}
$toolExecutable = $tool.Source
if (-not $toolExecutable) { $toolExecutable = $SignToolPath }
$storeArgs = @()
if ($MachineStore) { $storeArgs += "/sm" }

foreach ($file in $Files) {
  $inputFile = (Resolve-Path -LiteralPath $file -ErrorAction Stop).Path
  if ([IO.Path]::GetExtension($inputFile) -notin @(".exe", ".dll")) {
    throw "Refusing to sign non-PE file: $inputFile"
  }
  $signedFile = Join-Path $destination ([IO.Path]::GetFileName($inputFile))
  if ([IO.Path]::GetFullPath($inputFile).Equals([IO.Path]::GetFullPath($signedFile),
    [StringComparison]::OrdinalIgnoreCase)) {
    throw "Signing output must differ from original file: $file"
  }
  Copy-Item -LiteralPath $inputFile -Destination $signedFile -Force

  & $toolExecutable sign @storeArgs /sha1 $thumb /fd SHA256 /tr $TimestampUrl /td SHA256 $signedFile
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $signedFile -Force -ErrorAction SilentlyContinue
    throw "SignTool failed for $file. Original file remains unchanged."
  }

  & $toolExecutable verify /pa /v $signedFile
  if ($LASTEXITCODE -ne 0) { throw "Signature chain or Windows Authenticode verification failed: $signedFile" }
  $signature = Get-AuthenticodeSignature -LiteralPath $signedFile
  if ($signature.Status -ne "Valid") {
    throw "Windows does not trust the new signature: $($signature.Status) ($signedFile)."
  }
  if ($signature.SignerCertificate.Thumbprint -ne $thumb) {
    throw "Signed by a different certificate than the specified thumbprint."
  }
  $digest = (Get-FileHash -LiteralPath $signedFile -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "Signed and verified: $signedFile"
  Write-Host "Publisher: $($signature.SignerCertificate.Subject)"
  Write-Host "SHA256: $digest"
}
Write-Host "Complete. Each signed binary has NEW bytes and NEW SHA-256 hashes."
Write-Host "Update build receipts and release asset hashes BEFORE publishing a signed release."
