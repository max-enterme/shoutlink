import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectRedirectEvents,
  collectUnextractableNotices,
  extractHandleFromText,
  extractRedirectEvent,
  isSameChannel,
  normalizeChannelUrl,
} from '../src/detector'
import { REDIRECT_TEXT_PATTERNS } from '../src/selectors'
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

describe('isSameChannel', () => {
  it('URL とハンドルの表記違いを同一とみなす', () => {
    expect(isSameChannel(FAKE_CHANNEL.handle, FAKE_CHANNEL.url)).toBe(true)
    expect(isSameChannel(FAKE_CHANNEL.url.toUpperCase(), FAKE_CHANNEL.url)).toBe(true)
  })

  it('別のチャンネルは false', () => {
    expect(isSameChannel(FAKE_CHANNEL.url, FAKE_OTHER_CHANNEL.url)).toBe(false)
  })

  it('未設定(空)は常に false', () => {
    expect(isSameChannel('', FAKE_CHANNEL.url)).toBe(false)
    expect(isSameChannel(undefined, FAKE_CHANNEL.url)).toBe(false)
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

  // 回帰テスト: 2026-08-05。ハンドルが日本語のことがあり、ASCII 限定の正規表現では
  // 一文字も当たらず、通知を検知しても送信元が取れずに捨てていた。
  it('日本語のハンドルも拾う', () => {
    expect(extractHandleFromText('@あいうえお とその視聴者が参加しました。挨拶しましょう。')).toBe(
      '@あいうえお',
    )
  })

  it('末尾の句読点はハンドルに含めない', () => {
    expect(extractHandleFromText('@あいうえお。')).toBe('@あいうえお')
  })
})

describe('collectUnextractableNotices (診断用)', () => {
  it('通知らしいのに送信元が取れない要素を報告する', () => {
    const notice = document.createElement('div')
    notice.textContent = 'とその視聴者が参加しました。挨拶しましょう。'
    const misses = collectUnextractableNotices(notice)
    expect(misses).toHaveLength(1)
    expect(misses[0]?.text).toContain('参加しました')
  })

  it('送信元が取れる通知は報告しない', () => {
    expect(collectUnextractableNotices(makeJoinNotice())).toEqual([])
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

  it('日本語のハンドルの通知から送信元を取り出せる', () => {
    const event = extractRedirectEvent(makeJoinNotice({ handle: '@あいうえお' }), 5)
    expect(event?.sourceChannelUrl).toBe('https://www.youtube.com/@あいうえお')
    expect(event?.sourceChannelName).toBe('@あいうえお')
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

  // 回帰テスト: 2026-08-05 の実配信での事故 (2 件目)。
  // 返礼文には「リダイレクト」とチャンネル URL が両方入るため、メッセージの内側の要素を
  // 単独で見ると通知の条件を満たし、**自分の投稿を検知して再投稿する**ループになっていた。
  it('自分が投稿した返礼メッセージを通知として検知しない', () => {
    const items = document.createElement('div')
    const posted = makeChatMessage(
      `${FAKE_CHANNEL.handle}さんからリダイレクトありがとうございます! ${FAKE_CHANNEL.url}`,
      'me',
    )
    items.appendChild(posted)

    expect(collectRedirectEvents(items, 1)).toEqual([])
    // メッセージの内側の要素を直接渡しても検知しない
    const inner = posted.querySelector('#message')!
    expect(extractRedirectEvent(inner, 1)).toBeNull()
  })

  // 回帰テスト: 2026-08-06 の事故。
  // リダイレクトを **送った** 側にもバナーが出る。そこに載っている @ハンドル は
  // 送信先(自分ではない)なので、これを通知として拾うと逆向きに投稿してしまう。
  it('送信側のバナー(視聴を促進しましょう)を通知として拾わない', () => {
    const banner = document.createElement('yt-live-chat-banner-renderer')
    banner.textContent = `この機会に、${FAKE_CHANNEL.handle} のコンテンツの視聴を促進しましょう`
    expect(extractRedirectEvent(banner, 1)).toBeNull()
    expect(collectRedirectEvents(banner, 1)).toEqual([])
  })

  // 「なぜテキストのパターンマッチングで足りるのか」の根拠。
  // 送信側バナーの文言は、そもそも通知の文言パターンに一つも当たらない。
  // 2026-08-06 に発火したのは、推測で置いた要素セレクタが文言チェックを飛ばしていたため。
  it('送信側バナーの文言は、除外リストが無くても通知パターンに当たらない', () => {
    const text = `この機会に、${FAKE_CHANNEL.handle} のコンテンツの視聴を促進しましょう`
    expect(REDIRECT_TEXT_PATTERNS.some((pattern) => pattern.test(text))).toBe(false)
  })

  it('クラス名に redirect を含むだけの要素は、文言が合わなければ拾わない', () => {
    const banner = document.createElement('div')
    banner.className = 'yt-live-chat-banner-redirect-renderer'
    banner.textContent = `この機会に、${FAKE_CHANNEL.handle} のコンテンツの視聴を促進しましょう`
    expect(extractRedirectEvent(banner, 1)).toBeNull()
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

  // 回帰テスト: 通知はチャット項目リスト (#items) の外に出る。
  // 起動時の走査を #items に絞っていたため、ページを開き直したときに
  // 既に出ている通知を一切拾えなかった (2026-08-05)。
  it('チャット項目リストの外に出た通知も、body から走査すれば拾える', () => {
    const { items } = mountChatShell()
    items.appendChild(makeChatMessage('こんばんは'))
    // 項目リストではなくバナー領域に通知が出るケース
    document.querySelector('#visible-banners')!.appendChild(makeJoinNotice())

    expect(collectRedirectEvents(items, 1)).toEqual([])
    const fromBody = collectRedirectEvents(document.body, 1)
    expect(fromBody).toHaveLength(1)
    expect(fromBody[0]?.sourceChannelUrl).toBe(FAKE_CHANNEL.url)
  })
})
