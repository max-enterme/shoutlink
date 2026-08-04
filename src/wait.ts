export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type WaitForOptions = {
  timeoutMs?: number
  intervalMs?: number
}

/**
 * fn が非 null を返すまでポーリングする。最初の 1 回は即座に評価する。
 * タイムアウトしたら null。
 */
export async function waitFor<T>(fn: () => T | null, opts: WaitForOptions = {}): Promise<T | null> {
  const timeoutMs = opts.timeoutMs ?? 3000
  const intervalMs = opts.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const value = fn()
    if (value != null) return value
    if (Date.now() >= deadline) return null
    await sleep(intervalMs)
  }
}
