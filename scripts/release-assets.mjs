import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PLATFORM_ASSETS = {
  debian: /^Pinger-[^/]+-linux-amd64\.deb$/,
  macos: /^Pinger-[^/]+-macos-universal\.dmg$/,
  windows: /^Pinger-[^/]+-windows-amd64\.zip$/,
}
const RELEASE_FILE = /\.(dmg|zip|deb|AppImage)$/
const REQUIRED_KINDS = ['dmg', 'zip', 'deb', 'AppImage']
const TAG = /^v\d+(?:\.\d+){1,2}(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/
const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/
const WINGET_ID = 'cataWalter.Pinger'
const WINGET_MANIFEST_VERSION = '1.6.0'

export function validateTag(tag) {
  if (typeof tag !== 'string' || !TAG.test(tag)) throw new Error(`Invalid release tag: ${JSON.stringify(tag)}`)
  return tag
}

export function tagVersion(tag) {
  return validateTag(tag).slice(1)
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function formatChecksums(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, sha }) => `${sha}  ${name}\n`).join('')
}

export function parseChecksums(text) {
  const checksums = new Map()
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue
    const match = /^([0-9a-fA-F]{64}) [ *](?:\.\/)?(.+)$/.exec(line)
    if (!match || match[2].includes('/')) throw new Error(`Malformed checksums.txt line ${index + 1}`)
    if (checksums.has(match[2])) throw new Error(`Duplicate checksum entry for ${match[2]}`)
    checksums.set(match[2], match[1].toLowerCase())
  }
  if (checksums.size === 0) throw new Error('checksums.txt is empty')
  return checksums
}

async function releaseFiles(dist) {
  const names = (await readdir(dist, { withFileTypes: true })).filter((entry) => entry.isFile() && RELEASE_FILE.test(entry.name)).map((entry) => entry.name)
  for (const kind of REQUIRED_KINDS) {
    if (!names.some((name) => name.endsWith(`.${kind}`))) throw new Error(`Release is missing a .${kind} package in ${dist}`)
  }
  return names.sort()
}

export async function writeChecksums(dist) {
  const entries = []
  for (const name of await releaseFiles(dist)) entries.push({ name, sha: sha256(await readFile(join(dist, name))) })
  await writeFile(join(dist, 'checksums.txt'), formatChecksums(entries))
  return entries
}

export async function verifyChecksums(dist) {
  const checksums = parseChecksums(await readFile(join(dist, 'checksums.txt'), 'utf8'))
  const names = await releaseFiles(dist)
  const unlisted = names.filter((name) => !checksums.has(name))
  if (unlisted.length > 0) throw new Error(`checksums.txt does not list: ${unlisted.join(', ')}`)
  for (const [name, expected] of checksums) {
    if (sha256(await readFile(join(dist, name))) !== expected) throw new Error(`Checksum mismatch for ${name}`)
  }
  return checksums.size
}

export function selectAsset(release, platform) {
  const pattern = PLATFORM_ASSETS[platform]
  if (!pattern) throw new Error(`Unknown platform: ${platform}`)
  const matches = (release.assets ?? []).filter((asset) => pattern.test(asset.name))
  if (matches.length !== 1) throw new Error(`Expected one ${platform} asset on ${release.tag_name}, found ${matches.length}`)
  return matches[0]
}

// Reads names from the ZIP central directory; enough to inspect the portable package.
export function listZipEntries(buffer) {
  if (buffer.length < 22) throw new Error('Not a ZIP archive')
  const minimum = buffer.length - 22
  let end = -1
  for (let offset = minimum; offset >= Math.max(0, minimum - 0xffff); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      end = offset
      break
    }
  }
  if (end < 0) throw new Error('Not a ZIP archive')
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  const names = []
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt ZIP central directory')
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return names
}

export function writeOutputs(outputs, file = process.env.GITHUB_OUTPUT) {
  const lines = Object.entries(outputs).map(([key, value]) => {
    if (/[\r\n]/.test(String(value))) throw new Error(`Output ${key} must be a single line`)
    return `${key}=${value}\n`
  })
  if (file) appendFileSync(file, lines.join(''))
  else process.stdout.write(lines.join(''))
}

