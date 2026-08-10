// GitHub Releases に添付する ZIP を作る。
//
//   release/yt-redirect-pin-<version>.zip
//     yt-redirect-pin-<version>/
//       INSTALL.txt      … 展開した人がまず読むもの
//       manifest.json    … 「パッケージ化されていない拡張機能を読み込む」で選ぶのはこのフォルダ
//       content.js / options.html / options.js / icons/
//
// **中身をフォルダ 1 枚で包んである。**展開先に散らばると、どこを読み込めばよいか分からなくなるため。
//
// 前提: 先に `npm run build` で dist/ が作られていること。
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeZip } from './zip.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

try {
  await access(path.join(dist, 'manifest.json'))
} catch {
  console.error('dist/ が無い。先に `npm run build` を実行すること')
  process.exit(1)
}

const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'))
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

if (manifest.version !== version) {
  console.error(`版が食い違っている: package.json=${version} manifest=${manifest.version}`)
  process.exit(1)
}

const INSTALL = `yt-redirect-pin ${version}

■ 入れかた

1. このフォルダを、消さない場所に置く
   (Chrome はこのフォルダを読み続けます。消すと拡張も消えます)
2. Chrome で chrome://extensions を開く
3. 右上の「デベロッパー モード」を ON にする
4. 左上の「パッケージ化されていない拡張機能を読み込む」を押す
5. このフォルダ (manifest.json が入っているフォルダ) を選ぶ

■ 設定

chrome://extensions のカード →「詳細」→「拡張機能のオプション」

■ 使う前に

この拡張は、あなたのアカウントの名義で YouTube のライブチャットへ自動投稿します。
YouTube の規約上グレーな行為を含みます。リスクを理解した上で自己責任で使ってください。

  https://github.com/max-enterme/yt-redirect-pin

■ 注意

・Chrome が起動のたびに「デベロッパー モードの拡張機能を無効にする」と聞いてきます。
  未署名の拡張なので正常です。「キャンセル」で閉じてください。
・自動更新はされません。新しい版は上の GitHub の Releases から取ってください。
`

const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile() && !e.name.startsWith('_') && !e.name.endsWith('.map'))
  .map((e) => path.relative(dist, path.join(e.parentPath ?? e.path, e.name)))

const top = `yt-redirect-pin-${version}`
const entries = [{ name: `${top}/INSTALL.txt`, data: Buffer.from(INSTALL, 'utf8') }]
for (const file of files.sort()) {
  entries.push({
    name: `${top}/${file.split(path.sep).join('/')}`,
    data: await readFile(path.join(dist, file)),
  })
}

const releaseDir = path.join(root, 'release')
const zipPath = path.join(releaseDir, `${top}.zip`)
await mkdir(releaseDir, { recursive: true })
await rm(zipPath, { force: true })
await writeFile(zipPath, makeZip(entries))

console.log(`packaged -> ${zipPath}`)
for (const entry of entries) console.log(`  ${entry.name}`)
