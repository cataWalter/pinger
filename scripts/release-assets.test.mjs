import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  downloadRelease,
  formatChecksums,
  listZipEntries,
  main,
  parseChecksums,
  selectAsset,
  sha256,
  tagVersion,
  validateTag,
  verifyChecksums,
  wingetManifests,
  writeChecksums,
  writeOutputs,
  writeWingetManifests,
} from './release-assets.mjs'

const REPOSITORY = 'cataWalter/pinger'
const TAG = 'v0.14'
const RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/tags/${TAG}`

function storedZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const data = Buffer.from(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  const count = Object.keys(files).length
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function fakeRelease(files) {
  return {
    tag_name: TAG,
    published_at: '2026-10-31T12:00:00Z',
    assets: Object.entries(files).map(([name, data]) => ({
      name,
      size: Buffer.byteLength(data),
      url: `https://api.github.com/assets/${name}`,
      browser_download_url: `https://github.com/${REPOSITORY}/releases/download/${TAG}/${name}`,
    })),
  }
}

function fakeFetch(files, release = fakeRelease(files)) {
  const calls = []
  async function fetchImpl(url, init) {
    calls.push({ url, accept: init.headers.Accept, authorization: init.headers.Authorization })
    if (url === RELEASE_URL) return new Response(JSON.stringify(release))
    const name = url.replace('https://api.github.com/assets/', '')
    if (Object.hasOwn(files, name)) return new Response(files[name])
    return new Response('missing', { status: 404 })
  }
  return { fetchImpl, calls }
}

function withChecksums(files) {
  const entries = Object.entries(files).map(([name, data]) => ({ name, sha: sha256(data) }))
  return { ...files, 'checksums.txt': formatChecksums(entries) }
}

describe('release tags', () => {
  it('accepts release tags and strips the prefix for versions', () => {
    assert.equal(validateTag('v0.13'), 'v0.13')
    assert.equal(tagVersion('v0.1.7'), '0.1.7')
    assert.equal(tagVersion('v1.2.3-rc.1'), '1.2.3-rc.1')
  })

  it('rejects tags that could change shell or URL meaning', () => {
    for (const tag of ['0.13', 'v0.13;rm -rf /', 'v0.13\n', 'v0.13/../x', '', undefined]) {
      assert.throws(() => validateTag(tag), /Invalid release tag/)
    }
  })
})

describe('checksums', () => {
  let dist

  beforeEach(async () => {
    dist = await mkdtemp(join(tmpdir(), 'pinger-release-assets-'))
    for (const name of ['Pinger-0.14-macos-universal.dmg', 'Pinger-0.14-windows-amd64.zip', 'Pinger-0.14-linux-amd64.deb', 'Pinger-0.14-linux-amd64.AppImage']) {
      await writeFile(join(dist, name), `contents of ${name}`)
    }
    await writeFile(join(dist, 'notes.txt'), 'not a release file')
  })

  afterEach(async () => {
    await rm(dist, { recursive: true, force: true })
  })

  it('writes sorted sha256sum lines that verify', async () => {
    const entries = await writeChecksums(dist)
    assert.equal(entries.length, 4)
    const text = await readFile(join(dist, 'checksums.txt'), 'utf8')
    const lines = text.trim().split('\n')
    assert.deepEqual(lines.map((line) => line.split('  ')[1]), [...lines.map((line) => line.split('  ')[1])].sort())
    assert.match(lines[0], /^[0-9a-f]{64} {2}Pinger-0\.14-/)
    assert.equal(await verifyChecksums(dist), 4)
  })

  it('detects a modified package', async () => {
    await writeChecksums(dist)
    await writeFile(join(dist, 'Pinger-0.14-linux-amd64.deb'), 'tampered')
    await assert.rejects(verifyChecksums(dist), /Checksum mismatch for Pinger-0\.14-linux-amd64\.deb/)
  })

  it('detects a package missing from checksums.txt', async () => {
    await writeChecksums(dist)
    await writeFile(join(dist, 'Pinger-0.14-extra.zip'), 'extra')
    await assert.rejects(verifyChecksums(dist), /does not list: Pinger-0\.14-extra\.zip/)
  })

  it('requires every platform package', async () => {
    await rm(join(dist, 'Pinger-0.14-linux-amd64.AppImage'))
    await assert.rejects(writeChecksums(dist), /missing a \.AppImage package/)
  })

  it('parses legacy ./ prefixes and binary markers', () => {
    const sha = 'a'.repeat(64)
    const parsed = parseChecksums(`${sha}  ./Pinger-0.13-linux-amd64.deb\n${sha.toUpperCase()} *Pinger-0.13-windows-amd64.zip\n`)
    assert.equal(parsed.get('Pinger-0.13-linux-amd64.deb'), sha)
    assert.equal(parsed.get('Pinger-0.13-windows-amd64.zip'), sha)
  })

  it('rejects malformed, nested, duplicate, and empty checksum files', () => {
    const sha = 'b'.repeat(64)
    assert.throws(() => parseChecksums('not a checksum'), /Malformed/)
    assert.throws(() => parseChecksums(`${sha}  ../escape.deb`), /Malformed/)
    assert.throws(() => parseChecksums(`${sha}  a.deb\n${sha}  a.deb`), /Duplicate/)
    assert.throws(() => parseChecksums('\n'), /empty/)
  })
})

