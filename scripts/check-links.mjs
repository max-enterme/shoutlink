// リポジトリ内のドキュメント参照が壊れていないかを検査する。
// 壊れても静かに壊れる箇所(相対リンクの実在・自リポジトリの絶対 URL・md の見出しアンカー・
// README から辿れない md)を CI で落として気付けるようにする (005-docs-link-hygiene)。
//
//   npm run check-links
//   node scripts/check-links.mjs [走査ルート]   # 省略時は repo ルート。テストは一時フィクスチャを渡す
//
// 検査は 4 種:
//   ① 相対リンクの実在        — md は Markdown 記法 `](…)` のみ、index.html は href/src/<meta content>
//   ② 自リポジトリ絶対 URL の還元 — blob/main URL と GitHub Pages 絶対 URL を repo 内パスへ戻して実在確認
//   ③ md の見出しアンカー      — `…install.md#上限が効かない場合` の形
//   ④ 孤立検出               — docs/**/*.md のうち README.md から (他の md 経由も含め) 辿れないもの
//
// いずれもコードフェンス内は対象外。`data:` と `mailto:` は除外。新規依存は足さない (node: 組み込みのみ)。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, '..')
const root = path.resolve(process.argv[2] ?? defaultRoot)

const readmePath = path.join(root, 'README.md')
const docsDir = path.join(root, 'docs')
const indexHtmlPath = path.join(docsDir, 'index.html')

// 走査ルートが不正だと孤立検出の根 (README.md) すら無く、検査そのものが成立しない。
// 黙って「検査対象 0 本」で OK を返すと、フィクスチャのパスを間違えたテストまで
// 素通りしてしまう (正例テストの取り違え防止)。
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`check-links: 走査ルートが存在しないかディレクトリではありません — ${root}`)
  process.exit(1)
}
if (!existsSync(readmePath)) {
  console.error(`check-links: README.md が無く、孤立検出の根が無いため検査を実行できません — ${readmePath}`)
  process.exit(1)
}

// 自リポジトリを指す絶対 URL のプレフィックス (②)。他リポジトリ・releases・issues は還元しない
const BLOB_PREFIX = 'https://github.com/max-enterme/shoutlink/blob/main/'
const PAGES_PREFIX = 'https://max-enterme.github.io/shoutlink/'

/** @type {string[]} 見つかった違反 (人が読める形の 1 行ずつ) */
const violations = []

/** README.md を根として、md → md の参照グラフを作る (④ の孤立検出に使う)。index.html は含めない */
const linkGraph = new Map()

function addEdge(fromAbs, toAbs) {
  const key = path.normalize(fromAbs)
  if (!linkGraph.has(key)) linkGraph.set(key, new Set())
  linkGraph.get(key).add(path.normalize(toAbs))
}

/**
 * 自リポジトリの絶対 URL を repo ルートからの相対パスへ還元する。
 * 還元できない (他リポジトリ・releases・issues・末尾 `/` の Pages URL 等) 場合は null。
 */
function reduceAbsoluteUrl(url) {
  if (url.startsWith(BLOB_PREFIX)) {
    return url.slice(BLOB_PREFIX.length)
  }
  if (url.startsWith(PAGES_PREFIX)) {
    const rest = url.slice(PAGES_PREFIX.length)
    // 末尾 `/` は og:url のようにディレクトリ (= サイトルート) を指すので還元しない
    if (rest === '' || rest.endsWith('/')) return null
    return `docs/${rest}`
  }
  return null
}

/**
 * `absPath` (root 配下であることが前提) が、大小文字を区別してディスク上に実在するかを見る。
 * `existsSync` は Windows では大小文字を区別しないため、`docs/CaseTest.md` のようなリンクが
 * 実体 `docs/casetest.md` に対して Linux (CI) では違反、Windows (ローカル) では通過という
 * 食い違いを生む。親ディレクトリを readdirSync してエントリ名の完全一致を見ることで揃える。
 */
function existsCaseSensitive(absPath) {
  const rel = path.relative(root, absPath)
  const segments = rel.split(path.sep).filter(Boolean)
  let current = root
  for (const seg of segments) {
    let entries
    try {
      entries = readdirSync(current)
    } catch {
      return false
    }
    if (!entries.includes(seg)) return false
    current = path.join(current, seg)
  }
  return true
}

