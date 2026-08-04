/**
 * 同一送信元・クールダウンの多重発火抑止 (AC4)。DOM に触らない。
 *
 * 「同一配信内」は、配信が変わったときに `reset()` を呼ぶことで表現する
 * (content script はチャット文書ごとに動くため、通常は文書のライフサイクル = 1 配信)。
 */
import type { RedirectEvent } from './types'

export type Dedupe = {
  /** 発火してよければ true を返し、同時に「発火した」として記録する */
  tryAcquire(event: RedirectEvent, now?: number): boolean
  /** 記録を捨てる(配信が変わったとき) */
  reset(): void
  /** クールダウン秒数を差し替える(設定変更時) */
  setCooldownSec(sec: number): void
}

/** 送信元の同一性は正規化済みチャンネル URL で判定する */
export function sourceKey(event: RedirectEvent): string {
  return event.sourceChannelUrl.trim().toLowerCase()
}

export function createDedupe(cooldownSec: number): Dedupe {
  let cooldown = cooldownSec
  let lastFiredAt = new Map<string, number>()

  return {
    tryAcquire(event, now = Date.now()) {
      const key = sourceKey(event)
      const previous = lastFiredAt.get(key)
      // cooldown <= 0 は抑止なし(同一送信元でも毎回通す)
      if (previous != null && cooldown > 0 && now - previous < cooldown * 1000) return false
      lastFiredAt.set(key, now)
      return true
    },
    reset() {
      lastFiredAt = new Map()
    },
    setCooldownSec(sec) {
      cooldown = sec
    },
  }
}
