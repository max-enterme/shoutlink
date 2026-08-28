/**
 * 配線。検知(自動 / 手動)→ 文面生成 → 投稿 → 固定。
 * 全体を try/catch で包み、どこで失敗しても配信に影響させない (AC6)。
 */
import { compose } from './composer'
import { startCommentDetector } from './comment-detector'
import { createCommentRunner } from './comment-runner'
import type { CommentDetectorHandle } from './comment-detector'
import { REDIRECT_TEXT_PATTERNS, getChatMessages, getMessageText } from './selectors'
import { DEFAULT_CONFIG, isActionAllowed, loadConfig, onConfigChanged } from './config'
import {
  findEntry,
  loadDirectory,
  onDirectoryChanged,
  rememberSource,
  resolveDisplayName,
  resolveMessage,
  saveDirectory,
} from './directory'
import type { Directory } from './directory'
import { startRedirectDetector } from './detector'
import { decideScope } from './scope'
import { guard, guardAsync, log } from './log'
import { createInFlightGuard } from './in-flight'
import { mountManualTrigger } from './manual-trigger'
import type { ManualTriggerHandle } from './manual-trigger'
import { pin } from './pinner'
import { postMessage } from './poster'
import {
  currentStreamId,
  findRedirectReplyBlocker,
  loadPostLog,
  makePostRecord,
  rememberPost,
  savePostLog,
} from './post-log'
import type { PostLog } from './post-log'
import { createSelfEchoGuard } from './self-echo'
import type { Config, RedirectEvent } from './types'

/** ビルド時刻。esbuild の define で埋める(どのビルドが読み込まれているかの判別用) */
declare const __BUILD_TIME__: string

