/**
 * コメント返しの実行(判断 → キュー → 投稿)と、自己ループの記憶 (004 / AC10 / AC11)。
 *
 * **`main.ts` から切り出してある。**理由は [comment-reply.ts](./comment-reply.ts) と同じで、
 * `main.ts` は `chrome` と実 DOM が無いと動かず、**R2(降りる箇所)の歯止めが
 * 「実際に配線されているか」を自動で確かめられない**ため。
 * ここは依存をすべて注入で受けるので、jsdom も chrome も要らずにテストできる。
 *
 * 持っているのは **3 つ**:
 * 1. 自分が投稿した要素と本文の記憶 (AC10 の 1・2 枚目)
 * 2. 投稿の待ち行列 (AC11)
 * 3. 「投稿する / しない」の判断を [comment-reply.ts](./comment-reply.ts) へ渡す配線
 */
import { decideCommentReply } from './comment-reply'
import type { CommentAuthor } from './comment-detector'
import type { Directory } from './directory'
import { makePostRecordFor, rememberPost } from './post-log'
import type { PostLog } from './post-log'
import { createPostQueue } from './post-queue'
import type { PostQueue, SkipReason } from './post-queue'

/** 投稿の結果。`element` は特定できないことがある([poster.ts](./poster.ts)) */
export type CommentPostOutcome = { posted: boolean; element: Element | null }

export type CommentRunnerDeps = {
  /** **投稿の直前にも見る。**OFF にした瞬間に走っている 1 件を止めるため (AC1 / AC11) */
  isEnabled: () => boolean
  getDirectory: () => Directory
  getPostLog: () => PostLog
  /** 投稿履歴を更新する(保存は呼び出し側) */
  setPostLog: (log: PostLog) => void
  getCommentTemplate: () => string
  streamId: string
  /** **固定はしない (AC6)。**投稿だけを行う関数を渡す */
  post: (text: string) => Promise<CommentPostOutcome>
  now?: () => number
  wait?: (ms: number) => Promise<void>
  onLog?: (message: string, detail?: unknown) => void
}

export type CommentRunner = {
  /** 検知したコメントを積む(AC9 を通ったものだけが来る前提) */
  handle(author: CommentAuthor, messageText: string): void
  /** **自分が投稿した要素か** (AC10 の 1 枚目)。検知側の `ignoreElement` に渡す */
  isOwnElement(el: Element): boolean
  /** リダイレクト返礼の投稿もここへ登録する(コメント経路が自分の返礼に反応しないため) */
  rememberOwnPost(text: string, element: Element | null): void
  /** スイッチが OFF になったとき。**未処理のキューを捨てる** (AC11) */
  clear(): void
  readonly pending: number
  /** テスト用 */
  idle(): Promise<void>
}

/**
 * 覚えておく本文の件数(自己ループの抑止に使う)。
 *
 * ⚠️ **2026-09-05 に 50 → 200 へ上げた。**もとは「1 配信 20 件(AC11)+ リダイレクト返礼ぶん」で
 *    足りるという見積もりだったが、**その 20 件の上限を撤廃した**ので、1 配信に出る件数は
 *    **辞書で「コメントに反応する」を付けた人数**まで伸びる。溢れると古い本文から忘れる。
 */
export const OWN_TEXT_MEMORY = 200

export function createCommentRunner(deps: CommentRunnerDeps): CommentRunner {
  const now = deps.now ?? (() => Date.now())
  const log = deps.onLog ?? (() => {})

  /**
   * **自分が投稿した要素と本文** (AC10 の 1・2 枚目)。
   *
   * 1 枚目は [poster.ts](./poster.ts) が要素の特定に失敗しうるので**単独では信用しない**。
   * 2 枚目(本文)がその受け皿。
   */
  const ownElements = new WeakSet<Element>()
  const ownTexts = new Set<string>()

  const rememberOwnPost = (text: string, element: Element | null): void => {
    if (element) ownElements.add(element)
    if (text) ownTexts.add(text)
    while (ownTexts.size > OWN_TEXT_MEMORY) {
      const oldest = ownTexts.values().next().value
      if (oldest === undefined) break
      ownTexts.delete(oldest)
    }
  }

  const decide = (author: CommentAuthor, messageText: string) =>
    decideCommentReply({
      author,
      messageText,
      directory: deps.getDirectory(),
      postLog: deps.getPostLog(),
      commentTemplate: deps.getCommentTemplate(),
      streamId: deps.streamId,
      now: now(),
      ownTexts,
      enabled: deps.isEnabled(),
    })

  const runOne = async (item: { author: CommentAuthor; messageText: string }): Promise<boolean> => {
    // **キューに積んだ後に状況が変わりうる**(他の返礼が入る・設定が変わる)ので、
    // 投稿の直前にもう一度判断する。**スイッチもここで見る** (AC1)
    const decision = decide(item.author, item.messageText)
    if (decision.action !== 'post') {
      log(`コメント返しを見送った (${decision.reason})`)
      return false
    }
    const { entry, text } = decision
    log('コメント返しを投稿する:', text)

    // ⚠️ **投稿の「前」に本文を覚える (AC10 の 2 枚目)。**
    //    MutationObserver は自分の投稿ノードを**マイクロタスクで**配送するのに対し、
    //    `postMessage` は要素の確認をポーリング(マクロタスク)で行う。**投稿の後に覚えると、
    //    自分の投稿に対する検知のほうが先に走り、1・2 枚目が間に合わない。**
    //    `selfEcho.remember` を投稿前に置いているのと同じ理由。
    //    投稿に失敗した場合は「同じ本文のコメントに反応しない」だけが残るが、安全側。
    rememberOwnPost(text, null)

    const outcome = await deps.post(text)
    if (!outcome.posted) return false

    // 要素は投稿できて初めて分かる (AC10 の 1 枚目)
    rememberOwnPost(text, outcome.element)

    deps.setPostLog(
      rememberPost(
        deps.getPostLog(),
        makePostRecordFor(entry.url, text, { streamId: deps.streamId, postedAt: now(), kind: 'comment' }),
      ),
    )
    return true
  }

  const queue: PostQueue<{ author: CommentAuthor; messageText: string }> = createPostQueue({
    now,
    wait: deps.wait,
    post: runOne,
    onSkip: (item, reason: SkipReason, error) => {
      if (reason === 'failed') log('コメント返しで例外:', error)
      else log(`コメント返しを見送った (${reason})`, item.author.channelId)
    },
  })

  return {
    handle(author, messageText) {
      const decision = decide(author, messageText)
      if (decision.action !== 'post') {
        // **無言で捨てない。**ただし「辞書に該当が無い」は普通のコメントすべてが当たるので、
        // 呼び出し側が診断ログ扱いにする
        log(`コメント返しをしない (${decision.reason})`, decision.reason)
        return
      }
      log('コメント返しの対象を検知した:', decision.entry.url)
      queue.enqueue({ author, messageText })
    },
    isOwnElement: (el) => ownElements.has(el),
    rememberOwnPost,
    clear: () => queue.clear(),
    get pending() {
      return queue.pending
    },
    idle: () => queue.idle(),
  }
}