function splitAnchor(p) {
  const idx = p.indexOf('#')
  if (idx === -1) return { pathPart: p, anchor: null }
  let anchor = p.slice(idx + 1)
  try {
    anchor = decodeURIComponent(anchor)
  } catch {
    // 壊れた % エスケープはそのまま比較にかけて、通常どおり見出し無しとして落とす
  }
  return { pathPart: p.slice(0, idx), anchor: anchor.toLowerCase() }
}

/**
 * 見出しテキストを GitHub 風のアンカーに寄せる。
 * ⚠ GitHub の見出し ID 生成規則を完全には再現しない (spec.md R5)。
 *   ここでカバーしているのは「URL エンコードされていない日本語見出し」で、
 *   絵文字や記号を含む見出し・重複見出しの連番付与などは再現できない場合がある。
 */
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_ ]+/gu, '') // 句読点・括弧などを落とす (文字・数字・ハイフン・アンダースコア・空白だけ残す)
    .trim()
    .replace(/\s+/g, '-')
}

// コードフェンスの開始・終了行を見分ける。
// 開始行は「フェンスだけの行」に限定する: 省略可能なリストマーカー (`4. ```bash` のように
// リスト項目の先頭に直接フェンスが続く形。docs/setup-and-verify.md に実例あり) + ``` + 言語名など。
// 同じ行に 2 個目の ``` が出てはいけない — でないと `` `npm run build` `` のようなインライン
// コードをフェンス開始と誤爆し、以降のリンクを黙って見逃す (レビュー指摘 A1)。
// 終了行は ``` + 空白のみの単独行に限定する。
const FENCE_OPEN_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?```[^`]*$/
const FENCE_CLOSE_RE = /^\s*```\s*$/

/** フェンス状態 (inFence) に応じて、この行がフェンスの開始/終了かを判定する */
function isFenceLine(line, inFence) {
  return inFence ? FENCE_CLOSE_RE.test(line) : FENCE_OPEN_RE.test(line)
}

const headingSlugCache = new Map()

function headingSlugsOf(mdAbsPath) {
  const key = path.normalize(mdAbsPath)
  if (headingSlugCache.has(key)) return headingSlugCache.get(key)
  const slugs = new Set()
  if (existsSync(mdAbsPath)) {
    let inFence = false
    for (const line of readFileSync(mdAbsPath, 'utf8').split('\n')) {
      if (isFenceLine(line, inFence)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      // 見出しレベルは h2 / h3 / h4 が混在するので ^#{1,6} を見る
      const m = /^#{1,6}\s+(.+?)\s*$/.exec(line)
      if (m) slugs.add(slugify(m[1]))
    }
  }
  headingSlugCache.set(key, slugs)
  return slugs
}

/**
 * 1 本のリンク候補を検査する。
 * @param {string} rawUrl 抽出したそのままの文字列 (タイトル付きの場合あり)
 * @param {{sourceFile: string, baseDir: string, trackGraph: boolean, lineNo?: number}} ctx
 */
function checkLink(rawUrl, ctx) {
  let url = rawUrl.trim()
  if (!url) return
  // Markdown のリンクタイトル `(url "title")` は空白の後ろを落とす
  const spaceIdx = url.search(/\s/)
  if (spaceIdx !== -1) url = url.slice(0, spaceIdx)
  url = url.replace(/^['"]|['"]$/g, '')
  if (!url) return

  if (url.startsWith('#') || url.startsWith('data:') || url.startsWith('mailto:')) return

  let relPath
  if (/^https?:\/\//i.test(url)) {
    relPath = reduceAbsoluteUrl(url)
    if (relPath === null) return // 他リポジトリ・releases・issues など、還元対象外
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return // http(s) 以外のスキーム (tel: 等) は対象外
  } else {
    relPath = url // 相対リンク
  }

  const { pathPart, anchor } = splitAnchor(relPath)
  if (!pathPart) return // 自ページ内アンカーのみ

  const absPath = /^https?:\/\//i.test(url)
    ? path.join(root, pathPart) // 還元後は repo ルート基準
    : path.resolve(ctx.baseDir, pathPart) // 相対リンクは参照元ファイルのディレクトリ基準

  if (ctx.trackGraph && path.extname(absPath).toLowerCase() === '.md') {
    addEdge(ctx.sourceFile, absPath)
  }

  const where = ctx.lineNo ? `${path.relative(root, ctx.sourceFile)}:${ctx.lineNo}` : path.relative(root, ctx.sourceFile)

  // repo ルートを抜けるリンクは、ディスク上の実在確認より先に違反として扱う。
  // 実在確認だけで見ると「たまたまそのパスに何か存在するか」に判定が左右され、
  // チェックアウト位置 (例: 本体クローンの隣に max/ がある環境) 次第で合否が変わってしまう。
  const relFromRoot = path.relative(root, absPath)
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
    violations.push(`[repo 外] ${where}: repo ルートの外を指している — ${rawUrl}`)
    return
  }

  if (!existsCaseSensitive(absPath)) {
    violations.push(`[実在確認] ${where}: リンク先が無い — ${rawUrl} → ${path.relative(root, absPath)}`)
    return
  }
  if (anchor && path.extname(absPath).toLowerCase() === '.md') {
    if (!headingSlugsOf(absPath).has(anchor)) {
      violations.push(
        `[見出しアンカー] ${where}: #${anchor} が ${path.relative(root, absPath)} に無い — ${rawUrl}`,
      )
    }
  }
}

