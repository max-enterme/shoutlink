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
}

/** pinner.ts の戻り値 (plan.md) */
export type PinResult = 'pinned' | 'skipped' | 'unavailable'
