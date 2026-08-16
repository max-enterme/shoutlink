import { describe, expect, it } from 'vitest'
import { decideCommentReply } from '../src/comment-reply'
import type { DecideParams } from '../src/comment-reply'
import type { CommentAuthor } from '../src/comment-detector'
import type { Directory, DirectoryEntry } from '../src/directory'
import type { PostLog, PostRecord } from '../src/post-log'
import { UNKNOWN_STREAM_MIN_COOLDOWN_SEC } from '../src/dedupe'
import { DEFAULT_CONFIG } from '../src/config'
import { FAKE_CHANNEL, FAKE_OTHER_CHANNEL } from './fixtures/live-chat'

const OWNER_ID = 'UCoooooooooooooooooooooo'
const AUTHOR_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const OTHER_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const STREAM = 'stream-1'
const NOW = 10_000_000

function entry(over: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    url: FAKE_CHANNEL.url,
    nickname: '',
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
    detectedAt: NOW,
    ...over,
  }
}

function record(over: Partial<PostRecord> = {}): PostRecord {
  return {
    url: FAKE_CHANNEL.url,
    handle: FAKE_CHANNEL.handle,
    text: 'まえの投稿',
    postedAt: NOW - 1_000,
    streamId: STREAM,
    kind: 'comment',
    ...over,
  }
}

function params(over: Partial<DecideParams> = {}): DecideParams {
  return {
    author: author(),
    messageText: 'こんばんは',
    directory: [entry()] as Directory,
    postLog: [] as PostLog,
    commentTemplate: DEFAULT_CONFIG.commentTemplate,
    streamId: STREAM,
    now: NOW,
    ownTexts: new Set<string>(),
    ...over,
  }
}

describe('decideCommentReply — 投稿する場合 (AC4 / AC5)', () => {
  it('辞書に載っていてフラグが ON なら投稿する', () => {
    const decision = decideCommentReply(params())
    expect(decision.action).toBe('post')
    expect(decision.action === 'post' && decision.entry.url).toBe(FAKE_CHANNEL.url)
  })

  it('**文面は辞書の値だけで作る**(コメント側の表示名は使わない / AC5)', () => {
    const decision = decideCommentReply(
      params({ directory: [entry({ nickname: 'れい' })], messageText: 'なまえは べつのなまえ' }),
    )
    expect(decision.action === 'post' && decision.text).toBe(
      `れいさん、来てくれてありがとうございます! ${FAKE_CHANNEL.url}`,
    )
  })

  it('呼び名が無ければ**辞書の URL から作ったハンドル**になる (AC5)', () => {
    const decision = decideCommentReply(params())
    expect(decision.action === 'post' && decision.text).toContain(FAKE_CHANNEL.handle)
  })

  it('**`{msg}` にはコメント用の自由文が入る**(003 の自由文は入らない / AC16)', () => {
    const decision = decideCommentReply(
      params({
        commentTemplate: '{name} {msg} {url}',
        directory: [entry({ message: 'リダイレクト用', commentMessage: 'コメント用' })],
      }),
    )
    expect(decision.action === 'post' && decision.text).toContain('コメント用')
    expect(decision.action === 'post' && decision.text).not.toContain('リダイレクト用')
  })

  it('**投稿する URL は辞書の URL**(コメントから取った ID ではない / AC5)', () => {
    const decision = decideCommentReply(params())
    expect(decision.action === 'post' && decision.text).toContain(FAKE_CHANNEL.url)
    expect(decision.action === 'post' && decision.text).not.toContain(AUTHOR_ID)
  })
})

describe('decideCommentReply — 自己ループの遮断 (AC10)', () => {
  it('**自分が投稿した本文と一致したら出さない**(2 枚目)', () => {
    const decision = decideCommentReply(
      params({ messageText: 'じぶんの投稿', ownTexts: new Set(['じぶんの投稿']) }),
    )
    expect(decision).toEqual({ action: 'skip', reason: '自分の投稿と本文が一致' })
  })

  it('**`author-type` が owner なら出さない**(3 枚目)', () => {
    const decision = decideCommentReply(params({ author: author({ authorType: 'owner' }) }))
    expect(decision).toEqual({ action: 'skip', reason: '配信者自身のコメント' })
  })

  it('**投稿者の ID が持ち主と同じなら出さない**(3 枚目のもう 1 通り)', () => {
    const decision = decideCommentReply(
      params({
        author: author({ channelId: OWNER_ID }),
        directory: [entry({ channelId: OWNER_ID })],
      }),
    )
    expect(decision).toEqual({ action: 'skip', reason: '配信者自身のコメント' })
  })

  it('**自己ループの判定は辞書の照合より先に効く**(順番に意味がある)', () => {
    // 自分の投稿が、辞書に載っている相手を指していた場合
    const decision = decideCommentReply(
      params({ messageText: 'じぶんの投稿', ownTexts: new Set(['じぶんの投稿']) }),
    )
    expect(decision.action).toBe('skip')
    expect(decision.action === 'skip' && decision.reason).toBe('自分の投稿と本文が一致')
  })
})

