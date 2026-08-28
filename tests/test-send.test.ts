/**
 * テスト送信の判断と歯止め (006 / AC7-AC13 / AC16)。
 *
 * `createTestSendHandler` は依存をすべて注入で受けるので、chrome も実 DOM も要らずにテストできる
 * (`comment-runner.ts` と同じ作り)。
 */
import { describe, expect, it } from 'vitest'
import {
  TEST_SEND_TYPE,
  buildTestSendText,
  createTestSendHandler,
  parseTestSendRequest,
} from '../src/test-send'
import type { TestSendDeps } from '../src/test-send'
import { createInFlightGuard } from '../src/in-flight'
import {
  orderStudioTabsForTestSend,
  testSendAvailability,
  testSendResultMessage,
} from '../src/options/test-send'
import type { Directory, DirectoryEntry } from '../src/directory'
import { DEFAULT_CONFIG } from '../src/config'
import { FAKE_CHANNEL } from './fixtures/live-chat'

const CHANNEL_ID = 'UCexampleexampleexampl'

function entry(over: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    url: FAKE_CHANNEL.url,
    nickname: 'れい',
    message: 'リダイレクトありがとう',
    replyToComment: true,
    commentMessage: 'コメントもありがとう',
    channelId: CHANNEL_ID,
    lastSeenAt: 0,
    ...over,
  }
}

describe('parseTestSendRequest (AC16)', () => {
  it('正しい形を通す', () => {
    const raw = { type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url }
    expect(parseTestSendRequest(raw)).toEqual(raw)
  })

  it('type が違えば null', () => {
    expect(
      parseTestSendRequest({ type: 'other', kind: 'redirect', url: FAKE_CHANNEL.url }),
    ).toBeNull()
  })

  it('kind が enum 外なら null', () => {
    expect(
      parseTestSendRequest({ type: TEST_SEND_TYPE, kind: 'other', url: FAKE_CHANNEL.url }),
    ).toBeNull()
  })

  it('url が非文字列なら null', () => {
    expect(parseTestSendRequest({ type: TEST_SEND_TYPE, kind: 'redirect', url: 1 })).toBeNull()
  })

  it('url が空文字なら null', () => {
    expect(parseTestSendRequest({ type: TEST_SEND_TYPE, kind: 'redirect', url: '  ' })).toBeNull()
  })

  it('null は null', () => {
    expect(parseTestSendRequest(null)).toBeNull()
  })

  it('非オブジェクトは null', () => {
    expect(parseTestSendRequest('nope')).toBeNull()
  })
})

