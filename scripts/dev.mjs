import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wailsCommand = process.platform === 'win32' ? 'wails3.exe' : 'wails3';
const config = process.platform === 'win32' ? './build/windows/dev-config.yml' : './build/config.yml';
const port = process.env.WAILS_VITE_PORT ?? '9245';
const env = { ...process.env, GOTOOLCHAIN: 'go1.26.10' };

if (process.platform === 'win32') {
  const mingwBin = join(repoRoot, 'tools', 'msys64', 'ucrt64', 'bin');
  if (existsSync(join(mingwBin, 'gcc.exe'))) {
    env.PATH = `${mingwBin}${delimiter}${env.PATH ?? ''}`;
    env.CC = 'gcc';
  }
}

const wails = spawn(
  wailsCommand,
  ['dev', '-config', config, '-port', port],
  { cwd: repoRoot, env, stdio: 'inherit' },
);

wails.on('error', (error) => {
  console.error(`Could not start Wails dev mode: ${error.message}`);
  process.exitCode = 1;
});

wails.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
