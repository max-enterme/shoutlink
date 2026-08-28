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
  let busy = false

  const handler = createTestSendHandler({
    getDirectory: () => directory,
    getTemplate: (kind) => (kind === 'redirect' ? DEFAULT_CONFIG.template : DEFAULT_CONFIG.commentTemplate),
    streamId: 'stream-1',
    post: async (text) => {
      postCalls.push(text)
      if (fail) return { posted: false, element: null }
      return { posted: true, element: null }
    },
    rememberOwnPost: (text, element) => {
      rememberCalls.push({ text, element })
    },
    isBusy: () => busy,
    ...deps,
  })

  return {
    handler,
    rememberCalls,
    postCalls,
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

  it('TestSendDeps に投稿履歴に触る依存が無い(型に口が無い / AC8)', async () => {
    const { handler } = harness()
    const response = await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(response).not.toHaveProperty('postLog')
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

  it('固定を呼ぶ経路が無い(handler は post 以外の投稿系の依存を持たない / AC12)', async () => {
    const { handler } = harness()
    // TestSendDeps に pin 系の依存を渡す口が無いこと自体が担保。ここでは応答が固定結果を含まないことだけ見る
    const response = await handler({ type: TEST_SEND_TYPE, kind: 'redirect', url: FAKE_CHANNEL.url })
    expect(response).not.toHaveProperty('pinResult')
  })
})
