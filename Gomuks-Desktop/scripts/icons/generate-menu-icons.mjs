import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { AppWindow, MailCheck, Power, RefreshCw, Search, Settings2 } = require('lucide-react')
const { Resvg } = require('@resvg/resvg-js')
const check = process.argv.includes('--check')
const icons = [
  ['open', AppWindow, '#267f9b'],
  ['search', Search, '#377bc1'],
  ['read', MailCheck, '#258a67'],
  ['settings', Settings2, '#7164a3'],
  ['updates', RefreshCw, '#b87419'],
  ['quit', Power, '#bf4d4d'],
]

for (const [name, Icon, color] of icons) {
  const iconMarkup = renderToStaticMarkup(createElement(Icon, { size: 24 }))
  const iconContents = iconMarkup.slice(iconMarkup.indexOf('>') + 1, iconMarkup.lastIndexOf('</svg>'))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="6" fill="${color}"/><g transform="translate(4 4) scale(0.6666667)" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">${iconContents}</g></svg>`
  const data = new Resvg(svg).render().asPng()
  const path = join(root, 'desktop/menu_icons', `${name}.png`)

  if (check) {
    if (!existsSync(path) || !readFileSync(path).equals(data)) throw new Error(`Stale menu icon: ${name}; run npm --prefix frontend run icons:menu`)
    continue
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

console.log(`Menu icons ${check ? 'verified' : 'generated'}: ${icons.map(([name]) => name).join(', ')}`)