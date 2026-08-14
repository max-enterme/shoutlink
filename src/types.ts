/** リダイレクト受信イベント (plan.md のモジュール構成に対応) */
export type RedirectEvent = {
  sourceChannelName: string
  /** https://www.youtube.com/@handle または https://www.youtube.com/channel/UC... に正規化済み */
  sourceChannelUrl: string
  detectedAt: number
  /**
   * 発生経路。自動検知と手動トリガーは同じ RedirectEvent としてパイプラインを流れる
   * (分岐を 2 系統にしない)。ログ・デバッグ用の付加情報でしかない。
   */
  origin?: 'auto' | 'manual'
}

/** 固定モード (AC8) */
export type PinMode =
  | 'off' // 固定しない(投稿のみ)
  | 'ifEmpty' // 既存の固定が無いときだけ固定する(既定)
  | 'always' // 既存の固定があっても上書きする

export type Config = {
  enabled: boolean
  /** 例: '{name}さんからリダイレクトありがとうございます! {url}' */
  template: string
  pinMode: PinMode
  cooldownSec: number
  /**
   * ライブチャット画面の右下に手動トリガー (`↩ 返礼`) を出すか。
   *
   * **既定は false。**配信画面にチャット窓を載せていると常時映り込むため
   * ([docs/security-review.md](../docs/security-review.md) S8)。自動検知が空振りしたときの
   * 逃げ道 (plan.md R1) と、投稿・固定の切り分け経路としては必要なので、機能自体は残す。
   */
  showManualTrigger: boolean
  /**
   * 診断ログ。チャットに現れた「通常のメッセージ以外」のノードをすべてコンソールに出す。
   * リダイレクト通知の DOM が未確認(T1 未完)の間、その正体を掴むための唯一の手段。
   */
  debug: boolean
  /**
   * **辞書で「コメントに反応する」を付けた人のコメントに返す** (004 / AC1)。
   *
   * **既定は false。**これが 004 で投稿の頻度が上がることへの歯止めの 1 枚目
   * ([docs/d3-automation-policy.md](../docs/d3-automation-policy.md) / spec.md D3)。
   * **OFF の間はコメントの検知そのものを走らせない** — 「見てから捨てる」にすると、
   * 捨て漏れが投稿に化ける経路が残る。
   *
   * `enabled`(自動検知 = リダイレクト受信)とは**独立**。片方を切っても他方は動く。
   */
  commentReplyEnabled: boolean
  /**
   * コメント返しの文面 (AC5)。**リダイレクト返礼の `template` とは別に持つ。**
   *
   * 1 本にまとめると「リダイレクトありがとうございます」がただのコメントに対して出て
   * **文面が嘘になる**(spec.md「既定テンプレートを 001 のものと混ぜない」)。
   *
   * `{msg}` に入るのは **`DirectoryEntry.commentMessage`**(コメント返し専用の自由文)であって、
   * 003 の `DirectoryEntry.message` ではない (AC16 / spec.md D4)。
   */
  commentTemplate: string
}

/** pinner.ts の戻り値 (plan.md) */
export type PinResult = 'pinned' | 'skipped' | 'unavailable'
