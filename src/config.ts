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
  // 既定で出さない。配信画面にチャット窓を載せていると映り込むため (security-review.md S8)
  showManualTrigger: false,
  debug: false,
  // **既定 OFF (004 / AC1)。**引き金が増えて投稿の頻度が上がる側なので、
  // 有効にした人だけが動く形にする(spec.md D3 の決定)。**既定を変えない。**
  commentReplyEnabled: false,
  commentTemplate: '{name}さん、来てくれてありがとうございます! {url}',
}

/** 未知の値・欠損を既定で埋める。壊れた設定で拡張ごと死なせない (AC6) */
export function normalizeConfig(raw: unknown): Config {
  const source = (raw ?? {}) as Partial<Record<keyof Config, unknown>>

  const template = typeof source.template === 'string' && source.template.trim()
    ? source.template
    : DEFAULT_CONFIG.template

  // コメント用のテンプレートも同じ規則で埋める(空文字・空白だけは「未設定」とみなす / AC14)
  const commentTemplate = typeof source.commentTemplate === 'string' && source.commentTemplate.trim()
    ? source.commentTemplate
    : DEFAULT_CONFIG.commentTemplate

  const pinMode = PIN_MODES.includes(source.pinMode as PinMode)
    ? (source.pinMode as PinMode)
    : DEFAULT_CONFIG.pinMode

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_CONFIG.enabled,
    template,
    pinMode,
    showManualTrigger:
      typeof source.showManualTrigger === 'boolean'
        ? source.showManualTrigger
        : DEFAULT_CONFIG.showManualTrigger,
    debug: typeof source.debug === 'boolean' ? source.debug : DEFAULT_CONFIG.debug,
    // **真偽値でないものは既定 (false) に倒す** (AC1 / AC14)。
    // 壊れた設定で「勝手に ON になっている」状態を作らない
    commentReplyEnabled:
      typeof source.commentReplyEnabled === 'boolean'
        ? source.commentReplyEnabled
        : DEFAULT_CONFIG.commentReplyEnabled,
    commentTemplate,
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

/**
 * `getLocalStorageArea()` が**実際に選んだ**エリアの名前。
 * `chrome.storage.onChanged` の第 2 引数(areaName)で絞り込むために要る。
 *
 * **`'local'` 決め打ちにしない。** 上の関数は `local` が無ければ `sync` に落ちるので、
 * 決め打ちだとそのフォールバック時に変更通知が 1 件も届かなくなる
 * (設定画面での編集がチャット側に反映されなくなる)。
 */
export function getLocalStorageAreaName(): string | null {
  if (typeof chrome === 'undefined') return null
  if (chrome.storage?.local) return 'local'
  if (chrome.storage?.sync) return 'sync'
  return null
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
