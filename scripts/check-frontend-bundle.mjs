import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const rawBudget = 2_200_000
const gzipBudget = 620_000
const assetsDirectory = new URL('../frontend/dist/assets/', import.meta.url)
const entries = await readdir(assetsDirectory, { withFileTypes: true })
const bundleFiles = entries.filter((entry) => entry.isFile() && /\.(?:css|js)$/.test(entry.name))

if (bundleFiles.length === 0) throw new Error('No JavaScript or CSS assets found; run the frontend production build first.')

let rawBytes = 0
let gzipBytes = 0
for (const file of bundleFiles) {
  const contents = await readFile(new URL(file.name, assetsDirectory))
  rawBytes += contents.byteLength
  gzipBytes += gzipSync(contents).byteLength
}

const formatSize = (bytes) => `${(bytes / 1_000).toFixed(1)} kB`
console.log(`Frontend JS/CSS: ${formatSize(rawBytes)} raw / ${formatSize(gzipBytes)} gzip (budgets ${formatSize(rawBudget)} / ${formatSize(gzipBudget)}).`)

if (rawBytes > rawBudget || gzipBytes > gzipBudget) {
  throw new Error('Frontend bundle exceeds its raw or gzip size budget.')
}