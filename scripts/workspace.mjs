import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = path.join(root, 'frontend');
const preview = process.argv[2] === 'preview';

if (preview && !existsSync(path.join(frontend, 'dist', 'index.html'))) {
  console.error('Build the React app first with npm run build.');
  process.exit(1);
}
const require = createRequire(path.join(frontend, 'package.json'));
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const children = new Set();
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
function launch(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', env: process.env });
  children.add(child);
  child.on('error', err => {
    console.error(err.message);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) stop(code ?? (signal ? 1 : 0));
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
launch(['backend/identity/server.mjs'], root);
launch(['backend/catalog/server.mjs'], root);
launch(['backend/inventory/server.mjs'], root);
launch(preview ? [viteBin, 'preview'] : [viteBin], frontend);
