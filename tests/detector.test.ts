import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectRedirectEvents,
  extractHandleFromText,
  extractRedirectEvent,
  normalizeChannelUrl,
} from '../src/detector'
import {
  FAKE_CHANNEL,
  FAKE_OTHER_CHANNEL,
  makeChatMessage,
  makeJoinNotice,
  makeRedirectNotice,
  makeWelcomeMessage,
  mountChatShell,
} from './fixtures/live-chat'

describe('normalizeChannelUrl', () => {
  it('相対の @ハンドルを絶対 URL に正規化する', () => {
    expect(normalizeChannelUrl('/@example-channel')).toBe('https://www.youtube.com/@example-channel')
  })

  it('@ハンドルだけでも受ける', () => {
    expect(normalizeChannelUrl('@example-channel')).toBe('https://www.youtube.com/@example-channel')
  })

  it('/channel/UC... を受ける', () => {
    expect(normalizeChannelUrl(`/channel/${FAKE_CHANNEL.channelId}`)).toBe(
      `https://www.youtube.com/channel/${FAKE_CHANNEL.channelId}`,
    )
  })

  it('クエリ・ハッシュ・サブドメインの違いを落とす', () => {
    expect(normalizeChannelUrl('https://m.youtube.com/@example-channel?si=abc#x')).toBe(
      'https://www.youtube.com/@example-channel',
    )
  })

  it('チャンネル以外の URL は null', () => {
    expect(normalizeChannelUrl('https://www.youtube.com/watch?v=abc')).toBeNull()
    expect(normalizeChannelUrl('https://example.com/@example-channel')).toBeNull()
    expect(normalizeChannelUrl('')).toBeNull()
    expect(normalizeChannelUrl(null)).toBeNull()
  })
})

describe('extractHandleFromText', () => {
  it('通知文から @ハンドル を拾う', () => {
    expect(extractHandleFromText('@example-channel とその視聴者が参加しました。挨拶しましょう')).toBe(
      '@example-channel',
    )
  })

  it('ハンドルが無ければ null', () => {
    expect(extractHandleFromText('視聴者が参加しました')).toBeNull()
  })
})

// 2026-08-05 に実配信で確認した本物の通知の形。
// 「リダイレクト」という語を含まないため、当初のパターンでは検知できなかった。
describe('参加通知 (実配信で確認した文言)', () => {
  it('ハンドルがテキストだけでも送信元を取り出せる', () => {
    const event = extractRedirectEvent(makeJoinNotice(), 5)
    expect(event).toEqual({
      sourceChannelName: FAKE_CHANNEL.handle,
      sourceChannelUrl: FAKE_CHANNEL.url,
      detectedAt: 5,
      origin: 'auto',
    })
  })

  it('ハンドルがリンクになっていても取り出せる', () => {
    const event = extractRedirectEvent(makeJoinNotice({ withLink: true }), 5)
    expect(event?.sourceChannelUrl).toBe(FAKE_CHANNEL.url)
  })

  it('チャット項目リストの中に混じっていても拾う', () => {
    const wrapper = document.createElement('div')
    wrapper.appendChild(makeWelcomeMessage())
    wrapper.appendChild(makeChatMessage('こんばんは'))
    wrapper.appendChild(makeJoinNotice())
    expect(collectRedirectEvents(wrapper, 1)).toHaveLength(1)
  })

  // 回帰テスト: 2026-08-05 の実配信での事故。
  // チャット項目リスト全体が 1 要素として渡され、「リスト全体のテキスト」が文言に一致した結果、
  // リスト内の無関係な @ハンドル(自分自身のもの)を送信元として投稿してしまった。
  it('リスト全体を渡されても、リスト内の別の @ハンドル を送信元にしない', () => {
    const items = document.createElement('div')
    items.id = 'items'
    items.appendChild(makeChatMessage(`${FAKE_OTHER_CHANNEL.handle} こんばんは`))
    items.appendChild(makeChatMessage('配信ありがとう'))
    items.appendChild(makeJoinNotice({ handle: FAKE_CHANNEL.handle }))

    const events = collectRedirectEvents(items, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.sourceChannelUrl).toBe(FAKE_CHANNEL.url)
    expect(events[0]?.sourceChannelUrl).not.toBe(FAKE_OTHER_CHANNEL.url)
  })

  it('長いテキストの塊は通知とみなさない', () => {
    const container = document.createElement('div')
    container.textContent = `${'あ'.repeat(400)} ${FAKE_CHANNEL.handle} とその視聴者が参加しました`
    expect(extractRedirectEvent(container, 1)).toBeNull()
  })
})

