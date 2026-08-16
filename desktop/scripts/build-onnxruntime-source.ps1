param(
  [string]$Version = "1.18.1",
  [string]$LlvmMingwVersion = "20260505",
  [string]$Config = "Release",
  [string]$ToolchainDir = "",
  [string]$PythonVenvDir = "",
  [int]$DownloadThreads = 8,
  [int]$DownloadBufferKB = 1024,
  [switch]$BuildInference,
  [switch]$Force
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ToolchainDir) {
  $ToolchainDir = Join-Path $ProjectRoot ".toolchain"
}
if (-not $PythonVenvDir) {
  $PythonVenvDir = Join-Path $ProjectRoot "python"
}

$DownloadsDir = Join-Path $ToolchainDir "downloads"
$SourceRoot = Join-Path $ToolchainDir "onnxruntime-src"
$BuildRoot = Join-Path $ToolchainDir "onnxruntime-build"
$InstallRoot = Join-Path $ToolchainDir "onnxruntime-v$Version-mingw"
$LlvmMingwRoot = Join-Path $ToolchainDir "llvm-mingw"
$EigenCommit = "e7248b26a1ed53fa030c5c459f7ea095dfd276ac"
$EigenUrl = "https://gitlab.com/libeigen/eigen/-/archive/$EigenCommit/eigen-$EigenCommit.zip"
$EigenRoot = Join-Path $ToolchainDir "eigen-src"
$EigenArchive = Join-Path $DownloadsDir "eigen-$EigenCommit.zip"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "OK  $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "WARN $Message" -ForegroundColor Yellow
}

function First-ExistingPath {
  param([string[]]$Paths)
  foreach ($candidate in $Paths) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  return ""
}

function Remove-DirectorySafe {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Get-RemoteFileSize {
  param([string]$Url)

  try {
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.Method = "HEAD"
    $request.AllowAutoRedirect = $true
    $request.UserAgent = "setup-env"
    $response = $request.GetResponse()
    try {
      return [int64]$response.ContentLength
    } finally {
      $response.Close()
    }
  } catch {
    return -1
  }
}

function Test-RangeDownloadSupported {
  param([string]$Url)

  try {
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.Method = "GET"
    $request.AllowAutoRedirect = $true
    $request.UserAgent = "setup-env"
    $request.AddRange(0, 0)
    $response = $request.GetResponse()
    try {
      return ([int]$response.StatusCode -eq 206)
    } finally {
      $response.Close()
    }
  } catch {
    return $false
  }
}

function Download-RangePart {
  param(
    [string]$Url,
    [string]$PartPath,
    [int64]$Start,
    [int64]$End,
    [int]$BufferSize
  )

  $request = [System.Net.HttpWebRequest]::Create($Url)
  $request.Method = "GET"
  $request.AllowAutoRedirect = $true
  $request.UserAgent = "setup-env"
  $request.AddRange($Start, $End)

  $response = $request.GetResponse()
  try {
    $stream = $response.GetResponseStream()
    $file = [System.IO.File]::Open($PartPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $buffer = New-Object byte[] $BufferSize
      while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $file.Write($buffer, 0, $read)
      }
    } finally {
      $file.Close()
      if ($stream) { $stream.Close() }
    }
  } finally {
    $response.Close()
  }
}

function Download-FileSingle {
  param(
    [string]$Url,
    [string]$Destination
  )

  $tmp = "$Destination.part"
  if (Test-Path -LiteralPath $tmp) {
    Remove-Item -LiteralPath $tmp -Force
  }

  Write-Host ">> download $Url"
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
  Move-Item -LiteralPath $tmp -Destination $Destination -Force
}

