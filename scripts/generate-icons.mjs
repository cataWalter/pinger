import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { Resvg } = require('@resvg/resvg-js')
const source = readFileSync(join(root, 'assets/pinger.svg'))
const check = process.argv.includes('--check')
const targets = [
  ['build/appicon.png', 1024],
  ['frontend/public/pinger.png', 512],
  ['frontend/public/favicon-16.png', 16],
  ['frontend/public/favicon-32.png', 32],
  ...[16, 24, 32, 48, 64, 128, 256, 512, 1024].map((size) => [`build/linux/icons/${size}x${size}/pinger.png`, size]),
]

function output(relative, data) {
  const path = join(root, relative)
  if (check) {
    if (!existsSync(path) || !readFileSync(path).equals(data)) throw new Error(`Stale icon: ${relative}; run npm --prefix frontend run icons`)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

for (const [path, size] of targets) {
  const image = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render()
  if (image.width !== size || image.height !== size) throw new Error(`Incorrect icon dimensions: ${path}`)
  output(path, image.asPng())
}
output('frontend/public/pinger.svg', source)

const nativeIcons = ['build/darwin/icons.icns', 'build/windows/icon.ico']
function generateNativeIcons(paths) {
  const args = ['generate', 'icons', '-input', join(root, 'build/appicon.png'), '-macfilename', paths[0], '-windowsfilename', paths[1]]
  try {
    execFileSync(process.env.WAILS_COMMAND || 'wails3', args, { stdio: 'inherit' })
  } catch (error) {
    if (error.code !== 'ENOENT' || process.env.WAILS_COMMAND) throw error
    const goBin = execFileSync('go', ['env', 'GOBIN'], { encoding: 'utf8' }).trim()
    const goPath = execFileSync('go', ['env', 'GOPATH'], { encoding: 'utf8' }).trim().split(process.platform === 'win32' ? ';' : ':')[0]
    const executable = join(goBin || join(goPath || join(homedir(), 'go'), 'bin'), process.platform === 'win32' ? 'wails3.exe' : 'wails3')
    execFileSync(executable, args, { stdio: 'inherit' })
  }
}

if (check) {
  const directory = mkdtempSync(join(tmpdir(), 'pinger-icons-'))
  try {
    const paths = nativeIcons.map((path) => join(directory, basename(path)))
    generateNativeIcons(paths)
    nativeIcons.forEach((path, index) => output(path, readFileSync(paths[index])))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
} else {
  generateNativeIcons(nativeIcons.map((path) => join(root, path)))
}

const ico = readFileSync(join(root, nativeIcons[1]))
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('Invalid Windows ICO header')
const windowsSizes = new Set()
for (let index = 0; index < ico.readUInt16LE(4); index++) {
  const entry = 6 + index * 16
  const width = ico[entry] || 256
  const height = ico[entry + 1] || 256
  const length = ico.readUInt32LE(entry + 8)
  const offset = ico.readUInt32LE(entry + 12)
  if (width !== height || offset + length > ico.length || length === 0) throw new Error('Invalid Windows ICO image')
  windowsSizes.add(width)
}
if (![16, 32, 48, 256].every((size) => windowsSizes.has(size))) throw new Error('Windows ICO is missing required sizes')

const icns = readFileSync(join(root, nativeIcons[0]))
if (icns.toString('ascii', 0, 4) !== 'icns' || icns.readUInt32BE(4) !== icns.length) throw new Error('Invalid macOS ICNS header')
const macTypes = new Set()
for (let offset = 8; offset < icns.length;) {
  const length = icns.readUInt32BE(offset + 4)
  if (length <= 8 || offset + length > icns.length) throw new Error('Invalid macOS ICNS image')
  macTypes.add(icns.toString('ascii', offset, offset + 4))
  offset += length
}
if (!macTypes.has('ic10') || !macTypes.has('ic08')) throw new Error('macOS ICNS is missing large/Retina artwork')
console.log(`Icon assets ${check ? 'verified' : 'generated'}: SVG, PNG 16-1024px, Windows ICO, macOS ICNS`)