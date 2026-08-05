/**
 * 設定 UI (T7)。テンプレート編集 / ON・OFF / クールダウン / 固定モード。
 */
import { compose } from '../composer'
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../config'
import { normalizeChannelUrl } from '../detector'
import {
  displayHandle,
  loadDirectory,
  onDirectoryChanged,
  removeEntry,
  saveDirectory,
  sortForDisplay,
  upsertNickname,
} from '../directory'
import type { Directory } from '../directory'
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
const debug = el<HTMLInputElement>('debug')
const directoryRows = el<HTMLElement>('directoryRows')
const directoryStatus = el<HTMLElement>('directoryStatus')
const newHandle = el<HTMLInputElement>('newHandle')
const newNickname = el<HTMLInputElement>('newNickname')
const addEntry = el<HTMLButtonElement>('addEntry')

// --- 呼び名の辞書 ---------------------------------------------------------

let directory: Directory = []

function setDirectoryStatus(message: string): void {
  directoryStatus.textContent = message
}

async function persistDirectory(message: string): Promise<void> {
  await saveDirectory(directory)
  renderDirectory()
  setDirectoryStatus(message)
}

function renderDirectory(): void {
  directoryRows.textContent = ''

  if (directory.length === 0) {
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 3
    cell.className = 'empty'
    cell.textContent = 'まだ登録がありません。リダイレクトを受けると自動で追加されます。'
    row.appendChild(cell)
    directoryRows.appendChild(row)
    return
  }

  for (const entry of sortForDisplay(directory)) {
    const row = document.createElement('tr')

    const handleCell = document.createElement('td')
    handleCell.className = entry.lastSeenAt ? 'handle' : 'handle unseen'
    handleCell.textContent = displayHandle(entry)
    handleCell.title = entry.lastSeenAt ? entry.url : `${entry.url}(まだリダイレクトを受けていない)`

    const nicknameCell = document.createElement('td')
    const input = document.createElement('input')
    input.type = 'text'
    input.value = entry.nickname
    input.placeholder = '(未設定 — ハンドルのまま)'
    input.addEventListener('change', () => {
      directory = upsertNickname(directory, entry.url, input.value.trim())
      void persistDirectory(`${displayHandle(entry)} の呼び名を保存した`)
    })
    nicknameCell.appendChild(input)

    const actionCell = document.createElement('td')
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '削除'
    remove.title = '一覧から削除する'
    remove.addEventListener('click', () => {
      directory = removeEntry(directory, entry.url)
      void persistDirectory(`${displayHandle(entry)} を削除した`)
    })
    actionCell.appendChild(remove)

    row.append(handleCell, nicknameCell, actionCell)
    directoryRows.appendChild(row)
  }
}

addEntry.addEventListener('click', () => {
  const url = normalizeChannelUrl(newHandle.value)
  if (!url) {
    setDirectoryStatus('チャンネルの @ハンドル または URL を入れてください')
    return
  }
  directory = upsertNickname(directory, url, newNickname.value.trim())
  newHandle.value = ''
  newNickname.value = ''
  void persistDirectory('登録した')
})

for (const input of [newHandle, newNickname]) {
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') addEntry.click()
  })
}

void loadDirectory().then((loaded) => {
  directory = loaded
  renderDirectory()
})

onDirectoryChanged((next) => {
  directory = next
  renderDirectory()
})
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
  debug.checked = config.debug
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
      debug: debug.checked,
    })
    apply(saved)
    status.textContent = '保存した'
    setTimeout(() => (status.textContent = ''), 2000)
  })()
})

void loadConfig().then(apply)
