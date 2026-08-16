<#
.SYNOPSIS
  Prepare the desktop build environment for this project.

.DESCRIPTION
  This script is intentionally project-local by default:
  - Node.js, CMake, Ninja, LLVM/Clang and uv are downloaded into .toolchain.
  - Python is installed and managed by uv inside .toolchain/uv/python.
  - The project virtual environment is created at ./python by default.
  - Python packages are installed only into that virtual environment.

  The script never installs or modifies system Python. Even when -UseSystemTools
  is specified, Python still comes from the project-local uv-managed runtime.
#>

[CmdletBinding()]
param(
  [switch]$SkipSystemTools,
  [switch]$SkipNodeInstall,
  [switch]$SkipBundledPython,
  [switch]$SkipPythonDeps,
  [switch]$BuildInference,
  [switch]$OfflineInference,
  [switch]$CheckOnly,
  [switch]$Force,
  [switch]$UseSystemTools,
  [string]$PythonVenvDir = "",
  [string]$ToolchainDir = "",
  [string]$PipIndexUrl = "",
  [string[]]$ExtraPipArgs = @(),
  [ValidateRange(1, 32)]
  [int]$DownloadThreads = 8,
  [ValidateRange(64, 8192)]
  [int]$DownloadBufferKB = 1024
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# PowerShell 5.1 does not define $IsWindows. Keep platform checks strict-mode safe.
$script:IsWindowsPlatform = $false
if ($PSVersionTable.PSEdition -eq "Desktop" -or $env:OS -eq "Windows_NT") {
  $script:IsWindowsPlatform = $true
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DefaultToolchainDir = Join-Path $ProjectRoot ".toolchain"
$DefaultVenvDir = Join-Path $ProjectRoot "python"

if ([string]::IsNullOrWhiteSpace($ToolchainDir)) {
  $ToolchainDir = $DefaultToolchainDir
}
if ([string]::IsNullOrWhiteSpace($PythonVenvDir)) {
  $PythonVenvDir = $DefaultVenvDir
}

$ToolchainDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ToolchainDir)
$PythonVenvDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PythonVenvDir)

if ($CheckOnly) {
  $SkipSystemTools = $true
  $SkipNodeInstall = $true
  $SkipBundledPython = $true
  $SkipPythonDeps = $true
  $BuildInference = $false
}

$Versions = [ordered]@{
  Node   = "20.18.1"
  CMake  = "3.28.1"
  Ninja  = "1.12.1"
  Python = "3.11.9"
  LLVM   = "18.1.8"
  Uv     = "0.11.11"
}

$script:Tools = [ordered]@{
  Node    = ""
  Npm     = ""
  CMake   = ""
  Ninja   = ""
  Clang   = ""
  Clangxx = ""
  ClangCl = ""
  Lld     = ""
  Uv      = ""
}

