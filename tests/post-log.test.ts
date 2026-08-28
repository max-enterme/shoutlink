import { afterEach, describe, expect, it } from 'vitest'
import {
  POST_LOG_MAX_AGE_MS,
  POST_LOG_MAX_ENTRIES,
  UNKNOWN_STREAM_WINDOW_SEC,
  countCommentPostsInStream,
  currentStreamId,
  findCommentReplyBlocker,
  findLastPost,
  findPostInStream,
  findRedirectReplyBlocker,
  makePostRecord,
  makePostRecordFor,
  normalizePostLog,
  onPostLogChanged,
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
    // 004 で種別が増えた。既存の観点はすべてリダイレクト返礼の話なので既定は 'redirect'
    kind: 'redirect',
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
      kind: 'redirect',
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
    expect(findPostInStream(log, 'stream-1', FAKE_CHANNEL.url, 'redirect')?.postedAt).toBe(1_000)
    expect(findPostInStream(log, 'stream-2', FAKE_CHANNEL.url, 'redirect')?.postedAt).toBe(2_000)
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
    expect(findPostInStream(log, 'stream-1', FAKE_CHANNEL.url, 'redirect')?.postedAt).toBe(2_000)
  })

  it('配信 ID が空なら「この配信で投稿済み」は判定しない', () => {
    const log = rememberPost([], rec({ streamId: '' }))
    expect(findPostInStream(log, '', FAKE_CHANNEL.url, 'redirect')).toBeUndefined()
  })
})

describe('findLastPost', () => {
  it('配信をまたいで最後の投稿を返す', () => {
    let log = rememberPost([], rec({ streamId: 'stream-1', postedAt: 1_000 }))
    log = rememberPost(log, rec({ streamId: 'stream-2', postedAt: 9_000 }))
    expect(findLastPost(log, FAKE_CHANNEL.url, 'redirect')?.postedAt).toBe(9_000)
  })

  it('記録が無ければ undefined', () => {
    expect(findLastPost([], FAKE_CHANNEL.url, 'redirect')).toBeUndefined()
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
      kind: 'redirect',
    })
  })

  it('同じ配信・同じ送信元の重複は 1 件にする', () => {
    const log = normalizePostLog([rec({ text: '先' }), rec({ text: '後' })])
    expect(log).toHaveLength(1)
    expect(log[0].text).toBe('先')
  })
})

// --- 004: 種別つきの抑止 -------------------------------------------------------

describe('kind (004 / AC14)', () => {
  it('既存の記録(kind を持たない)は redirect として読む', () => {
    const [record] = normalizePostLog([
      { url: FAKE_CHANNEL.url, postedAt: 1_000, streamId: 'stream-1' },
    ])
    expect(record.kind).toBe('redirect')
  })

  it("**'comment' に完全一致したときだけ comment**。それ以外はすべて redirect", () => {
    for (const kind of ['comment ', 'Comment', 'COMMENT', 'reply', 42, null, {}, true]) {
      expect(normalizePostLog([{ url: FAKE_CHANNEL.url, postedAt: 1, kind }])[0].kind).toBe('redirect')
    }
    expect(normalizePostLog([{ url: FAKE_CHANNEL.url, postedAt: 1, kind: 'comment' }])[0].kind).toBe(
      'comment',
    )
  })

  it('makePostRecord(リダイレクト返礼)は kind=redirect', () => {
    expect(makePostRecord(ev(FAKE_CHANNEL.url), 'x', { streamId: 's', postedAt: 1 }).kind).toBe(
      'redirect',
    )
  })

  it('makePostRecordFor は URL から記録を作れる(コメント経路には RedirectEvent が無い)', () => {
    const record = makePostRecordFor(FAKE_CHANNEL.url, 'ようこそ', {
      streamId: 's',
      postedAt: 5,
      kind: 'comment',
    })
    expect(record).toEqual({
      url: FAKE_CHANNEL.url,
      handle: FAKE_CHANNEL.handle,
      text: 'ようこそ',
      postedAt: 5,
      streamId: 's',
      kind: 'comment',
    })
  })

  it('同じ配信・同じ相手でも種別が違えば別の記録として残る (AC8)', () => {
    let log = rememberPost([], rec({ kind: 'redirect', text: '返礼' }))
    log = rememberPost(log, rec({ kind: 'comment', text: 'コメント返し', postedAt: 2_000 }))
    expect(log).toHaveLength(2)
    expect(findPostInStream(log, 'stream-1', FAKE_CHANNEL.url, 'redirect')?.text).toBe('返礼')
    expect(findPostInStream(log, 'stream-1', FAKE_CHANNEL.url, 'comment')?.text).toBe('コメント返し')
  })

  it('**コメント返しがリダイレクト返礼の記録を上書きしない**(上書きすると 001 の抑止が消える)', () => {
    let log = rememberPost([], rec({ kind: 'redirect', postedAt: 1_000 }))
    log = rememberPost(log, rec({ kind: 'comment', postedAt: 2_000 }))
    expect(findPostInStream(log, 'stream-1', FAKE_CHANNEL.url, 'redirect')?.postedAt).toBe(1_000)
  })

  it('findLastPost は種別をまたいで拾わない(切り分けログが嘘をつかない)', () => {
    const log = [rec({ kind: 'comment', postedAt: 9_000, streamId: 'stream-2' })]
    expect(findLastPost(log, FAKE_CHANNEL.url, 'redirect')).toBeUndefined()
    expect(findLastPost(log, FAKE_CHANNEL.url, 'comment')?.postedAt).toBe(9_000)
  })
})

