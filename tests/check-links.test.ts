/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * `scripts/check-links.mjs` の回帰テスト (005-docs-link-hygiene AC2 / AC4)。
 *
 * `.mjs` を import すると TS7016 で typecheck が落ちるため import しない
 * (spec.md D3 / plan.md)。代わりに**子プロセスで起動して exit code と出力を見る**。
 * 検査本体が走査ルートを第 1 引数で受けられる (AC5) ので、テストごとに
 * 一時ディレクトリのフィクスチャを作って渡す。
 */

const scriptPath = path.resolve(fileURLToPath(import.meta.url), '../../scripts/check-links.mjs')

const createdRoots: string[] = []

/** files のキーをフィクスチャルートからの相対パスとして、一時ディレクトリにファイルを作る */
function createFixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'check-links-'))
  createdRoots.push(root)
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(root, relPath)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return root
}

function runCheckLinks(root: string) {
  const result = spawnSync('node', [scriptPath, root], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

afterEach(() => {
  while (createdRoots.length) {
    const root = createdRoots.pop()
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

describe('check-links.mjs — ① 相対リンクの実在', () => {
  it('実在しないファイルへの相対リンクで非 0 になり、そのパスが出力に出る', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n\n[missing](docs/nope.md)\n',
    })

    const { status, stderr } = runCheckLinks(root)

    expect(status).not.toBe(0)
    expect(stderr).toContain('docs/nope.md')
  })
})

describe('check-links.mjs — ② 自リポジトリ絶対 URL の還元', () => {
  it('実在しないパスを指す blob/main URL で非 0 になり、そのパスが出力に出る', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n\n[ghost](https://github.com/max-enterme/shoutlink/blob/main/docs/ghost.md)\n',
    })

    const { status, stderr } = runCheckLinks(root)

    expect(status).not.toBe(0)
    expect(stderr).toContain('docs/ghost.md')
  })
})

describe('check-links.mjs — ③ md の見出しアンカー', () => {
  it('実在する md + 実在しない見出しアンカーで非 0 になり、そのアンカーが出力に出る', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n\n[link](docs/target.md#存在しない見出し)\n',
      'docs/target.md': '# 対象\n\n## 実在する見出し\n\n本文\n',
    })

    const { status, stderr } = runCheckLinks(root)

    expect(status).not.toBe(0)
    expect(stderr).toContain('存在しない見出し')
  })

  it('正例: 実在する日本語見出し(#上限が効かない場合)が解決されて exit 0 になる', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n\n[link](docs/target.md#上限が効かない場合)\n',
      'docs/target.md': '# 対象\n\n#### 上限が効かない場合\n\n本文\n',
    })

    const { status } = runCheckLinks(root)

    expect(status).toBe(0)
  })
})

describe('check-links.mjs — ④ 孤立検出', () => {
  it('どこからも参照されない md で非 0 になり、そのパスが出力に出る', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n\n参照なし\n',
      'docs/orphan.md': '# 孤立\n\n本文\n',
    })

    const { status, stderr } = runCheckLinks(root)

    expect(status).not.toBe(0)
    expect(stderr).toContain(path.join('docs', 'orphan.md'))
  })
})

describe('check-links.mjs — ci.yml への登録 (AC4)', () => {
  it('.github/workflows/ci.yml が check-links を回している', () => {
    // ci.yml は YAML なので tests/manifest.test.ts (resolveJsonModule での import) は真似ず、
    // readFileSync で読んで文字列一致を見る
    const ciYmlPath = path.resolve(fileURLToPath(import.meta.url), '../../.github/workflows/ci.yml')
    const content = readFileSync(ciYmlPath, 'utf8')

    expect(content).toContain('check-links')
  })
})