function Write-Step {
  param([Parameter(Mandatory)][string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([Parameter(Mandatory)][string]$Message)
  Write-Host "OK  $Message" -ForegroundColor Green
}

function Write-Warn {
  param([Parameter(Mandatory)][string]$Message)
  Write-Host "WARN $Message" -ForegroundColor Yellow
}

function Test-CommandExists {
  param([Parameter(Mandatory)][string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function New-Directory {
  param([Parameter(Mandatory)][string]$Path)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Assert-FileExists {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Name
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Name was not found: $Path"
  }
  return $Path
}

function Get-FirstExistingFile {
  param([Parameter(Mandatory)][string[]]$Paths)
  foreach ($Path in $Paths) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      return $Path
    }
  }
  return ""
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = $ProjectRoot
  )

  Write-Host ">> $FilePath $($Arguments -join ' ')"
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    $ExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  }
  finally {
    Pop-Location
  }

  if ($ExitCode -ne 0) {
    throw "Command failed with exit code ${ExitCode}: $FilePath $($Arguments -join ' ')"
  }
}

function Initialize-ParallelDownloader {
  try {
    $null = [ProjectSetup.ParallelDownloader]
    return
  }
  catch {
    # Type is not loaded yet.
  }

  Add-Type -Language CSharp -ReferencedAssemblies "System.Net.Http" -TypeDefinition @"
using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;

namespace ProjectSetup {
  public static class ParallelDownloader {
    private static readonly HttpClient Client;

    static ParallelDownloader() {
      ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
      var handler = new HttpClientHandler();
      handler.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
      Client = new HttpClient(handler);
      Client.Timeout = TimeSpan.FromHours(2);
      Client.DefaultRequestHeaders.UserAgent.ParseAdd("project-setup-env/1.0");
    }

    public static bool Download(string url, string destination, int threadCount, int bufferSize) {
      if (threadCount < 1) threadCount = 1;
      if (bufferSize < 65536) bufferSize = 65536;

      Directory.CreateDirectory(Path.GetDirectoryName(destination));
      long length = GetLengthIfRangeSupported(url);

      if (threadCount <= 1 || length <= 0 || length < 1024 * 1024) {
        DownloadSingle(url, destination, bufferSize);
        return false;
      }

      DownloadParallel(url, destination, length, threadCount, bufferSize);
      return true;
    }

    private static long GetLengthIfRangeSupported(string url) {
      using (var request = new HttpRequestMessage(HttpMethod.Get, url)) {
        request.Headers.Range = new RangeHeaderValue(0, 0);
        using (var response = Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult()) {
          if ((int)response.StatusCode != 206) return -1;
          if (response.Content.Headers.ContentRange == null) return -1;
          if (!response.Content.Headers.ContentRange.Length.HasValue) return -1;
          return response.Content.Headers.ContentRange.Length.Value;
        }
      }
    }

    private static void DownloadSingle(string url, string destination, int bufferSize) {
      string tempFile = destination + ".part";
      if (File.Exists(tempFile)) File.Delete(tempFile);

      try {
        using (var response = Client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult()) {
          response.EnsureSuccessStatusCode();
          using (var input = response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
          using (var output = new FileStream(tempFile, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize)) {
            CopyStream(input, output, bufferSize);
          }
        }
        ReplaceFile(tempFile, destination);
      }
      catch {
        TryDelete(tempFile);
        throw;
      }
    }

    private static void DownloadParallel(string url, string destination, long length, int threadCount, int bufferSize) {
      int partCount = (int)Math.Min((long)threadCount, length);
      long partSize = (length + partCount - 1) / partCount;
      string tempDir = destination + ".parts";
      string tempFile = destination + ".part";

      TryDelete(tempFile);
      if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true);
      Directory.CreateDirectory(tempDir);

      try {
        Task[] tasks = new Task[partCount];
        for (int i = 0; i < partCount; i++) {
          int index = i;
          long start = index * partSize;
          long end = Math.Min(length - 1, start + partSize - 1);
          string partPath = Path.Combine(tempDir, index.ToString("D4") + ".part");
          tasks[index] = Task.Factory.StartNew(delegate { DownloadRange(url, partPath, start, end, bufferSize); });
        }

        Task.WaitAll(tasks);

        using (var output = new FileStream(tempFile, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize)) {
          for (int i = 0; i < partCount; i++) {
            string partPath = Path.Combine(tempDir, i.ToString("D4") + ".part");
            using (var input = new FileStream(partPath, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize)) {
              CopyStream(input, output, bufferSize);
            }
          }
        }

        var fileInfo = new FileInfo(tempFile);
        if (fileInfo.Length != length) {
          throw new IOException("Downloaded file size mismatch. Expected " + length + " bytes, got " + fileInfo.Length + " bytes.");
        }

        ReplaceFile(tempFile, destination);
      }
      catch {
        TryDelete(tempFile);
        throw;
      }
      finally {
        if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true);
      }
    }

    private static void DownloadRange(string url, string partPath, long start, long end, int bufferSize) {
      using (var request = new HttpRequestMessage(HttpMethod.Get, url)) {
        request.Headers.Range = new RangeHeaderValue(start, end);
        using (var response = Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult()) {
          if ((int)response.StatusCode != 206) {
            throw new HttpRequestException("Server did not return HTTP 206 for range " + start + "-" + end + ".");
          }
          using (var input = response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
          using (var output = new FileStream(partPath, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize)) {
            CopyStream(input, output, bufferSize);
          }
        }
      }
    }

    private static void CopyStream(Stream input, Stream output, int bufferSize) {
      byte[] buffer = new byte[bufferSize];
      int read;
      while ((read = input.Read(buffer, 0, buffer.Length)) > 0) {
        output.Write(buffer, 0, read);
      }
    }

    private static void ReplaceFile(string tempFile, string destination) {
      if (File.Exists(destination)) File.Delete(destination);
      File.Move(tempFile, destination);
    }

    private static void TryDelete(string path) {
      try {
        if (File.Exists(path)) File.Delete(path);
      }
      catch { }
    }
  }
}
"@
}

function Download-File {
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$Destination
  )

  if ((Test-Path -LiteralPath $Destination -PathType Leaf) -and -not $Force) {
    Write-Ok "Using cached download: $Destination"
    return
  }

  New-Directory (Split-Path -Parent $Destination)
  $ProgressPreference = "SilentlyContinue"

  try {
    Initialize-ParallelDownloader
    Write-Host ">> download $Url"
    Write-Host ">> parallel downloader: $DownloadThreads threads, $DownloadBufferKB KB buffer"
    $UsedParallel = [ProjectSetup.ParallelDownloader]::Download(
      $Url,
      $Destination,
      $DownloadThreads,
      ($DownloadBufferKB * 1024)
    )

    if ($UsedParallel) {
      Write-Ok "Downloaded with multi-thread range requests: $Destination"
    }
    else {
      Write-Ok "Downloaded with single-stream fallback: $Destination"
    }
  }
  catch {
    Write-Warn "Multi-thread download failed or is unsupported. Falling back to Invoke-WebRequest. Detail: $($_.Exception.Message)"
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
  }
}

