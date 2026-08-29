// dist/ に Chrome 拡張 (MV3) の読み込み可能な形を吐く。
//   src/main.ts            -> dist/content.js  (content script / IIFE)
//   src/options/options.ts -> dist/options.js  (options page)
//   public/*               -> dist/*           (manifest.json, options.html, icons/)
//
// --release を付けると配布用のビルドになる (sourcemap を出さない)。
// 難読化はしない — 何をしている拡張かを読んで確かめられる状態で配る。
//
// **出力先は worktree ではなく本体の dist/ に固定してある** (理由は paths.mjs)。
import { build } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { distDir, distIsElsewhere, repoRoot as root } from './paths.mjs'

const outdir = distDir
const forRelease = process.argv.includes('--release')

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

await build({
  entryPoints: {
    content: path.join(root, 'src', 'main.ts'),
    options: path.join(root, 'src', 'options', 'options.ts'),
  },
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  sourcemap: !forRelease,
  outdir,
  logLevel: 'info',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})

await cp(path.join(root, 'public'), outdir, { recursive: true })
console.log(`built -> ${outdir}${forRelease ? ' (release)' : ''}`)
if (distIsElsewhere) {
  // worktree からビルドした。Chrome が読んでいるのはこの 1 か所なので、
  // 別の worktree のビルドを上書きしている可能性がある
  console.log(`  (${root} のコードを、本体の dist/ へ出した)`)
}