describe('buildTestSendText', () => {
  it("kind='redirect': 呼び名と message が template の {name} {msg} に入る", () => {
    const directory: Directory = [entry()]
    const result = buildTestSendText({
      kind: 'redirect',
      directory,
      url: FAKE_CHANNEL.url,
      template: '{name}さん {msg} {url}',
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.text).toContain('れい')
    expect(result.text).toContain('リダイレクトありがとう')
  })

  it("kind='comment': commentMessage が入り、message は入らない (004 / AC16)", () => {
    const directory: Directory = [entry()]
    const result = buildTestSendText({
      kind: 'comment',
      directory,
      url: FAKE_CHANNEL.url,
      template: '{name}さん {msg} {url}',
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.text).toContain('コメントもありがとう')
    expect(result.text).not.toContain('リダイレクトありがとう')
  })

  it('辞書に無い URL は no-entry', () => {
    const result = buildTestSendText({
      kind: 'redirect',
      directory: [],
      url: FAKE_CHANNEL.url,
      template: DEFAULT_CONFIG.template,
    })
    expect(result).toEqual({ status: 'failed', reason: 'no-entry' })
  })

  it("kind='comment' かつ channelId が空なら unresolved-channel-id", () => {
    const directory: Directory = [entry({ channelId: '' })]
    const result = buildTestSendText({
      kind: 'comment',
      directory,
      url: FAKE_CHANNEL.url,
      template: DEFAULT_CONFIG.commentTemplate,
    })
    expect(result).toEqual({ status: 'failed', reason: 'unresolved-channel-id' })
  })

  it("kind='redirect' かつ channelId が空でも通る(URL で照合するため)", () => {
    const directory: Directory = [entry({ channelId: '' })]
    const result = buildTestSendText({
      kind: 'redirect',
      directory,
      url: FAKE_CHANNEL.url,
      template: DEFAULT_CONFIG.template,
    })
    expect(result.status).toBe('ok')
  })
})

type HarnessOptions = Partial<TestSendDeps> & {
  fail?: boolean
}

/** 依存をすべて偽物にした handler。**実 DOM も chrome も要らない** */
function harness(over: HarnessOptions = {}) {
  const { fail, ...deps } = over
  const directory: Directory = [entry()]
  const rememberCalls: Array<{ text: string; element: Element | null }> = []
  const postCalls: string[] = []
  // **呼び出し順を確かめるための共通の記録先** (AC11)。`rememberCalls` / `postCalls` が
  // 別々だと、実装を `post` → `rememberOwnPost` の順に入れ替えても各配列単体は壊れない。
  // 呼ばれた順に 'remember' / 'post' を積んで、両者をまたいだ順序を見る
  const calls: string[] = []
  let busy = false

  const handler = createTestSendHandler({
    getDirectory: () => directory,
    getTemplate: (kind) => (kind === 'redirect' ? DEFAULT_CONFIG.template : DEFAULT_CONFIG.commentTemplate),
    streamId: 'stream-1',
    post: async (text) => {
      calls.push('post')
      postCalls.push(text)
      if (fail) return { posted: false, element: null }
      return { posted: true, element: null }
    },
    rememberOwnPost: (text, element) => {
      calls.push('remember')
      rememberCalls.push({ text, element })
    },
    isBusy: () => busy,
    ...deps,
  })

  return {
    handler,
    rememberCalls,
    postCalls,
    calls,
    setBusy: (v: boolean) => {
      busy = v
    },
  }
}

describe('createTestSendHandler の歯止め (AC8 / AC11 / AC12 / AC13 / AC16)', () => {
  it('投稿の前に rememberOwnPost(text, null) が呼ばれる (AC11)', async () => {
    const { handler, rememberCalls } = harness()
    await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(rememberCalls[0]).toEqual({ text: expect.any(String), element: null })
  })

  it('投稿できたら rememberOwnPost(text, element) が 2 回目に呼ばれる (AC11)', async () => {
    const element = document.createElement('div')
    const { handler, rememberCalls } = harness({
      post: async () => ({ posted: true, element }),
    })
    await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(rememberCalls).toHaveLength(2)
    expect(rememberCalls[1].element).toBe(element)
    expect(rememberCalls[0].element).toBeNull()
  })

  it('呼び出し順は remember → post → remember(投稿できたとき) (AC11)', async () => {
    const { handler, calls } = harness()
    await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(calls).toEqual(['remember', 'post', 'remember'])
  })

  it('呼び出し順は remember → post(投稿に失敗したとき、2 回目の remember は無い) (AC11)', async () => {
    const { handler, calls } = harness({ fail: true })
    await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(calls).toEqual(['remember', 'post'])
  })

  it('TestSendDeps に投稿履歴・固定に触る依存を渡すと型エラーになる(型に口が無い / AC8 / AC12)', () => {
    const withExtraDeps: TestSendDeps = {
      getDirectory: () => [],
      getTemplate: () => '',
      streamId: '',
      post: async () => ({ posted: false, element: null }),
      rememberOwnPost: () => {},
      isBusy: () => false,
      // @ts-expect-error TestSendDeps に savePostLog(履歴)/ pin(固定)相当の口は無い
      savePostLog: async () => {},
    }
    expect(withExtraDeps).toBeDefined()
  })

  it("isBusy() が true のときは post を呼ばずに { status:'failed', reason:'busy' } (AC13)", async () => {
    const { handler, postCalls, setBusy } = harness()
    setBusy(true)
    const response = await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(response).toEqual({ status: 'failed', reason: 'busy' })
    expect(postCalls).toHaveLength(0)
  })

  it("投稿に失敗したら { status:'failed', reason:'no-input' } を返し、rememberOwnPost の 2 回目は呼ばない", async () => {
    const { handler, rememberCalls } = harness({ fail: true })
    const response = await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(response).toEqual({ status: 'failed', reason: 'no-input' })
    expect(rememberCalls).toHaveLength(1)
  })

  it("投稿できたら { status:'posted', text, streamId } を返す (AC9)", async () => {
    const { handler } = harness()
    const response = await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(response).toMatchObject({ status: 'posted', streamId: 'stream-1' })
    if (response?.status === 'posted') expect(response.text.length).toBeGreaterThan(0)
  })

  it('未知の形のメッセージには null を返し、post を呼ばない (AC16)', async () => {
    const { handler, postCalls } = harness()
    const response = await handler({ nope: true })
    expect(response).toBeNull()
    expect(postCalls).toHaveLength(0)
  })
})

describe('createTestSendHandler + createInFlightGuard — post を枠で包む (006 レビュー #4 / AC13)', () => {
  it('post を begin/end で包むと、post が終わるまで isBusy() が true になり、2 本目は post を実行せず busy を返す', async () => {
    // main.ts は `test-send.ts` の型・インターフェースを変えずに、注入する `post` 自体を
    // `inFlight.begin` / `finally { inFlight.end }` で包む。ここでは同じ形を組んで確かめる。
    const inFlight = createInFlightGuard()
    const postCalls: string[] = []
    let resolveFirstPost: (() => void) | undefined
    const wrappedPost = async (text: string) => {
      if (!inFlight.begin('test-send')) return { posted: false, element: null }
      try {
        postCalls.push(text)
        await new Promise<void>((resolve) => {
          resolveFirstPost = resolve
        })
        return { posted: true, element: null }
      } finally {
        inFlight.end('test-send')
      }
    }
    const directory: Directory = [entry()]
    const handler = createTestSendHandler({
      getDirectory: () => directory,
      getTemplate: () => DEFAULT_CONFIG.template,
      streamId: 'stream-1',
      post: wrappedPost,
      rememberOwnPost: () => {},
      isBusy: () => inFlight.isBusy(),
    })

    const first = handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    // 1 本目の post がまだ終わっていない間に 2 本目を呼ぶ
    const second = await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(second).toEqual({ status: 'failed', reason: 'busy' })
    expect(postCalls).toHaveLength(1)

    resolveFirstPost?.()
    const firstResult = await first
    expect(firstResult).toMatchObject({ status: 'posted' })
  })
})

describe('testSendAvailability (確定値 B4)', () => {
  it('channelId が空の行はコメント側だけ enabled: false、返礼文側は true', () => {
    const result = testSendAvailability(entry({ channelId: '' }))
    expect(result.redirect).toEqual({ enabled: true })
    expect(result.comment).toEqual({ enabled: false, reason: expect.any(String) })
  })

  it('channelId がある行はどちらも enabled: true', () => {
    const result = testSendAvailability(entry({ channelId: CHANNEL_ID }))
    expect(result.redirect).toEqual({ enabled: true })
    expect(result.comment).toEqual({ enabled: true })
  })
})

describe('orderStudioTabsForTestSend (plan.md「宛先タブの決め方」)', () => {
  it('lastAccessed の降順に並べる', () => {
    const tabs = [{ id: 1, lastAccessed: 100 }, { id: 2, lastAccessed: 300 }, { id: 3, lastAccessed: 200 }]
    expect(orderStudioTabsForTestSend(tabs).map((t) => t.id)).toEqual([2, 3, 1])
  })

  it('lastAccessed が無いものは最後へ回す', () => {
    const tabs = [{ id: 1 }, { id: 2, lastAccessed: 100 }, { id: 3 }]
    expect(orderStudioTabsForTestSend(tabs).map((t) => t.id)).toEqual([2, 1, 3])
  })

  it('同値・未定義どうしは元の並び順を保つ(安定ソート)', () => {
    const tabs = [
      { id: 1, lastAccessed: 100 },
      { id: 2, lastAccessed: 100 },
      { id: 3 },
      { id: 4 },
    ]
    expect(orderStudioTabsForTestSend(tabs).map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('空配列は空配列', () => {
    expect(orderStudioTabsForTestSend([])).toEqual([])
  })
})

describe('testSendResultMessage (AC9: 6 通りが互いに違う文言)', () => {
  it('6 通りが互いに違う文言を返す', () => {
    const messages = [
      testSendResultMessage({ status: 'posted', text: 'テストの文面', streamId: 'stream-1' }),
      testSendResultMessage({ status: 'failed', reason: 'no-input' }),
      testSendResultMessage({ status: 'failed', reason: 'no-tab' }),
      testSendResultMessage({ status: 'failed', reason: 'unresolved-channel-id' }),
      testSendResultMessage({ status: 'failed', reason: 'no-entry' }),
      testSendResultMessage({ status: 'failed', reason: 'busy' }),
    ]
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('posted は投稿した文面とどの配信へ出したかを含む', () => {
    const message = testSendResultMessage({ status: 'posted', text: 'テストの文面', streamId: 'stream-1' })
    expect(message).toContain('テストの文面')
    expect(message).toContain('stream-1')
  })

  it('streamId が空なら「(不明)」にする(main.ts の起動ログと揃える)', () => {
    const message = testSendResultMessage({ status: 'posted', text: 'テストの文面', streamId: '' })
    expect(message).toContain('(不明)')
    expect(message).not.toContain('配信 )')
  })
})
