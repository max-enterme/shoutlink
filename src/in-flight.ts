/**
 * 同じ相手への投稿が重なって走らないための歯止め (AC1 / AC13)。
 *
 * `postLog` は**投稿できたときだけ**記録するので、`await postMessage(...)` の間に
 * 同じ通知がもう一度来ると、1 件目がまだ履歴に残っていないため 2 件目が素通りする。
 * ここで投稿の**前**に同期的に枠を取り、投稿の成否に関わらず `finally` で必ず解放する
 * (失敗した回まで枠を残すと、次に検知したときにもう一度試せなくなる / AC1)。
 *
 * **チャットの入力欄は 1 つしかない。**`isBusy()` は URL を問わず「何かの投稿が走っているか」を
 * 返す — 人がタイミングを選べるテスト送信 (006) が自動検知・手動トリガーの投稿に割り込むと、
 * 入力欄の上書きと要素の取り違えが起きるため (AC13)。
 */
import { postLogKey } from './post-log'

export type InFlightGuard = {
  /** 投稿を始める。**同じ URL が処理中なら false**(始めてはいけない) */
  begin(url: string): boolean
  /** **必ず `finally` で呼ぶ。**投稿に失敗しても呼ぶ (AC1) */
  end(url: string): void
  /** 何かの投稿が走っているか (AC13)。テスト送信はこれが true なら `busy` を返す */
  isBusy(): boolean
}

export function createInFlightGuard(): InFlightGuard {
  const inFlight = new Set<string>()

  return {
    begin(url) {
      const key = postLogKey(url)
      if (inFlight.has(key)) return false
      inFlight.add(key)
      return true
    },
    end(url) {
      inFlight.delete(postLogKey(url))
    },
    isBusy() {
      return inFlight.size > 0
    },
  }
}
