const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class InferenceService {
  constructor(app) {
    this.app = app;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.lastError = '';
    this.manifestPath = '';
  }

  defaultExecutablePath() {
    const exe = process.platform === 'win32' ? 'yp_fault_infer.exe' : 'yp_fault_infer';
    if (this.app.isPackaged) {
      return path.join(process.resourcesPath, 'inference', exe);
    }
    const candidates = [
      path.join(__dirname, 'inference', 'onnxruntime', 'build', exe),
      path.join(__dirname, 'inference', 'onnxruntime', 'build', 'Release', exe),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  }

  defaultManifestPath() {
    if (this.app.isPackaged) {
      return path.join(process.resourcesPath, 'models', 'sage_no_saf', 'model_manifest.json');
    }
    return path.join(__dirname, 'models', 'sage_no_saf', 'model_manifest.json');
  }

  resolveManifestPath(manifestPath) {
    const requested = String(manifestPath || this.manifestPath || '').trim();
    if (requested && fs.existsSync(requested)) return requested;

    const bundled = this.defaultManifestPath();
    if (fs.existsSync(bundled)) return bundled;

    return requested || bundled;
  }

  getStatus() {
    return {
      running: !!this.proc,
      manifestPath: this.resolveManifestPath(),
      executablePath: this.defaultExecutablePath(),
      error: this.lastError,
    };
  }

  async ensureStarted() {
    if (this.proc) return;
    const exePath = this.defaultExecutablePath();
    if (!fs.existsSync(exePath)) {
      this.lastError = `Inference executable not found: ${exePath}`;
      throw new Error(this.lastError);
    }

    this.proc = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      this.lastError = String(chunk).trim() || this.lastError;
    });
    this.proc.on('exit', (code) => {
      const message = `Inference process exited${code == null ? '' : ` with code ${code}`}`;
      this.lastError = message;
      for (const pending of this.pending.values()) {
        pending.reject(new Error(message));
      }
      this.pending.clear();
      this.proc = null;
      this.buffer = '';
    });
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        this.lastError = `Bad inference JSON: ${e.message}`;
        continue;
      }
      const pending = this.pending.get(String(msg.id));
      if (!pending) continue;
      this.pending.delete(String(msg.id));
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error || 'Inference request failed'));
    }
  }

  async request(method, params = {}) {
    await this.ensureStarted();
    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Inference request timed out: ${method}`));
      }, method === 'predict' ? 5000 : 15000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.proc.stdin.write(payload, 'utf8');
    });
  }

  async loadModel(manifestPath) {
    this.manifestPath = this.resolveManifestPath(manifestPath);
    const result = await this.request('load_model', { manifest_path: this.manifestPath });
    this.lastError = '';
    if (result && typeof result === 'object') {
      result.manifestPath = this.manifestPath;
    }
    return result;
  }

  async predictWindow(windowRows) {
    if (!this.manifestPath) {
      await this.loadModel();
    }
    return this.request('predict', { window: windowRows });
  }

  async listBackends() {
    return this.request('list_backends', {});
  }

  async backendStatus() {
    return this.request('status', {});
  }

  shutdown() {
    if (!this.proc) return;
    try {
      this.proc.stdin.write(JSON.stringify({ id: String(this.nextId++), method: 'shutdown', params: {} }) + '\n');
    } catch {}
    this.proc.kill();
    this.proc = null;
  }
}

module.exports = { InferenceService };