function Remove-PathSafe {
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  try {
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
  }
  catch {
    # A short retry avoids common Windows file-lock timing issues after extraction or npm operations.
    Start-Sleep -Milliseconds 500
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
  }
}

function Expand-ArchiveSafe {
  param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$Destination
  )

  $Stage = "$Destination.stage"
  Remove-PathSafe $Stage
  New-Directory $Stage

  try {
    if ($Archive -match '\.(zip)$') {
      Expand-Archive -LiteralPath $Archive -DestinationPath $Stage -Force
    }
    elseif ($Archive -match '\.(tar\.xz|txz|tar\.gz|tgz)$') {
      Invoke-Checked "tar" @("-xf", $Archive, "-C", $Stage)
    }
    else {
      throw "Unsupported archive format: $Archive"
    }

    Remove-PathSafe $Destination
    Move-Item -LiteralPath $Stage -Destination $Destination -Force
  }
  catch {
    Remove-PathSafe $Stage
    throw
  }
}

function Ensure-ArchiveExpanded {
  param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string[]]$RequiredFiles
  )

  $Complete = $true
  foreach ($RequiredFile in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $Destination $RequiredFile) -PathType Leaf)) {
      $Complete = $false
      break
    }
  }

  if ($Complete -and -not $Force) {
    Write-Ok "Using existing tool directory: $Destination"
    return
  }

  Expand-ArchiveSafe -Archive $Archive -Destination $Destination
}

function Add-PathPrefix {
  param([Parameter(Mandatory)][string[]]$Paths)

  $Existing = $Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
  if ($Existing.Count -eq 0) {
    return
  }

  $env:PATH = ($Existing -join [IO.Path]::PathSeparator) + [IO.Path]::PathSeparator + $env:PATH
}

