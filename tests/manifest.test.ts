import { describe, expect, it } from 'vitest'
import manifestJson from '../public/manifest.json'

/**
 * **manifest の中身そのものを固定する回帰テスト。**
 *
 * ⚠️ 2026-08-06 の事故 1: content script が `www.youtube.com` にも注入されていたため、
 *    **他人の配信のチャットを開いているだけで動いた**([docs/security-review.md](../docs/security-review.md))。
 *    再発防止はこれまで **`tests/scope.test.ts`(実行時の判定)と文書だけ**で、
 *    **manifest の注入範囲を固定するテストが無かった。**
 *
 * 004 で `host_permissions` に `https://www.youtube.com/*` を足す(fetch 用 / AC17)ため、
 * **「権限は増えたが注入範囲は増えていない」ことを機械で押さえる。**
 */
const manifest = manifestJson as {
  permissions: string[]
  host_permissions: string[]
  content_scripts: { matches: string[]; js?: string[]; world?: string; all_frames?: boolean }[]
  optional_permissions?: string[]
  optional_host_permissions?: string[]
  web_accessible_resources?: unknown[]
}

describe('manifest.json — 注入範囲 (事故 1 の再発防止)', () => {
  it('**content script を注入するのは Studio のライブチャットだけ**', () => {
    expect(manifest.content_scripts).toHaveLength(1)
    expect(manifest.content_scripts[0].matches).toEqual(['https://studio.youtube.com/live_chat*'])
  })

  it('**`www.youtube.com` に content script を注入しない**', () => {
    const matches = manifest.content_scripts.flatMap((cs) => cs.matches)
    for (const pattern of matches) {
      expect(pattern).not.toContain('www.youtube.com')
      // `*://*/*` のような広いパターンも入れない
      expect(pattern.startsWith('https://studio.youtube.com/')).toBe(true)
    }
  })

  it('content script の対象が 1 つも増えていない(数で固定する)', () => {
    expect(manifest.content_scripts.flatMap((cs) => cs.matches)).toHaveLength(1)
  })

  it('**メインワールドへ注入しない**(spec.md D1 の決定)', () => {
    // `world: "MAIN"` にすると、ページと同じ文脈でスクリプトが動く。
    // T1 の結果、投稿者は DOM 属性から取れるので注入する理由が無い
    for (const cs of manifest.content_scripts) {
      expect(cs.world).toBeUndefined()
    }
  })

  it('注入するファイルは content.js だけ', () => {
    expect(manifest.content_scripts[0].js).toEqual(['content.js'])
  })

  it('**ページ側から拡張のリソースを読めるようにしない**', () => {
    // `web_accessible_resources` はページ文脈へ露出する経路になる
    expect(manifest.web_accessible_resources).toBeUndefined()
  })
})

describe('manifest.json — 権限 (AC17)', () => {
  it('`www.youtube.com` への host 権限がある(`channelId` の解決に使う)', () => {
    expect(manifest.host_permissions).toContain('https://www.youtube.com/*')
  })

  it('host 権限は YouTube の 2 つだけ', () => {
    expect([...manifest.host_permissions].sort()).toEqual([
      'https://studio.youtube.com/*',
      'https://www.youtube.com/*',
    ])
  })

  it('API 権限は storage だけ(増やさない)', () => {
    expect(manifest.permissions).toEqual(['storage'])
  })

  it('**あとから広げられる権限も宣言しない**', () => {
    // `optional_*` があると「host 権限は YouTube の 2 つだけ」が実質破れる
    expect(manifest.optional_permissions).toBeUndefined()
    expect(manifest.optional_host_permissions).toBeUndefined()
  })
})
