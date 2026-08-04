const PREFIX = '[yt-redirect-pin]'

/**
 * AC6: 検知・投稿・固定のいずれが失敗しても配信そのものに影響させない。
 * 例外はここで握り潰し、ログだけ残す。
 */
export const log = {
  info(...args: unknown[]): void {
    console.info(PREFIX, ...args)
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args)
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args)
  },
}

/** 同期処理を握り潰す。失敗時は fallback を返す。 */
export function guard<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (err) {
    log.error(`${label} で例外:`, err)
    return fallback
  }
}

/** 非同期処理を握り潰す。失敗時は fallback を返す。 */
export async function guardAsync<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    log.error(`${label} で例外:`, err)
    return fallback
  }
}
