/**
 * コメント返しの連投抑制 (004 / AC11)。DOM に触らない。
 *
 * 該当者が同時に複数現れうる(ポップアウトの開き直し・フィルタ切替で、既存のコメントが
 * 追加ノードとして一斉に流れる / plan.md R3)ため、**逐次処理 + 最低間隔**で挟む。
 *
 * ⚠️ **1 配信あたりの件数の上限は 2026-09-05 に撤廃した**(MAX の判断 / AC11 を改訂)。
 *    残る歯止めは **AC7 の「同じ配信・同じ人に 1 回」と、この最低間隔**の 2 つ。
 *    一斉流入時に出る件数は、**辞書で「コメントに反応する」を付けた人数**が上限になる。
 *
 * ⚠️ **実時間で待たない形にしてある。**`wait` を注入できるので、テストは待たずに検証する。
 */

/** 投稿の最低間隔 (AC11)。**設定には出さない定数** */
export const COMMENT_REPLY_INTERVAL_MS = 5000

/** 投稿しなかった理由。切り分けのためログに出す */
export type SkipReason =
  /** キューを捨てた(スイッチが OFF になった / 配信が変わった) */
  | 'discarded'
  /** 投稿が例外を投げた (AC12)。**無言で消さないための窓** */
  | 'failed'

export type PostQueueOptions<T> = {
  /** 実際の投稿。**投稿できたら true**(false は間隔の起点にしない) */
  post: (item: T) => Promise<boolean>
  /** 投稿しなかったときの通知(ログ用)。`failed` のときだけ原因が付く */
  onSkip?: (item: T, reason: SkipReason, error?: unknown) => void
  now?: () => number
  /** 待つ手段。テストでは偽の時計を進めるだけの関数を渡す */
  wait?: (ms: number) => Promise<void>
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

      const waitMs = intervalMs - (now() - lastPostedAt)
      if (waitMs > 0) {
        await wait(waitMs)
        // 待っている間に捨てられたら、この 1 件も投稿しない (AC11)
        if (generation !== generationAtStart) {
          onSkip(item, 'discarded')
          return
        }
      }

      // **例外はここで握る (AC12)。**握らないと ① この 1 件が `onSkip` も呼ばれず無言で消え、
      // ② `running` に付いたプロミスが unhandledrejection になり、③ `idle()` が reject する。
      // このキューは「投稿が失敗しても配信に影響させない」ための層なので、ここで落ちては本末転倒。
      // 失敗は**間隔の起点にしない**(次の 1 件を無駄に待たせない)
      let posted = false
      try {
        posted = await options.post(item)
      } catch (err) {
        onSkip(item, 'failed', err)
      }
      if (posted) lastPostedAt = now()
    }
  }

  const kick = (): void => {
    if (running) return
    // **駆動側にも catch を置く** (AC12)。`drain` の中は握ってあるが、ここが素の promise だと
    // 万一 reject したときに unhandledrejection になり `idle()` も巻き込む
    running = drain()
      .catch((err) => onSkip(undefined as never, 'failed', err))
      .finally(() => {
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
