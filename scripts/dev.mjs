import { existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wailsCommand = process.platform === 'win32' ? 'wails3.exe' : 'wails3';
const port = process.env.WAILS_VITE_PORT ?? '9245';
const env = { ...process.env };
const config = process.platform === 'win32'
  ? './build/windows/dev-config.yml'
  : process.platform === 'darwin'
    ? './build/darwin/dev-config.yml'
    : './build/config.dev.unix.yml';

if (process.platform === 'win32') {
  const bundledMingwBin = join(repoRoot, 'toolchain', 'mingw64', 'x86_64-w64-mingw32', 'bin');
  const bundledMsysBin = join(repoRoot, 'toolchain', 'msys64', 'usr', 'bin');
  const candidates = [
    join(repoRoot, 'toolchain', 'mingw64', 'bin', 'gcc.exe'),
    join(repoRoot, 'tools', 'msys64', 'ucrt64', 'bin', 'gcc.exe'),
    join(env.SystemDrive ?? 'C:', 'msys64', 'ucrt64', 'bin', 'gcc.exe'),
  ];
  if (env.MSYSTEM_PREFIX) candidates.push(join(env.MSYSTEM_PREFIX, 'bin', 'gcc.exe'));
  try {
    candidates.push(...execFileSync('where.exe', ['gcc.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/));
  } catch {
    // A compiler may still be available through an explicit MSYS2 prefix.
  }

  const compiler = candidates.find((candidate) => {
    if (!candidate || !existsSync(candidate)) return false;
    try {
      const probePath = [dirname(candidate), bundledMingwBin, bundledMsysBin, env.PATH].filter(Boolean).join(delimiter);
      const probeEnv = { ...env, PATH: probePath };
      const crt2 = execFileSync(candidate, ['-print-file-name=crt2.o'], { encoding: 'utf8', env: probeEnv }).trim();
      const libm = execFileSync(candidate, ['-print-file-name=libm.a'], { encoding: 'utf8', env: probeEnv }).trim();
      return existsSync(crt2) && existsSync(libm);
    } catch {
      return false;
    }
  });

  if (!compiler) {
    console.error('A working MinGW-w64 GCC was not found (crt2.o and libm.a are required).');
    console.error('Install MSYS2 UCRT64 GCC and add its ucrt64/bin directory to PATH.');
    process.exit(1);
  }

  const mingwBin = dirname(compiler);
  env.PATH = [mingwBin, bundledMingwBin, bundledMsysBin, env.PATH].filter(Boolean).join(delimiter);
  env.CC = 'gcc';
  if (!env.GOFLAGS) env.GOFLAGS = '-p=2';
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
