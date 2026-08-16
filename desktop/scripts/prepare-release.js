const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'build', 'release');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runNode(scriptName) {
  const result = spawnSync(process.execPath, [path.join(__dirname, scriptName)], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function gitValue(args) {
  try {
    return execSync(`git ${args}`, {
      cwd: path.resolve(root, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return '';
  }
}

runNode('sync-app-name.js');

const appConfigPath = path.join(root, 'app-config.json');
const packagePath = path.join(root, 'package.json');
const appConfig = readJson(appConfigPath);
const pkg = readJson(packagePath);
const commit = gitValue('rev-parse --short HEAD');
const branch = gitValue('branch --show-current');

const releaseInfo = {
  version: appConfig.version,
  displayName: appConfig.displayName,
  displayNameZh: appConfig.displayName_zh,
  packageName: appConfig.packageName,
  appId: appConfig.appId,
  description: appConfig.description,
  author: appConfig.author,
  copyright: appConfig.copyright,
  packageVersion: pkg.version,
  generatedAt: new Date().toISOString(),
  git: {
    branch,
    commit,
  },
};

fs.mkdirSync(releaseDir, { recursive: true });
fs.writeFileSync(path.join(releaseDir, 'app-config.json'), JSON.stringify(appConfig, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(releaseDir, 'release-info.json'), JSON.stringify(releaseInfo, null, 2) + '\n', 'utf8');

console.log(`\nRelease metadata prepared: ${appConfig.displayName} v${appConfig.version}`);