function Download-FileMulti {
  param(
    [string]$Url,
    [string]$Destination,
    [int]$Threads,
    [int]$BufferKB
  )

  if ($Threads -lt 2) {
    Download-FileSingle $Url $Destination
    return
  }

  $size = Get-RemoteFileSize $Url
  if ($size -le 0) {
    Write-Warn "Cannot determine remote file size. Falling back to single-thread download."
    Download-FileSingle $Url $Destination
    return
  }

  if (-not (Test-RangeDownloadSupported $Url)) {
    Write-Warn "Server does not support HTTP Range. Falling back to single-thread download."
    Download-FileSingle $Url $Destination
    return
  }

  $tmpDir = "$Destination.parts"
  if (Test-Path -LiteralPath $tmpDir) {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

  $Threads = [Math]::Min($Threads, [int]$size)
  $partSize = [int64][Math]::Ceiling($size / [double]$Threads)
  $jobs = @()
  $bufferSize = [Math]::Max(64, $BufferKB) * 1024

  Write-Host ">> download $Url ($Threads threads)"

  for ($i = 0; $i -lt $Threads; $i++) {
    $start = [int64]($i * $partSize)
    $end = [int64]([Math]::Min($start + $partSize - 1, $size - 1))
    if ($start -gt $end) { continue }

    $partPath = Join-Path $tmpDir ("part-{0:D4}.bin" -f $i)
    $jobs += Start-Job -ScriptBlock {
      param($u, $p, $s, $e, $b)
      $request = [System.Net.HttpWebRequest]::Create($u)
      $request.Method = "GET"
      $request.AllowAutoRedirect = $true
      $request.UserAgent = "setup-env"
      $request.AddRange([int64]$s, [int64]$e)
      $response = $request.GetResponse()
      try {
        $stream = $response.GetResponseStream()
        $file = [System.IO.File]::Open($p, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
          $buffer = New-Object byte[] $b
          while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $file.Write($buffer, 0, $read)
          }
        } finally {
          $file.Close()
          if ($stream) { $stream.Close() }
        }
      } finally {
        $response.Close()
      }
    } -ArgumentList $Url, $partPath, $start, $end, $bufferSize
  }

  try {
    Wait-Job -Job $jobs | Out-Null
    foreach ($job in $jobs) {
      if ($job.State -ne "Completed") {
        $err = Receive-Job -Job $job -ErrorAction SilentlyContinue
        throw "A download worker failed: $err"
      }
      Receive-Job -Job $job -ErrorAction Stop | Out-Null
    }

    $tmp = "$Destination.part"
    if (Test-Path -LiteralPath $tmp) {
      Remove-Item -LiteralPath $tmp -Force
    }

    $out = [System.IO.File]::Open($tmp, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      for ($i = 0; $i -lt $Threads; $i++) {
        $partPath = Join-Path $tmpDir ("part-{0:D4}.bin" -f $i)
        if (-not (Test-Path -LiteralPath $partPath)) {
          throw "Missing download part: $partPath"
        }
        $bytes = [System.IO.File]::ReadAllBytes($partPath)
        $out.Write($bytes, 0, $bytes.Length)
      }
    } finally {
      $out.Close()
    }

    $actual = (Get-Item -LiteralPath $tmp).Length
    if ($actual -ne $size) {
      throw "Downloaded file size mismatch. Expected $size bytes, got $actual bytes."
    }

    Move-Item -LiteralPath $tmp -Destination $Destination -Force
  } finally {
    foreach ($job in $jobs) {
      Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $tmpDir) {
      Remove-Item -LiteralPath $tmpDir -Recurse -Force
    }
  }
}

function Download-File {
  param(
    [string]$Url,
    [string]$Destination
  )

  if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
    Write-Ok "Using cached download: $Destination"
    return
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null

  try {
    Download-FileMulti -Url $Url -Destination $Destination -Threads $DownloadThreads -BufferKB $DownloadBufferKB
  } catch {
    Write-Warn "Multi-thread download failed: $($_.Exception.Message)"
    Write-Warn "Retrying with single-thread download."
    Download-FileSingle -Url $Url -Destination $Destination
  }
}

