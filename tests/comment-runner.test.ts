import { describe, expect, it } from 'vitest'
import { createCommentRunner } from '../src/comment-runner'
import type { CommentRunnerDeps } from '../src/comment-runner'
import type { CommentAuthor } from '../src/comment-detector'
import type { Directory, DirectoryEntry } from '../src/directory'
import type { PostLog } from '../src/post-log'
import { COMMENT_REPLY_INTERVAL_MS } from '../src/post-queue'
import { DEFAULT_CONFIG } from '../src/config'
import { FAKE_CHANNEL, FAKE_OTHER_CHANNEL } from './fixtures/live-chat'

const OWNER_ID = 'UCoooooooooooooooooooooo'
const AUTHOR_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const OTHER_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const STREAM = 'stream-1'

function entry(over: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    url: FAKE_CHANNEL.url,
    nickname: 'れい',
    message: '',
    replyToComment: true,
    commentMessage: '',
    channelId: AUTHOR_ID,
    lastSeenAt: 0,
    ...over,
  }
}

function author(over: Partial<CommentAuthor> = {}): CommentAuthor {
  return {
    channelId: AUTHOR_ID,
    ownerChannelId: OWNER_ID,
    ownerMatchedBy: 'video-id',
    authorType: '',
    timestampText: '5:17 PM',
    detectedAt: 0,
    ...over,
  }
}

type HarnessOptions = Partial<CommentRunnerDeps> & {
  /** この本文の投稿を失敗させる(`throw` するか `posted: false` を返すか) */
  failOn?: (text: string) => 'throw' | 'fail' | null
}

/** 依存をすべて偽物にした runner。**実 DOM も chrome も要らない** */
function harness(over: HarnessOptions = {}) {
  const { failOn, ...deps } = over
  let clock = 0
  const posted: string[] = []
  const logs: string[] = []
  let directory: Directory = [entry()]
  let postLog: PostLog = []
  let enabled = true
  /** 投稿の途中で何かを起こしたいとき用 */
  let duringPost: (() => void) | null = null

  const runner = createCommentRunner({
    isEnabled: () => enabled,
    getDirectory: () => directory,
    getPostLog: () => postLog,
    setPostLog: (next) => {
      postLog = next
    },
    getCommentTemplate: () => DEFAULT_CONFIG.commentTemplate,
    streamId: STREAM,
    now: () => clock,
    // 実時間で待たない。待った分だけ時計を進める
    wait: async (ms) => {
      clock += ms
    },
    post: async (text) => {
      duringPost?.()
      const mode = failOn?.(text) ?? null
      if (mode === 'throw') throw new Error('投稿でこけた')
      if (mode === 'fail') return { posted: false, element: null }
      posted.push(text)
      return { posted: true, element: null }
    },
    onLog: (message) => logs.push(message),
    ...deps,
  })

  return {
    runner,
    posted,
    logs,
    get postLog() {
      return postLog
    },
    setDirectory: (d: Directory) => {
      directory = d
    },
    setPostLogValue: (l: PostLog) => {
      postLog = l
    },
    setEnabled: (v: boolean) => {
      enabled = v
    },
    onDuringPost: (fn: (() => void) | null) => {
      duringPost = fn
    },
    advance: (ms: number) => {
      clock += ms
    },
    get clock() {
      return clock
    },
  }
}

describe('createCommentRunner — 投稿までの配線 (AC5 / AC7)', () => {
  it('対象のコメントを投稿する', async () => {
    const h = harness()
    h.runner.handle(author(), 'こんばんは')
    await h.runner.idle()

    expect(h.posted).toEqual([`れいさん、来てくれてありがとうございます! ${FAKE_CHANNEL.url}`])
  })

  it('**投稿できたら履歴に `kind: comment` で残す** (AC7 / AC8)', async () => {
    const h = harness()
    h.runner.handle(author(), 'こんばんは')
    await h.runner.idle()

    expect(h.postLog).toHaveLength(1)
    expect(h.postLog[0]).toMatchObject({ url: FAKE_CHANNEL.url, kind: 'comment', streamId: STREAM })
  })

  it('**同じ人が何度コメントしても投稿は 1 回** (AC7)', async () => {
    const h = harness()
    h.runner.handle(author(), '1 回目')
    await h.runner.idle()
    h.runner.handle(author(), '2 回目')
    await h.runner.idle()

    expect(h.posted).toHaveLength(1)
  })

  it('辞書に無い人には投稿しない (AC4)', async () => {
    const h = harness()
    h.runner.handle(author({ channelId: OTHER_ID }), 'こんばんは')
    await h.runner.idle()

    expect(h.posted).toEqual([])
  })

  it('**投稿に失敗したら履歴に残さない**(次に再挑戦できる)', async () => {
    const h = harness({ failOn: () => 'fail' })
    h.runner.handle(author(), 'こんばんは')
    await h.runner.idle()

    expect(h.postLog).toEqual([])
  })
})

