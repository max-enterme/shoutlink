import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectRedirectEvents,
  extractRedirectEvent,
  normalizeChannelUrl,
} from '../src/detector'
import {
  FAKE_CHANNEL,
  makeChatMessage,
  makeRedirectNotice,
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