async function githubFetch(fetchImpl, url, token, accept) {
  const headers = { Accept: accept, 'User-Agent': 'pinger-release-assets', 'X-GitHub-Api-Version': '2022-11-28' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetchImpl(url, { headers, redirect: 'follow' })
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}) for ${url}`)
  return response
}

async function downloadAsset(fetchImpl, asset, token) {
  const response = await githubFetch(fetchImpl, asset.url, token, 'application/octet-stream')
  const data = Buffer.from(await response.arrayBuffer())
  if (typeof asset.size === 'number' && data.length !== asset.size) throw new Error(`Size mismatch for ${asset.name}`)
  return data
}

export async function downloadRelease(platform, dir, { fetchImpl = fetch, token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, repository = process.env.GITHUB_REPOSITORY, tag = process.env.TAG, outputFile = process.env.GITHUB_OUTPUT } = {}) {
  validateTag(tag)
  if (!REPOSITORY.test(repository ?? '')) throw new Error(`Invalid repository: ${JSON.stringify(repository)}`)
  const releaseURL = `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`
  const release = await (await githubFetch(fetchImpl, releaseURL, token, 'application/vnd.github+json')).json()
  const asset = selectAsset(release, platform)
  const checksumAsset = (release.assets ?? []).find((item) => item.name === 'checksums.txt')
  if (!checksumAsset) throw new Error(`Release ${tag} has no checksums.txt`)
  const checksums = parseChecksums((await downloadAsset(fetchImpl, checksumAsset, token)).toString('utf8'))
  const expected = checksums.get(asset.name)
  if (!expected) throw new Error(`checksums.txt does not list ${asset.name}`)
  const data = await downloadAsset(fetchImpl, asset, token)
  const digest = sha256(data)
  if (digest !== expected) throw new Error(`Checksum mismatch for ${asset.name}`)

  const metadata = {
    tag,
    version: tagVersion(tag),
    filename: asset.name,
    sha256: digest,
    size: data.length,
    url: asset.browser_download_url,
    releaseDate: String(release.published_at ?? release.created_at ?? '').slice(0, 10),
  }
  if (platform === 'windows') {
    const executables = listZipEntries(data).filter((name) => /\.exe$/i.test(name))
    if (executables.length !== 1) throw new Error(`${asset.name} must contain exactly one executable`)
    metadata.nestedFile = executables[0]
  }
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, asset.name), data)
  await writeFile(join(dir, 'release-asset.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  writeOutputs({ version: metadata.version, asset: metadata.filename, sha256: metadata.sha256 }, outputFile)
  return metadata
}

export function wingetManifests(asset) {
  const version = asset.version
  if (!/^\d+(?:\.\d+){1,2}(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error(`Invalid WinGet version: ${JSON.stringify(version)}`)
  if (!/^[0-9a-f]{64}$/.test(asset.sha256 ?? '')) throw new Error('Invalid installer SHA-256')
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\//.test(asset.url ?? '')) throw new Error('Invalid installer URL')
  if (!asset.nestedFile) throw new Error('Missing portable executable name')
  const base = { PackageIdentifier: WINGET_ID, PackageVersion: version }
  const installer = {
    ...base,
    InstallerType: 'zip',
    NestedInstallerType: 'portable',
    NestedInstallerFiles: [{ RelativeFilePath: asset.nestedFile, PortableCommandAlias: 'pinger' }],
    Commands: ['pinger'],
    Installers: [{ Architecture: 'x64', InstallerUrl: asset.url, InstallerSha256: asset.sha256.toUpperCase() }],
    ManifestType: 'installer',
    ManifestVersion: WINGET_MANIFEST_VERSION,
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(asset.releaseDate ?? '')) installer.ReleaseDate = asset.releaseDate
  return {
    [`${WINGET_ID}.yaml`]: { ...base, DefaultLocale: 'en-US', ManifestType: 'version', ManifestVersion: WINGET_MANIFEST_VERSION },
    [`${WINGET_ID}.locale.en-US.yaml`]: {
      ...base,
      PackageLocale: 'en-US',
      Publisher: 'cataWalter',
      PublisherUrl: 'https://github.com/cataWalter',
      PackageName: 'Pinger',
      PackageUrl: 'https://github.com/cataWalter/pinger',
      License: 'AGPL-3.0',
      LicenseUrl: 'https://github.com/cataWalter/pinger/blob/main/LICENSE',
      ShortDescription: 'Triage-focused Matrix desktop client with local AI assistance',
      ManifestType: 'defaultLocale',
      ManifestVersion: WINGET_MANIFEST_VERSION,
    },
    [`${WINGET_ID}.installer.yaml`]: installer,
  }
}

// JSON is valid YAML; the workflow validates it against the schemas before converting.
export async function writeWingetManifests(dir, assetPath) {
  const manifests = wingetManifests(JSON.parse(await readFile(assetPath, 'utf8')))
  await mkdir(dir, { recursive: true })
  for (const [name, manifest] of Object.entries(manifests)) await writeFile(join(dir, name), `${JSON.stringify(manifest, null, 2)}\n`)
  return Object.keys(manifests)
}

const USAGE = 'Usage: release-assets.mjs checksums <dist> | verify <dist> | download <debian|macos|windows> <dir> | winget <manifest-dir> <release-asset.json>'

export async function main(args) {
  const [command, first, second] = args
  switch (command) {
    case 'checksums': {
      if (!first) break
      const entries = await writeChecksums(resolve(first))
      console.log(`Wrote checksums for ${entries.length} release files.`)
      return
    }
    case 'verify': {
      if (!first) break
      console.log(`Verified ${await verifyChecksums(resolve(first))} release checksums.`)
      return
    }
    case 'download': {
      if (!first || !second) break
      const metadata = await downloadRelease(first, resolve(second))
      console.log(`Downloaded and verified ${metadata.filename} (${metadata.sha256}).`)
      return
    }
    case 'winget': {
      if (!first || !second) break
      const names = await writeWingetManifests(resolve(first), resolve(second))
      console.log(`Wrote ${names.join(', ')}.`)
      return
    }
  }
  throw new Error(USAGE)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`::error::${error.message}`)
    process.exit(1)
  })
}