function Remove-DirectorySafe {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if ($fullPath.Length -lt 10) {
    throw "Refusing to remove suspiciously short path: $fullPath"
  }

  try {
    Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction Stop
    return
  } catch {
    Write-Warn "PowerShell Remove-Item failed for $fullPath. Retrying with .NET directory deletion..."
  }

  try {
    [System.IO.Directory]::Delete($fullPath, $true)
    return
  } catch {
    Write-Warn ".NET directory deletion failed for $fullPath. Retrying with cmd rmdir..."
  }

  & cmd.exe /c "rmdir /s /q `"$fullPath`""
  if ((Test-Path -LiteralPath $fullPath) -or $LASTEXITCODE -ne 0) {
    throw "Failed to remove directory: $fullPath"
  }
}

function Expand-ZipArchiveWithTarOrDotNet {
  param(
    [string]$Archive,
    [string]$Destination
  )

  # Windows PowerShell 5.1 Expand-Archive has a known failure mode with some
  # GitHub source archives, including ONNX Runtime, where duplicate/stale entries
  # such as .clang-format can trigger an internal Remove-Item error. Avoid it.
  $tarExe = Join-Path $env:SystemRoot "System32\tar.exe"
  if (Test-Path -LiteralPath $tarExe) {
    Write-Host ">> $tarExe -xf $Archive -C $Destination"
    & $tarExe -xf $Archive -C $Destination
    if ($LASTEXITCODE -eq 0) {
      return
    }
    Write-Warn "tar.exe extraction failed with exit code $LASTEXITCODE. Falling back to .NET ZipFile."
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
}

function Expand-ZipArchiveClean {
  param(
    [string]$Archive,
    [string]$Destination,
    [string]$Description
  )

  $parent = Split-Path -Path $Destination -Parent
  $leaf = Split-Path -Path $Destination -Leaf
  New-Item -ItemType Directory -Force -Path $parent | Out-Null

  $tempDestination = Join-Path $parent ("$leaf.extracting.$([guid]::NewGuid().ToString('N'))")
  if (Test-Path -LiteralPath $tempDestination) {
    Remove-DirectorySafe $tempDestination
  }

  New-Item -ItemType Directory -Force -Path $tempDestination | Out-Null
  try {
    Expand-ZipArchiveWithTarOrDotNet -Archive $Archive -Destination $tempDestination

    if (Test-Path -LiteralPath $Destination) {
      Write-Warn "Existing $Description directory is incomplete or outdated. Replacing: $Destination"
      Remove-DirectorySafe $Destination
    }

    Move-Item -LiteralPath $tempDestination -Destination $Destination -ErrorAction Stop
  } catch {
    if (Test-Path -LiteralPath $tempDestination) {
      Remove-DirectorySafe $tempDestination
    }
    throw
  }
}

function Expand-ZipArchiveFresh {
  param(
    [string]$Archive,
    [string]$Destination,
    [string]$ValidationPath,
    [string]$Description
  )

  if ((Test-Path -LiteralPath $ValidationPath) -and -not $Force) {
    Write-Ok "Using existing $Description`: $ValidationPath"
    return
  }

  Expand-ZipArchiveClean -Archive $Archive -Destination $Destination -Description $Description

  if (-not (Test-Path -LiteralPath $ValidationPath)) {
    throw "$Description was not found after extraction: $ValidationPath"
  }
}

function Resolve-LocalTool {
  param(
    [string]$ToolGroup,
    [string]$Executable
  )
  $base = Join-Path $ToolchainDir $ToolGroup
  $direct = Join-Path $base $Executable
  if (Test-Path -LiteralPath $direct) {
    return $direct
  }
  $match = Get-ChildItem -LiteralPath $base -Recurse -Filter $Executable -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($match) {
    return $match.FullName
  }
  return $Executable
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = $ProjectRoot
  )
  Write-Host ">> $FilePath $($Arguments -join ' ')"
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  } finally {
    Pop-Location
  }
  if ($exitCode -ne 0) {
    throw "Command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')"
  }
}

function Ensure-LlvmMingw {
  Write-Step "Preparing llvm-mingw toolchain"
  $archive = Join-Path $DownloadsDir "llvm-mingw-$LlvmMingwVersion-ucrt-x86_64.zip"
  Download-File "https://github.com/mstorsjo/llvm-mingw/releases/download/$LlvmMingwVersion/llvm-mingw-$LlvmMingwVersion-ucrt-x86_64.zip" $archive

  $bin = Join-Path $LlvmMingwRoot "llvm-mingw-$LlvmMingwVersion-ucrt-x86_64\bin"
  $cc = Join-Path $bin "x86_64-w64-mingw32-clang.exe"
  Expand-ZipArchiveFresh -Archive $archive -Destination $LlvmMingwRoot -ValidationPath $cc -Description "llvm-mingw toolchain"

  if (-not (Test-Path -LiteralPath $bin)) {
    throw "llvm-mingw bin directory was not found under $LlvmMingwRoot"
  }
  return $bin
}

function Find-OnnxRuntimeSourceDir {
  param([string]$Root)

  $expected = Join-Path $Root "onnxruntime-$Version"
  $expectedBuildScript = Join-Path $expected "tools\ci_build\build.py"
  if (Test-Path -LiteralPath $expectedBuildScript) {
    return $expected
  }

  $candidate = Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue |
    Where-Object {
      (Test-Path -LiteralPath (Join-Path $_.FullName "tools\ci_build\build.py")) -and
      (Test-Path -LiteralPath (Join-Path $_.FullName "include\onnxruntime\core\session"))
    } |
    Select-Object -First 1

  if ($candidate) {
    return $candidate.FullName
  }

  return ""
}

