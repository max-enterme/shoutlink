/**
 * 設定の永続化 (T7 / AC5 / AC7 / AC8)。`chrome.storage.sync` を使う。
 * 正規化 (`normalizeConfig`) は純関数で、chrome が無い環境でもテストできる。
 */
import type { Config, PinMode } from './types'

const STORAGE_KEY = 'ytRedirectPin.config'

export const PIN_MODES: readonly PinMode[] = ['off', 'ifEmpty', 'always']

export const DEFAULT_CONFIG: Config = {
  enabled: true,
  template: '{name}さんからリダイレクトありがとうございます! {url}',
  // 既定は ifEmpty (spec.md AC8)。ただし成立は「固定中かどうか」を DOM から
  // 判定できることが前提で、T1 未確認 (plan.md R4)。
  pinMode: 'ifEmpty',
  // **配信の長さを見込んだ値にする (6 時間)。**
  // クールダウンは同一配信内でのみ効く一方、リダイレクトの通知はチャットに残り続けるため、
  // 秒数が短いと「明けた後にチャットを開き直す → 再投稿」が起きる (2026-08-07)。
  cooldownSec: 6 * 60 * 60,
  // 既定で出さない。配信画面にチャット窓を載せていると映り込むため (security-review.md S8)
  showManualTrigger: false,
  debug: false,
}

/** 未知の値・欠損を既定で埋める。壊れた設定で拡張ごと死なせない (AC6) */
export function normalizeConfig(raw: unknown): Config {
  const source = (raw ?? {}) as Partial<Record<keyof Config, unknown>>

  const template = typeof source.template === 'string' && source.template.trim()
    ? source.template
    : DEFAULT_CONFIG.template

  const pinMode = PIN_MODES.includes(source.pinMode as PinMode)
    ? (source.pinMode as PinMode)
    : DEFAULT_CONFIG.pinMode

  const cooldownRaw = Number(source.cooldownSec)
  const cooldownSec = Number.isFinite(cooldownRaw) && cooldownRaw >= 0
    ? Math.floor(cooldownRaw)
    : DEFAULT_CONFIG.cooldownSec

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_CONFIG.enabled,
    template,
    pinMode,
    cooldownSec,
    showManualTrigger:
      typeof source.showManualTrigger === 'boolean'
        ? source.showManualTrigger
        : DEFAULT_CONFIG.showManualTrigger,
    debug: typeof source.debug === 'boolean' ? source.debug : DEFAULT_CONFIG.debug,
  }
}

/**
 * 投稿・固定まで進んでよいか (AC7)。
 *
 * **「有効にする」は自動検知のスイッチ。** 手動トリガーは人がボタンを押した時点で
 * 意思表示なので、無効化中でも通す。AC7 が止めたいのは「想定外の連投」であって、
 * 人の 1 クリックはそれに当たらない。
 *
 * ドキュメントが「OFF でも手動から使える」と説明している根拠がここ。
 * **この関数の挙動を変えるなら README / docs/install.md / docs/index.html も直すこと。**
 */
export function isActionAllowed(enabled: boolean, origin?: 'auto' | 'manual'): boolean {
  return enabled || origin === 'manual'
}

/** 保存先。chrome が無い環境(テスト等)では null */
export function getStorageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined') return null
  return chrome.storage?.sync ?? chrome.storage?.local ?? null
}

/**
 * **この端末だけで持つもの**の保存先(投稿履歴)。
 *
 * `sync` を使わないのは、端末をまたいで共有する意味が無い(配信は 1 台で回す)ことと、
 * 書き込み頻度・容量制限のため。`local` が無い環境でだけ `sync` に落とす。
 */
export function getLocalStorageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined') return null
  return chrome.storage?.local ?? chrome.storage?.sync ?? null
}

const storage = getStorageArea

export async function loadConfig(): Promise<Config> {
  const area = storage()
  if (!area) return { ...DEFAULT_CONFIG }
  const stored = await area.get(STORAGE_KEY)
  return normalizeConfig(stored?.[STORAGE_KEY])
}

export async function saveConfig(patch: Partial<Config>): Promise<Config> {
  const area = storage()
  const next = normalizeConfig({ ...(await loadConfig()), ...patch })
  if (area) await area.set({ [STORAGE_KEY]: next })
  return next
}

/** 設定変更の購読。戻り値を呼ぶと解除する */
export function onConfigChanged(handler: (config: Config) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {}

  const listener = (changes: Record<string, chrome.storage.StorageChange>): void => {
    const change = changes[STORAGE_KEY]
    if (change) handler(normalizeConfig(change.newValue))
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
