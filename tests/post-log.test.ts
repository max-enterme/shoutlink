import { describe, expect, it } from 'vitest'
import {
  POST_LOG_MAX_AGE_MS,
  POST_LOG_MAX_ENTRIES,
  currentStreamId,
  findLastPost,
  findPostInStream,
  makePostRecord,
  normalizePostLog,
  prunePostLog,
  rememberPost,
  streamIdFromUrl,
} from '../src/post-log'
import type { PostRecord } from '../src/post-log'
import type { RedirectEvent } from '../src/types'
import { FAKE_CHANNEL, FAKE_OTHER_CHANNEL } from './fixtures/live-chat'

function ev(url: string): RedirectEvent {
  return { sourceChannelName: 'x', sourceChannelUrl: url, detectedAt: 0 }
}

function rec(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    url: FAKE_CHANNEL.url,
    handle: FAKE_CHANNEL.handle,
    text: 'ありがとう',
    postedAt: 1_000,
    streamId: 'stream-1',
    ...overrides,
  }
}

describe('streamIdFromUrl', () => {
  it('live_chat の v= を配信 ID として取る', () => {
    expect(streamIdFromUrl('https://studio.youtube.com/live_chat?is_popout=1&v=abc123')).toBe(
      'abc123',
    )
  })

  it('v が無い / URL でない場合は空文字(同一配信の判定を諦める)', () => {
    expect(streamIdFromUrl('https://studio.youtube.com/live_chat?is_popout=1')).toBe('')
    expect(streamIdFromUrl('not a url')).toBe('')
  })
})

describe('currentStreamId', () => {
  /** content script が動くフレームの最小の模型 */
  function win(href: string, topHref?: string): Window {
    const self = { location: { href } } as unknown as Window
    const top = topHref == null ? self : ({ location: { href: topHref } } as unknown as Window)
    return { ...self, top } as unknown as Window
  }

  it('自分の URL の v= を最優先で使う(ポップアウト)', () => {
    expect(currentStreamId(win('https://studio.youtube.com/live_chat?is_popout=1&v=abc123'))).toBe(
      'abc123',
    )
  })

  it('埋め込みチャットで v= が無ければ、親フレームの管制室 URL から取る', () => {
    expect(
      currentStreamId(
        win(
          'https://studio.youtube.com/live_chat?continuation=xxx',
          'https://studio.youtube.com/video/abc123/livestreaming',
        ),
      ),
    ).toBe('abc123')
  })

  it('親フレームが読めない(クロスオリジン)場合は空文字', () => {
    const self = { location: { href: 'https://studio.youtube.com/live_chat' } }
    const blocked = {
      ...self,
      get top(): Window {
        throw new DOMException('cross-origin')
      },
    } as unknown as Window
    expect(currentStreamId(blocked)).toBe('')
  })

  it('どこからも取れなければ空文字', () => {
    expect(currentStreamId(win('https://studio.youtube.com/live_chat'))).toBe('')
  })
})

describe('makePostRecord', () => {
  it('送信元・文面・時刻・配信を記録する', () => {
    const record = makePostRecord(ev(FAKE_CHANNEL.url), 'ありがとう', {
      streamId: 'stream-1',
      postedAt: 5_000,
    })
    expect(record).toEqual({
      url: FAKE_CHANNEL.url,
      handle: FAKE_CHANNEL.handle,
      text: 'ありがとう',
      postedAt: 5_000,
      streamId: 'stream-1',
    })
  })
})

