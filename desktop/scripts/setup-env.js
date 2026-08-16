const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const passthrough = process.argv.slice(2);

const powershellArgMap = new Map([
  ['--skip-system-tools', '-SkipSystemTools'],
  ['--skip-node-install', '-SkipNodeInstall'],
  ['--skip-bundled-python', '-SkipBundledPython'],
  ['--skip-python-deps', '-SkipPythonDeps'],
  ['--build-inference', '-BuildInference'],
  ['--offline-inference', '-OfflineInference'],
  ['--check-only', '-CheckOnly'],
  ['--force', '-Force'],
  ['--python-command', '-PythonCommand'],
  ['--python-venv-dir', '-PythonVenvDir'],
  ['--pip-index-url', '-PipIndexUrl'],
  ['--extra-pip-arg', '-ExtraPipArg'],
  ['--use-system-tools', '-UseSystemTools'],
  ['--toolchain-dir', '-ToolchainDir'],
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (process.platform === 'win32') {
  const powershellArgs = passthrough.map((arg) => powershellArgMap.get(arg) || arg);
  run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(__dirname, 'setup-env.ps1'),
    ...powershellArgs,
  ]);
} else {
  run('bash', [
    path.join(__dirname, 'setup-env.sh'),
    ...passthrough,
  ]);
}