describe('findRedirectReplyBlocker (AC1 / AC2 / AC3)', () => {
  const now = 10_000_000

  it('同じ配信・同じ相手にリダイレクト返礼の記録があれば止める', () => {
    const log = [rec({ kind: 'redirect', streamId: 'stream-1' })]
    expect(
      findRedirectReplyBlocker(log, { streamId: 'stream-1', url: FAKE_CHANNEL.url, now }),
    ).toBeDefined()
  })

  it('**同じ配信・同じ相手にコメント返しの記録しか無ければ止めない**(AC3 / 004 AC8)', () => {
    const log = [rec({ kind: 'comment', streamId: 'stream-1' })]
    expect(
      findRedirectReplyBlocker(log, { streamId: 'stream-1', url: FAKE_CHANNEL.url, now }),
    ).toBeUndefined()
  })

  it('配信が違えば止めない', () => {
    const log = [rec({ kind: 'redirect', streamId: 'stream-1' })]
    expect(
      findRedirectReplyBlocker(log, { streamId: 'stream-2', url: FAKE_CHANNEL.url, now }),
    ).toBeUndefined()
  })

  it('記録側の streamId が空なら、違う配信 ID で問い合わせても 6 時間以内は止める (AC2)', () => {
    const log = [rec({ kind: 'redirect', streamId: '', postedAt: now - 1_000 })]
    expect(
      findRedirectReplyBlocker(log, { streamId: 'stream-1', url: FAKE_CHANNEL.url, now }),
    ).toBeDefined()
  })

  it('問い合わせ側の streamId が空なら、6 時間以内の記録だけが止める (AC2)', () => {
    const within = now - UNKNOWN_STREAM_WINDOW_SEC * 1000 + 1
    const outside = now - UNKNOWN_STREAM_WINDOW_SEC * 1000 - 1
    expect(
      findRedirectReplyBlocker([rec({ kind: 'redirect', streamId: 'stream-1', postedAt: within })], {
        streamId: '',
        url: FAKE_CHANNEL.url,
        now,
      }),
    ).toBeDefined()
    expect(
      findRedirectReplyBlocker([rec({ kind: 'redirect', streamId: 'stream-1', postedAt: outside })], {
        streamId: '',
        url: FAKE_CHANNEL.url,
        now,
      }),
    ).toBeUndefined()
  })
})

describe('UNKNOWN_STREAM_WINDOW_SEC', () => {
  it('6 時間', () => {
    expect(UNKNOWN_STREAM_WINDOW_SEC).toBe(6 * 60 * 60)
  })
})

