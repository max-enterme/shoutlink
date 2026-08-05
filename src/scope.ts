/**
 * **どのチャットで動いてよいか**の判定。
 *
 * ⚠️ 2026-08-06 の事故:
 *   content script は `www.youtube.com/live_chat*` にも注入されるため、
 *   **他人の配信のチャットを開いているだけで動いてしまい、その配信が
 *   リダイレクトを受けたときに自分の名義で「ありがとうございます」を投稿していた。**
 *   他人のチャットを荒らす実害があるので、既定では動かす場所を絞る。
 *
 * `studio.youtube.com` のライブ管制室は**自分の配信でしか開けない**ため、
 * 「自分の配信である」ことの代わりに使える唯一の確実な手掛かり。
 */

export const STUDIO_HOST = 'studio.youtube.com'

export type ScopeDecision = {
  allowed: boolean
  reason: string
}

/**
 * このホストで動かしてよいか。
 *
 * - `studio.youtube.com` → **常に許可**(自分の配信の管制室)
 * - それ以外(`www.youtube.com` 等)→ **既定は不許可。**設定で明示的に許可したときだけ動く。
 *   許可した場合、**他人の配信のチャットを開いていると誤爆する**ことを利用者が承知している前提。
 */
export function decideScope(hostname: string, allowWww: boolean): ScopeDecision {
  if (hostname === STUDIO_HOST) {
    return { allowed: true, reason: 'Studio のライブ管制室(自分の配信)' }
  }
  if (allowWww) {
    return {
      allowed: true,
      reason: `設定で ${hostname} を許可済み(他人の配信のチャットでは無効化すること)`,
    }
  }
  return {
    allowed: false,
    reason: `${hostname} では既定で動かさない。自分の配信かどうかを判別できず、他人のチャットへ投稿する恐れがあるため`,
  }
}
