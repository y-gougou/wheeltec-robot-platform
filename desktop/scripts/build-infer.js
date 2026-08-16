const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'inference', 'onnxruntime');
const buildDir = path.join(sourceDir, 'build');
const offline = process.argv.includes('--offline');
let selectedGenerator = process.env.CMAKE_GENERATOR || '';
let selectedCompiler = '';
let vsDevCmd = '';

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function firstChildBin(dir, prefix) {
  if (!fs.existsSync(dir)) return '';
  const child = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(dir, entry.name, 'bin'))
    .find((candidate) => fs.existsSync(candidate));
  return child || '';
}

function prependLocalToolchainPath() {
  const toolchainDir = path.join(root, '.toolchain');
  const pathEntries = [];

  pathEntries.push(firstChildBin(path.join(toolchainDir, 'cmake'), 'cmake-'));
  pathEntries.push(path.join(toolchainDir, 'ninja'));
  pathEntries.push(firstChildBin(path.join(toolchainDir, 'llvm'), 'clang+llvm-'));
  pathEntries.push(firstExisting([
    path.join(toolchainDir, 'uv'),
    firstChildBin(path.join(toolchainDir, 'uv'), 'uv-'),
  ]));

  const existing = pathEntries.filter(Boolean);
  if (existing.length > 0) {
    process.env.PATH = `${existing.join(path.delimiter)}${path.delimiter}${process.env.PATH || ''}`;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore', shell: false });
  return result.status === 0;
}

function findCommand(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { encoding: 'utf8', shell: false });
  if (result.status !== 0) return '';
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || '';
}

