// テスターに渡す ZIP を作る。
//   release/yt-redirect-pin-test-<version>/
//     START-HERE.md   … docs/for-testers.md(この文書だけで完結する手順書)
//     extension/      … dist/ の中身(chrome://extensions で読み込むフォルダ)
//     source/         … ソース一式(何をしている拡張か確認できるように)
//   release/yt-redirect-pin-test-<version>.zip
//
// 前提: 先に `npm run build` で dist/ が作られていること。
import { execFile } from 'node:child_process'
import { access, cp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const name = `yt-redirect-pin-test-${version}`
const releaseDir = path.join(root, 'release')
const stageDir = path.join(releaseDir, name)
const zipPath = path.join(releaseDir, `${name}.zip`)

const dist = path.join(root, 'dist')
try {
  await access(path.join(dist, 'manifest.json'))
} catch {
  console.error('dist/ が無い。先に `npm run build` を実行すること')
  process.exit(1)
}

await rm(stageDir, { recursive: true, force: true })
await rm(zipPath, { force: true })
await mkdir(stageDir, { recursive: true })

await cp(dist, path.join(stageDir, 'extension'), { recursive: true })
await cp(path.join(root, 'docs', 'for-testers.md'), path.join(stageDir, 'START-HERE.md'))

// 監査できるようにソースも同梱する(node_modules / dist / release は除く)
const SOURCE_ENTRIES = [
  'src',
  'public',
  'tests',
  'scripts',
  'docs',
  'specs',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'README.md',
]
const sourceDir = path.join(stageDir, 'source')
await mkdir(sourceDir, { recursive: true })
for (const entry of SOURCE_ENTRIES) {
  await cp(path.join(root, entry), path.join(sourceDir, entry), { recursive: true })
}

if (process.platform === 'win32') {
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`,
  ])
} else {
  await execFileAsync('zip', ['-rq', zipPath, name], { cwd: releaseDir })
}

console.log(`packaged -> ${zipPath}`)