function Initialize-UvEnvironment {
  $UvDir = Join-Path $ToolchainDir "uv"
  $script:Tools.Uv = Get-FirstExistingFile @(
    (Join-Path $UvDir "uv.exe"),
    (Join-Path $UvDir "uv-x86_64-pc-windows-msvc\uv.exe")
  )

  $UvCacheDir = Join-Path $UvDir "cache"
  $UvPythonDir = Join-Path $UvDir "python"
  New-Directory $UvCacheDir
  New-Directory $UvPythonDir

  $env:UV_CACHE_DIR = $UvCacheDir
  $env:UV_PYTHON_INSTALL_DIR = $UvPythonDir
  $env:UV_PYTHON_BIN_DIR = Join-Path $UvDir "python-bin"
  $env:UV_PYTHON_INSTALL_BIN = "0"
  $env:UV_NO_MODIFY_PATH = "1"
  $env:UV_PYTHON_PREFERENCE = "only-managed"
  New-Directory $env:UV_PYTHON_BIN_DIR

  if ($PipIndexUrl) {
    $env:UV_INDEX_URL = $PipIndexUrl
  }
}

function Ensure-LocalToolchain {
  Write-Step "Preparing project-local toolchain"

  $Downloads = Join-Path $ToolchainDir "downloads"
  New-Directory $Downloads

  $NodeDir = Join-Path $ToolchainDir "node"
  $CMakeDir = Join-Path $ToolchainDir "cmake"
  $NinjaDir = Join-Path $ToolchainDir "ninja"
  $LlvmDir = Join-Path $ToolchainDir "llvm"
  $UvDir = Join-Path $ToolchainDir "uv"

  $NodeZip = Join-Path $Downloads "node-v$($Versions.Node)-win-x64.zip"
  $CMakeZip = Join-Path $Downloads "cmake-$($Versions.CMake)-windows-x86_64.zip"
  $NinjaZip = Join-Path $Downloads "ninja-win-$($Versions.Ninja).zip"
  $LlvmArchive = Join-Path $Downloads "clang+llvm-$($Versions.LLVM)-x86_64-pc-windows-msvc.tar.xz"
  $UvZip = Join-Path $Downloads "uv-$($Versions.Uv)-x86_64-pc-windows-msvc.zip"

  Download-File "https://nodejs.org/dist/v$($Versions.Node)/node-v$($Versions.Node)-win-x64.zip" $NodeZip
  Ensure-ArchiveExpanded $NodeZip $NodeDir @("node-v$($Versions.Node)-win-x64\node.exe", "node-v$($Versions.Node)-win-x64\npm.cmd")

  Download-File "https://github.com/Kitware/CMake/releases/download/v$($Versions.CMake)/cmake-$($Versions.CMake)-windows-x86_64.zip" $CMakeZip
  Ensure-ArchiveExpanded $CMakeZip $CMakeDir @("cmake-$($Versions.CMake)-windows-x86_64\bin\cmake.exe")

  Download-File "https://github.com/ninja-build/ninja/releases/download/v$($Versions.Ninja)/ninja-win.zip" $NinjaZip
  Ensure-ArchiveExpanded $NinjaZip $NinjaDir @("ninja.exe")

  Download-File "https://github.com/llvm/llvm-project/releases/download/llvmorg-$($Versions.LLVM)/clang+llvm-$($Versions.LLVM)-x86_64-pc-windows-msvc.tar.xz" $LlvmArchive
  Ensure-ArchiveExpanded $LlvmArchive $LlvmDir @("clang+llvm-$($Versions.LLVM)-x86_64-pc-windows-msvc\bin\clang.exe", "clang+llvm-$($Versions.LLVM)-x86_64-pc-windows-msvc\bin\clang++.exe")

  Download-File "https://github.com/astral-sh/uv/releases/download/$($Versions.Uv)/uv-x86_64-pc-windows-msvc.zip" $UvZip
  Ensure-ArchiveExpanded $UvZip $UvDir @("uv.exe")

  $NodeBin = Join-Path $NodeDir "node-v$($Versions.Node)-win-x64"
  $CMakeBin = Join-Path $CMakeDir "cmake-$($Versions.CMake)-windows-x86_64\bin"
  $NinjaBin = $NinjaDir
  $LlvmBin = Join-Path $LlvmDir "clang+llvm-$($Versions.LLVM)-x86_64-pc-windows-msvc\bin"

  $script:Tools.Node = Assert-FileExists (Join-Path $NodeBin "node.exe") "Node.js"
  $script:Tools.Npm = Assert-FileExists (Join-Path $NodeBin "npm.cmd") "npm"
  $script:Tools.CMake = Assert-FileExists (Join-Path $CMakeBin "cmake.exe") "CMake"
  $script:Tools.Ninja = Assert-FileExists (Join-Path $NinjaBin "ninja.exe") "Ninja"
  $script:Tools.Clang = Assert-FileExists (Join-Path $LlvmBin "clang.exe") "clang"
  $script:Tools.Clangxx = Assert-FileExists (Join-Path $LlvmBin "clang++.exe") "clang++"
  $script:Tools.ClangCl = Assert-FileExists (Join-Path $LlvmBin "clang-cl.exe") "clang-cl"
  $script:Tools.Lld = Assert-FileExists (Join-Path $LlvmBin "lld.exe") "lld"

  Initialize-UvEnvironment
  $script:Tools.Uv = Assert-FileExists $script:Tools.Uv "uv"

  Add-PathPrefix @($NodeBin, $CMakeBin, $NinjaBin, $LlvmBin, (Split-Path -Parent $script:Tools.Uv))

  Write-Step "Installing uv-managed Python"
  Invoke-Checked $script:Tools.Uv @("python", "install", "--no-bin", $Versions.Python)

  Write-Ok "Project-local toolchain ready: $ToolchainDir"
}