describe('createCommentRunner — 自己ループの遮断 (AC10)', () => {
  it('**投稿した本文は「投稿の前」に覚える**(自分の投稿の検知が先に走っても間に合う)', async () => {
    const h = harness()
    let ownTextSeenDuringPost: string | null = null

    // 投稿の最中に「自分の投稿が検知された」状況を作る
    h.onDuringPost(() => {
      const text = `れいさん、来てくれてありがとうございます! ${FAKE_CHANNEL.url}`
      // このコメントが検知されたとして handle を通す
      h.runner.handle(author({ channelId: OTHER_ID }), text)
      ownTextSeenDuringPost = text
    })

    h.runner.handle(author(), 'こんばんは')
    await h.runner.idle()

    expect(ownTextSeenDuringPost).not.toBeNull()
    // **自分の投稿は積まれていない**(積まれていれば 2 件目の投稿が出る)
    expect(h.posted).toHaveLength(1)
  })

  it('**リダイレクト返礼の投稿も覚える**(コメント経路が自分の返礼に反応しない)', async () => {
    const h = harness()
    h.runner.rememberOwnPost('リダイレクトありがとうございます', null)
    h.runner.handle(author(), 'リダイレクトありがとうございます')
    await h.runner.idle()

    expect(h.posted).toEqual([])
  })

  it('**本文を含んでいれば自分の投稿とみなす**(`#message` が取れないときの受け皿)', async () => {
    const h = harness()
    h.runner.rememberOwnPost('ありがとうございます', null)
    // タイムスタンプや表示名が混ざったテキスト
    h.runner.handle(author(), '5:17 PM  じぶん  ありがとうございます')
    await h.runner.idle()

    expect(h.posted).toEqual([])
  })

  it('**投稿した要素は `isOwnElement` で分かる**(検知側が抽出の前に弾く / 1 枚目)', () => {
    const h = harness()
    const el = { tagName: 'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER' } as unknown as Element
    expect(h.runner.isOwnElement(el)).toBe(false)
    h.runner.rememberOwnPost('なにか', el)
    expect(h.runner.isOwnElement(el)).toBe(true)
  })

  it('配信者自身のコメントには反応しない (3 枚目)', async () => {
    const h = harness()
    h.runner.handle(author({ authorType: 'owner' }), 'こんばんは')
    await h.runner.idle()

    expect(h.posted).toEqual([])
  })
})

describe('createCommentRunner — スイッチ (AC1 / AC11)', () => {
  it('**OFF の間は投稿しない**', async () => {
    const h = harness()
    h.setEnabled(false)
    h.runner.handle(author(), 'こんばんは')
    await h.runner.idle()

    expect(h.posted).toEqual([])
  })

  it('**積んだ後に OFF にされたら、走っている 1 件も投稿しない** (AC1)', async () => {
    const h = harness()
    // 1 件目の投稿中に OFF にする
    h.onDuringPost(() => h.setEnabled(false))
    h.runner.handle(author(), 'こんばんは')
    h.runner.handle(author({ channelId: OTHER_ID }), 'こんばんは')
    await h.runner.idle()

    // 1 件目は走り出しているので出るが、2 件目は投稿の直前で止まる
    expect(h.posted).toHaveLength(1)
  })

  it('**clear() で未処理を捨てる** (AC11)', async () => {
    const h = harness()
    h.setDirectory([entry(), entry({ url: FAKE_OTHER_CHANNEL.url, channelId: OTHER_ID })])
    h.runner.handle(author(), 'こんばんは')
    h.runner.handle(author({ channelId: OTHER_ID }), 'こんばんは')
    h.runner.clear()
    await h.runner.idle()

    expect(h.posted).toHaveLength(1)
    expect(h.runner.pending).toBe(0)
  })
})

describe('createCommentRunner — 連投の抑制 (AC11)', () => {
  it('**2 人目以降は 5 秒の間隔を空ける**', async () => {
    const h = harness()
    h.setDirectory([entry(), entry({ url: FAKE_OTHER_CHANNEL.url, channelId: OTHER_ID })])

    h.runner.handle(author(), 'こんばんは')
    h.runner.handle(author({ channelId: OTHER_ID }), 'こんばんは')
    await h.runner.idle()

    expect(h.posted).toHaveLength(2)
    expect(h.clock).toBeGreaterThanOrEqual(COMMENT_REPLY_INTERVAL_MS)
  })

  it('**件数の上限は無い**(2026-09-05 に撤廃 / AC11 改訂)', async () => {
    const h = harness()
    // かつての上限 (20) を超えるコメント返しの履歴があっても、次の 1 件は投稿される
    h.setPostLogValue(
      Array.from({ length: 25 }, (_, i) => ({
        url: `https://www.youtube.com/@already-${i}`,
        handle: `@already-${i}`,
        text: 'まえの投稿',
        postedAt: 0,
        streamId: STREAM,
        kind: 'comment' as const,
      })),
    )

    h.runner.handle(author(), 'こんばんは')
    await h.runner.idle()

    expect(h.posted).toHaveLength(1)
    expect(h.logs.some((l) => l.includes('limit'))).toBe(false)
  })
})

describe('createCommentRunner — 例外 (AC12)', () => {
  it('**投稿が例外を投げても止まらない**(次の 1 件は処理される)', async () => {
    const h = harness({ failOn: (text) => (text.includes('れい') ? 'throw' : null) })
    h.setDirectory([entry(), entry({ url: FAKE_OTHER_CHANNEL.url, nickname: 'ほか', channelId: OTHER_ID })])

    h.runner.handle(author(), 'こんばんは')
    h.runner.handle(author({ channelId: OTHER_ID }), 'こんばんは')
    await expect(h.runner.idle()).resolves.toBeUndefined()

    expect(h.posted).toHaveLength(1)
    expect(h.logs.some((l) => l.includes('例外'))).toBe(true)
  })
})