function Ensure-OnnxRuntimeSource {
  Write-Step "Preparing ONNX Runtime source"
  $archive = Join-Path $DownloadsDir "onnxruntime-v$Version.zip"
  Download-File "https://github.com/microsoft/onnxruntime/archive/refs/tags/v$Version.zip" $archive

  $sourceDir = Find-OnnxRuntimeSourceDir -Root $SourceRoot
  if ($sourceDir -and -not $Force) {
    Write-Ok "Using existing ONNX Runtime source: $sourceDir"
    return $sourceDir
  }

  Expand-ZipArchiveClean -Archive $archive -Destination $SourceRoot -Description "ONNX Runtime source"

  $sourceDir = Find-OnnxRuntimeSourceDir -Root $SourceRoot
  if (-not $sourceDir) {
    $children = Get-ChildItem -LiteralPath $SourceRoot -Force -ErrorAction SilentlyContinue |
      ForEach-Object { $_.FullName }
    throw "ONNX Runtime source directory was not found after extraction. Expected a directory containing tools\ci_build\build.py under $SourceRoot. Found: $($children -join '; ')"
  }

  Write-Ok "ONNX Runtime source ready: $sourceDir"
  return $sourceDir
}


function Find-EigenSourceDir {
  param([string]$Root)

  if ((Test-Path -LiteralPath (Join-Path $Root "Eigen\Core")) -or
      (Test-Path -LiteralPath (Join-Path $Root "Eigen\Core.h"))) {
    return $Root
  }

  $match = Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue |
    Where-Object {
      (Test-Path -LiteralPath (Join-Path $_.FullName "Eigen\Core")) -or
      (Test-Path -LiteralPath (Join-Path $_.FullName "Eigen\Core.h"))
    } |
    Select-Object -First 1

  if ($match) {
    return $match.FullName
  }

  return ""
}

function Ensure-EigenSource {
  Write-Step "Preparing Eigen source"

  Download-File $EigenUrl $EigenArchive "Eigen source archive"

  $existing = ""
  if ((Test-Path -LiteralPath $EigenRoot) -and -not $Force) {
    $existing = Find-EigenSourceDir $EigenRoot
  }

  if ($existing) {
    Write-Ok "Using existing Eigen source: $existing"
    return $existing
  }

  if (Test-Path -LiteralPath $EigenRoot) {
    Write-Warn "Existing Eigen source directory is incomplete or outdated. Re-extracting: $EigenRoot"
  }

  Expand-ZipArchiveClean -Archive $EigenArchive -Destination $EigenRoot -Description "Eigen source"

  $detected = Find-EigenSourceDir $EigenRoot
  if (-not $detected) {
    $children = Get-ChildItem -LiteralPath $EigenRoot -Force -ErrorAction SilentlyContinue |
      ForEach-Object { $_.FullName }
    throw "Eigen source directory was not found after extraction. Found: $($children -join '; ')"
  }

  Write-Ok "Eigen source ready: $detected"
  return $detected
}

function Install-BuildRequirements {
  param(
    [string]$SourceDir,
    [string]$PythonExe,
    [string]$UvExe
  )
  $requirements = Join-Path $SourceDir "requirements.txt"
  if (-not (Test-Path -LiteralPath $requirements)) {
    return
  }
  Write-Step "Installing ONNX Runtime Python build requirements"
  Invoke-Checked $UvExe @("pip", "install", "--python", $PythonExe, "-r", $requirements)
}


