import { describe, expect, it } from 'vitest'
import {
  COMMENT_REPLY_INTERVAL_MS,
  COMMENT_REPLY_MAX_PER_STREAM,
  createPostQueue,
} from '../src/post-queue'
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
      countPosted: () => h.posted.length,
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
      countPosted: () => h.posted.length,
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
      countPosted: () => h.posted.length,
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
      countPosted: () => h.posted.length,
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

  it('**1 配信 20 件の上限**を超えたら投稿せずログに残す', async () => {
    const clock = fakeClock()
    const h = harness()
    // 既に上限ぶん投稿済みの状態(投稿履歴から数える / AC11)
    let already = COMMENT_REPLY_MAX_PER_STREAM
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      countPosted: () => already,
      post: async (item) => {
        h.posted.push(item)
        already += 1
        return true
      },
      onSkip: (item, reason) => h.skipped.push({ item, reason }),
    })

    queue.enqueue('a')
    await queue.idle()

    expect(h.posted).toEqual([])
    expect(h.skipped).toEqual([{ item: 'a', reason: 'limit' }])
  })

  it('上限に達するまでは投稿し、そこから先を落とす', async () => {
    const clock = fakeClock()
    const h = harness()
    let already = COMMENT_REPLY_MAX_PER_STREAM - 2
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      countPosted: () => already,
      post: async (item) => {
        h.posted.push(item)
        already += 1
        return true
      },
      onSkip: (item, reason) => h.skipped.push({ item, reason }),
    })

    for (const item of ['a', 'b', 'c', 'd']) queue.enqueue(item)
    await queue.idle()

    expect(h.posted).toEqual(['a', 'b'])
    expect(h.skipped.map((s) => s.item)).toEqual(['c', 'd'])
    expect(h.skipped.every((s) => s.reason === 'limit')).toBe(true)
  })

  it('**上限は投稿の直前に数える**(待っている間に増えた分を数え落とさない)', async () => {
    const clock = fakeClock()
    const h = harness()
    // 外(リダイレクト経路ではなく別のタブ等)で増えた想定
    let already = 0
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      countPosted: () => already,
      post: async (item) => {
        h.posted.push(item)
        already = COMMENT_REPLY_MAX_PER_STREAM
        return true
      },
      onSkip: (item, reason) => h.skipped.push({ item, reason }),
    })

    queue.enqueue('a')
    queue.enqueue('b')
    await queue.idle()

    expect(h.posted).toEqual(['a'])
    expect(h.skipped).toEqual([{ item: 'b', reason: 'limit' }])
  })

  it('**clear() で未処理を捨てる**(スイッチが OFF になったとき)', async () => {
    const clock = fakeClock()
    const h = harness()
    const queue = createPostQueue<string>({
      now: clock.now,
      wait: clock.wait,
      countPosted: () => h.posted.length,
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
      countPosted: () => h.posted.length,
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
      countPosted: () => h.posted.length,
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
      countPosted: () => h.posted.length,
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

  it('定数は spec のとおり(5 秒 / 20 件)', () => {
    expect(COMMENT_REPLY_INTERVAL_MS).toBe(5_000)
    expect(COMMENT_REPLY_MAX_PER_STREAM).toBe(20)
  })
})