describe('release asset selection', () => {
  const release = fakeRelease({
    'Pinger-0.14-macos-universal.dmg': 'dmg',
    'Pinger-0.14-windows-amd64.zip': 'zip',
    'Pinger-0.14-linux-amd64.deb': 'deb',
    'checksums.txt': 'sums',
  })

  it('selects exactly one package per platform', () => {
    assert.equal(selectAsset(release, 'macos').name, 'Pinger-0.14-macos-universal.dmg')
    assert.equal(selectAsset(release, 'windows').name, 'Pinger-0.14-windows-amd64.zip')
    assert.equal(selectAsset(release, 'debian').name, 'Pinger-0.14-linux-amd64.deb')
  })

  it('rejects unknown platforms, missing packages, and ambiguous packages', () => {
    assert.throws(() => selectAsset(release, 'freebsd'), /Unknown platform/)
    assert.throws(() => selectAsset({ ...release, assets: [] }, 'macos'), /found 0/)
    const doubled = { ...release, assets: [...release.assets, { ...release.assets[0], name: 'Pinger-0.15-macos-universal.dmg' }] }
    assert.throws(() => selectAsset(doubled, 'macos'), /found 2/)
  })
})

describe('ZIP inspection', () => {
  it('lists central directory entries', () => {
    assert.deepEqual(listZipEntries(storedZip({ 'pinger.exe': 'MZ', 'docs/readme.txt': 'hi' })), ['pinger.exe', 'docs/readme.txt'])
  })

  it('rejects data that is not a ZIP archive', () => {
    assert.throws(() => listZipEntries(Buffer.from('short')), /Not a ZIP archive/)
    assert.throws(() => listZipEntries(Buffer.alloc(64)), /Not a ZIP archive/)
  })
})

describe('GitHub outputs', () => {
  it('appends single-line outputs and rejects multi-line values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pinger-outputs-'))
    try {
      const file = join(dir, 'output')
      writeOutputs({ version: '0.14', asset: 'a.dmg' }, file)
      assert.equal(await readFile(file, 'utf8'), 'version=0.14\nasset=a.dmg\n')
      assert.throws(() => writeOutputs({ version: '0.14\nsha256=evil' }, file), /single line/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('release downloads', () => {
  let dir

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pinger-download-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('downloads, verifies, and records the macOS package', async () => {
    const files = withChecksums({ 'Pinger-0.14-macos-universal.dmg': 'dmg bytes', 'Pinger-0.14-linux-amd64.deb': 'deb bytes' })
    const { fetchImpl, calls } = fakeFetch(files)
    const outputFile = join(dir, 'github-output')
    const metadata = await downloadRelease('macos', join(dir, 'dmg'), { fetchImpl, token: 'test-token', repository: REPOSITORY, tag: TAG, outputFile })

    assert.equal(await readFile(join(dir, 'dmg', 'Pinger-0.14-macos-universal.dmg'), 'utf8'), 'dmg bytes')
    assert.equal(metadata.sha256, sha256('dmg bytes'))
    assert.equal(metadata.releaseDate, '2026-10-31')
    assert.equal(await readFile(outputFile, 'utf8'), `version=0.14\nasset=Pinger-0.14-macos-universal.dmg\nsha256=${sha256('dmg bytes')}\n`)
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'dmg', 'release-asset.json'), 'utf8')), metadata)
    assert.ok(calls.every((call) => call.authorization === 'Bearer test-token'))
    assert.deepEqual(calls.slice(1).map((call) => call.accept), ['application/octet-stream', 'application/octet-stream'])
  })

  it('records the portable executable inside the Windows package', async () => {
    const files = withChecksums({ 'Pinger-0.14-windows-amd64.zip': storedZip({ 'pinger.exe': 'MZ' }) })
    const { fetchImpl } = fakeFetch(files)
    const metadata = await downloadRelease('windows', dir, { fetchImpl, repository: REPOSITORY, tag: TAG, outputFile: join(dir, 'out') })
    assert.equal(metadata.nestedFile, 'pinger.exe')
    assert.equal(metadata.url, `https://github.com/${REPOSITORY}/releases/download/${TAG}/Pinger-0.14-windows-amd64.zip`)
  })

  it('rejects Windows packages without exactly one executable', async () => {
    const files = withChecksums({ 'Pinger-0.14-windows-amd64.zip': storedZip({ 'pinger.exe': 'MZ', 'helper.exe': 'MZ' }) })
    const { fetchImpl } = fakeFetch(files)
    await assert.rejects(downloadRelease('windows', join(dir, 'windows'), { fetchImpl, repository: REPOSITORY, tag: TAG, outputFile: join(dir, 'out') }), /exactly one executable/)
  })

  it('rejects a package that does not match checksums.txt and writes nothing', async () => {
    const files = { ...withChecksums({ 'Pinger-0.14-linux-amd64.deb': 'original' }), 'Pinger-0.14-linux-amd64.deb': 'swapped!' }
    const { fetchImpl } = fakeFetch(files)
    await assert.rejects(downloadRelease('debian', join(dir, 'debian'), { fetchImpl, repository: REPOSITORY, tag: TAG, outputFile: join(dir, 'out') }), /Checksum mismatch/)
    await assert.rejects(readFile(join(dir, 'debian', 'release-asset.json')), { code: 'ENOENT' })
  })

  it('requires checksums.txt on the release', async () => {
    const { fetchImpl } = fakeFetch({ 'Pinger-0.14-linux-amd64.deb': 'deb' })
    await assert.rejects(downloadRelease('debian', dir, { fetchImpl, repository: REPOSITORY, tag: TAG }), /has no checksums\.txt/)
  })

  it('rejects unsafe tags and repositories before making requests', async () => {
    const { fetchImpl, calls } = fakeFetch({})
    await assert.rejects(downloadRelease('debian', dir, { fetchImpl, repository: REPOSITORY, tag: 'v1;id' }), /Invalid release tag/)
    await assert.rejects(downloadRelease('debian', dir, { fetchImpl, repository: '../evil', tag: TAG }), /Invalid repository/)
    assert.equal(calls.length, 0)
  })

  it('surfaces GitHub API failures', async () => {
    const fetchImpl = async () => new Response('nope', { status: 404 })
    await assert.rejects(downloadRelease('macos', dir, { fetchImpl, repository: REPOSITORY, tag: TAG }), /GitHub request failed \(404\)/)
  })
})