function Patch-OnnxRuntimeEigenArchiveHash {
  param([string]$SourceDir)

  # ONNX Runtime 1.18.1 pins the SHA1 of GitLab's dynamically generated
  # Eigen zip archive. In practice GitLab can regenerate the zip container
  # with a different archive hash while preserving the same commit contents.
  # Recursively patch all CMake-related files that still contain the old hash.
  $oldHash = "be8be39fdbc6e60e94fa7870b280707069b5b81a"
  $newHash = "32b145f525a8308d7ab1c09388b2e288312d8eba"
  $patchedCount = 0

  if (Test-Path -LiteralPath $SourceDir) {
    $files = Get-ChildItem -LiteralPath $SourceDir -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Extension -in @(".cmake", ".txt", ".in", ".json") -or
        $_.Name -eq "CMakeLists.txt"
      }

    foreach ($file in $files) {
      try {
        $content = [IO.File]::ReadAllText($file.FullName)
        if ($content.Contains($oldHash)) {
          $patched = $content.Replace($oldHash, $newHash)
          [IO.File]::WriteAllText($file.FullName, $patched, [Text.UTF8Encoding]::new($false))
          $patchedCount++
        }
      } catch {
        Write-Warn "Failed to inspect or patch file: $($file.FullName)"
      }
    }
  }

  if ($patchedCount -gt 0) {
    Write-Warn "Patched Eigen archive SHA1 in $patchedCount ONNX Runtime CMake file(s)."
  } else {
    Write-Ok "No stale Eigen archive SHA1 found in ONNX Runtime source, or it was already patched."
  }

  # Remove generated FetchContent state so CMake regenerates download scripts.
  $releaseBuildRoot = Join-Path $BuildRoot $Config
  if (Test-Path -LiteralPath $releaseBuildRoot) {
    Get-ChildItem -LiteralPath $releaseBuildRoot -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -like "*eigen*" -or
        ($_.PSIsContainer -and $_.FullName -like "*\_deps\*")
      } |
      Sort-Object { $_.FullName.Length } -Descending |
      ForEach-Object {
        try {
          if ($_.PSIsContainer) {
            Remove-DirectorySafe $_.FullName
          } else {
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
          }
        } catch {
          Write-Warn "Failed to remove stale Eigen build state: $($_.FullName)"
        }
      }
  }
}

function Find-BuiltFile {
  param(
    [string]$Root,
    [string[]]$Names
  )
  foreach ($name in $Names) {
    $match = Get-ChildItem -LiteralPath $Root -Recurse -File -Filter $name -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($match) {
      return $match.FullName
    }
  }
  return ""
}

function Install-OnnxRuntimeArtifacts {
  param([string]$SourceDir)
  Write-Step "Installing ONNX Runtime artifacts"
  $includeDir = Join-Path $InstallRoot "include"
  $libDir = Join-Path $InstallRoot "lib"
  if (Test-Path -LiteralPath $InstallRoot) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $includeDir, $libDir | Out-Null

  $sessionInclude = Join-Path $SourceDir "include\onnxruntime\core\session"
  if (-not (Test-Path -LiteralPath $sessionInclude)) {
    throw "ONNX Runtime include directory was not found: $sessionInclude"
  }
  Copy-Item -LiteralPath (Join-Path $sessionInclude "*.h") -Destination $includeDir -Force

  $dll = Find-BuiltFile $BuildRoot @("onnxruntime.dll")
  $importLib = Find-BuiltFile $BuildRoot @("libonnxruntime.dll.a", "onnxruntime.lib")
  if (-not $dll -or -not $importLib) {
    throw "Could not find built ONNX Runtime dll/import library under $BuildRoot"
  }

  Copy-Item -LiteralPath $dll -Destination (Join-Path $libDir "onnxruntime.dll") -Force
  if ($importLib.EndsWith(".dll.a")) {
    Copy-Item -LiteralPath $importLib -Destination (Join-Path $libDir "libonnxruntime.dll.a") -Force
  } else {
    Copy-Item -LiteralPath $importLib -Destination (Join-Path $libDir "onnxruntime.lib") -Force
  }

  Write-Ok "ONNXRUNTIME_ROOT=$InstallRoot"
}

Push-Location $ProjectRoot
function New-OptionalMacroGuardHeader {
  $patchDir = Join-Path $ToolchainDir "patches"
  New-Item -ItemType Directory -Force -Path $patchDir | Out-Null

  $headerPath = Join-Path $patchDir "ort_mingw_optional_guard.h"
  $headerText = @"
#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#if defined(_WIN32)
#include <windows.h>
#endif
#ifdef OPTIONAL
#undef OPTIONAL
#endif
#ifdef ERROR
#undef ERROR
#endif
"@

  Set-Content -LiteralPath $headerPath -Value $headerText -Encoding ASCII
  return (Resolve-Path -LiteralPath $headerPath).Path
}

