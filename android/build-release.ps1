param(
    [string]$SdkRoot = "F:\Android\Sdk",
    [string]$GradleUserHome = "F:\Android\.gradle"
)

$ErrorActionPreference = "Stop"
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:GRADLE_USER_HOME = $GradleUserHome

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceApk = Join-Path $PSScriptRoot "app\build\outputs\apk\release\app-release.apk"
$outputDirectory = Join-Path $projectRoot "release\android"
$artifactName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("6ZO+5Yqo6LSn5rqQ5p+l6K+iLTEuOS4wLWFuZHJvaWQtZGVidWcuYXBr"))
$outputApk = Join-Path $outputDirectory $artifactName
$signer = Join-Path $SdkRoot "build-tools\36.0.0\apksigner.bat"

if (-not (Test-Path -LiteralPath (Join-Path $SdkRoot "platforms\android-36\android.jar"))) {
    throw "Android SDK Platform 36 is missing: $SdkRoot"
}
if (-not (Test-Path -LiteralPath $signer)) {
    throw "Android Build Tools 36.0.0 is missing: $SdkRoot"
}

Push-Location $PSScriptRoot
try {
    & ".\gradlew.bat" clean test lint verifyMobileScope assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "Android build or test failed" }
} finally {
    Pop-Location
}

$size = (Get-Item -LiteralPath $sourceApk).Length
if ($size -gt 3MB) { throw "APK exceeds the 3 MB limit: $size bytes" }

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Copy-Item -LiteralPath $sourceApk -Destination $outputApk -Force
& $signer verify --verbose --print-certs $outputApk
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed" }

$hash = (Get-FileHash -LiteralPath $outputApk -Algorithm SHA256).Hash
[pscustomobject]@{
    Path = $outputApk
    Bytes = $size
    SizeMB = [math]::Round($size / 1MB, 3)
    SHA256 = $hash
} | Format-List