describe('decideCommentReply — 辞書の照合 (AC2 / AC4 / AC17)', () => {
  it('辞書に該当が無ければ出さない', () => {
    const decision = decideCommentReply(params({ author: author({ channelId: OTHER_ID }) }))
    expect(decision).toEqual({ action: 'skip', reason: '辞書に該当が無い' })
  })

  it('**フラグが OFF なら出さない** (AC2)', () => {
    const decision = decideCommentReply(params({ directory: [entry({ replyToComment: false })] }))
    expect(decision).toEqual({ action: 'skip', reason: 'コメントに反応しない設定' })
  })

  it('**`channelId` が未解決(空)の行には当たらない** (AC17)', () => {
    const decision = decideCommentReply(params({ directory: [entry({ channelId: '' })] }))
    expect(decision).toEqual({ action: 'skip', reason: '辞書に該当が無い' })
  })

  it('**同じ `channelId` の行が 2 件以上あれば出さない**(どの行を採るか決められない)', () => {
    const decision = decideCommentReply(
      params({
        directory: [
          entry({ url: FAKE_CHANNEL.url }),
          entry({ url: `https://www.youtube.com/channel/${AUTHOR_ID}` }),
        ],
      }),
    )
    expect(decision).toEqual({ action: 'skip', reason: '辞書に該当が無い' })
  })

  it('**照合に表示名を使っていない**(辞書の呼び名と一致しても ID が違えば出さない)', () => {
    const decision = decideCommentReply(
      params({
        author: author({ channelId: OTHER_ID }),
        directory: [entry({ nickname: 'れい', channelId: AUTHOR_ID })],
        messageText: 'れい',
      }),
    )
    expect(decision.action).toBe('skip')
  })
})

describe('decideCommentReply — 抑止 (AC7 / AC8)', () => {
  it('**同じ配信でコメント返し済みなら出さない**', () => {
    const decision = decideCommentReply(params({ postLog: [record({ kind: 'comment' })] }))
    expect(decision.action === 'skip' && decision.reason).toBe('この配信では投稿済み')
  })

  it('**同じ配信でリダイレクト返礼済みでも出さない**(非対称の前半 / AC8)', () => {
    const decision = decideCommentReply(params({ postLog: [record({ kind: 'redirect' })] }))
    expect(decision.action === 'skip' && decision.reason).toBe('この配信では投稿済み')
  })

  it('配信が違えば出す(別の出来事)', () => {
    const decision = decideCommentReply(params({ postLog: [record({ streamId: 'stream-2' })] }))
    expect(decision.action).toBe('post')
  })

  it('相手が違えば出す', () => {
    const decision = decideCommentReply(
      params({ postLog: [record({ url: FAKE_OTHER_CHANNEL.url })] }),
    )
    expect(decision.action).toBe('post')
  })

  it('**配信 ID が空なら 6 時間の下限で止める** (AC7)', () => {
    const decision = decideCommentReply(
      params({
        streamId: '',
        postLog: [record({ streamId: '', postedAt: NOW - 1_000 })],
      }),
    )
    expect(decision.action === 'skip' && decision.reason).toBe('この配信では投稿済み')
  })

  it('配信 ID が空でも 6 時間より古ければ出す', () => {
    const decision = decideCommentReply(
      params({
        streamId: '',
        postLog: [
          record({ streamId: '', postedAt: NOW - UNKNOWN_STREAM_MIN_COOLDOWN_SEC * 1000 - 1 }),
        ],
      }),
    )
    expect(decision.action).toBe('post')
  })

  it('止めた理由には**どの記録で止めたか**が付く(切り分け用)', () => {
    const blocker = record({ kind: 'redirect', text: 'まえの返礼' })
    const decision = decideCommentReply(params({ postLog: [blocker] }))
    expect(decision.action === 'skip' && decision.reason === 'この配信では投稿済み' && decision.blocker)
      .toEqual(blocker)
  })
})