describe('WinGet manifests', () => {
  const asset = {
    version: '0.14',
    sha256: 'c'.repeat(64),
    url: `https://github.com/${REPOSITORY}/releases/download/${TAG}/Pinger-0.14-windows-amd64.zip`,
    nestedFile: 'pinger.exe',
    releaseDate: '2026-10-31',
  }

  it('builds version, locale, and nested portable installer manifests', () => {
    const manifests = wingetManifests(asset)
    assert.deepEqual(Object.keys(manifests), ['cataWalter.Pinger.yaml', 'cataWalter.Pinger.locale.en-US.yaml', 'cataWalter.Pinger.installer.yaml'])
    assert.deepEqual(Object.values(manifests).map((manifest) => manifest.ManifestType), ['version', 'defaultLocale', 'installer'])
    for (const manifest of Object.values(manifests)) {
      assert.equal(manifest.PackageIdentifier, 'cataWalter.Pinger')
      assert.equal(manifest.PackageVersion, '0.14')
      assert.equal(manifest.ManifestVersion, '1.6.0')
    }
    const installer = manifests['cataWalter.Pinger.installer.yaml']
    assert.equal(installer.InstallerType, 'zip')
    assert.equal(installer.NestedInstallerType, 'portable')
    assert.deepEqual(installer.NestedInstallerFiles, [{ RelativeFilePath: 'pinger.exe', PortableCommandAlias: 'pinger' }])
    assert.equal(installer.Installers[0].InstallerSha256, 'C'.repeat(64))
    assert.equal(installer.ReleaseDate, '2026-10-31')
  })

  it('rejects incomplete or unexpected asset metadata', () => {
    assert.throws(() => wingetManifests({ ...asset, version: '0.14; rm' }), /Invalid WinGet version/)
    assert.throws(() => wingetManifests({ ...asset, sha256: 'xyz' }), /SHA-256/)
    assert.throws(() => wingetManifests({ ...asset, url: 'https://example.com/pinger.zip' }), /installer URL/)
    assert.throws(() => wingetManifests({ ...asset, nestedFile: undefined }), /portable executable/)
  })

  it('writes JSON manifests the workflow can validate and convert', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pinger-winget-'))
    try {
      const assetPath = join(dir, 'release-asset.json')
      await writeFile(assetPath, JSON.stringify(asset))
      const names = await writeWingetManifests(join(dir, 'manifests'), assetPath)
      for (const name of names) {
        const manifest = JSON.parse(await readFile(join(dir, 'manifests', name), 'utf8'))
        assert.ok(['version', 'defaultLocale', 'installer'].includes(manifest.ManifestType))
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('command line', () => {
  it('prints usage for unknown or incomplete commands', async () => {
    await assert.rejects(main([]), /Usage/)
    await assert.rejects(main(['download', 'macos']), /Usage/)
  })
})
