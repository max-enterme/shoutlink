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
  // `spawnSync('node', …)` は PATH 解決に依存し環境で失敗しうるので、この Node 自身の実行ファイルを使う。
  const result = spawnSync(process.execPath, [scriptPath, root], { encoding: 'utf8' })
  if (result.error) {
    throw new Error(`check-links.mjs の起動に失敗した (spawn error): ${result.error.message}`)
  }
  if (result.status === null) {
    throw new Error(`check-links.mjs がシグナルで終了した (原因不明の異常終了): signal=${result.signal}`)
  }
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
    expect(stderr).toContain('[実在確認]')
    expect(stderr).toContain('docs/nope.md')
  })
})

describe('check-links.mjs — ② 自リポジトリ絶対 URL の還元', () => {
  it('実在しないパスを指す blob/main URL で非 0 になり、還元後のパスが実在確認の違反として出る', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n\n[ghost](https://github.com/max-enterme/shoutlink/blob/main/docs/ghost.md)\n',
    })

    const { status, stderr } = runCheckLinks(root)

    expect(status).not.toBe(0)
    expect(stderr).toContain('[実在確認]')
    // 還元 (blob/main URL → repo 内パス) が正しく効いていることまで、矢印より後ろ (還元結果)
    // だけを見て固定する。矢印より前 (元 URL) にも同じ部分文字列が含まれるため、
    // 矢印を含めないと「還元先を誤る」壊れ方を CI (パス区切りが `/` の環境) で検出できない。
    expect(stderr).toContain(`→ ${path.join('docs', 'ghost.md')}`)
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
    expect(stderr).toContain('[見出しアンカー]')
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
    expect(stderr).toContain('[孤立]')
    expect(stderr).toContain(path.join('docs', 'orphan.md'))
  })

  it('正例: README → A → B と間接的に辿れる B は孤立にならない (推移的到達可能性)', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n\n[a](docs/a.md)\n',
      'docs/a.md': '# A\n\n[b](b.md)\n',
      'docs/b.md': '# B\n\n本文\n',
    })

    const { status, stdout } = runCheckLinks(root)

    expect(status).toBe(0)
    // B5: 正例のうち最低 1 本は stdout も見て、検査本数まで出ていることを確かめる
    // (早期 return で何も検査せず 0 で抜けた、という壊れ方を塞ぐ)
    expect(stdout).toContain('check-links: OK')
    expect(stdout).toContain('2 本')
  })
})

describe('check-links.mjs — docs/index.html (B3)', () => {
  it('相対 href の実在しない参照で非 0 になり [実在確認] が出る', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'docs/index.html': '<!doctype html><html><body><a href="missing.html">x</a></body></html>\n',
    })

    const { status, stderr } = runCheckLinks(root)

    expect(status).not.toBe(0)
    expect(stderr).toContain('[実在確認]')
    expect(stderr).toContain(path.join('docs', 'missing.html'))
  })

  it('Pages 絶対 URL の <meta content> が実在しない先を指すと非 0 になり、還元後のパスが出る', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'docs/index.html':
        '<!doctype html><html><head><meta property="og:image" content="https://max-enterme.github.io/shoutlink/img/missing.png"></head><body></body></html>\n',
    })

    const { status, stderr } = runCheckLinks(root)

    expect(status).not.toBe(0)
    expect(stderr).toContain('[実在確認]')
    expect(stderr).toContain(path.join('docs', 'img', 'missing.png'))
  })

  it('正例: 末尾 / の Pages URL (og:url 相当) は還元されず、それだけなら exit 0', () => {
    // 還元されれば `docs/nonexistent` となり実在しないため違反になるはずのパスを使うことで、
    // 「末尾 `/` を還元しない」除外が実際に効いていることを区別できるようにする。
    // (`docs/` 自体が実在するパスだと、除外が無くても偶然 exit 0 になり検証にならない)
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'docs/index.html':
        '<!doctype html><html><head><meta property="og:url" content="https://max-enterme.github.io/shoutlink/nonexistent/"></head><body></body></html>\n',
    })

    const { status } = runCheckLinks(root)

    expect(status).toBe(0)
  })
})

describe('check-links.mjs — ci.yml への登録 (AC4)', () => {
  it('.github/workflows/ci.yml が check-links を回している', () => {
    // ci.yml は YAML なので tests/manifest.test.ts (resolveJsonModule での import) は真似ず、
    // readFileSync で読んで文字列一致を見る。
    // `toContain('check-links')` は `# - run: npm run check-links` のコメントアウトや
    // `- run: npm run check-links || true` でも緑になってしまうため、行そのものを固定する。
    const ciYmlPath = path.resolve(fileURLToPath(import.meta.url), '../../.github/workflows/ci.yml')
    const content = readFileSync(ciYmlPath, 'utf8')

    expect(content).toMatch(/^\s*- run: npm run check-links\s*$/m)
  })
})
