import { describe, expect, it } from 'vitest'

/**
 * 006 / AC17: `cooldownSec` / `dedupe` / 「クールダウン」の残存を機械で見る。
 *
 * `node:fs` を使わず、Vite の `import.meta.glob` (raw) でソースを読む
 * (Vitest はブラウザ相当の環境で動くため、テストのソース読み込みは Vite のビルド機構に
 * 寄せておくほうが自然。`@types/node` 自体は 005-docs-link-hygiene で導入済み)。
 */
const srcFiles = (import.meta as any).glob('../src/**/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>
const publicFiles = (import.meta as any).glob('../public/**/*.{html,json}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>
const docFiles = (import.meta as any).glob('../docs/**/*.{md,html}', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>
const readmeFiles = (import.meta as any).glob('../README.md', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>
const testFiles = (import.meta as any).glob('../tests/**/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>
const scriptFiles = (import.meta as any).glob('../scripts/**/*.mjs', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function key(path: string): string {
  // `tests/**` はこのファイル自身と同じディレクトリなので、glob のキーが `./config.test.ts` の
  // ように相対で来る(他の glob は `../docs/...` のように 1 つ上から書いている)。
  if (path.startsWith('./')) return `tests/${path.slice(2)}`
  return path.replace(/^\.\.\//, '')
}

function findMatches(files: Record<string, string>, pattern: RegExp): { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = []
  for (const [path, content] of Object.entries(files)) {
    content.split('\n').forEach((line, i) => {
      if (pattern.test(line)) {
        hits.push({ file: key(path), line: i + 1, text: line.trim() })
      }
    })
  }
  return hits
}

describe('docs / cooldownSec の残存', () => {
  it('src/ と public/ に cooldownSec の出現が無い', () => {
    const hits = findMatches({ ...srcFiles, ...publicFiles }, /cooldownSec/)
    expect(hits).toEqual([])
  })

  it('src/ と public/ に「クールダウン」の出現が無い', () => {
    const hits = findMatches({ ...srcFiles, ...publicFiles }, /クールダウン/)
    expect(hits).toEqual([])
  })

  it('src/ に dedupe の出現が無い', () => {
    const hits = findMatches(srcFiles, /dedupe/)
    expect(hits).toEqual([])
  })

  it('README.md と docs/* に「クールダウン」の出現が無い(docs/t1-findings.md は除外)', () => {
    const files = Object.fromEntries(
      Object.entries({ ...readmeFiles, ...docFiles }).filter(([path]) => key(path) !== 'docs/t1-findings.md'),
    )
    const hits = findMatches(files, /クールダウン/)
    expect(hits).toEqual([])
  })

  // tests/ と scripts/ にも残骸が残ることがある(例: 版下生成スクリプトの見本データ、
  // 撤去済みの設定を前提にしたテストの説明文)。
  // ⚠️ tests/config.test.ts (AC5: 保存済みの cooldownSec を読み捨てることを確かめる) と
  //    tests/post-log.test.ts (cooldownSec が dedupe と無関係であることを確かめる) は
  //    cooldownSec への正当な言及なので除外する。tests/docs.test.ts 自身も検査パターンの
  //    文字列を持つので除外する。
  const COOLDOWN_SEC_ALLOWED = new Set(['tests/config.test.ts', 'tests/post-log.test.ts', 'tests/docs.test.ts'])

  it('tests/ と scripts/ に cooldownSec の残骸が無い(正当な言及を除く)', () => {
    const files = Object.fromEntries(
      Object.entries({ ...testFiles, ...scriptFiles }).filter(([path]) => !COOLDOWN_SEC_ALLOWED.has(key(path))),
    )
    const hits = findMatches(files, /cooldownSec/)
    expect(hits).toEqual([])
  })

  it('tests/ と scripts/ に「クールダウン」の出現が無い(tests/docs.test.ts 自身は除外)', () => {
    const files = Object.fromEntries(
      Object.entries({ ...testFiles, ...scriptFiles }).filter(([path]) => key(path) !== 'tests/docs.test.ts'),
    )
    const hits = findMatches(files, /クールダウン/)
    expect(hits).toEqual([])
  })
})
