/**
 * 同一送信元・クールダウンの多重発火抑止 (AC4)。DOM に触らない。
 *
 * **クールダウンは「同じ配信の中」でだけ効かせる。**
 *   - 配信が違う(`streamId` が違う)→ **クールダウンに関係なく通す。**
 *     別の配信でリダイレクトを受けたなら、それは別の出来事として返礼したい。
 *   - 同じ配信 → 設定のクールダウン秒数で判定する。
 *
 * ⚠️ **記録はメモリだけに持たない。**リロードで消えると抑止が白紙に戻り、
 *    残っている通知を拾って再投稿する (2026-08-06 の不具合)。
 *    保存済みの投稿履歴 (`post-log.ts`) を `history` として渡し、起動時に読み戻す。
 *    読み戻すのは**今の配信の記録だけ**(他の配信の記録は上のルールで無視する)。
 */
import type { RedirectEvent } from './types'

/**
 * **配信 ID が取れないときだけ使うクールダウンの下限(6 時間)。**
 *
 * 配信を特定できないと「同じ配信か」が判断できず、履歴を捨てることも信じることもできない。
 * リダイレクトの通知は配信が終わるまで消えないので、秒〜分のクールダウンだけに頼ると
 * **チャットを開き直すたびに再投稿する**(2026-08-06 の不具合)。
 * 「返礼を 1 回取りこぼす」より「同じ相手に何度も投稿する」方が実害が大きいので、
 * 判定材料が無いときは長い方に倒す。
 *
 * かかるのは **配信 ID が不明 かつ 前回の起動で投稿していた**ときだけ。
 * 同じ画面のままの連続発火は、設定どおりのクールダウンで判定する。
 */
export const UNKNOWN_STREAM_MIN_COOLDOWN_SEC = 6 * 60 * 60

/** 抑止の判定に使う、保存済み投稿の最小形 (`post-log.ts` の `PostRecord` が当てはまる) */
export type PriorPost = {
  url: string
  postedAt: number
  streamId?: string
  /**
   * 投稿の種別 (004 / AC8)。**欠損は `redirect` 扱い** — 004 以前の記録はリダイレクト返礼しかない。
   * ここが `'comment'` の記録は**リダイレクト側の抑止に取り込まない**(下の `absorb`)。
   */
  kind?: 'redirect' | 'comment'
}

export type DedupeOptions = {
  /** 今見ているチャットの配信 ID。空なら「同じ配信か」を判定できない */
  streamId?: string
  /** 保存済みの投稿履歴(リロードをまたいで抑止を効かせるための初期値) */
  history?: readonly PriorPost[]
}

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
  return channelKey(event.sourceChannelUrl)
}

function channelKey(url: string): string {
  return url.trim().toLowerCase()
}

/** 直近の発火。`restored` = 保存済み履歴から読み戻したもの(= 前回の起動での投稿) */
type Fire = { at: number; restored: boolean }

export function createDedupe(cooldownSec: number, options: DedupeOptions = {}): Dedupe {
  let cooldown = cooldownSec
  const streamId = options.streamId ?? ''
  let lastFiredAt = new Map<string, Fire>()

  /**
   * 保存済みの履歴を読み戻す。
   * **今の配信の記録だけを採る。**配信 ID が取れているなら、他の配信での投稿は
   * 「別の出来事」なので抑止に使わない。取れていない場合だけ、全部を安全側で見る。
   */
  const absorb = (history: readonly PriorPost[]): void => {
    for (const post of history) {
      if (!post || typeof post.url !== 'string' || !Number.isFinite(post.postedAt)) continue
      // **コメント返しの記録は取り込まない** (004 / AC8)。
      // 抑止は非対称で、「コメント返し済みでもリダイレクト返礼はする」(こちらが本命)。
      // 取り込むと、コメント返しの記録が起動時からリダイレクト側のクールダウンを埋める。
      if (post.kind === 'comment') continue
      if (streamId && post.streamId !== streamId) continue
      const key = channelKey(post.url)
      const previous = lastFiredAt.get(key)
      if (previous == null || post.postedAt > previous.at) {
        lastFiredAt.set(key, { at: post.postedAt, restored: true })
      }
    }
  }
  absorb(options.history ?? [])

  return {
    tryAcquire(event, now = Date.now()) {
      const key = sourceKey(event)
      // cooldown <= 0 は抑止なし(同一送信元でも毎回通す)。
      // 「同じ相手に何度も投稿して試す」ための逃げ道なので、履歴があっても通す。
      if (cooldown <= 0) {
        lastFiredAt.set(key, { at: now, restored: false })
        return true
      }

      const previous = lastFiredAt.get(key)
      if (previous != null) {
        // 配信を特定できず、かつ前回の起動での投稿なら長い方に倒す(上の定数を参照)
        const effective =
          previous.restored && !streamId
            ? Math.max(cooldown, UNKNOWN_STREAM_MIN_COOLDOWN_SEC)
            : cooldown
        if (now - previous.at < effective * 1000) return false
      }

      lastFiredAt.set(key, { at: now, restored: false })
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
