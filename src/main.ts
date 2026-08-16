/**
 * 配線。検知(自動 / 手動)→ 文面生成 → 投稿 → 固定。
 * 全体を try/catch で包み、どこで失敗しても配信に影響させない (AC6)。
 */
import { compose } from './composer'
import { startCommentDetector } from './comment-detector'
import { decideCommentReply } from './comment-reply'
import type { CommentAuthor, CommentDetectorHandle } from './comment-detector'
import { REDIRECT_TEXT_PATTERNS, getChatMessages, getMessageText } from './selectors'
import { DEFAULT_CONFIG, isActionAllowed, loadConfig, onConfigChanged } from './config'
import { createDedupe } from './dedupe'
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
import { mountManualTrigger } from './manual-trigger'
import type { ManualTriggerHandle } from './manual-trigger'
import { pin } from './pinner'
import { postMessage } from './poster'
import {
  countCommentPostsInStream,
  currentStreamId,
  findLastPost,
  findPostInStream,
  loadPostLog,
  makePostRecord,
  makePostRecordFor,
  redirectHistory,
  rememberPost,
  savePostLog,
} from './post-log'
import { createPostQueue } from './post-queue'
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
  // **リダイレクト側の抑止にはリダイレクト返礼の記録だけを渡す** (004 / AC8)。
  // コメント返しの記録まで渡すと、それが起動時からクールダウンを埋め、
  // 「コメント返し済みでもリダイレクト返礼はする」が壊れる(`absorb` 側でも弾いている)
  const dedupe = createDedupe(config.cooldownSec, { streamId, history: redirectHistory(postLog) })
  // 設定と独立した自己ループの歯止め (security-review.md S1)
  const selfEcho = createSelfEchoGuard()

  /**
   * **自分が投稿した要素と本文** (AC10 の 1・2 枚目)。
   *
   * コメント返しの投稿は**それ自体がチャットコメント**で、検知対象と同じ種類のノードになる。
   * 1 枚目(要素)は [poster.ts](./poster.ts) が要素の特定に失敗しうるので**単独では信用しない**。
   * 2 枚目(本文一致)がその受け皿。
   */
  const ownMessageElements = new WeakSet<Element>()
  const ownMessageTexts = new Set<string>()
  /** 覚えておく本文の件数。1 配信 20 件(AC11)+ リダイレクト返礼ぶんで足りる */
  const OWN_TEXT_MEMORY = 50

  const rememberOwnPost = (text: string, element: Element | null): void => {
    if (element) ownMessageElements.add(element)
    ownMessageTexts.add(text)
    // 無限に増やさない。古いものから捨てる(Set は挿入順)
    while (ownMessageTexts.size > OWN_TEXT_MEMORY) {
      const oldest = ownMessageTexts.values().next().value
      if (oldest === undefined) break
      ownMessageTexts.delete(oldest)
    }
  }

  onDirectoryChanged((next) => {
    directory = next
  })

  onConfigChanged((next) => {
    config = next
    dedupe.setCooldownSec(next.cooldownSec)
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
    // AC4: 同じ配信の中での、同一送信元・クールダウン内の多重発火を抑止
    if (!dedupe.tryAcquire(event)) {
      // なぜ止めたかを保存済みの履歴から説明する(「投稿されない」の切り分け用)
      // **種別を指定する** (004)。指定しないとコメント返しの記録を
      // 「前回のリダイレクト返礼」として出し、切り分けの窓が嘘をつく
      const prior =
        findPostInStream(postLog, streamId, event.sourceChannelUrl, 'redirect') ??
        findLastPost(postLog, event.sourceChannelUrl, 'redirect')
      log.info(
        'クールダウン中のためスキップ',
        event.sourceChannelUrl,
        prior
          ? { 前回: new Date(prior.postedAt).toLocaleString(), 文面: prior.text }
          : '(この画面で投稿済み)',
      )
      return
    }

    // 辞書に呼び名があればそれを使う。無ければ検知した表示名のまま。
    // 自由文も同じく**ここで辞書から解決してから**純関数の `compose` へ渡す
    // (`composer.ts` は辞書を知らないままでいる)
    const named = { ...event, sourceChannelName: resolveDisplayName(directory, event) }
    const text = compose(config.template, named, { message: resolveMessage(directory, event) })
    log.info(`投稿する (${event.origin ?? 'auto'}):`, text)

    // 投稿する**前に**覚える。投稿・固定の途中で observer が発火しても取りこぼさないため
    selfEcho.remember(event.sourceChannelUrl)
    const posted = await postMessage(text)
    if (posted.status !== 'posted') {
      log.warn('投稿に失敗した:', posted.reason)
      return
    }

    // 自分の投稿として覚える (AC10)。**コメント経路が自分の返礼に反応しないため**にも要る
    rememberOwnPost(text, posted.element)

    // **投稿できたときだけ**履歴に残す。次回の起動はここから抑止を組み立てる。
    // 失敗した回まで残すと、投稿できていないのに抑止だけ効いてしまう。
    postLog = rememberPost(postLog, makePostRecord(event, text, { streamId, postedAt: Date.now() }))
    void guardAsync('投稿履歴の保存', () => savePostLog(postLog), undefined)

    if (!posted.element) return

    const result = await pin(posted.element, config.pinMode)
    log.info('固定結果:', result)
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
   * コメント返しを 1 件投稿する。**投稿できたら true**(キューの間隔の起点になる)。
   *
   * ⚠️ **固定しない (AC6)。**`pinMode` の値に関わらず固定操作を行わない。
   *    固定枠は 1 件しかなく、コメントのたびに上書きするとリダイレクト返礼の固定が流れる。
   */
  /** 判断は純関数に寄せてある([comment-reply.ts](./comment-reply.ts))。ここは実行だけ */
  const decide = (author: CommentAuthor, messageText: string) =>
    decideCommentReply({
      author,
      messageText,
      directory,
      postLog,
      commentTemplate: config.commentTemplate,
      streamId,
      now: Date.now(),
      ownTexts: ownMessageTexts,
    })

  const postCommentReply = async (author: CommentAuthor, messageText: string): Promise<boolean> => {
    // **キューに積んだ後に状況が変わりうる**(他の返礼が入る・設定が変わる)ので、
    // 投稿の直前にもう一度判断する
    const decision = decide(author, messageText)
    if (decision.action !== 'post') {
      log.info(`コメント返しを見送った (${decision.reason})`)
      return false
    }
    const { entry, text } = decision
    log.info('コメント返しを投稿する:', text)

    const posted = await postMessage(text)
    if (posted.status !== 'posted') {
      log.warn('コメント返しの投稿に失敗した:', posted.reason)
      return false
    }

    // ⚠️ **`selfEcho.remember` は呼ばない**(plan.md 6.)。
    //    `self-echo` の鍵は投稿相手の URL だけで**種別を持たない**ので、ここで覚えると
    //    30 秒の間その相手からの**リダイレクト受信が捨てられ、AC8 の後半が破れる。**
    //    そもそも `self-echo` が想定しているのは固定バナー経路で、コメント返しは固定しない (AC6)。
    rememberOwnPost(text, posted.element)

    postLog = rememberPost(
      postLog,
      makePostRecordFor(entry.url, text, { streamId, postedAt: Date.now(), kind: 'comment' }),
    )
    void guardAsync('投稿履歴の保存', () => savePostLog(postLog), undefined)
    return true
  }

  /**
   * 連投の抑制 (AC11)。**上限の分母は投稿履歴から数える** — メモリのカウンタにすると
   * チャットを開き直すたびに枠がリセットされ、上限が事実上効かない。
   */
  type QueuedComment = { author: CommentAuthor; messageText: string }
  const commentQueue = createPostQueue<QueuedComment>({
    countPosted: () => countCommentPostsInStream(postLog, streamId, Date.now()),
    post: (item) => postCommentReply(item.author, item.messageText),
    onSkip: (item, reason, error) => {
      if (reason === 'failed') log.error('コメント返しで例外:', error)
      else log.info(`コメント返しを見送った (${reason})`, item.author.channelId)
    },
  })

  /**
   * 検知したコメントを投稿の待ち行列へ積むまで。
   *
   * **自己ループの遮断 3 枚 (AC10) はここで効かせる。**
   * 1 枚目(投稿した要素)は検知側の `ignoreElement` で、抽出の前に弾いている。
   */
  const handleComment = (author: CommentAuthor, el: Element): void => {
    const messageText = getMessageText(el)
    const decision = decide(author, messageText)
    if (decision.action !== 'post') {
      // **無言で捨てない。**ただし「辞書に無い」は普通のコメントすべてが当たるので診断ログ側
      if (decision.reason === '辞書に該当が無い') {
        if (config.debug) log.info('[debug] 辞書に該当が無いコメント')
      } else {
        log.info(`コメント返しをしない (${decision.reason})`)
      }
      return
    }

    log.info('コメント返しの対象を検知した:', decision.entry.url)
    commentQueue.enqueue({ author, messageText })
  }

  /**
   * 検知の開始・停止 (AC1 / AC11)。
   *
   * **OFF の間は検知そのものを走らせない。**「見てから捨てる」にすると、捨て漏れが投稿に化ける。
   * **OFF になった時点で未処理のキューは捨てる** (AC11)。
   */
  let commentDetector: CommentDetectorHandle | null = null
  const syncCommentDetector = (enabled: boolean): void => {
    if (enabled === (commentDetector != null)) return
    if (enabled) {
      commentDetector = startCommentDetector({
        streamId,
        debug: () => config.debug,
        ignoreElement: (el) => ownMessageElements.has(el),
        onComment: (author, el) =>
          guard('コメント返しのパイプライン', () => handleComment(author, el), undefined),
      })
      log.info('コメント返しの検知を開始した')
    } else {
      commentDetector?.stop()
      commentDetector = null
      commentQueue.clear()
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
