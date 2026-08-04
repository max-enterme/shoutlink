/**
 * PinMode を解釈してメッセージを固定する (T6 / AC3 / AC8)。
 *
 * 「固定するかどうか」の判断はここが持ち、DOM 操作はその結果でしかない (plan.md)。
 *   off      → 何もせず 'skipped'
 *   ifEmpty  → 既存の固定バナーがあれば 'skipped'、無ければ固定して 'pinned'
 *   always   → 既存を見ずに固定して 'pinned'
 *   固定 UI が見つからない → 'unavailable'(投稿は成立しているので処理は継続 / AC6)
 */
import { log } from './log'
import { findPinMenuItem, getMessageMenuButton, getPinnedBanner } from './selectors'
import type { PinMode, PinResult } from './types'
import { waitFor } from './wait'

export type PinOptions = {
  root?: ParentNode
  /** メニューが開くのを待つ上限 */
  menuTimeoutMs?: number
  menuIntervalMs?: number
}

/**
 * メニューを開くための操作。
 * TODO(T1): 実 DOM で要確認。YouTube はメッセージをホバーしないとメニューボタンを
 *           出さないことがあるため、click の前にポインタ系イベントを流している。
 */
function openMenu(message: HTMLElement, button: HTMLElement): void {
  for (const type of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter'] as const) {
    message.dispatchEvent(new Event(type, { bubbles: true }))
  }
  button.click()
}

/** 開いたメニューを閉じる(固定項目が見つからなかったとき、開きっぱなしにしない) */
function closeMenu(root: ParentNode): void {
  const node = root as unknown as Node
  const doc = node.nodeType === 9 ? (node as Document) : node.ownerDocument
  doc?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

export async function pin(
  el: HTMLElement,
  mode: PinMode,
  opts: PinOptions = {},
): Promise<PinResult> {
  if (mode === 'off') return 'skipped'

  const root = opts.root ?? el.ownerDocument

  if (mode === 'ifEmpty') {
    const banner = getPinnedBanner(root)
    if (banner) {
      log.info('既に固定中のメッセージがあるため固定しない (pinMode=ifEmpty)')
      return 'skipped'
    }
  }

  const menuButton = getMessageMenuButton(el)
  if (!menuButton) {
    log.warn('メッセージのメニューボタンが見つからない。固定をスキップする')
    return 'unavailable'
  }

  openMenu(el, menuButton)

  const item = await waitFor(() => findPinMenuItem(root), {
    timeoutMs: opts.menuTimeoutMs ?? 2000,
    intervalMs: opts.menuIntervalMs ?? 50,
  })

  if (!item) {
    log.warn('メニューに「固定」項目が見つからない。固定をスキップする')
    closeMenu(root)
    return 'unavailable'
  }

  item.click()
  // TODO(T1): 実 DOM で要確認。固定に確認ダイアログが挟まる場合、ここで
  //           もう一段の確定操作が要る。未確認のため現状は click のみ。
  return 'pinned'
}
