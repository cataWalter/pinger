import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { listZipEntries, parseChecksums, selectAsset, tagVersion, validateTag, verifyChecksums, writeChecksums, writeOutputs } from './release-assets.mjs'
import { fakeRelease, storedZip } from './release-assets.fixtures.mjs'

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
