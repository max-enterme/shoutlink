// Chrome ウェブストアへ提出する ZIP を作る。
//
//   release/shoutlink-<version>-store.zip
//     manifest.json    … **ルート直下**。ストアはここに manifest が無いと弾く
//     content.js / options.html / options.js / icons/
//
// GitHub Releases 用の `package.mjs` とは、意図的に 3 つ違う:
//
//   1. **フォルダで包まない。** Releases 用は展開先に散らばらないよう
//      `shoutlink-<version>/` で包んでいるが、**ストアは ZIP のルートに
//      `manifest.json` を要求する**ので、包んだままだと弾かれる。
//   2. **`INSTALL.txt` を入れない。** デベロッパーモード読み込みの手順書なので、
//      ストア経由のインストールには要らないどころか手順が食い違う。
//   3. **`key` を落とす。** → 下の「なぜ key を落とすか」。
//
// 前提: 先に `npm run build --release` で dist/ が作られていること
// (`npm run package:store` がまとめてやる)。
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeZip } from './zip.mjs'
import { distDir, repoRoot as root } from './paths.mjs'

// ⚠ dist/ は本体に固定されている (paths.mjs)。ZIP の出力先 release/ はこのチェックアウトの下。
const dist = distDir

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

const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile() && !e.name.startsWith('_') && !e.name.endsWith('.map'))
  .map((e) => path.relative(dist, path.join(e.parentPath ?? e.path, e.name)))

// ZIP ライタもディレクトリ走査も自前なので、**取りこぼしても妥当な ZIP ができてしまう**。
// 「開けるが読み込めない拡張」を提出しないよう、要るものが揃っているかをここで見る
// (`package.mjs` と同じ検査。片方だけ直して食い違うことがないよう、内容も揃えてある)。
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

// ── リモートコードが入っていないことの確認 ──────────────────────────────
//
// ストアの申告 (`docs/` の プライバシー申告) で「リモートコードを使わない」と書くので、
// **提出物と申告が食い違わないことを、提出物を作るこの場で機械で見る。**
//
// ⚠️ **これは「外から取ってきたコードを実行する経路が無い」ことの確認であって、
//    「ネットワークに一切触らない」ことの確認ではない。**
//    設定ページは `www.youtube.com` のチャンネルページを 1 回 GET する (AC17)。
//    それは**取得した HTML を読むだけでコードとしては実行しない**ので、ここでは落とさない。
const REMOTE_CODE_IN_JS = [
  { re: /\beval\s*\(/, why: 'eval()' },
  { re: /\bnew\s+Function\s*\(/, why: 'new Function()' },
  { re: /\bimportScripts\s*\(/, why: 'importScripts()' },
  { re: /\bimport\s*\(/, why: '動的 import()' },
]
// 属性値がプロトコル付き / プロトコル相対 (`//cdn…`) の src・href を拾う。
const REMOTE_SRC_IN_HTML = /\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i

const remote = []
for (const file of files) {
  const rel = file.split(path.sep).join('/')
  if (rel.endsWith('.js')) {
    const text = await readFile(path.join(dist, file), 'utf8')
    for (const { re, why } of REMOTE_CODE_IN_JS) {
      if (re.test(text)) remote.push(`${rel}: ${why}`)
    }
  } else if (rel.endsWith('.html')) {
    const text = await readFile(path.join(dist, file), 'utf8')
    if (REMOTE_SRC_IN_HTML.test(text)) remote.push(`${rel}: 外部 src/href`)
  }
}
if (remote.length > 0) {
  console.error(`リモートコードらしきものがある:\n  ${remote.join('\n  ')}`)
  console.error('申告 (リモートコードなし) と食い違う。提出前に潰すこと')
  process.exit(1)
}

// ── なぜ key を落とすか ────────────────────────────────────────────────
//
// `public/manifest.json` の `key` は**開発用**。これがあると読み込むフォルダの場所に
// 依らずローカルの拡張 ID が一定になり、版を入れ替えても設定が引き継がれる。
//
// **ストアはこの `key` を使わない。**
// [Keep a consistent extension ID](https://developer.chrome.com/docs/extensions/reference/manifest/key)
// が示す手順は「まずダッシュボードへ ZIP を上げる → Package タブの View public key で
// 公開鍵を取る → それを manifest の `key` に入れる」で、**鍵と ID を作るのはストア側**。
// `key` は開発側をストアの ID に合わせるための**逆方向**の仕組みで、持ち込むものではない。
//
// さらに、新規アイテムの初回アップロードで `key field is not allowed in manifest` が出る
// という報告がある (chromium-extensions, 2021 / コミュニティの報告で公式の記述ではない)。
// 外しておけばどちらでも通るので、外す。
//
// **`public/manifest.json` からは外さない** (ローカルの ID が動くと開発中に困る)。
// ここでは ZIP へ入れる分だけを書き換え、`dist/` はそのままにする。
//
// → `docs/setup-and-verify.md` 「ストアへ移すと拡張 ID が変わる」
const { key: _droppedKey, ...storeManifest } = manifest
if (_droppedKey === undefined) {
  console.warn('注意: dist/manifest.json に `key` が無い。開発用の ID 固定が外れていないか確認すること')
}

const entries = []
for (const file of files.sort()) {
  const rel = file.split(path.sep).join('/')
  entries.push({
    name: rel,
    data:
      rel === 'manifest.json'
        ? Buffer.from(`${JSON.stringify(storeManifest, null, 2)}\n`, 'utf8')
        : await readFile(path.join(dist, file)),
  })
}

const releaseDir = path.join(root, 'release')
const zipPath = path.join(releaseDir, `shoutlink-${version}-store.zip`)
await mkdir(releaseDir, { recursive: true })
await rm(zipPath, { force: true })
await writeFile(zipPath, makeZip(entries))

console.log(`packaged for store -> ${zipPath}`)
for (const entry of entries) console.log(`  ${entry.name}`)
console.log('')
console.log('確認したこと:')
console.log(`  - manifest.json が ZIP のルートにある`)
console.log(`  - INSTALL.txt を入れていない`)
console.log(`  - \`key\` を落とした (dist/ と public/ は据え置き)`)
console.log(`  - .map と \`_\` 始まりを除外した`)
console.log(`  - eval / new Function / importScripts / 動的 import / 外部 src が無い`)
