import { describe, expect, it } from 'vitest'
import { COMMENT_REPLY_INTERVAL_MS, createPostQueue } from '../src/post-queue'
import type { SkipReason } from '../src/post-queue'

/**
 * 偽の時計。**実時間で待たない** (AC11 / plan.md 5.)。
 * `wait(ms)` は「その ms だけ時計を進めて即座に解決する」だけ。
 */
function fakeClock(startAt = 0) {
  let current = startAt
  const waited: number[] = []
  return {
    now: () => current,
    waited,
    wait: async (ms: number): Promise<void> => {
      waited.push(ms)
      current += ms
    },
    advance: (ms: number): void => {
      current += ms
    },
  }
}

type Harness = {
  posted: string[]
  skipped: { item: string; reason: SkipReason }[]
}

function harness(): Harness {
  return { posted: [], skipped: [] }
}

describe('createPostQueue (AC11)', () => {
  it('1 件だけなら待たずに投稿する', async () => {
    const clock = fakeClock()
    const h = harness()
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        h.posted.push(item)
        return true
      },
    })

    queue.enqueue('a')
    await queue.idle()

    expect(h.posted).toEqual(['a'])
    expect(clock.waited).toEqual([])
  })

  it('**逐次に、最低 5 秒の間隔を空けて**投稿する', async () => {
    const clock = fakeClock()
    const h = harness()
    const times: number[] = []
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        times.push(clock.now())
        h.posted.push(item)
        return true
      },
    })

    queue.enqueue('a')
    queue.enqueue('b')
    queue.enqueue('c')
    await queue.idle()

    expect(h.posted).toEqual(['a', 'b', 'c'])
    expect(times).toEqual([0, COMMENT_REPLY_INTERVAL_MS, COMMENT_REPLY_INTERVAL_MS * 2])
  })

  it('前の投稿から十分に時間が経っていれば待たない', async () => {
    const clock = fakeClock()
    const h = harness()
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        h.posted.push(item)
        return true
      },
    })

    queue.enqueue('a')
    await queue.idle()
    clock.advance(COMMENT_REPLY_INTERVAL_MS)
    queue.enqueue('b')
    await queue.idle()

    expect(clock.waited).toEqual([])
  })

  it('**投稿に失敗した回は間隔の起点にしない**(次の 1 件を無駄に待たせない)', async () => {
    const clock = fakeClock()
    const h = harness()
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        if (item === 'a') return false
        h.posted.push(item)
        return true
      },
    })

    queue.enqueue('a')
    queue.enqueue('b')
    await queue.idle()

    expect(h.posted).toEqual(['b'])
    expect(clock.waited).toEqual([])
  })

  it('**件数の上限は無い** (2026-09-05 に撤廃 / AC11 改訂)', async () => {
    const clock = fakeClock()
    const h = harness()
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        h.posted.push(item)
        return true
      },
      onSkip: (item, reason) => h.skipped.push({ item, reason }),
    })

    // かつての上限 (20) を大きく超える数を積んでも、1 件も落とさない
    const items = Array.from({ length: 50 }, (_, i) => `i${i}`)
    for (const item of items) queue.enqueue(item)
    await queue.idle()

    expect(h.posted).toEqual(items)
    expect(h.skipped).toEqual([])
  })

  it('**clear() で未処理を捨てる**(スイッチが OFF になったとき)', async () => {
    const clock = fakeClock()
    const h = harness()
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        h.posted.push(item)
        return true
      },
      onSkip: (item, reason) => h.skipped.push({ item, reason }),
    })

    queue.enqueue('a')
    queue.enqueue('b')
    queue.enqueue('c')
    queue.clear()
    await queue.idle()

    // 1 件目は走り出しているが、2 件目以降は捨てる
    expect(h.posted).toEqual(['a'])
    expect(h.skipped.map((s) => s.item).sort()).toEqual(['b', 'c'])
    expect(h.skipped.every((s) => s.reason === 'discarded')).toBe(true)
    expect(queue.pending).toBe(0)
  })

  it('**間隔を待っている最中に捨てられたら、その 1 件も投稿しない**', async () => {
    const clock = fakeClock()
    const h = harness()
    let queueRef: { clear(): void } | null = null
    const queue = createPostQueue<string>({
      now: clock.now,
      // 待ちに入った瞬間に捨てる(スイッチが OFF になった状況)
      wait: async (ms) => {
        clock.advance(ms)
        queueRef?.clear()
      },
      post: async (item) => {
        h.posted.push(item)
        return true
      },
      onSkip: (item, reason) => h.skipped.push({ item, reason }),
    })
    queueRef = queue

    queue.enqueue('a')
    queue.enqueue('b')
    await queue.idle()

    expect(h.posted).toEqual(['a'])
    expect(h.skipped).toEqual([{ item: 'b', reason: 'discarded' }])
  })

  it('捨てた直後に積み直したら、新しい分は投稿する', async () => {
    const clock = fakeClock()
    const h = harness()
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        h.posted.push(item)
        return true
      },
      onSkip: (item, reason) => h.skipped.push({ item, reason }),
    })

    queue.enqueue('a')
    queue.clear()
    queue.enqueue('b')
    await queue.idle()

    expect(h.posted).toContain('b')
  })

  it('処理中に積まれた分も取りこぼさない', async () => {
    const clock = fakeClock()
    const h = harness()
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        h.posted.push(item)
        if (item === 'a') queue.enqueue('b')
        return true
      },
    })

    queue.enqueue('a')
    await queue.idle()

    expect(h.posted).toEqual(['a', 'b'])
  })

  it('**post が例外を投げても飲み込み、キューは止まらない** (AC12)', async () => {
    const clock = fakeClock()
    const h = harness()
    const errors: unknown[] = []
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        if (item === 'a') throw new Error('投稿でこけた')
        h.posted.push(item)
        return true
      },
      onSkip: (item, reason, error) => {
        h.skipped.push({ item, reason })
        if (error) errors.push(error)
      },
    })

    queue.enqueue('a')
    queue.enqueue('b')
    // idle() が reject しないこと(reject すると呼び出し側まで巻き込む)
    await expect(queue.idle()).resolves.toBeUndefined()

    expect(h.posted).toEqual(['b'])
    expect(h.skipped).toEqual([{ item: 'a', reason: 'failed' }])
    expect(errors).toHaveLength(1)
  })

  it('例外で終わった回は間隔の起点にしない(次の 1 件を無駄に待たせない)', async () => {
    const clock = fakeClock()
    const h = harness()
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      post: async (item) => {
        if (item === 'a') throw new Error('投稿でこけた')
        h.posted.push(item)
        return true
      },
      onSkip: (item, reason) => h.skipped.push({ item, reason }),
    })

    queue.enqueue('a')
    queue.enqueue('b')
    await queue.idle()

    expect(clock.waited).toEqual([])
  })

  it('定数は spec のとおり(5 秒)', () => {
    expect(COMMENT_REPLY_INTERVAL_MS).toBe(5_000)
  })
})
