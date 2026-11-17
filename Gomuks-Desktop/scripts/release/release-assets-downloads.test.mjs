import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { downloadRelease, main, sha256, writeWingetManifests, wingetManifests } from './release-assets.mjs'
import { REPOSITORY, TAG, fakeFetch, storedZip, withChecksums } from './release-assets.fixtures.mjs'

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

  it('records the GUI executable inside the Windows package', async () => {
    const files = withChecksums({ 'Pinger-0.14-windows-amd64.zip': storedZip({ 'pinger-qt.exe': 'MZ', 'pinger.exe': 'MZ' }) })
    const { fetchImpl } = fakeFetch(files)
    const metadata = await downloadRelease('windows', dir, { fetchImpl, repository: REPOSITORY, tag: TAG, outputFile: join(dir, 'out') })
    assert.equal(metadata.nestedFile, 'pinger-qt.exe')
    assert.equal(metadata.url, `https://github.com/${REPOSITORY}/releases/download/${TAG}/Pinger-0.14-windows-amd64.zip`)
  })

  it('rejects Windows packages without exactly pinger-qt.exe and pinger.exe', async () => {
    const files = withChecksums({ 'Pinger-0.14-windows-amd64.zip': storedZip({ 'pinger-qt.exe': 'MZ', 'pinger.exe': 'MZ', 'helper.exe': 'MZ' }) })
    const { fetchImpl } = fakeFetch(files)
    await assert.rejects(downloadRelease('windows', join(dir, 'windows'), { fetchImpl, repository: REPOSITORY, tag: TAG, outputFile: join(dir, 'out') }), /exactly pinger-qt\.exe and pinger\.exe/)
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
    nestedFile: 'pinger-qt.exe',
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
    assert.deepEqual(installer.NestedInstallerFiles, [{ RelativeFilePath: 'pinger-qt.exe', PortableCommandAlias: 'pinger' }])
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