/** md 中の `](…)` を、コードフェンス内を除いて抽出する */
function extractMdLinks(absPath) {
  const links = []
  let inFence = false
  const linkRe = /\]\(([^)]+)\)/g
  readFileSync(absPath, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (isFenceLine(line, inFence)) {
        inFence = !inFence
        return
      }
      if (inFence) return
      linkRe.lastIndex = 0
      let m
      while ((m = linkRe.exec(line))) {
        links.push({ raw: m[1], lineNo: i + 1 })
      }
    })
  return links
}

function checkMdFile(absPath) {
  const baseDir = path.dirname(absPath)
  for (const { raw, lineNo } of extractMdLinks(absPath)) {
    checkLink(raw, { sourceFile: absPath, baseDir, trackGraph: true, lineNo })
  }
}

/** docs/index.html の href / src / <meta content> を検査する。コードフェンス相当の除外は持たせない (plan.md R7) */
function checkIndexHtml() {
  if (!existsSync(indexHtmlPath)) return
  const content = readFileSync(indexHtmlPath, 'utf8')
  const baseDir = path.dirname(indexHtmlPath)
  const ctx = { sourceFile: indexHtmlPath, baseDir, trackGraph: false } // index.html は被参照元に含めない (AC3)

  const attrRe = /\b(?:href|src)="([^"]*)"/g
  let m
  while ((m = attrRe.exec(content))) {
    checkLink(m[1], ctx)
  }

  // <meta content="…"> は og:url / og:image の絶対 URL 用。他の meta (description 等) は
  // 自由文であってリンクではないので、リンクらしい http(s) 絶対 URL のときだけ検査にかける
  const metaRe = /<meta\b[^>]*\bcontent="([^"]*)"[^>]*>/g
  while ((m = metaRe.exec(content))) {
    if (/^https?:\/\//i.test(m[1])) checkLink(m[1], ctx)
  }
}

function listDocsMdRecursive(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listDocsMdRecursive(p))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(p)
  }
  return out.sort()
}

const docsMdFiles = listDocsMdRecursive(docsDir)

checkMdFile(readmePath) // 存在は冒頭で検証済み
for (const f of docsMdFiles) checkMdFile(f)
checkIndexHtml()

// ④ 孤立検出: README.md を根に、md → md の参照グラフを辿って届く範囲を求める
function reachableFromReadme() {
  const seen = new Set()
  const stack = [path.normalize(readmePath)]
  while (stack.length) {
    const cur = stack.pop()
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const next of linkGraph.get(cur) ?? []) {
      if (!seen.has(next)) stack.push(next)
    }
  }
  return seen
}

const reachable = reachableFromReadme()
for (const f of docsMdFiles) {
  if (!reachable.has(path.normalize(f))) {
    violations.push(`[孤立] ${path.relative(root, f)}: README.md から参照されていない`)
  }
}

if (violations.length > 0) {
  console.error('check-links: 違反が見つかりました')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}

console.log(
  `check-links: OK (README.md + docs/**/*.md ${docsMdFiles.length} 本 / docs/index.html を検査)`,
)