function Resolve-Tool {
  param(
    [string]$LocalPath,
    [Parameter(Mandatory)][string]$Command
  )

  if ($LocalPath -and (Test-Path -LiteralPath $LocalPath -PathType Leaf)) {
    return $LocalPath
  }

  if (Test-CommandExists $Command) {
    return $Command
  }

  throw "Required tool was not found: $Command"
}

function Test-VsBuildTools {
  $ProgramFilesX86 = ${env:ProgramFiles(x86)}
  if (-not $ProgramFilesX86) {
    $ProgramFilesX86 = "C:\Program Files (x86)"
  }

  $VsWhere = Join-Path $ProgramFilesX86 "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $VsWhere -PathType Leaf)) {
    return $false
  }

  $Result = & $VsWhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  return -not [string]::IsNullOrWhiteSpace(($Result | Out-String).Trim())
}

function Install-WithWinget {
  param(
    [Parameter(Mandatory)][string]$PackageId,
    [Parameter(Mandatory)][string]$DisplayName,
    [string[]]$ExtraArgs = @()
  )

  if (-not (Test-CommandExists "winget")) {
    throw "winget was not found. Install App Installer from Microsoft Store, then rerun this script."
  }

  Write-Step "Installing $DisplayName"
  Invoke-Checked "winget" (@(
    "install",
    "--id", $PackageId,
    "--exact",
    "--source", "winget",
    "--accept-package-agreements",
    "--accept-source-agreements"
  ) + $ExtraArgs)
}

function Ensure-SystemTool {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(Mandatory)][string]$PackageId,
    [Parameter(Mandatory)][string]$DisplayName,
    [string[]]$ExtraArgs = @()
  )

  if ((Test-CommandExists $Command) -and -not $Force) {
    Write-Ok "$DisplayName already available: $Command"
    return
  }

  Install-WithWinget -PackageId $PackageId -DisplayName $DisplayName -ExtraArgs $ExtraArgs
}

