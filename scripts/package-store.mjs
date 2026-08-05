// Chrome ウェブストアに提出する ZIP を作る。
//   release/yt-redirect-pin-store-<version>.zip
//
// テスター配布用の `package.mjs` と違い、**manifest.json が ZIP の直下**に来る形にする
// (フォルダに包むとストアが弾く)。ソース同梱・START-HERE も入れない。
//
// 使い方: npm run package:store
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeZip } from './zip.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const dist = path.join(root, 'dist')
const manifestPath = path.join(dist, 'manifest.json')
try {
  await access(manifestPath)
} catch {
  console.error('dist/ が無い。先に `npm run build:store` (= build.mjs --store) を実行すること')
  process.exit(1)
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

// 提出前の自己チェック。ここで落ちるものはストアでも落ちる。
const problems = []
if (manifest.description.length > 132) {
  problems.push(`description が ${manifest.description.length} 文字 (上限 132)`)
}
for (const size of ['16', '48', '128']) {
  if (!manifest.icons?.[size]) problems.push(`icons.${size} が無い`)
}
const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile())
  .map((e) => path.relative(dist, path.join(e.parentPath ?? e.path, e.name)))
const stray = files.filter((f) => f.endsWith('.map'))
if (stray.length > 0) {
  problems.push(`sourcemap が混ざっている (${stray.join(', ')}) — --store でビルドすること`)
}
if (problems.length > 0) {
  console.error('提出前チェックに失敗:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const releaseDir = path.join(root, 'release')
const zipPath = path.join(releaseDir, `yt-redirect-pin-store-${manifest.version}.zip`)
await mkdir(releaseDir, { recursive: true })
await rm(zipPath, { force: true })

const entries = []
for (const file of files.sort()) {
  entries.push({
    name: file.split(path.sep).join('/'),
    data: await readFile(path.join(dist, file)),
  })
}
await writeFile(zipPath, makeZip(entries))

console.log(`packaged for store -> ${zipPath}`)
console.log(`  name: ${manifest.name}`)
console.log(`  version: ${manifest.version}`)
for (const entry of entries) console.log(`  ${entry.name}`)
