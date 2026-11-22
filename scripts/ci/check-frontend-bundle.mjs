import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const rawBudget = 2_200_000
const gzipBudget = 620_000
// Lazy Ogg Opus decoder, including the multichannel build; loads only for voice notes that need it.
const oggOpusRawBudget = 4_400_000
const oggOpusGzipBudget = 3_500_000
const assetsDirectory = new URL('../../frontend/dist/assets/', import.meta.url)
const entries = await readdir(assetsDirectory, { withFileTypes: true })
const bundleFiles = entries.filter((entry) => entry.isFile() && /\.(?:css|js)$/.test(entry.name))

if (bundleFiles.length === 0) throw new Error('No JavaScript or CSS assets found; run the frontend production build first.')

let rawBytes = 0
let gzipBytes = 0
let oggOpusRawBytes = 0
let oggOpusGzipBytes = 0
for (const file of bundleFiles) {
  const contents = await readFile(new URL(file.name, assetsDirectory))
  const gzipSize = gzipSync(contents).byteLength
  if (file.name.startsWith('ogg-opus-')) {
    oggOpusRawBytes += contents.byteLength
    oggOpusGzipBytes += gzipSize
    continue
  }
  rawBytes += contents.byteLength
  gzipBytes += gzipSize
}

const formatSize = (bytes) => `${(bytes / 1_000).toFixed(1)} kB`
console.log(`Frontend JS/CSS: ${formatSize(rawBytes)} raw / ${formatSize(gzipBytes)} gzip (budgets ${formatSize(rawBudget)} / ${formatSize(gzipBudget)}).`)

console.log(`Ogg Opus decoder: ${formatSize(oggOpusRawBytes)} raw / ${formatSize(oggOpusGzipBytes)} gzip (budgets ${formatSize(oggOpusRawBudget)} / ${formatSize(oggOpusGzipBudget)}).`)

if (rawBytes > rawBudget || gzipBytes > gzipBudget || oggOpusRawBytes > oggOpusRawBudget || oggOpusGzipBytes > oggOpusGzipBudget) {
  throw new Error('Frontend bundle exceeds its raw or gzip size budget.')
}