function Ensure-VsBuildTools {
  if ((Test-VsBuildTools) -and -not $Force) {
    Write-Ok "Visual Studio C++ Build Tools already available"
    return
  }

  $Override = "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  Install-WithWinget `
    -PackageId "Microsoft.VisualStudio.2022.BuildTools" `
    -DisplayName "Visual Studio Build Tools 2022 C++ workload" `
    -ExtraArgs @("--override", $Override)
}

function Ensure-SystemBuildTools {
  Write-Step "Checking system build tools"
  Ensure-SystemTool -Command "git" -PackageId "Git.Git" -DisplayName "Git"
  Ensure-SystemTool -Command "node" -PackageId "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
  Ensure-SystemTool -Command "cmake" -PackageId "Kitware.CMake" -DisplayName "CMake"
  Ensure-SystemTool -Command "ninja" -PackageId "Ninja-build.Ninja" -DisplayName "Ninja"
  Ensure-SystemTool -Command "clang" -PackageId "LLVM.LLVM" -DisplayName "LLVM/Clang"
  Ensure-VsBuildTools

  # Intentionally do not install or use system Python.
  Initialize-UvEnvironment
  if (-not $script:Tools.Uv) {
    throw "uv was not found. Run without -UseSystemTools once to bootstrap the project-local uv runtime."
  }
}

function Get-VenvPython {
  if ($script:IsWindowsPlatform) {
    return Join-Path $PythonVenvDir "Scripts\python.exe"
  }
  return Join-Path $PythonVenvDir "bin/python3"
}

function Backup-VenvReadme {
  $ReadmePath = Join-Path $PythonVenvDir "README.md"
  $BackupPath = Join-Path $ToolchainDir "python-README.md.tmp"

  if (Test-Path -LiteralPath $ReadmePath -PathType Leaf) {
    New-Directory $ToolchainDir
    Copy-Item -LiteralPath $ReadmePath -Destination $BackupPath -Force
    return $BackupPath
  }

  return ""
}

function Restore-VenvReadme {
  param([string]$BackupPath)

  if ($BackupPath -and (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
    New-Directory $PythonVenvDir
    Copy-Item -LiteralPath $BackupPath -Destination (Join-Path $PythonVenvDir "README.md") -Force
    Remove-Item -LiteralPath $BackupPath -Force
  }
}

function Test-PythonVenvUsable {
  param([Parameter(Mandatory)][string]$VenvPython)

  $PyvenvCfg = Join-Path $PythonVenvDir "pyvenv.cfg"
  if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath $PyvenvCfg -PathType Leaf)) { return $false }

  $Config = Get-Content -LiteralPath $PyvenvCfg
  $ExecutableLine = $Config | Where-Object { $_ -match '^executable\s*=' } | Select-Object -First 1

  if ($ExecutableLine) {
    $BasePython = ($ExecutableLine -replace '^executable\s*=\s*', '').Trim()
    if ($BasePython -and -not (Test-Path -LiteralPath $BasePython -PathType Leaf)) {
      return $false
    }
  }

  try {
    & $VenvPython -c "import sys; raise SystemExit(0 if sys.prefix != sys.base_prefix else 1)"
    return $LASTEXITCODE -eq 0
  }
  catch {
    return $false
  }
}

function Ensure-PythonVenv {
  Initialize-UvEnvironment
  $Uv = Resolve-Tool $script:Tools.Uv "uv"
  $VenvPython = Get-VenvPython

  if ((Test-PythonVenvUsable -VenvPython $VenvPython) -and -not $Force) {
    Write-Ok "Project Python virtual environment already exists: $VenvPython"
    return $VenvPython
  }

  Write-Step "Creating project Python virtual environment"
  $ReadmeBackup = Backup-VenvReadme

  try {
    Remove-PathSafe $PythonVenvDir
    Invoke-Checked $Uv @("venv", "--python", $Versions.Python, "--seed", $PythonVenvDir)
  }
  finally {
    Restore-VenvReadme $ReadmeBackup
  }

  $VenvPython = Get-VenvPython
  Assert-FileExists $VenvPython "Project Python virtual environment"
  Write-Ok "Project Python runtime: $VenvPython"
  return $VenvPython
}