describe('extractRedirectEvent', () => {
  it('通知ノードから送信元の表示名と URL を取り出す', () => {
    const event = extractRedirectEvent(makeRedirectNotice(), 1000)
    expect(event).toEqual({
      sourceChannelName: FAKE_CHANNEL.name,
      sourceChannelUrl: FAKE_CHANNEL.url,
      detectedAt: 1000,
      origin: 'auto',
    })
  })

  it('href が /channel/UC... 形式でも取り出せる', () => {
    const event = extractRedirectEvent(
      makeRedirectNotice({ href: `/channel/${FAKE_CHANNEL.channelId}` }),
      1,
    )
    expect(event?.sourceChannelUrl).toBe(`https://www.youtube.com/channel/${FAKE_CHANNEL.channelId}`)
  })

  it('表示名が取れないときは URL のハンドルで代替する', () => {
    const notice = makeRedirectNotice({ name: '' })
    expect(extractRedirectEvent(notice, 1)?.sourceChannelName).toBe(FAKE_CHANNEL.handle)
  })

  it('送信元 URL が取れない通知は捨てる (AC2 を満たせないため)', () => {
    const notice = makeRedirectNotice({ href: '/watch?v=abc' })
    expect(extractRedirectEvent(notice, 1)).toBeNull()
  })

  it('「リダイレクト」と書いただけの視聴者コメントは拾わない', () => {
    const message = makeChatMessage('リダイレクトありがとう <a href="/@example-channel">link</a>')
    expect(extractRedirectEvent(message, 1)).toBeNull()
  })

  // 回帰テスト: 2026-08-05 に実 DOM で確認。「ライブ チャットへようこそ」の常設メッセージは
  // リダイレクト通知と同じ yt-live-chat-viewer-engagement-message-renderer で出ている。
  it('常設の「ライブ チャットへようこそ」を通知として拾わない', () => {
    expect(extractRedirectEvent(makeWelcomeMessage(), 1)).toBeNull()
  })

  it('システムメッセージでも、リダイレクトの文言が無ければ拾わない', () => {
    const notice = makeRedirectNotice({ text: 'メンバーシップに登録しました' })
    expect(extractRedirectEvent(notice, 1)).toBeNull()
  })
})

describe('collectRedirectEvents', () => {
  beforeEach(() => {
    mountChatShell()
  })

  it('追加ノードが親要素でも、子孫の通知を拾う', () => {
    const wrapper = document.createElement('div')
    wrapper.appendChild(makeChatMessage('こんにちは'))
    wrapper.appendChild(makeRedirectNotice())

    const events = collectRedirectEvents(wrapper, 42)
    expect(events).toHaveLength(1)
    expect(events[0]?.sourceChannelUrl).toBe(FAKE_CHANNEL.url)
    expect(events[0]?.detectedAt).toBe(42)
  })

  it('通知が無ければ空', () => {
    const wrapper = document.createElement('div')
    wrapper.appendChild(makeChatMessage('こんにちは'))
    expect(collectRedirectEvents(wrapper, 1)).toEqual([])
  })

  it('要素以外のノードは無視する', () => {
    expect(collectRedirectEvents(document.createTextNode('リダイレクト'), 1)).toEqual([])
  })
})
