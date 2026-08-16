const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    encoding: 'utf8',
    ...options,
  });
}

function stopProjectElectron() {
  if (process.platform !== 'win32') return;

  const script = [
    "$needle = '*turn_on_wheeltec_robot*desktop*node_modules*electron*'",
    "Get-Process -ErrorAction SilentlyContinue | ForEach-Object {",
    "  try {",
    "    if ($_.ProcessName -eq 'electron' -and $_.Path -like $needle) {",
    "      Stop-Process -Id $_.Id -Force",
    "    }",
    "  } catch {}",
    "}",
  ].join('; ');

  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
  });
}

function build(extraArgs = []) {
  return run('npx', ['electron-builder', '--win', ...extraArgs], {
    stdio: 'inherit',
  });
}

stopProjectElectron();

const prepare = run(process.execPath, [path.join(__dirname, 'prepare-release.js')], {
  stdio: 'inherit',
  shell: false,
});
if (prepare.status !== 0) {
  process.exit(prepare.status ?? 1);
}

const unpackedOnly = process.argv.includes('--dir');
let result = build(unpackedOnly ? ['--dir'] : []);

if (result.status !== 0 && !unpackedOnly) {
  console.warn(
    '\n[build:win] Build failed. Retrying with output directory dist-pack in case dist/win-unpacked is locked...\n'
  );
  result = build(['--config.directories.output=dist-pack']);
}

process.exit(result.status ?? 1);
