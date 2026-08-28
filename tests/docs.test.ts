import { describe, expect, it } from 'vitest'

/**
 * 006 / AC17: `cooldownSec` / `dedupe` / 「クールダウン」の残存を機械で見る。
 *
 * `node:fs` を使わず、Vite の `import.meta.glob` (raw) でソースを読む
 * (このリポジトリに `@types/node` が入っておらず、依存を増やさないため)。
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

function key(path: string): string {
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
})