async function main(): Promise<void> {
  let config: Config = await guardAsync('設定の読み込み', loadConfig, { ...DEFAULT_CONFIG })

  // **自分の配信のチャットでしか動かさない。**
  // ここを緩めると他人のチャットへ投稿する (2026-08-06 の事故)。設定変更後はページの再読み込みが要る。
  const scope = decideScope(location.hostname)
  if (!scope.allowed) {
    log.info('この画面では動かさない:', scope.reason)
    return
  }

  // `sync` → `local` の 1 度きりの移行は `loadDirectory` の中で走り、**成否はその中で 1 行出る**
  // (設定画面から先に開かれても同じログが出るように / plan.md R3)。
  let directory: Directory = await guardAsync('呼び名辞書の読み込み', loadDirectory, [])

  // **リロードをまたいで再投稿を止めるための土台。**
  // リダイレクトの通知はチャットに残り続けるため、開き直すたびに初期走査が拾い直す。
  // 抑止の記録をメモリだけに持っていると、そのたびに白紙に戻って再投稿していた (2026-08-06)。
  const streamId = guard('配信 ID の取得', () => currentStreamId(), '')
  let postLog: PostLog = await guardAsync('投稿履歴の読み込み', loadPostLog, [])
  // **同じ URL への投稿が重なって走らないための歯止め** (AC1 / AC13)。
  // `postLog` は投稿できたときだけ記録するので、`await postMessage(...)` の間に同じ通知が
  // もう一度来ると 2 件目が素通りしてしまう。ここで同期的に枠を取る
  const inFlight = createInFlightGuard()
  // 設定と独立した自己ループの歯止め (security-review.md S1)
  const selfEcho = createSelfEchoGuard()

  /**
   * コメント返しの実行と、自己ループの記憶 (AC10 / AC11)。
   * **配線の中身は [comment-runner.ts](./comment-runner.ts)** — `main.ts` に置くと
   * `chrome` と実 DOM 無しではテストできず、**R2 の歯止めが配線されているかを誰も確かめられない。**
   */
  const commentRunner = createCommentRunner({
    isEnabled: () => config.commentReplyEnabled,
    getDirectory: () => directory,
    getPostLog: () => postLog,
    setPostLog: (next) => {
      postLog = next
      void guardAsync('投稿履歴の保存', () => savePostLog(postLog), undefined)
    },
    getCommentTemplate: () => config.commentTemplate,
    streamId,
    // **固定はしない (AC6)。**投稿だけを渡す
    post: async (text) => {
      const posted = await postMessage(text)
      if (posted.status !== 'posted') {
        log.warn('コメント返しの投稿に失敗した:', posted.reason)
        return { posted: false, element: null }
      }
      return { posted: true, element: posted.element }
    },
    onLog: (message, detail) => {
      if (detail === undefined) log.info(message)
      else log.info(message, detail)
    },
  })

  onDirectoryChanged((next) => {
    directory = next
  })

  onConfigChanged((next) => {
    config = next
    // 手動トリガーの表示切り替えに、ページの再読み込みを要らなくする
    guard('手動トリガーの切り替え', () => syncManualTrigger(next.showManualTrigger), undefined)
    // コメント返しの ON / OFF も再読み込みなしで効かせる (AC1 / AC11)
    guard('コメント検知の切り替え', () => syncCommentDetector(next.commentReplyEnabled), undefined)
    log.info('設定を更新した', next)
  })

  /**
   * 自動検知・手動トリガーの共通パイプライン。
   * 手動トリガーは検知を飛ばすだけで、以降は自動検知とまったく同じ経路を通る。
   */
  const handle = async (event: RedirectEvent): Promise<void> => {
    // 自分が直前に投稿した返礼(とその固定バナー)を、新しい通知として拾い直さない (S1)。
    // 自動検知だけを止める。手動トリガーは人が明示的に押しているので通す。
    if (event.origin !== 'manual' && selfEcho.isEcho(event.sourceChannelUrl)) {
      log.info('直前に自分が投稿した相手のため、自己反射とみなしてスキップ', event.sourceChannelUrl)
      return
    }

    // リダイレクトしてきた相手は、**投稿の可否に関わらず**辞書に載せる。
    // 無効化中でも「誰が来たか」は残しておきたいため。呼び名は後から人が付ける。
    if (!findEntry(directory, event.sourceChannelUrl)) {
      log.info('辞書に登録した:', event.sourceChannelUrl)
    }
    directory = rememberSource(directory, event)
    void guardAsync('呼び名辞書の保存', () => saveDirectory(directory), undefined)

    // AC7: 自動検知は無効化で止まる。手動トリガーは人が押しているので通す
    if (!isActionAllowed(config.enabled, event.origin)) {
      log.info('自動検知が無効化されているためスキップ', event.sourceChannelUrl)
      return
    }
    // AC1 / AC6: 同じ配信・同じ相手への抑止。**手動トリガーは対象外** — 人が押した時点で意思表示
    if (event.origin !== 'manual') {
      const blocker = findRedirectReplyBlocker(postLog, {
        streamId,
        url: event.sourceChannelUrl,
        now: Date.now(),
      })
      if (blocker) {
        log.info('この配信では投稿済みのためスキップ', event.sourceChannelUrl, {
          前回: new Date(blocker.postedAt).toLocaleString(),
          文面: blocker.text,
        })
        return
      }
    }

    // AC13 / AC6: チャットの入力欄は 1 つしかないので、手動トリガーでも見る。
    // ここで枠を取っておかないと `begin` していないのに `finally` の `end` が走り、
    // 他の経路が持っている枠を解放して `isBusy()` が嘘になる
    if (!inFlight.begin(event.sourceChannelUrl)) {
      log.info('他の投稿が進行中のためスキップ', event.sourceChannelUrl)
      return
    }
    try {
      // 辞書に呼び名があればそれを使う。無ければ検知した表示名のまま。
      // 自由文も同じく**ここで辞書から解決してから**純関数の `compose` へ渡す
      // (`composer.ts` は辞書を知らないままでいる)
      const named = { ...event, sourceChannelName: resolveDisplayName(directory, event) }
      const text = compose(config.template, named, { message: resolveMessage(directory, event) })
      log.info(`投稿する (${event.origin ?? 'auto'}):`, text)

      // 投稿する**前に**覚える。投稿・固定の途中で observer が発火しても取りこぼさないため。
      // **コメント経路の自己ループ遮断 (AC10) も同じ理由で投稿前に本文を覚える** —
      // MutationObserver は自分の投稿を**マイクロタスク**で配送するのに対し、
      // `postMessage` の要素確認はポーリング(マクロタスク)なので、後だと間に合わない
      selfEcho.remember(event.sourceChannelUrl)
      commentRunner.rememberOwnPost(text, null)
      const posted = await postMessage(text)
      if (posted.status !== 'posted') {
        log.warn('投稿に失敗した:', posted.reason)
        return
      }

      // 要素は投稿できて初めて分かる (AC10 の 1 枚目)
      commentRunner.rememberOwnPost(text, posted.element)

      // **投稿できたときだけ**履歴に残す。次回の起動はここから抑止を組み立てる。
      // 失敗した回まで残すと、投稿できていないのに抑止だけ効いてしまう。
      postLog = rememberPost(postLog, makePostRecord(event, text, { streamId, postedAt: Date.now() }))
      void guardAsync('投稿履歴の保存', () => savePostLog(postLog), undefined)

      if (!posted.element) return

      const result = await pin(posted.element, config.pinMode)
      log.info('固定結果:', result)
    } finally {
      // 投稿に失敗しても解放する (AC1)。次に検知したときにもう一度試せるように
      inFlight.end(event.sourceChannelUrl)
    }
  }

  const safeHandle = (event: RedirectEvent): void => {
    void guardAsync<void>('パイプライン', () => handle(event), undefined)
  }

  const detector = startRedirectDetector({ onEvent: safeHandle, debug: () => config.debug })
  detector.scanExisting()

  // --- コメント返し (004) ---------------------------------------------------
  //
  // **リダイレクト返礼とは別のパイプライン**にする。規則が違うため (plan.md のアプローチ表):
  // 起動時の既存ノードを拾わない (AC9) / 固定しない (AC6) / 文面もテンプレートも別 (AC5) /
  // 抑止が非対称 (AC8)。

  /**
   * 検知の開始・停止 (AC1 / AC11)。
   *
   * **OFF の間は検知そのものを走らせない。**「見てから捨てる」にすると、捨て漏れが投稿に化ける。
   * **OFF になった時点で未処理のキューは捨てる** (AC11)。
   * 走っている 1 件は `decideCommentReply` が投稿の直前に `enabled` を見て止める。
   */
  let commentDetector: CommentDetectorHandle | null = null
  const syncCommentDetector = (enabled: boolean): void => {
    if (enabled === (commentDetector != null)) return
    if (enabled) {
      commentDetector = startCommentDetector({
        streamId,
        debug: () => config.debug,
        // AC10 の 1 枚目: 自分が投稿した要素は抽出の前に弾く
        ignoreElement: (el) => commentRunner.isOwnElement(el),
        onComment: (author, el) =>
          guard(
            'コメント返しのパイプライン',
            () => commentRunner.handle(author, getMessageText(el)),
            undefined,
          ),
      })
      log.info('コメント返しの検知を開始した')
    } else {
      commentDetector?.stop()
      commentDetector = null
      commentRunner.clear()
      log.info('コメント返しの検知を止めた(未処理のキューは捨てた)')
    }
  }
  syncCommentDetector(config.commentReplyEnabled)

  /**
   * 切り分け用: 投稿せずに固定だけを試す。
   * チャットの**最後のメッセージ**を対象に、設定に関わらず `always` で固定を試みる。
   * ③ が単独で動くかを ①② と切り離して確認するための経路。
   */
  const pinTest = async (): Promise<string> => {
    const messages = getChatMessages(document)
    const target = messages[messages.length - 1]
    if (!target) {
      log.warn('固定テスト: 対象のメッセージが見つからない')
      return 'メッセージが見つからない'
    }
    log.info('固定テスト: 対象 =', getMessageText(target).slice(0, 40))
    const result = await pin(target, 'always')
    log.info('固定テスト: 結果 =', result)
    return result
  }

  /**
   * 手動トリガー UI の出し入れ。**既定は出さない** (security-review.md S8)。
   * 配信画面にチャット窓を載せていると常時映り込むため。機能自体は残してあり、
   * 自動検知が空振りしたときの逃げ道 (plan.md R1) と、投稿・固定の切り分け経路として使う。
   *
   * 設定の変更に追従させる(ページの再読み込みを要らなくする)。
   */
  let manualTrigger: ManualTriggerHandle | null = null
  const syncManualTrigger = (show: boolean): void => {
    if (show === (manualTrigger != null)) return
    if (show) {
      manualTrigger = mountManualTrigger({
        onTrigger: safeHandle,
        onPinTest: () => guardAsync('固定テスト', pinTest, 'エラー'),
      })
    } else {
      manualTrigger?.destroy()
      manualTrigger = null
    }
  }
  syncManualTrigger(config.showManualTrigger)

  // 「どのビルドが・どの設定で動いているか」を 1 行で分かるようにする。
  // 拡張の ↻ 忘れ / ページのリロード忘れ / 診断ログの入れ忘れを、ログだけで切り分けるため。
  log.info('起動した', {
    build: __BUILD_TIME__,
    scope: scope.reason,
    enabled: config.enabled,
    debug: config.debug,
    pinMode: config.pinMode,
    cooldownSec: config.cooldownSec,
    // 「この配信で誰に投稿済みか」の土台。streamId が空だと同一配信の判定ができない
    streamId: streamId || '(不明)',
    postLog: postLog.length,
    showManualTrigger: config.showManualTrigger,
    // 「ON にしたのに動かない」の切り分け用。**辞書側のフラグが 0 件なら何も起きない** (AC13)
    commentReplyEnabled: config.commentReplyEnabled,
    replyToComment: directory.filter((entry) => entry.replyToComment).length,
    // フラグが ON でも `channelId` が空だと照合できない (AC17)
    commentReady: directory.filter((entry) => entry.replyToComment && entry.channelId).length,
    patterns: REDIRECT_TEXT_PATTERNS.length,
    url: location.href,
  })
}

void main().catch((err) => log.error('起動に失敗した:', err))