describe('findCommentReplyBlocker (AC7 / AC8)', () => {
  const now = 10_000_000

  it('同じ配信でコメント返し済みなら止める', () => {
    const log = [rec({ kind: 'comment', streamId: 'stream-1' })]
    expect(
      findCommentReplyBlocker(log, { streamId: 'stream-1', url: FAKE_CHANNEL.url, now }),
    ).toBeDefined()
  })

  it('**同じ配信でリダイレクト返礼済みでも止める**(非対称の前半 / AC8)', () => {
    const log = [rec({ kind: 'redirect', streamId: 'stream-1' })]
    expect(
      findCommentReplyBlocker(log, { streamId: 'stream-1', url: FAKE_CHANNEL.url, now }),
    ).toBeDefined()
  })

  it('配信が違えば止めない(別の出来事として 1 回投稿してよい)', () => {
    const log = [rec({ kind: 'comment', streamId: 'stream-1' })]
    expect(
      findCommentReplyBlocker(log, { streamId: 'stream-2', url: FAKE_CHANNEL.url, now }),
    ).toBeUndefined()
  })

  it('相手が違えば止めない', () => {
    const log = [rec({ kind: 'comment', streamId: 'stream-1' })]
    expect(
      findCommentReplyBlocker(log, { streamId: 'stream-1', url: FAKE_OTHER_CHANNEL.url, now }),
    ).toBeUndefined()
  })

  it('記録が無ければ止めない', () => {
    expect(
      findCommentReplyBlocker([], { streamId: 'stream-1', url: FAKE_CHANNEL.url, now }),
    ).toBeUndefined()
  })

  it('**配信 ID が空なら 6 時間の下限**で止める (AC7)', () => {
    const postedAt = now - UNKNOWN_STREAM_WINDOW_SEC * 1000 + 1
    const log = [rec({ kind: 'comment', streamId: '', postedAt })]
    expect(findCommentReplyBlocker(log, { streamId: '', url: FAKE_CHANNEL.url, now })).toBeDefined()
  })

  it('6 時間より古ければ止めない', () => {
    const postedAt = now - UNKNOWN_STREAM_WINDOW_SEC * 1000 - 1
    const log = [rec({ kind: 'comment', streamId: '', postedAt })]
    expect(findCommentReplyBlocker(log, { streamId: '', url: FAKE_CHANNEL.url, now })).toBeUndefined()
  })

  it('**配信 ID が空のまま残った記録も、ID が取れてから 6 時間は見る**(開き直しでの二重投稿)', () => {
    // 管制室の埋め込みチャット(ID が取れない)で投稿 → ポップアウト(ID が取れる)を開き直した状況
    const log = [rec({ kind: 'comment', streamId: '', postedAt: now - 1_000 })]
    expect(
      findCommentReplyBlocker(log, { streamId: 'stream-1', url: FAKE_CHANNEL.url, now }),
    ).toBeDefined()
  })

  it('配信 ID が空の記録でも、6 時間より古ければ止めない', () => {
    const postedAt = now - UNKNOWN_STREAM_WINDOW_SEC * 1000 - 1
    const log = [rec({ kind: 'comment', streamId: '', postedAt })]
    expect(
      findCommentReplyBlocker(log, { streamId: 'stream-1', url: FAKE_CHANNEL.url, now }),
    ).toBeUndefined()
  })

  it('**cooldownSec = 0 でも下限は外れない**(dedupe と独立していること)', () => {
    // findCommentReplyBlocker は cooldownSec を引数に取らない = 逃げ道が構造上ない
    const log = [rec({ kind: 'comment', streamId: '', postedAt: now - 1_000 })]
    expect(findCommentReplyBlocker(log, { streamId: '', url: FAKE_CHANNEL.url, now })).toBeDefined()
  })
})

describe('countCommentPostsInStream (AC11)', () => {
  const now = 10_000_000

  it('今の配信のコメント返しだけを数える', () => {
    const log = [
      rec({ kind: 'comment', streamId: 'stream-1' }),
      rec({ kind: 'comment', streamId: 'stream-1', url: FAKE_OTHER_CHANNEL.url }),
      rec({ kind: 'comment', streamId: 'stream-2' }),
      rec({ kind: 'redirect', streamId: 'stream-1' }),
    ]
    expect(countCommentPostsInStream(log, 'stream-1', now)).toBe(2)
  })

  it('**配信 ID が取れないときは直近 6 時間のコメント返しを数える**(上限を無効にしない)', () => {
    const log = [
      rec({ kind: 'comment', streamId: '', postedAt: now - 1_000 }),
      rec({ kind: 'comment', streamId: '', postedAt: now - 2_000, url: FAKE_OTHER_CHANNEL.url }),
      // 6 時間より古い / 種別が違うものは数えない
      rec({ kind: 'comment', streamId: '', postedAt: now - UNKNOWN_STREAM_WINDOW_SEC * 1000 - 1 }),
      rec({ kind: 'redirect', streamId: '', postedAt: now - 1_000 }),
    ]
    expect(countCommentPostsInStream(log, '', now)).toBe(2)
  })

  it('0 を返すと 20 件の上限が丸ごと無効になるので、そうしない', () => {
    const log = Array.from({ length: 25 }, (_, i) =>
      rec({ kind: 'comment', streamId: '', url: FAKE_CHANNEL.url + '/' + i, postedAt: now - i }),
    )
    expect(countCommentPostsInStream(log, '', now)).toBe(25)
  })
})

