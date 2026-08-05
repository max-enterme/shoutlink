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
import { findPinMenuItem, getMessageMenuButton, getPinnedBanner, textOf } from './selectors'
import type { PinMode, PinResult } from './types'
import { waitFor } from './wait'

export type PinOptions = {
  root?: ParentNode
  /** メニューが開くのを待つ上限 */
  menuTimeoutMs?: number
  menuIntervalMs?: number
}

/** PointerEvent が無い環境 (jsdom 等) では MouseEvent で代替する */
function pointerish(type: string, init: MouseEventInit): Event {
  if (typeof PointerEvent === 'function') return new PointerEvent(type, init)
  return new MouseEvent(type, init)
}

/**
 * メニューを開くための操作。
 *
 * ⚠️ **`button.click()` だけではメニューが開かないことを実配信で確認 (2026-08-05)。**
 *    Polymer のボタンは pointerdown/up 系から `tap` を合成するため、click だけでは
 *    ドロップダウンが開かず `unavailable` になっていた。
 *    人の操作に近い順序でイベントを流す。
 * TODO(T1): これで開くかは未検証。開かないなら、そもそも DOM 操作では固定できない
 *           可能性があり、③ の実現手段から見直す必要がある。
 */
function openMenu(message: HTMLElement, button: HTMLElement): void {
  // ホバーしないとメニューボタンが出ない場合への対処
  for (const type of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove']) {
    message.dispatchEvent(pointerish(type, { bubbles: true }))
  }

  const init: MouseEventInit = { bubbles: true, cancelable: true, composed: true, button: 0 }
  button.dispatchEvent(pointerish('pointerover', init))
  button.dispatchEvent(pointerish('pointerenter', init))
  button.dispatchEvent(pointerish('pointerdown', init))
  button.dispatchEvent(new MouseEvent('mousedown', init))
  button.focus?.()
  button.dispatchEvent(pointerish('pointerup', init))
  button.dispatchEvent(new MouseEvent('mouseup', init))
  button.click()
}

/**
 * 固定に失敗したときの状況を記録する。
 * 「メニューが開かなかった」のか「開いたが固定項目が無い」のかを区別できないと、
 * ③ を DOM 操作で実現できるかの判断ができない。
 */
function describeMenuState(root: ParentNode): Record<string, unknown> {
  const isItem = (e: Element) => /item-renderer$|paper-item$/.test(e.tagName.toLowerCase())
  const popups = Array.from(root.querySelectorAll('tp-yt-iron-dropdown, ytd-menu-popup-renderer'))
  return {
    popupCount: popups.length,
    popups: popups.slice(0, 6).map((d) => ({
      tag: d.tagName.toLowerCase(),
      ariaHidden: d.getAttribute('aria-hidden'),
      visible: d.getClientRects().length > 0,
      items: Array.from(d.querySelectorAll('*'))
        .filter(isItem)
        .map((e) => textOf(e).slice(0, 24)),
    })),
    roleMenuItems: Array.from(root.querySelectorAll('[role="menuitem"]')).map((e) =>
      textOf(e).slice(0, 24),
    ),
  }
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
    log.warn('メッセージのメニューボタンが見つからない。固定をスキップする', {
      messageTag: el.tagName.toLowerCase(),
      innerTags: Array.from(el.querySelectorAll('*'))
        .map((c) => c.tagName.toLowerCase() + (c.id ? '#' + c.id : ''))
        .slice(0, 30),
    })
    return 'unavailable'
  }

  openMenu(el, menuButton)

  const item = await waitFor(() => findPinMenuItem(root), {
    timeoutMs: opts.menuTimeoutMs ?? 2000,
    intervalMs: opts.menuIntervalMs ?? 50,
  })

  if (!item) {
    // popupCount が 0 / visible が false なら「メニューが開いていない」、
    // items にラベルが並んでいるのに固定が無いなら「固定できない権限・画面」。
    log.warn('メニューに「固定」項目が見つからない。固定をスキップする', describeMenuState(root))
    closeMenu(root)
    return 'unavailable'
  }

  item.click()
  // TODO(T1): 実 DOM で要確認。固定に確認ダイアログが挟まる場合、ここで
  //           もう一段の確定操作が要る。未確認のため現状は click のみ。
  return 'pinned'
}