function commandVersionMajor(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', shell: false });
  if (result.status !== 0) return 0;
  const match = result.stdout.match(/version\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function detectVisualStudioGenerator() {
  if (process.platform !== 'win32') return '';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return '';
  const result = spawnSync(vswhere, [
    '-latest',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property',
    'catalog_productLineVersion',
  ], { encoding: 'utf8', shell: false });
  if (result.status !== 0 || !result.stdout.trim()) return '';
  const version = result.stdout.trim();
  const generatorMap = { '2022': 'Visual Studio 17 2022', '2025': 'Visual Studio 18 2025' };
  return generatorMap[version] || '';
}

function findVisualStudioDevCmd() {
  if (process.platform !== 'win32') return '';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return '';
  const result = spawnSync(vswhere, [
    '-latest',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property',
    'installationPath',
  ], { encoding: 'utf8', shell: false });
  if (result.status !== 0 || !result.stdout.trim()) return '';
  const candidate = path.join(result.stdout.trim(), 'Common7', 'Tools', 'VsDevCmd.bat');
  return fs.existsSync(candidate) ? candidate : '';
}

function configureArgs() {
  const args = ['-S', sourceDir, '-B', buildDir];
  if (offline) args.push('-DYP_FETCH_ONNXRUNTIME=OFF');

  if (process.env.CMAKE_GENERATOR) {
    return args;
  }

  if (process.platform === 'win32') {
    if (process.env.ONNXRUNTIME_ROOT && commandExists('ninja') && commandExists('clang++')) {
      const clangxx = findCommand('clang++').replace(/\\/g, '/');
      args.push('-G', 'Ninja', `-DCMAKE_CXX_COMPILER=${clangxx}`);
      selectedGenerator = 'Ninja';
      selectedCompiler = clangxx;
      return args;
    }

    if (offline && commandExists('ninja') && commandExists('clang++')) {
      const clangxx = findCommand('clang++').replace(/\\/g, '/');
      args.push('-G', 'Ninja', `-DCMAKE_CXX_COMPILER=${clangxx}`);
      selectedGenerator = 'Ninja';
      selectedCompiler = clangxx;
      return args;
    }

    vsDevCmd = findVisualStudioDevCmd();
    if (vsDevCmd && commandExists('ninja') && commandExists('clang-cl') && commandVersionMajor('clang-cl') >= 20) {
      args.push('-G', 'Ninja', '-DCMAKE_CXX_COMPILER=clang-cl');
      selectedGenerator = 'Ninja';
      selectedCompiler = 'clang-cl';
      return args;
    }

    if (vsDevCmd && commandExists('ninja')) {
      args.push('-G', 'Ninja', '-DCMAKE_CXX_COMPILER=cl');
      selectedGenerator = 'Ninja';
      selectedCompiler = 'cl';
      return args;
    }

    const vsGenerator = detectVisualStudioGenerator();
    if (vsGenerator) {
      args.push('-G', vsGenerator, '-A', 'x64');
      selectedGenerator = vsGenerator;
      return args;
    }

    console.error('');
    console.error('No supported Windows C++ build environment was found.');
    console.error('');
    console.error('For real ONNX Runtime inference on Windows, install:');
    console.error('  Visual Studio Build Tools 2022+ with "Desktop development with C++"');
    console.error('');
    console.error('The official ONNX Runtime win-x64 package is built for the MSVC ABI.');
    console.error('Project-local LLVM/Clang is used when available, but clang-cl still needs the Windows SDK/MSVC environment.');
    console.error('');
    console.error('For UI/protocol testing only, run:');
    console.error('  npm run build:infer:offline');
    console.error('');
    process.exit(1);
  }

  // Non-Windows: prefer clang++ + Ninja, fallback to default
  if (commandExists('ninja') && commandExists('clang++')) {
    args.push('-G', 'Ninja', '-DCMAKE_CXX_COMPILER=clang++');
    selectedGenerator = 'Ninja';
    selectedCompiler = 'clang++';
  } else if (commandExists('ninja')) {
    args.push('-G', 'Ninja');
    selectedGenerator = 'Ninja';
  }
  return args;
}

function cleanMismatchedGenerator(configureArgs) {
  const cachePath = path.join(buildDir, 'CMakeCache.txt');
  if (!fs.existsSync(cachePath)) return;
  const cache = fs.readFileSync(cachePath, 'utf8');

  if (selectedGenerator) {
    const genMatch = cache.match(/^CMAKE_GENERATOR:INTERNAL=(.+)$/m);
    const cachedGenerator = genMatch ? genMatch[1].trim() : '';
    if (cachedGenerator && cachedGenerator !== selectedGenerator) {
      console.log(`Cleaning stale CMake build directory (generator: ${cachedGenerator} -> ${selectedGenerator})`);
      fs.rmSync(buildDir, { recursive: true, force: true });
      return;
    }
  }

  // Detect compiler change (e.g. clang++ -> g++) to avoid passing incompatible flags
  const compilerFlag = configureArgs.find((a) => a.startsWith('-DCMAKE_CXX_COMPILER='));
  if (compilerFlag) {
    const newCompiler = compilerFlag.split('=')[1].replace(/\\/g, '/');
    const ccMatch = cache.match(/^CMAKE_CXX_COMPILER:FILEPATH=(.+)$/m);
    const cachedCompiler = ccMatch ? ccMatch[1].trim().replace(/\\/g, '/') : '';
    if (cachedCompiler && cachedCompiler !== newCompiler && !cachedCompiler.endsWith('/cl.exe')) {
      console.log(`Cleaning stale CMake build directory (compiler: ${cachedCompiler} -> ${newCompiler})`);
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
  }
}

function runBuildCommand(command, args) {
  if (vsDevCmd) {
    const escapedArgs = args.map((arg) => `"${String(arg).replace(/"/g, '""')}"`).join(' ');
    const scriptPath = path.join(buildDir, 'run-msvc-build.cmd');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(scriptPath, [
      '@echo off',
      `call "${vsDevCmd}" -arch=x64 -host_arch=x64 >nul`,
      `if errorlevel 1 exit /b %errorlevel%`,
      `${command} ${escapedArgs}`,
      `exit /b %errorlevel%`,
      '',
    ].join('\r\n'));
    run('cmd.exe', ['/d', '/c', scriptPath]);
    return;
  }
  run(command, args);
}

function main() {
  prependLocalToolchainPath();

  if (!commandExists('cmake')) {
    console.error('CMake was not found in PATH.');
    process.exit(1);
  }

  const args = configureArgs();
  cleanMismatchedGenerator(args);
  runBuildCommand('cmake', args);
  runBuildCommand('cmake', ['--build', buildDir, '--config', 'Release']);
}

main();