function Install-PythonDeps {
  param([Parameter(Mandatory)][string]$VenvPython)

  Initialize-UvEnvironment
  $Uv = Resolve-Tool $script:Tools.Uv "uv"

  Write-Step "Installing Python dependencies into project venv"
  $CommonArgs = @("pip", "install", "--python", $VenvPython)
  if ($PipIndexUrl) {
    $CommonArgs += @("--index-url", $PipIndexUrl)
  }
  $CommonArgs += $ExtraPipArgs

  Invoke-Checked $Uv ($CommonArgs + @("--upgrade", "pip", "setuptools", "wheel"))
  Invoke-Checked $Uv ($CommonArgs + @("torch", "onnx", "joblib", "scikit-learn"))
}

function Ensure-NodeDeps {
  Write-Step "Installing Electron desktop dependencies"
  $Npm = Resolve-Tool $script:Tools.Npm "npm"
  Invoke-Checked $Npm @("install")
}

function Show-ToolVersion {
  param(
    [Parameter(Mandatory)][string]$Name,
    [string]$Path = ""
  )

  try {
    $Tool = Resolve-Tool $Path $Name
    & $Tool --version | Select-Object -First 1
  }
  catch {
    Write-Warn "$Name not available"
  }
}

function Show-ToolVersions {
  Write-Step "Tool versions"
  Show-ToolVersion "git"
  Show-ToolVersion "node" $script:Tools.Node
  Show-ToolVersion "npm" $script:Tools.Npm
  Show-ToolVersion "cmake" $script:Tools.CMake
  Show-ToolVersion "ninja" $script:Tools.Ninja
  Show-ToolVersion "clang" $script:Tools.Clang
  Show-ToolVersion "clang++" $script:Tools.Clangxx
  Show-ToolVersion "clang-cl" $script:Tools.ClangCl
  Show-ToolVersion "lld" $script:Tools.Lld
  Show-ToolVersion "uv" $script:Tools.Uv

  $VenvPython = Get-VenvPython
  if (Test-Path -LiteralPath $VenvPython -PathType Leaf) {
    & $VenvPython --version
  }
}

Push-Location $ProjectRoot
try {
  Write-Step "Project root"
  Write-Host $ProjectRoot

  if (-not $SkipSystemTools) {
    if ($UseSystemTools) {
      Ensure-SystemBuildTools
    }
    else {
      Ensure-LocalToolchain
      if (-not (Test-VsBuildTools)) {
        Write-Warn "Visual Studio C++ Build Tools were not detected. Native Windows C++ inference builds may require MSVC/Windows SDK."
      }
    }
  }
  else {
    Initialize-UvEnvironment
  }

  if (-not $SkipNodeInstall) {
    Ensure-NodeDeps
  }

  $VenvPython = ""
  if (-not $SkipBundledPython) {
    $VenvPython = Ensure-PythonVenv
    if (-not $SkipPythonDeps) {
      Install-PythonDeps -VenvPython $VenvPython
    }
  }

  if ($BuildInference) {
    Write-Step "Building C++ inference runtime"
    $Npm = Resolve-Tool $script:Tools.Npm "npm"
    if ($OfflineInference) {
      Invoke-Checked $Npm @("run", "build:infer:offline")
    }
    else {
      Invoke-Checked $Npm @("run", "build:infer")
    }
  }

  Show-ToolVersions

  Write-Step "Done"
  Write-Ok "Desktop build environment is ready."
  if ($VenvPython) {
    Write-Ok "Python packages were installed only into the project venv: $VenvPython"
  }
}
finally {
  Pop-Location
}
