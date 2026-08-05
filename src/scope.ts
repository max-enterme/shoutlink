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
 * このホストで動かしてよいか。**`studio.youtube.com` だけ。**
 *
 * `www.youtube.com` を設定で許可する余地は**意図的に持たせない**。
 * そこでは自分の配信か他人の配信かを原理的に判別できず、
 * 「許可すると他人のチャットへ投稿しうる」設定は安全にしようがないため。
 * ポップアウト運用も `studio.youtube.com/live_chat?is_popout=1` で足りる。
 *
 * manifest からも `www` を外してあるので通常ここへは来ないが、
 * 注入先が増えたときの二重の歯止めとして残す。
 */
export function decideScope(hostname: string): ScopeDecision {
  if (hostname === STUDIO_HOST) {
    return { allowed: true, reason: 'Studio のライブ管制室(自分の配信)' }
  }
  return {
    allowed: false,
    reason: `${hostname} では動かさない。自分の配信かどうかを判別できず、他人のチャットへ投稿する恐れがあるため`,
  }
}