// --- 006: 履歴の購読 (AC14) -------------------------------------------------

const POST_LOG_KEY = 'ytRedirectPin.postLog'

type Store = Record<string, unknown>

function fakePostLogArea(store: Store): chrome.storage.StorageArea {
  return {
    async get(keys?: string | string[] | null): Promise<Store> {
      const names = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys]
      const out: Store = {}
      for (const name of names) if (name in store) out[name] = store[name]
      return out
    },
    async set(items: Store): Promise<void> {
      Object.assign(store, items)
    },
  } as unknown as chrome.storage.StorageArea
}

function stubChrome(local: Store, sync: Store): { listeners: Array<(...args: unknown[]) => void> } {
  const listeners: Array<(...args: unknown[]) => void> = []
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: fakePostLogArea(local),
      sync: fakePostLogArea(sync),
      onChanged: {
        addListener(listener: (...args: unknown[]) => void) {
          listeners.push(listener)
        },
        removeListener(listener: (...args: unknown[]) => void) {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        },
      },
    },
  }
  return { listeners }
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

describe('onPostLogChanged (AC14)', () => {
  it('chrome が無い環境では何もせず、解除関数を返す', () => {
    const handler = onPostLogChanged(() => {})
    expect(typeof handler).toBe('function')
    expect(() => handler()).not.toThrow()
  })

  it('自分のエリア(local)以外の onChanged では発火しない', () => {
    const { listeners } = stubChrome({}, {})
    const received: PostRecord[][] = []
    onPostLogChanged((next) => received.push(next))

    listeners[0]({ [POST_LOG_KEY]: { newValue: [rec()] } }, 'sync')

    expect(received).toHaveLength(0)
  })

  it('空配列に変わったとき、ハンドラに [] が渡る', () => {
    const { listeners } = stubChrome({}, {})
    const received: PostRecord[][] = []
    onPostLogChanged((next) => received.push(next))

    listeners[0]({ [POST_LOG_KEY]: { newValue: [] } }, 'local')

    expect(received).toEqual([[]])
  })
})

describe('prunePostLog — 件数の食い合い (plan.md R4)', () => {
  it('**コメント記録が上限を超えても、今の配信の redirect 記録が残る**', () => {
    const redirect = rec({ kind: 'redirect', streamId: 'stream-1', postedAt: 1 })
    const comments = Array.from({ length: POST_LOG_MAX_ENTRIES + 50 }, (_, i) =>
      rec({
        kind: 'comment',
        streamId: 'stream-1',
        url: FAKE_CHANNEL.url + '/' + i,
        postedAt: i + 10,
      }),
    )
    const pruned = prunePostLog([redirect, ...comments], POST_LOG_MAX_ENTRIES + 100)
    expect(pruned.some((entry) => entry.kind === 'redirect' && entry.streamId === 'stream-1')).toBe(
      true,
    )
    expect(pruned.filter((entry) => entry.kind === 'comment')).toHaveLength(POST_LOG_MAX_ENTRIES)
  })

  it('種別ごとの枠なので、リダイレクト側の上限は今までどおり', () => {
    const log = Array.from({ length: POST_LOG_MAX_ENTRIES + 10 }, (_, i) =>
      rec({ kind: 'redirect', streamId: 'stream-' + i, postedAt: i + 1 }),
    )
    expect(prunePostLog(log, POST_LOG_MAX_ENTRIES + 20)).toHaveLength(POST_LOG_MAX_ENTRIES)
  })
})
