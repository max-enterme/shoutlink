/**
 * 設定 UI (T7)。テンプレート編集 / ON・OFF / クールダウン / 固定モード。
 */
import { compose } from '../composer'
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../config'
import type { Config, PinMode, RedirectEvent } from '../types'

/** プレビュー用のダミー。実在するチャンネルは使わない */
const SAMPLE_EVENT: RedirectEvent = {
  sourceChannelName: 'example-channel',
  sourceChannelUrl: 'https://www.youtube.com/@example-channel',
  detectedAt: 0,
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`要素が見つからない: #${id}`)
  return found as T
}

const enabled = el<HTMLInputElement>('enabled')
const template = el<HTMLTextAreaElement>('template')
const pinMode = el<HTMLSelectElement>('pinMode')
const cooldownSec = el<HTMLInputElement>('cooldownSec')
const preview = el<HTMLElement>('preview')
const status = el<HTMLElement>('status')
const save = el<HTMLButtonElement>('save')

function renderPreview(): void {
  preview.textContent = compose(template.value || DEFAULT_CONFIG.template, SAMPLE_EVENT)
}

function apply(config: Config): void {
  enabled.checked = config.enabled
  template.value = config.template
  pinMode.value = config.pinMode
  cooldownSec.value = String(config.cooldownSec)
  renderPreview()
}

template.addEventListener('input', renderPreview)

save.addEventListener('click', () => {
  void (async () => {
    const saved = await saveConfig({
      enabled: enabled.checked,
      template: template.value,
      pinMode: pinMode.value as PinMode,
      cooldownSec: Number(cooldownSec.value),
    })
    apply(saved)
    status.textContent = '保存した'
    setTimeout(() => (status.textContent = ''), 2000)
  })()
})

void loadConfig().then(apply)