describe('rememberPost / findPostInStream', () => {
  it('同じ配信・同じ送信元は 1 件に上書きされる', () => {
    let log = rememberPost([], rec({ postedAt: 1_000, text: '1 回目' }))
    log = rememberPost(log, rec({ postedAt: 2_000, text: '2 回目' }))
    expect(log).toHaveLength(1)
    expect(log[0].text).toBe('2 回目')
  })

  it('配信が違えば別の記録として残る', () => {
    let log = rememberPost([], rec({ streamId: 'stream-1' }))
    log = rememberPost(log, rec({ streamId: 'stream-2', postedAt: 2_000 }))
    expect(log).toHaveLength(2)
    expect(findPostInStream(log, 'stream-1', FAKE_CHANNEL.url)?.postedAt).toBe(1_000)
    expect(findPostInStream(log, 'stream-2', FAKE_CHANNEL.url)?.postedAt).toBe(2_000)
  })

  it('送信元が違えば別の記録として残る', () => {
    let log = rememberPost([], rec())
    log = rememberPost(log, rec({ url: FAKE_OTHER_CHANNEL.url, handle: FAKE_OTHER_CHANNEL.handle }))
    expect(log).toHaveLength(2)
  })

  it('URL の大小文字・前後の空白の違いは同一送信元として扱う', () => {
    let log = rememberPost([], rec())
    log = rememberPost(log, rec({ url: `  ${FAKE_CHANNEL.url.toUpperCase()} `, postedAt: 2_000 }))
    expect(log).toHaveLength(1)
    expect(findPostInStream(log, 'stream-1', FAKE_CHANNEL.url)?.postedAt).toBe(2_000)
  })

  it('配信 ID が空なら「この配信で投稿済み」は判定しない', () => {
    const log = rememberPost([], rec({ streamId: '' }))
    expect(findPostInStream(log, '', FAKE_CHANNEL.url)).toBeUndefined()
  })
})

describe('findLastPost', () => {
  it('配信をまたいで最後の投稿を返す', () => {
    let log = rememberPost([], rec({ streamId: 'stream-1', postedAt: 1_000 }))
    log = rememberPost(log, rec({ streamId: 'stream-2', postedAt: 9_000 }))
    expect(findLastPost(log, FAKE_CHANNEL.url)?.postedAt).toBe(9_000)
  })

  it('記録が無ければ undefined', () => {
    expect(findLastPost([], FAKE_CHANNEL.url)).toBeUndefined()
  })
})

describe('prunePostLog', () => {
  it('古すぎる記録を捨てる', () => {
    const log = [rec({ postedAt: 0 })]
    expect(prunePostLog(log, POST_LOG_MAX_AGE_MS + 1)).toHaveLength(0)
    expect(prunePostLog(log, POST_LOG_MAX_AGE_MS - 1)).toHaveLength(1)
  })

  it('上限を超えたら新しい方から残す', () => {
    const log = Array.from({ length: POST_LOG_MAX_ENTRIES + 10 }, (_, i) =>
      rec({ streamId: `stream-${i}`, postedAt: i + 1 }),
    )
    const pruned = prunePostLog(log, POST_LOG_MAX_ENTRIES + 20)
    expect(pruned).toHaveLength(POST_LOG_MAX_ENTRIES)
    expect(pruned[0].postedAt).toBe(POST_LOG_MAX_ENTRIES + 10)
  })
})

describe('normalizePostLog (AC6)', () => {
  it('配列でない・壊れた値は落とす', () => {
    expect(normalizePostLog(null)).toEqual([])
    expect(normalizePostLog('x')).toEqual([])
    expect(normalizePostLog([null, {}, { url: '' }, { url: FAKE_CHANNEL.url }])).toEqual([])
  })

  it('欠けている項目を埋める', () => {
    const [record] = normalizePostLog([{ url: FAKE_CHANNEL.url, postedAt: 1_000 }])
    expect(record).toEqual({
      url: FAKE_CHANNEL.url,
      handle: FAKE_CHANNEL.handle,
      text: '',
      postedAt: 1_000,
      streamId: '',
    })
  })

  it('同じ配信・同じ送信元の重複は 1 件にする', () => {
    const log = normalizePostLog([rec({ text: '先' }), rec({ text: '後' })])
    expect(log).toHaveLength(1)
    expect(log[0].text).toBe('先')
  })
})
