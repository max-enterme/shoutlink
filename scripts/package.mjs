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

// README を経由せず ZIP だけ手渡しされることがある。**この文書が唯一の告知になりうる**ので、
// 警告を手順より先に置く。
const INSTALL = `yt-redirect-pin ${version}

■ 使う前に必ず読んでください

この拡張は、あなたのアカウントの名義で YouTube のライブチャットへ自動投稿します。
これは YouTube の規約上グレーな行為を含みます。処分の前例は見つかっていませんが、
「安全である証拠」ではなく「証拠が無い」という状態です。
何かあったとき失うのは、作者ではなくあなたのチャンネルです。

リスクを自分で判断・管理できる人が、自己責任で使うことを想定しています。
判断がつかない場合は、使わないでください。作者は結果について責任を負いません (MIT / 無保証)。

また、実配信で動作を確認できているのは日本語 UI・1 環境だけです。
既定の固定モード ifEmpty の判定は未検証です。

  詳細: https://max-enterme.github.io/yt-redirect-pin/

■ 前提

・Chrome (確認しているのは Chrome だけです)
・YouTube Studio のライブ管制室のチャットでのみ動きます (www.youtube.com では動きません)
・Studio の表示言語が日本語であること (検知は通知の文言に依存しています)

■ 入れかた

1. このフォルダを、消さない場所に置く
   (Chrome はこのフォルダを読み続けます。消すと拡張も消えます)
2. Chrome で chrome://extensions を開く
3. 右上の「デベロッパー モード」を ON にする
4. 左上の「パッケージ化されていない拡張機能を読み込む」を押す
5. このフォルダ (manifest.json が入っているフォルダ) を選ぶ
6.「リダイレクト返礼ピン」のカードが出れば完了

■ 設定

chrome://extensions のカード →「詳細」→「拡張機能のオプション」

「有効にする」を外すと、自動検知も手動の「↩ 返礼」も止まります。

■ 注意

・Chrome が起動のたびに「デベロッパー モードの拡張機能を無効にする」と聞いてきます。
  未署名の拡張なので正常です。「キャンセル」で閉じてください。
・自動更新はされません。新しい版はここから取ってください。
  https://github.com/max-enterme/yt-redirect-pin/releases/latest
`

const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile() && !e.name.startsWith('_') && !e.name.endsWith('.map'))
  .map((e) => path.relative(dist, path.join(e.parentPath ?? e.path, e.name)))

// ZIP ライタもディレクトリ走査も自前なので、**取りこぼしても妥当な ZIP ができてしまう**。
// 「開けるが読み込めない拡張」を配らないよう、要るものが揃っているかをここで見る。
const REQUIRED = [
  'manifest.json',
  'content.js',
  'options.html',
  'options.js',
  ...Object.values(manifest.icons),
]
const found = new Set(files.map((f) => f.split(path.sep).join('/')))
const missing = REQUIRED.filter((f) => !found.has(f))
if (missing.length > 0) {
  console.error(`dist/ に足りないものがある: ${missing.join(', ')}`)
  process.exit(1)
}

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
