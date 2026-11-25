/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * `scripts/check-links.mjs` の回帰テスト (005-docs-link-hygiene AC2)。
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
    // check-links:ignore-next docs/nope.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/nope.md')
  })
})

describe('check-links.mjs — ② 自リポジトリ絶対 URL の還元', () => {
  it('実在しないパスを指す blob/main URL で非 0 になり、還元後のパスが実在確認の違反として出る', () => {
    const root = createFixtureRoot({
      // check-links:ignore-next https://github.com/max-enterme/shoutlink/blob/main/docs/ghost.md -- フィクスチャ内だけに置く検査用の参照
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
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
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
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
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
      // check-links:ignore-next docs/orphan.md -- フィクスチャ内だけに置く検査用の参照
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
      // check-links:ignore-next docs/a.md -- フィクスチャ内だけに置く検査用の参照
      'docs/a.md': '# A\n\n[b](b.md)\n',
      // check-links:ignore-next docs/b.md -- フィクスチャ内だけに置く検査用の参照
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

describe('check-links.mjs — 008 B1', () => {
  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('expanded sources: specs/sample/spec.md の Markdown リンクを検査する', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'specs/sample/spec.md':
        '\n' +
        '[missing](../../docs/missing.md)\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('specs', 'sample', 'spec.md')}:2`)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('expanded sources: src/sample.ts の Markdown リンクを検査する', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        '\n' +
        // check-links:ignore-next ../docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '[missing](../docs/missing.md)\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('src', 'sample.ts')}:2`)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('expanded sources: tests/sample.test.ts の Markdown リンクを検査する', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'tests/sample.test.ts':
        '\n' +
        // check-links:ignore-next ../docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '[missing](../docs/missing.md)\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('tests', 'sample.test.ts')}:2`)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare URLs: .github/ISSUE_TEMPLATE/config.yml の正しい blob', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      '.github/ISSUE_TEMPLATE/config.yml':
        // check-links:ignore-next https://github.com/max-enterme/shoutlink/blob/main/docs/target.md -- フィクスチャ内だけに置く検査用の参照
        'url: "https://github.com/max-enterme/shoutlink/blob/main/docs/target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare URLs: .github/ISSUE_TEMPLATE/config.yml の移動前 blob', () => {
    const root = createFixtureRoot({
      'README.md': '[new](docs/users/target.md)\n',
      // check-links:ignore-next docs/users/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/users/target.md': '# Target\n',
      '.github/ISSUE_TEMPLATE/config.yml':
        // check-links:ignore-next https://github.com/max-enterme/shoutlink/blob/main/docs/target.md -- フィクスチャ内だけに置く検査用の参照
        'url: "https://github.com/max-enterme/shoutlink/blob/main/docs/target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('.github', 'ISSUE_TEMPLATE', 'config.yml')}:1`)
    // check-links:ignore-next https://github.com/max-enterme/shoutlink/blob/main/docs/target.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('https://github.com/max-enterme/shoutlink/blob/main/docs/target.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare URLs: .github/ISSUE_TEMPLATE/config.yml の正しい Pages', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      '.github/ISSUE_TEMPLATE/config.yml':
        // check-links:ignore-next https://max-enterme.github.io/shoutlink/target.md -- フィクスチャ内だけに置く検査用の参照
        'url: "https://max-enterme.github.io/shoutlink/target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare URLs: .github/ISSUE_TEMPLATE/config.yml の移動前 Pages', () => {
    const root = createFixtureRoot({
      'README.md': '[new](docs/users/target.md)\n',
      // check-links:ignore-next docs/users/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/users/target.md': '# Target\n',
      '.github/ISSUE_TEMPLATE/config.yml':
        // check-links:ignore-next https://max-enterme.github.io/shoutlink/target.md -- フィクスチャ内だけに置く検査用の参照
        'url: "https://max-enterme.github.io/shoutlink/target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('.github', 'ISSUE_TEMPLATE', 'config.yml')}:1`)
    // check-links:ignore-next https://max-enterme.github.io/shoutlink/target.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('https://max-enterme.github.io/shoutlink/target.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare URLs: src/sample.ts の正しい blob', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next https://github.com/max-enterme/shoutlink/blob/main/docs/target.md -- フィクスチャ内だけに置く検査用の参照
        'url: "https://github.com/max-enterme/shoutlink/blob/main/docs/target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare URLs: src/sample.ts の移動前 blob', () => {
    const root = createFixtureRoot({
      'README.md': '[new](docs/users/target.md)\n',
      // check-links:ignore-next docs/users/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/users/target.md': '# Target\n',
      'src/sample.ts':
        // check-links:ignore-next https://github.com/max-enterme/shoutlink/blob/main/docs/target.md -- フィクスチャ内だけに置く検査用の参照
        'url: "https://github.com/max-enterme/shoutlink/blob/main/docs/target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('src', 'sample.ts')}:1`)
    // check-links:ignore-next https://github.com/max-enterme/shoutlink/blob/main/docs/target.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('https://github.com/max-enterme/shoutlink/blob/main/docs/target.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare URLs: src/sample.ts の正しい Pages', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next https://max-enterme.github.io/shoutlink/target.md -- フィクスチャ内だけに置く検査用の参照
        'url: "https://max-enterme.github.io/shoutlink/target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare URLs: src/sample.ts の移動前 Pages', () => {
    const root = createFixtureRoot({
      'README.md': '[new](docs/users/target.md)\n',
      // check-links:ignore-next docs/users/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/users/target.md': '# Target\n',
      'src/sample.ts':
        // check-links:ignore-next https://max-enterme.github.io/shoutlink/target.md -- フィクスチャ内だけに置く検査用の参照
        'url: "https://max-enterme.github.io/shoutlink/target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('src', 'sample.ts')}:1`)
    // check-links:ignore-next https://max-enterme.github.io/shoutlink/target.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('https://max-enterme.github.io/shoutlink/target.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare URLs: 他 repo の同じ docs パスは対象外', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'src/sample.ts': '"https://github.com/other/repo/blob/main/docs/missing.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 抽出済み範囲の除去を外すと、実在確認の件数が2件になり期待が落ちる。
  it('bare URLs: Markdown URL と内部パスを重複診断しない', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next https://github.com/max-enterme/shoutlink/blob/main/docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '[missing](https://github.com/max-enterme/shoutlink/blob/main/docs/missing.md)\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr.match(/\[実在確認\]/g)).toHaveLength(1)
  })

  // 検出根拠: 抽出済み範囲の除去を外すと、実在確認の件数が2件になり期待が落ちる。
  it('bare URLs: 裸 URL と内部パスを重複診断しない', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next https://github.com/max-enterme/shoutlink/blob/main/docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'https://github.com/max-enterme/shoutlink/blob/main/docs/missing.md\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr.match(/\[実在確認\]/g)).toHaveLength(1)
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare paths: README.md の不在パス', () => {
    const root = createFixtureRoot({
      'README.md':
        '[target](docs/target.md)\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('README.md')}:2`)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  // check-links:ignore-next docs/context.md -- フィクスチャ内だけに置く検査用の参照
  it('bare paths: docs/context.md の不在パス', () => {
    const root = createFixtureRoot({
      'README.md':
        '[target](docs/target.md)\n' +
        '[context](docs/context.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      // check-links:ignore-next docs/context.md -- フィクスチャ内だけに置く検査用の参照
      'docs/context.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('docs', 'context.md')}:1`)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare paths: specs/sample.md の不在パス', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'specs/sample.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('specs', 'sample.md')}:1`)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare paths: src/sample.ts の不在パス', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('src', 'sample.ts')}:1`)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare paths: tests/sample.ts の不在パス', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'tests/sample.ts':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${path.join('tests', 'sample.ts')}:1`)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: 実在する md', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
        'const ref = `docs/target.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: 実在アンカー', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next docs/target.md#見出し -- フィクスチャ内だけに置く検査用の参照
        'const ref = `docs/target.md#見出し`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: 行番号接尾辞', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next docs/target.md:42 -- フィクスチャ内だけに置く検査用の参照
        'const ref = `docs/target.md:42`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: アンカーと行番号', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next docs/target.md#見出し:42 -- フィクスチャ内だけに置く検査用の参照
        'const ref = `docs/target.md#見出し:42`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: ソース基準の ../docs', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next ../docs/target.md -- フィクスチャ内だけに置く検査用の参照
        'const ref = `../docs/target.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: 参照元基準の ./docs', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'CHANGELOG.md': '"./docs/target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare paths: 大小文字違い', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next docs/Target.md -- フィクスチャ内だけに置く検査用の参照
        '"docs/Target.md"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    // check-links:ignore-next docs/Target.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/Target.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('bare paths: 不在アンカー', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'src/sample.ts':
        // check-links:ignore-next docs/target.md#不在 -- フィクスチャ内だけに置く検査用の参照
        '"docs/target.md#不在"\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('#不在')
    expect(stderr).toContain('[見出しアンカー]')
  })

  // 検出根拠: 局所除外の処理を外すと、不在参照の診断が残って exit 0 の期待が落ちる。
  it('local ignore: specs/sample.md の直後1行を除外', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'specs/sample.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '<!-- check-links:ignore-next docs/missing.md -- 不在参照の検査例 -->\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 局所除外の処理を外すと、不在参照の診断が残って exit 0 の期待が落ちる。
  it('local ignore: src/sample.ts の直後1行を除外', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'src/sample.ts':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '// check-links:ignore-next docs/missing.md -- 不在参照の検査例\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 局所除外の処理を外すと、不在参照の診断が残って exit 0 の期待が落ちる。
  it('local ignore: scripts/sample.js の直後1行を除外', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'scripts/sample.js':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '// check-links:ignore-next docs/missing.md -- 不在参照の検査例\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 局所除外の処理を外すと、不在参照の診断が残って exit 0 の期待が落ちる。
  it('local ignore: scripts/sample.mjs の直後1行を除外', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'scripts/sample.mjs':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '// check-links:ignore-next docs/missing.md -- 不在参照の検査例\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 局所除外の処理を外すと、不在参照の診断が残って exit 0 の期待が落ちる。
  it('local ignore: .github/sample.yml の直後1行を除外', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      '.github/sample.yml':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '# check-links:ignore-next docs/missing.md -- 不在参照の検査例\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 局所除外の処理を外すと、不在参照の診断が残って exit 0 の期待が落ちる。
  it('local ignore: .github/sample.yaml の直後1行を除外', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      '.github/sample.yaml':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '# check-links:ignore-next docs/missing.md -- 不在参照の検査例\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 除外を別パス・後続行・フェンス外まで広げると、残るべき実在確認の期待が落ちる。
  it('local ignore: 次行の別パスは除外しない', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '<!-- check-links:ignore-next docs/missing.md -- 不在参照の検査例 -->\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`' +
        // check-links:ignore-next docs/other.md -- フィクスチャ内だけに置く検査用の参照
        ' `docs/other.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    // check-links:ignore-next docs/other.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/other.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 除外を別パス・後続行・フェンス外まで広げると、残るべき実在確認の期待が落ちる。
  it('local ignore: 2行後の同じパスは除外しない', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '<!-- check-links:ignore-next docs/missing.md -- 不在参照の検査例 -->\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('README.md:3')
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
    expect(stderr.match(/\[実在確認\]/g)).toHaveLength(1)
  })

  // 検出根拠: マーカーの形式・完全一致・使用先の検証を外すと、局所除外診断の期待が落ちる。
  it('local ignore: 空理由は違反', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '<!-- check-links:ignore-next docs/missing.md --  -->\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('[局所除外]')
  })

  // 検出根拠: マーカーの形式・完全一致・使用先の検証を外すと、局所除外診断の期待が落ちる。
  it('local ignore: 不正形式は違反', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '<!-- check-links:ignore-next docs/missing.md -->\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('[局所除外]')
  })

  // 検出根拠: マーカーの形式・完全一致・使用先の検証を外すと、局所除外診断の期待が落ちる。
  it('local ignore: 未使用は違反', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '<!-- check-links:ignore-next docs/missing.md -- 不在参照の検査例 -->\n' +
        '参照なし\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('README.md:1')
    expect(stderr).toContain('[局所除外]')
  })

  // 検出根拠: マーカーの形式・完全一致・使用先の検証を外すと、局所除外診断の期待が落ちる。
  it('local ignore: 空行を越えて効かない', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '<!-- check-links:ignore-next docs/missing.md -- 不在参照の検査例 -->\n' +
        '\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('README.md:3')
    expect(stderr).toContain('[局所除外]')
  })

  // 検出根拠: マーカーの形式・完全一致・使用先の検証を外すと、局所除外診断の期待が落ちる。
  it('local ignore: raw の部分一致では除外しない', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '<!-- check-links:ignore-next docs/missing.md -- 不在参照の検査例 -->\n' +
        // check-links:ignore-next docs/missing.md#別 -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md#別`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('[局所除外]')
  })

  // 検出根拠: 除外を別パス・後続行・フェンス外まで広げると、残るべき実在確認の期待が落ちる。
  it('local ignore: フェンス内のマーカーは効力なし', () => {
    const root = createFixtureRoot({
      'README.md':
        '```\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '<!-- check-links:ignore-next docs/missing.md -- 不在参照の検査例 -->\n' +
        '```\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('README.md:4')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('fence and glob: md フェンス内の不在パス', () => {
    const root = createFixtureRoot({
      'README.md':
        '```text\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'docs/missing.md\n' +
        '```\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('fence and glob: アスタリスク glob', () => {
    const root = createFixtureRoot({
      'README.md': '`docs/**/*.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('fence and glob: 疑問符 glob', () => {
    const root = createFixtureRoot({
      'README.md': '`docs/file?.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('fence and glob: フェンス外の具体的パス', () => {
    const root = createFixtureRoot({
      'README.md':
        '```text\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'docs/missing.md\n' +
        '```\n' +
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('README.md:4')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('fence and glob: ソースのバッククォート内も検査する', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'src/sample.ts':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'const ref = `docs/missing.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('fence and glob: ソースの正規表現サンプル', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'scripts/sample.mjs': 'const re = /docs\\/[^/]+\\.md/g\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 裸パス・追加範囲を到達判定へ数えると、孤立診断のアサーションが落ちる。
  it('orphan remains: README の裸パスでは到達扱いにしない', () => {
    const root = createFixtureRoot({
      'README.md':
        // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md`\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('[孤立]')
  })

  // 検出根拠: 裸パス・追加範囲を到達判定へ数えると、孤立診断のアサーションが落ちる。
  it('orphan remains: src/sample.ts の Markdown リンクでは救済しない', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n',
      'src/sample.ts':
        // check-links:ignore-next ../docs/target.md -- フィクスチャ内だけに置く検査用の参照
        '[target](../docs/target.md)\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('[孤立]')
  })

  // 検出根拠: 裸パス・追加範囲を到達判定へ数えると、孤立診断のアサーションが落ちる。
  it('orphan remains: tests/sample.ts の Markdown リンクでは救済しない', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n',
      'tests/sample.ts':
        // check-links:ignore-next ../docs/target.md -- フィクスチャ内だけに置く検査用の参照
        '[target](../docs/target.md)\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('[孤立]')
  })

  // 検出根拠: 裸パス・追加範囲を到達判定へ数えると、孤立診断のアサーションが落ちる。
  it('orphan remains: specs/sample.md の Markdown リンクでは救済しない', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n',
      'specs/sample.md':
        // check-links:ignore-next ../docs/target.md -- フィクスチャ内だけに置く検査用の参照
        '[target](../docs/target.md)\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    expect(stderr).toContain('[孤立]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('expanded sources: CHANGELOG.md の裸パスも検査する', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'CHANGELOG.md':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'docs/missing.md\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('expanded sources: scripts/sample.js の裸パスも検査する', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'scripts/sample.js':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'docs/missing.md\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('expanded sources: scripts/sample.mjs の裸パスも検査する', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'scripts/sample.mjs':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'docs/missing.md\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('expanded sources: .github/workflows/sample.yml の裸パスも検査する', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      '.github/workflows/sample.yml':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'docs/missing.md\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 対象の走査・抽出・実在またはアンカー検査を外すと、違反診断の期待が落ちる。
  it('expanded sources: .github/workflows/sample.yaml の裸パスも検査する', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      '.github/workflows/sample.yaml':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'docs/missing.md\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(1)
    // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
    expect(stderr).toContain('docs/missing.md')
    expect(stderr).toContain('[実在確認]')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('expanded sources: docs 外の一般リンクは検査しない', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'specs/sample.md': '[other](missing.ts)\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('expanded sources: 隠しディレクトリは走査しない', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'src/.hidden/sample.ts':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'docs/missing.md\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('expanded sources: node_modules は走査しない', () => {
    const root = createFixtureRoot({
      'README.md': '# Test\n',
      'src/node_modules/sample.ts':
        // check-links:ignore-next docs/missing.md -- フィクスチャ内だけに置く検査用の参照
        'docs/missing.md\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: README.md の 実在する md', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n' +
        // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md`\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: README.md の 実在アンカー', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n' +
        // check-links:ignore-next docs/target.md#見出し -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md#見出し`\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: README.md の 行番号接尾辞', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n' +
        // check-links:ignore-next docs/target.md:42 -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md:42`\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  // check-links:ignore-next docs/context.md -- フィクスチャ内だけに置く検査用の参照
  it('bare paths: docs/context.md の 実在する md', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n[context](docs/context.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      // check-links:ignore-next docs/context.md -- フィクスチャ内だけに置く検査用の参照
      'docs/context.md':
        // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  // check-links:ignore-next docs/context.md -- フィクスチャ内だけに置く検査用の参照
  it('bare paths: docs/context.md の 実在アンカー', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n[context](docs/context.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      // check-links:ignore-next docs/context.md -- フィクスチャ内だけに置く検査用の参照
      'docs/context.md':
        // check-links:ignore-next docs/target.md#見出し -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md#見出し`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  // check-links:ignore-next docs/context.md -- フィクスチャ内だけに置く検査用の参照
  it('bare paths: docs/context.md の 行番号接尾辞', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n[context](docs/context.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      // check-links:ignore-next docs/context.md -- フィクスチャ内だけに置く検査用の参照
      'docs/context.md':
        // check-links:ignore-next docs/target.md:42 -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md:42`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: specs/sample.md の 実在する md', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'specs/sample.md':
        // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: specs/sample.md の 実在アンカー', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'specs/sample.md':
        // check-links:ignore-next docs/target.md#見出し -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md#見出し`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: specs/sample.md の 行番号接尾辞', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'specs/sample.md':
        // check-links:ignore-next docs/target.md:42 -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md:42`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: tests/sample.ts の 実在する md', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'tests/sample.ts':
        // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: tests/sample.ts の 実在アンカー', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'tests/sample.ts':
        // check-links:ignore-next docs/target.md#見出し -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md#見出し`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 解決先・抽出除外を誤ると exit 0 の期待が落ちる（検査全削除は正例単独では検出できない）。
  it('bare paths: tests/sample.ts の 行番号接尾辞', () => {
    const root = createFixtureRoot({
      'README.md': '[target](docs/target.md)\n',
      // check-links:ignore-next docs/target.md -- フィクスチャ内だけに置く検査用の参照
      'docs/target.md': '# Target\n\n## 見出し\n',
      'tests/sample.ts':
        // check-links:ignore-next docs/target.md:42 -- フィクスチャ内だけに置く検査用の参照
        '`docs/target.md:42`\n',
    })
    const { status, stderr } = runCheckLinks(root)
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  // 検出根拠: 固定 URL の変更や公開2ファイルの削除で、集合・存在のアサーションが落ちる。
  it('fixed public targets: 提出文書の URL 集合と公開2ファイルを保持する', () => {
    const root = path.resolve(path.dirname(scriptPath), '..')
    const submission = readFileSync(path.join(root, 'docs/store-submission.md'), 'utf8')
    const urls = [...new Set(submission.match(/https?:\/\/[^\s`"'<>()[\]]+/g) ?? [])].sort()
    expect(urls).toEqual([
      'https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq',
      'https://developer.chrome.com/docs/webstore/program-policies/user-data-faq',
      'https://developer.chrome.com/docs/webstore/register',
      'https://github.com/max-enterme/shoutlink/blob/main/docs/privacy-policy.md',
      'https://github.com/max-enterme/shoutlink/issues',
      'https://max-enterme.github.io/shoutlink/',
      'https://max-enterme.github.io/shoutlink/privacy-policy.md',
    ].sort())
    expect(existsSync(path.join(root, 'docs/privacy-policy.md'))).toBe(true)
    expect(existsSync(path.join(root, 'docs/index.html'))).toBe(true)
  })
})
