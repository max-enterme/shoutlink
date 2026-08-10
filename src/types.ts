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
}

/** pinner.ts の戻り値 (plan.md) */
export type PinResult = 'pinned' | 'skipped' | 'unavailable'
