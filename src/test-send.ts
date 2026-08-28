/**
 * 設定画面からの「テスト送信」の判断と実行 (006 / AC7-AC13 / AC16)。
 *
 * **`main.ts` から切り出してある。**理由は [comment-runner.ts](./comment-runner.ts) と同じで、
 * `main.ts` は `chrome` と実 DOM が無いと動かず、歯止め(固定しない・履歴に残さない・
 * 他の投稿と競合しない)が配線されているかを自動で確かめられないため。
 * ここは依存をすべて注入で受けるので、jsdom も chrome も要らずにテストできる。
 *
 * ⚠️ **`postLog` に触る依存を持たない。**渡す口が無いこと自体が「投稿履歴に残さない」(AC8)の担保。
 * ⚠️ **固定しない (AC12)。**`pin` を呼ぶ依存も無い。
 */
import type { Directory } from './directory'
import {
  findEntry,
  resolveCommentDisplayName,
  resolveCommentMessage,
  resolveDisplayName,
  resolveMessage,
} from './directory'
import { composeText } from './composer'
import { handleFromChannelUrl } from './detector'
import type { RedirectEvent } from './types'
import type { CommentPostOutcome } from './comment-runner'

export const TEST_SEND_TYPE = 'shoutlink.testSend'
export type TestSendKind = 'redirect' | 'comment'

/** options → コンテントスクリプト。**文面は送らない** — 保存済みの辞書と設定で受け側が組む */
export type TestSendRequest = { type: typeof TEST_SEND_TYPE; kind: TestSendKind; url: string }

export type TestSendFailReason =
  /** チャット側の辞書にその URL が無い(行を足したがまだ保存されていない) */
  | 'no-entry'
  /** チャットの入力欄が見つからない(`poster.ts` の `PostOutcome` から) */
  | 'no-input'
  /** `kind: 'comment'` で `entry.channelId` が空。**返礼文側では起きない** */
  | 'unresolved-channel-id'
  /** 他の投稿が走っている (AC13) */
  | 'busy'

export type TestSendResponse =
  | { status: 'posted'; text: string; streamId: string }
  | { status: 'failed'; reason: TestSendFailReason }

/** 壊れた / 未知のメッセージを弾く (AC16)。返り値が null なら**黙って無視する** */
export function parseTestSendRequest(raw: unknown): TestSendRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const { type, kind, url } = raw as Partial<TestSendRequest>
  if (type !== TEST_SEND_TYPE) return null
  if (kind !== 'redirect' && kind !== 'comment') return null
  if (typeof url !== 'string' || !url.trim()) return null
  return { type: TEST_SEND_TYPE, kind, url }
}

/** 保存済みの辞書 + テンプレートから文面を組む。`composer.ts` の再利用だけ */
export function buildTestSendText(params: {
  kind: TestSendKind
  directory: Directory
  url: string
  template: string
}): { status: 'ok'; text: string } | { status: 'failed'; reason: 'no-entry' | 'unresolved-channel-id' } {
  const entry = findEntry(params.directory, params.url)
  if (!entry) return { status: 'failed', reason: 'no-entry' }

  if (params.kind === 'comment') {
    if (!entry.channelId) return { status: 'failed', reason: 'unresolved-channel-id' }
    const name = resolveCommentDisplayName(params.directory, params.url)
    const message = resolveCommentMessage(params.directory, params.url)
    return { status: 'ok', text: composeText(params.template, { name, url: params.url }, { message }) }
  }

  // kind: 'redirect'。resolveDisplayName / resolveMessage は RedirectEvent を受ける形なので、
  // 実際の検知が無いテスト送信では辞書の URL から最小限の RedirectEvent を組み立てて渡す。
  // ニックネームが未設定のときの呼び名フォールバックは resolveCommentDisplayName と同じくハンドルにする
  // (どちらも「辞書に入っている値だけで決める」という同じ方針)。
  const fakeEvent: RedirectEvent = {
    sourceChannelName: handleFromChannelUrl(entry.url),
    sourceChannelUrl: params.url,
    detectedAt: 0,
  }
  const name = resolveDisplayName(params.directory, fakeEvent)
  const message = resolveMessage(params.directory, fakeEvent)
  return { status: 'ok', text: composeText(params.template, { name, url: params.url }, { message }) }
}

/**
 * テスト送信の本体。**依存はすべて注入で受ける** — chrome も実 DOM も要らずにテストできる。
 * `comment-runner.ts` の `createCommentRunner` と同じ作り。
 */
export type TestSendDeps = {
  getDirectory: () => Directory
  /** kind に応じたテンプレートを返す(`config.template` / `config.commentTemplate`) */
  getTemplate: (kind: TestSendKind) => string
  streamId: string
  /** 投稿だけを行う。**固定はしない** (AC12) */
  post: (text: string) => Promise<CommentPostOutcome>
  /** 004 / AC10 の 1・2 枚目。`commentRunner.rememberOwnPost` をそのまま渡す */
  rememberOwnPost: (text: string, element: Element | null) => void
  /** 他の投稿が走っているか (AC13)。`inFlight.isBusy` を渡す */
  isBusy: () => boolean
  onLog?: (message: string, detail?: unknown) => void
}

export function createTestSendHandler(
  deps: TestSendDeps,
): (raw: unknown) => Promise<TestSendResponse | null> {
  const log = deps.onLog ?? (() => {})

  return async (raw) => {
    const request = parseTestSendRequest(raw)
    if (!request) return null

    // AC13: チャットの入力欄は 1 つしかない。他の投稿が走っているならここで諦める
    if (deps.isBusy()) {
      log('テスト送信を見送った (他の投稿が進行中)')
      return { status: 'failed', reason: 'busy' }
    }

    const built = buildTestSendText({
      kind: request.kind,
      directory: deps.getDirectory(),
      url: request.url,
      template: deps.getTemplate(request.kind),
    })
    if (built.status !== 'ok') return { status: 'failed', reason: built.reason }

    const { text } = built
    log(`テスト送信する (${request.kind}):`, text)

    // ⚠️ 投稿の「前」に本文を覚える (AC11)。comment-runner.ts / main.ts と同じ理由・同じ順序 —
    //    MutationObserver は自分の投稿ノードをマイクロタスクで配送するのに対し、
    //    `postMessage` の要素確認はマクロタスクなので、後だと間に合わない。
    //    ⚠️ `selfEcho.remember` はここでは打たない(plan.md「採らない案」)。
    deps.rememberOwnPost(text, null)

    const outcome = await deps.post(text)
    if (!outcome.posted) {
      log('テスト送信の投稿に失敗した')
      return { status: 'failed', reason: 'no-input' }
    }

    // 要素は投稿できて初めて分かる (AC10 の 1 枚目)
    deps.rememberOwnPost(text, outcome.element)
    return { status: 'posted', text, streamId: deps.streamId }
  }
}
