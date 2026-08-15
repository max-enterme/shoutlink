import { describe, expect, it } from 'vitest'
import { channelIdFromUrl, extractChannelId, resolveChannelId } from '../src/channel-id'

const ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const OTHER = 'UCbbbbbbbbbbbbbbbbbbbbbb'

const canonical = (id: string) =>
  `<link rel="canonical" href="https://www.youtube.com/channel/${id}">`
const ogUrl = (id: string) =>
  `<meta property="og:url" content="https://www.youtube.com/channel/${id}">`
const itemprop = (id: string) => `<meta itemprop="identifier" content="${id}">`

/** 実際のチャンネルページには**他人の `UC…` が大量に載っている**ことの再現 */
const NOISE = `
  <script>var ytInitialData = {"contents":[
    {"channelId":"UCzzzzzzzzzzzzzzzzzzzzzz","title":"関連チャンネル"},
    {"channelId":"UCyyyyyyyyyyyyyyyyyyyyyy","title":"動画の投稿者"}
  ]};</script>
`

describe('extractChannelId (AC17)', () => {
  it('canonical から取れる', () => {
    const result = extractChannelId(`<html><head>${canonical(ID)}</head></html>`)
    expect(result).toEqual({ ok: true, channelId: ID, sources: ['canonical'] })
  })

  it('og:url から取れる', () => {
    const result = extractChannelId(`<html><head>${ogUrl(ID)}</head></html>`)
    expect(result.ok && result.channelId).toBe(ID)
  })

  it('itemprop=identifier から取れる', () => {
    const result = extractChannelId(`<html><head>${itemprop(ID)}</head></html>`)
    expect(result.ok && result.channelId).toBe(ID)
  })

  it('externalId から取れる', () => {
    const result = extractChannelId(`<html>{"externalId":"${ID}"}</html>`)
    expect(result.ok && result.channelId).toBe(ID)
  })

  it('**他人の UC が大量にあっても、ページ自身の ID だけを採る**', () => {
    const html = `<html><head>${canonical(ID)}</head><body>${NOISE}</body></html>`
    const result = extractChannelId(html)
    expect(result.ok && result.channelId).toBe(ID)
  })

  it('複数の出所が一致していれば通す', () => {
    const html = `<html><head>${canonical(ID)}${ogUrl(ID)}${itemprop(ID)}</head></html>`
    const result = extractChannelId(html)
    expect(result.ok && result.channelId).toBe(ID)
    expect(result.sources).toHaveLength(3)
  })

  it('**出所が食い違ったら失敗**(推測で選ばない)', () => {
    const html = `<html><head>${canonical(ID)}${ogUrl(OTHER)}</head></html>`
    const result = extractChannelId(html)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('候補が複数')
  })

  it('1 つも無ければ失敗', () => {
    expect(extractChannelId('<html><body>なにもない</body></html>').ok).toBe(false)
  })

  it('**汎用の "channelId" キーは見ない**(関連チャンネルを拾ってしまうため)', () => {
    const result = extractChannelId(`<html><body>${NOISE}</body></html>`)
    expect(result.ok).toBe(false)
  })

  it('短すぎる / 形が違う値は拾わない', () => {
    expect(extractChannelId('<link rel="canonical" href="/channel/UCshort">').ok).toBe(false)
    expect(extractChannelId('<meta itemprop="identifier" content="XXnotachannel">').ok).toBe(false)
  })

  it('空文字でも落ちない', () => {
    expect(extractChannelId('').ok).toBe(false)
  })
})

describe('channelIdFromUrl (AC17)', () => {
  it('`/channel/UC…` 形はその場で決まる', () => {
    expect(channelIdFromUrl(`https://www.youtube.com/channel/${ID}`)).toBe(ID)
    expect(channelIdFromUrl(`https://www.youtube.com/channel/${ID}/videos`)).toBe(ID)
  })

  it('`@handle` 形は決まらない(取得が要る)', () => {
    expect(channelIdFromUrl('https://www.youtube.com/@example')).toBeNull()
  })

  it('legacy 形も決まらない', () => {
    expect(channelIdFromUrl('https://www.youtube.com/c/example')).toBeNull()
    expect(channelIdFromUrl('https://www.youtube.com/user/example')).toBeNull()
  })
})

/** テスト用の偽 fetch。**実際のネットワークには触らない** */
function fakeFetch(body: string, init: { ok?: boolean; status?: number } = {}) {
  const calls: string[] = []
  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      text: async () => body,
    } as Response
  }) as typeof fetch
  return { impl, calls }
}

describe('resolveChannelId (AC17)', () => {
  it('取得して解決できる', async () => {
    const { impl, calls } = fakeFetch(`<html><head>${canonical(ID)}</head></html>`)
    const result = await resolveChannelId('https://www.youtube.com/@example', { fetchImpl: impl })
    expect(result).toEqual({ status: 'resolved', channelId: ID })
    expect(calls).toEqual(['https://www.youtube.com/@example'])
  })

  it('**`/channel/UC…` 形は取得しない**(その場で決まる)', async () => {
    const { impl, calls } = fakeFetch('')
    const result = await resolveChannelId(`https://www.youtube.com/channel/${ID}`, {
      fetchImpl: impl,
    })
    expect(result).toEqual({ status: 'already', channelId: ID })
    expect(calls).toEqual([])
  })

  it('**legacy 形も `entry.url` をそのまま取りに行く**(鍵は 3 形ありうる)', async () => {
    const { impl, calls } = fakeFetch(`<html><head>${canonical(ID)}</head></html>`)
    const result = await resolveChannelId('https://www.youtube.com/c/example', { fetchImpl: impl })
    expect(result).toEqual({ status: 'resolved', channelId: ID })
    expect(calls).toEqual(['https://www.youtube.com/c/example'])
  })

  it('**HTTP エラーでも例外を投げず、理由を返す**', async () => {
    const { impl } = fakeFetch('', { ok: false, status: 404 })
    const result = await resolveChannelId('https://www.youtube.com/@example', { fetchImpl: impl })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toContain('404')
  })

  it('**通信が例外を投げても握って理由を返す**', async () => {
    const impl = (async () => {
      throw new Error('ネットワークが死んだ')
    }) as unknown as typeof fetch
    const result = await resolveChannelId('https://www.youtube.com/@example', { fetchImpl: impl })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toContain('ネットワークが死んだ')
  })

  it('ページに ID が無ければ理由を返す(空のままにする)', async () => {
    const { impl } = fakeFetch('<html><body>なにもない</body></html>')
    const result = await resolveChannelId('https://www.youtube.com/@example', { fetchImpl: impl })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toContain('見つからない')
  })

  it('出所が食い違うページは解決しない(**推測で埋めない**)', async () => {
    const { impl } = fakeFetch(`<html><head>${canonical(ID)}${ogUrl(OTHER)}</head></html>`)
    const result = await resolveChannelId('https://www.youtube.com/@example', { fetchImpl: impl })
    expect(result.status).toBe('failed')
  })

  it('読む量を上限で切っても、先頭にある metadata なら拾える', async () => {
    const { impl } = fakeFetch(`<html><head>${canonical(ID)}</head><body>${'x'.repeat(5000)}</body>`)
    const result = await resolveChannelId('https://www.youtube.com/@example', {
      fetchImpl: impl,
      maxBytes: 200,
    })
    expect(result).toEqual({ status: 'resolved', channelId: ID })
  })
})
