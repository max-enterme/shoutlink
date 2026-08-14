/**
 * コメント返しの連投抑制 (004 / AC11)。DOM に触らない。
 *
 * 該当者が同時に複数現れうる(ポップアウトの開き直し・フィルタ切替で、既存のコメントが
 * 追加ノードとして一斉に流れる / plan.md R3)ため、**逐次処理 + 最低間隔 + 上限**で挟む。
 *
 * ⚠️ **上限の分母をここで数えない。**「今の配信で何件出したか」は投稿履歴から数える
 *    (`countPosted` で注入する / AC11)。メモリのカウンタにすると、チャットを開き直すたびに
 *    枠がリセットされ、上限が事実上効かない(2026-08-06 ④ で一度踏んだ形)。
 *
 * ⚠️ **実時間で待たない形にしてある。**`wait` を注入できるので、テストは待たずに検証する。
 */

/** 投稿の最低間隔 (AC11)。**設定には出さない定数** */
export const COMMENT_REPLY_INTERVAL_MS = 5000

/**
 * 1 配信あたりのコメント返しの上限 (AC11)。**設定には出さない定数。**
 * リダイレクト返礼は数に入れない(数えるのは `kind='comment'` の記録だけ)。
 */
export const COMMENT_REPLY_MAX_PER_STREAM = 20

/** 投稿しなかった理由。切り分けのためログに出す */
export type SkipReason =
  /** 1 配信の上限に達した (AC11) */
  | 'limit'
  /** キューを捨てた(スイッチが OFF になった / 配信が変わった) */
  | 'discarded'

export type PostQueueOptions<T> = {
  /** 実際の投稿。**投稿できたら true**(false は間隔の起点にしない) */
  post: (item: T) => Promise<boolean>
  /** 今の配信で既に出したコメント返しの件数 (AC11)。**投稿履歴から数える** */
  countPosted: () => number
  /** 投稿しなかったときの通知(ログ用) */
  onSkip?: (item: T, reason: SkipReason) => void
  now?: () => number
  /** 待つ手段。テストでは偽の時計を進めるだけの関数を渡す */
  wait?: (ms: number) => Promise<void>
  /** 上限。既定は `COMMENT_REPLY_MAX_PER_STREAM` */
  maxPerStream?: number
  /** 最低間隔。既定は `COMMENT_REPLY_INTERVAL_MS` */
  intervalMs?: number
}

export type PostQueue<T> = {
  /** 投稿待ちに積む。処理は自動で始まる */
  enqueue(item: T): void
  /** **未処理を捨てる** (AC11)。待っている最中の 1 件も投稿しない */
  clear(): void
  /** 待っている件数(テスト・ログ用) */
  readonly pending: number
  /** 処理中のものが片付くまで待つ(テスト用) */
  idle(): Promise<void>
}

export function createPostQueue<T>(options: PostQueueOptions<T>): PostQueue<T> {
  const now = options.now ?? (() => Date.now())
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxPerStream = options.maxPerStream ?? COMMENT_REPLY_MAX_PER_STREAM
  const intervalMs = options.intervalMs ?? COMMENT_REPLY_INTERVAL_MS
  const onSkip = options.onSkip ?? (() => {})

  const queue: T[] = []
  /**
   * `clear()` のたびに増やす。**待っている間に捨てられたかを、待ち明けに判定する**ための印。
   * 真偽値のフラグだと「捨てた直後に積み直した」場合に取り違える。
   */
  let generation = 0
  let running: Promise<void> | null = null
  /** 直前に**投稿できた**時刻。失敗した回は間隔の起点にしない */
  let lastPostedAt = Number.NEGATIVE_INFINITY

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      const generationAtStart = generation
      const item = queue.shift() as T

      // **上限は投稿の直前に見る。**積んだ時点で見ると、待っている間に増えた分を数え落とす
      if (options.countPosted() >= maxPerStream) {
        onSkip(item, 'limit')
        continue
      }

      const waitMs = intervalMs - (now() - lastPostedAt)
      if (waitMs > 0) {
        await wait(waitMs)
        // 待っている間に捨てられたら、この 1 件も投稿しない (AC11)
        if (generation !== generationAtStart) {
          onSkip(item, 'discarded')
          return
        }
      }

      if (await options.post(item)) lastPostedAt = now()
    }
  }

  const kick = (): void => {
    if (running) return
    running = drain().finally(() => {
      running = null
      // 処理中に積まれた分を取りこぼさない
      if (queue.length > 0) kick()
    })
  }

  return {
    enqueue(item) {
      queue.push(item)
      kick()
    },
    clear() {
      generation += 1
      const discarded = queue.splice(0, queue.length)
      for (const item of discarded) onSkip(item, 'discarded')
    },
    get pending() {
      return queue.length
    },
    async idle() {
      // 直列に処理するので、走っている限り待ち続ける
      while (running) await running
    },
  }
}
