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
  cooldownSec: 600,
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

/** 保存先。chrome が無い環境(テスト等)では null */
export function getStorageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined') return null
  return chrome.storage?.sync ?? chrome.storage?.local ?? null
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
