const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app-config.json'), 'utf8'));

function replaceInFile(filePath, replacements) {
  const absPath = path.join(root, filePath);
  let content = fs.readFileSync(absPath, 'utf8');
  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }
  fs.writeFileSync(absPath, content, 'utf8');
  console.log(`  Updated ${filePath}`);
}

// 1. electron-builder.yml
replaceInFile('electron-builder.yml', [
  [/^appId: .+$/m, `appId: ${config.appId}`],
  [/^productName: .+$/m, `productName: ${config.displayName}`],
  [/^copyright: .+$/m, `copyright: ${config.copyright}`],
  [/(^win:\s*\n  target:.*\n  icon: ).*$/m, `$1${config.icon}`],
  [/(^linux:\s*\n  target:.*\n  icon: ).*$/m, `$1${config.icon_linux}`],
  [/^  description: .+$/m, `  description: ${config.description_linux}`],
  [/^  installerIcon: .+$/m, `  installerIcon: ${config.installerIcon}`],
  [/^  uninstallerIcon: .+$/m, `  uninstallerIcon: ${config.uninstallerIcon}`],
]);

// 2. package.json
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.name = config.packageName;
pkg.version = config.version;
pkg.description = config.description;
pkg.author = config.author;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('  Updated package.json');

const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.name = config.packageName;
  lock.version = config.version;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].name = config.packageName;
    lock.packages[''].version = config.version;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  console.log('  Updated package-lock.json');
}

// 3. renderer/index.html
replaceInFile('renderer/index.html', [
  [/<title>.*?<\/title>/, `<title>${config.displayName}</title>`],
  [/(<span class="titlebar-title"[^>]*>)[^<]*<\/span>/, `$1${config.displayName}</span>`],
]);

// 4. renderer/i18n.js — zh title
replaceInFile('renderer/i18n.js', [
  [/(zh:\s*\{[^}]*title:\s*')[^']*(')/, `$1${config.displayName_zh}$2`],
  [/(en:\s*\{[^}]*title:\s*')[^']*(')/, `$1${config.displayName}$2`],
]);

// 5. renderer/app.js — startup log
replaceInFile('renderer/app.js', [
  [/addLog\('[^']* ready'/, `addLog('${config.displayName} ready'`],
]);

console.log('\nDone! All files synced with app-config.json');
