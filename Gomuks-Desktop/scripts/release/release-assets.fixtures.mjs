import { formatChecksums, sha256 } from './release-assets.mjs'

export const REPOSITORY = 'cataWalter/pinger'
export const TAG = 'v0.14'
export const RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/tags/${TAG}`

export function storedZip(files) {
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

export function fakeRelease(files) {
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

export function fakeFetch(files, release = fakeRelease(files)) {
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

export function withChecksums(files) {
  const entries = Object.entries(files).map(([name, data]) => ({ name, sha: sha256(data) }))
  return { ...files, 'checksums.txt': formatChecksums(entries) }
}
