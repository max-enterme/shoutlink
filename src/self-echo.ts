/**
 * 自己反射(自分の投稿を、自分で通知として拾い直す)の抑止。
 *
 * ⚠️ **経路 (security-review.md S1):**
 *   投稿した返礼メッセージ自体は `isChatTextMessage` / `isInsideChatTextMessage` で除外されるが、
 *   **それを固定したときに現れる固定バナーは別のノード**であり、`MutationObserver` は
 *   `body` 全体を見ているのでバナーの追加も拾う。バナーの中には返礼文
 *   (= 送信元の `@ハンドル` とチャンネル URL)がそのまま入っているため、
 *   **同じ送信元の新しい通知として検知されうる。**
 *
 * dedupe も同じ送信元を鍵にしているので通常はそこで止まるが、
 * **`cooldownSec = 0`(抑止なし)にすると外れる。**そこは配信者が調整する値であって、
 * 自己ループの歯止めを預けてよい場所ではない。ここで**設定と独立した最低限の窓**を持つ。
 *
 * 抑止するのは**自動検知のイベントだけ。**手動トリガーは人が明示的に押しているので通す
 * (クールダウン 0 で同じ相手に何度も投稿して試す、という使い方を壊さないため)。
 */

/** 自分の投稿を「反射」とみなす窓。設定からは変えられない */
export const SELF_ECHO_WINDOW_MS = 30_000

export type SelfEchoGuard = {
  /** 投稿した(これから投稿する)送信元を覚える */
  remember(url: string, now?: number): void
  /** 直前に自分が投稿した相手か */
  isEcho(url: string, now?: number): boolean
}

/** 送信元の同一性は正規化済みチャンネル URL で判定する(dedupe と同じ考え方) */
function key(url: string): string {
  return url.trim().toLowerCase()
}

export function createSelfEchoGuard(windowMs: number = SELF_ECHO_WINDOW_MS): SelfEchoGuard {
  const postedAt = new Map<string, number>()

  return {
    remember(url, now = Date.now()) {
      postedAt.set(key(url), now)
    },
    isEcho(url, now = Date.now()) {
      const at = postedAt.get(key(url))
      if (at == null) return false
      if (now - at >= windowMs) {
        postedAt.delete(key(url))
        return false
      }
      return true
    },
  }
}