try {
  $llvmMingwBin = Ensure-LlvmMingw
  $sourceDir = Ensure-OnnxRuntimeSource

  $pythonExe = Join-Path $PythonVenvDir "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "Python venv was not found: $pythonExe. Run npm run setup:env first."
  }

  $uvExe = Resolve-LocalTool "uv" "uv.exe"
  $cmakeExe = Resolve-LocalTool "cmake" "cmake.exe"
  $ninjaExe = Resolve-LocalTool "ninja" "ninja.exe"

  $env:PATH = @(
    $llvmMingwBin,
    (Split-Path $cmakeExe -Parent),
    (Split-Path $ninjaExe -Parent),
    (Split-Path $uvExe -Parent),
    (Split-Path $pythonExe -Parent),
    $env:PATH
  ) -join [IO.Path]::PathSeparator

  $env:CC = Join-Path $llvmMingwBin "x86_64-w64-mingw32-clang.exe"
  $env:CXX = Join-Path $llvmMingwBin "x86_64-w64-mingw32-clang++.exe"
  $env:RC = Join-Path $llvmMingwBin "llvm-rc.exe"

  foreach ($requiredTool in @($env:CC, $env:CXX, $env:RC, $cmakeExe, $ninjaExe, $uvExe)) {
    if (-not (Test-Path -LiteralPath $requiredTool)) {
      throw "Required build tool was not found: $requiredTool"
    }
  }

  Install-BuildRequirements -SourceDir $sourceDir -PythonExe $pythonExe -UvExe $uvExe

  # Prepare Eigen locally before invoking ONNX Runtime CMake.
  # This is required because GitLab archive zip hashes can differ from
  # ONNX Runtime 1.18.1's pinned SHA1 even for the same Eigen commit.
  $eigenSourceDir = Ensure-EigenSource
  if (-not $eigenSourceDir -or -not (Test-Path -LiteralPath $eigenSourceDir)) {
    throw "Eigen source directory was not prepared correctly."
  }

  Patch-OnnxRuntimeEigenArchiveHash -SourceDir $sourceDir

  # Do not pass ONNX Runtime build.py --parallel when using llvm-mingw on Windows.
  # build.py treats native Windows as an MSVC build and injects /MP into
  # CMAKE_C_FLAGS/CMAKE_CXX_FLAGS. llvm-mingw clang is GNU-like and fails
  # with: clang: error: no such file or directory: '/MP'.
  # Ninja still performs parallel builds by itself; this env var only provides
  # a sensible upper bound without forcing MSVC-only flags.
  if (-not $env:CMAKE_BUILD_PARALLEL_LEVEL) {
    $env:CMAKE_BUILD_PARALLEL_LEVEL = [string][Math]::Max(1, [Environment]::ProcessorCount)
  }

  $optionalGuardHeader = New-OptionalMacroGuardHeader
  $optionalGuardHeaderForCMake = $optionalGuardHeader.Replace('\', '/')

  Write-Step "Building ONNX Runtime from source with llvm-mingw"
  Invoke-Checked $pythonExe @(
    (Join-Path $sourceDir "tools\ci_build\build.py"),
    "--config", $Config,
    "--build_dir", $BuildRoot,
    "--skip_tests",
    "--build_shared_lib",
    "--compile_no_warning_as_error",
    "--cmake_generator", "Ninja",
    "--cmake_extra_defines", "CMAKE_MAKE_PROGRAM=$($ninjaExe.Replace('\', '/'))",
    "--cmake_extra_defines", "CMAKE_C_COMPILER=$($env:CC.Replace('\', '/'))",
    "--cmake_extra_defines", "CMAKE_CXX_COMPILER=$($env:CXX.Replace('\', '/'))",
    "--cmake_extra_defines", "CMAKE_RC_COMPILER=$($env:RC.Replace('\', '/'))",
    "--cmake_extra_defines", "CMAKE_C_FLAGS=-include $optionalGuardHeaderForCMake -UOPTIONAL -UERROR",
    "--cmake_extra_defines", "CMAKE_CXX_FLAGS=-include $optionalGuardHeaderForCMake -UOPTIONAL -UERROR",
    "--cmake_extra_defines", "FETCHCONTENT_SOURCE_DIR_EIGEN=$($eigenSourceDir.Replace('\', '/'))"
  ) $sourceDir

  Install-OnnxRuntimeArtifacts -SourceDir $sourceDir

  if ($BuildInference) {
    Write-Step "Building inference executable against source-built ONNX Runtime"
    $env:ONNXRUNTIME_ROOT = $InstallRoot

    $nodeExe = Resolve-LocalTool "node" "node.exe"
    if (-not (Test-Path -LiteralPath $nodeExe)) {
      $nodeExe = "node"
    }

    Invoke-Checked $nodeExe @((Join-Path $PSScriptRoot "build-infer.js"))
  }

  Write-Step "Done"
  Write-Ok "ONNX Runtime source build is ready: $InstallRoot"
} finally {
  Pop-Location
}
