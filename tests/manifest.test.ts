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
  key?: string
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

/**
 * **`key` が消えると、配布した全員の設定が次の更新で消える。**
 *
 * パッケージ化されていない拡張の ID は、`key` が無いと**読み込んだフォルダのパス**から決まる。
 * 設定 (`chrome.storage.sync`) と呼び名の辞書・投稿履歴 (`chrome.storage.local`) は
 * **ID に紐づく**ので、版ごとに別フォルダへ展開する配布の形では
 * **更新のたびに空の拡張が増える**(しかも古い版が残っていると**二重投稿**する)。
 *
 * `key` を置くと ID がパスに依らず固定され、
 * **どこへ展開しても設定が残り、古い版を消し忘れたら Chrome が同じ ID として弾く。**
 *
 * ⚠️ **消したこと・変えたことに気づける手段がここしか無い。**
 *    壊れても**手元では何も起きない**(開発機は同じフォルダを読み続けるため)。
 *    気づくのは、配った相手の設定が消えたときになる。
 */
describe('manifest.json — 拡張 ID の固定 (更新で設定を消さない)', () => {
  it('**`key` がある**', () => {
    expect(typeof manifest.key).toBe('string')
    expect(manifest.key && manifest.key.length).toBeGreaterThan(300)
  })

  it('**`key` を変えない** — 変えると ID が変わり、既存の利用者の設定が切り離される', () => {
    // 2026-08-17 に生成した公開鍵。この鍵から決まる拡張 ID は
    // `bfmfamnekclamfdjbfndmomljgneejgo`
    // (公開鍵 DER の SHA-256 の先頭 16 バイトを a〜p に写したもの)。
    // **この値を更新しない** — 更新が要るのは鍵を作り直すと決めたとき = 全員の設定を捨てるときだけ
    expect(manifest.key).toBe(
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlV9451W8agKwrcppxtPhPkRZ7lVl7horDr8tjC96keVPyxTXowsNvchcmIgslT+o8e5ksg90eEQBZRyI66Wz8Pqu9cQ5wKgK/48Zu/thw21lZ8ewnCTRzWzjiglUDShewGMVSF9FKOf9jPWrEjjASSLjWW10jC4h2UxZF/twDANnix1Lh+X3lD3S22HdwSl4L/xckzdD7e0bNCeC/crjETDtNVOM370yAroccQGC8TiIWoftdkvM9kWVBsHKbS3pVIxQpzrJir1BfRM+06e6iaVVFQPWPxkbG285agJld3JsIzGj8buu16Mdh7UM/jAbmx8k+qgXaGZx9aaUYoc5MQIDAQAB',
    )
  })
})
