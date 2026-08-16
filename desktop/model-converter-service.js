const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class ModelConverterService {
  constructor(app) {
    this.app = app;
    this.lastStatus = 'idle';
    this.lastError = '';
    this.lastResult = null;
  }

  resourcePath(...parts) {
    if (this.app.isPackaged) return path.join(process.resourcesPath, ...parts);
    return path.join(__dirname, ...parts);
  }

  defaultPythonPath() {
    const bundledCandidates = process.platform === 'win32'
      ? [
        this.resourcePath('python', 'python.exe'),
        this.resourcePath('python', 'Scripts', 'python.exe'),
      ]
      : [
        this.resourcePath('python', 'bin', 'python3'),
        this.resourcePath('python', 'bin', 'python'),
        this.resourcePath('python', 'python3'),
      ];

    const bundled = bundledCandidates.find((candidate) => fs.existsSync(candidate));
    if (bundled) return bundled;

    return process.platform === 'win32' ? 'python' : 'python3';
  }

  defaultScriptPath() {
    return this.resourcePath('inference', 'tools', 'export_sage_cnn_onnx.py');
  }

  defaultOutputDir() {
    if (this.app.isPackaged) {
      return path.join(this.app.getPath('userData'), 'models', 'sage_no_saf');
    }
    return path.join(__dirname, 'models', 'sage_no_saf');
  }

  getStatus() {
    return {
      status: this.lastStatus,
      error: this.lastError,
      result: this.lastResult,
      pythonPath: this.defaultPythonPath(),
      scriptPath: this.defaultScriptPath(),
      outputDir: this.defaultOutputDir(),
    };
  }

  convertSageCnn(payload = {}) {
    const pythonPath = String(payload.pythonPath || this.defaultPythonPath()).trim();
    const scriptPath = String(payload.scriptPath || this.defaultScriptPath()).trim();
    const modelRoot = String(payload.modelRoot || '').trim();
    const selectedDir = String(payload.selectedDir || '').trim();
    const outputDir = String(payload.outputDir || this.defaultOutputDir()).trim();
    const modelName = String(payload.modelName || 'SAGE-CNN selected').trim();

    if (!scriptPath || !fs.existsSync(scriptPath)) {
      throw new Error(`Model export script not found: ${scriptPath}`);
    }
    if (!modelRoot || !fs.existsSync(modelRoot)) {
      throw new Error(`Model root not found: ${modelRoot}`);
    }
    if (!selectedDir || !fs.existsSync(selectedDir)) {
      throw new Error(`Selected model directory not found: ${selectedDir}`);
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      scriptPath,
      '--model-root', modelRoot,
      '--selected-dir', selectedDir,
      '--output-dir', outputDir,
      '--name', modelName,
    ];
    if (payload.preferCuda === false) args.push('--no-prefer-cuda');

    this.lastStatus = 'running';
    this.lastError = '';
    this.lastResult = null;

    return new Promise((resolve, reject) => {
      const child = spawn(pythonPath, args, {
        cwd: path.dirname(scriptPath),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => {
        this.lastStatus = 'error';
        this.lastError = error.message;
        reject(error);
      });
      child.on('exit', (code) => {
        const manifestPath = path.join(outputDir, 'model_manifest.json');
        const result = {
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          outputDir,
          manifestPath,
        };
        if (code === 0 && fs.existsSync(manifestPath)) {
          this.lastStatus = 'done';
          this.lastResult = result;
          resolve(result);
          return;
        }
        const message = stderr.trim() || stdout.trim() || `Model conversion failed with code ${code}`;
        this.lastStatus = 'error';
        this.lastError = message;
        reject(new Error(message));
      });
    });
  }
}

module.exports = { ModelConverterService };
