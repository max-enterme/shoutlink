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
 * 人の操作に近い一連のイベントを 1 要素に流す。
 *
 * ⚠️ **`button.click()` だけではメニューが開かないことを実配信で確認 (2026-08-05)。**
 *    Polymer のボタンは pointerdown/up から `tap` を合成するため click だけでは足りない。
 *    座標(要素の中心)も入れる。座標 0,0 のイベントを無視する実装があるため。
 */
function pressLikeAHuman(target: HTMLElement): void {
  const rect = target.getBoundingClientRect()
  const base: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    detail: 1,
    clientX: Math.round(rect.left + rect.width / 2),
    clientY: Math.round(rect.top + rect.height / 2),
  }
  const down = { ...base, buttons: 1 }
  const up = { ...base, buttons: 0 }

  target.dispatchEvent(pointerish('pointerover', base))
  target.dispatchEvent(pointerish('pointerenter', base))
  target.dispatchEvent(new MouseEvent('mouseover', base))
  target.dispatchEvent(pointerish('pointerdown', down))
  target.dispatchEvent(new MouseEvent('mousedown', down))
  target.focus?.()
  target.dispatchEvent(pointerish('pointerup', up))
  target.dispatchEvent(new MouseEvent('mouseup', up))
  target.click()
}

/** メニューを開く前に、ホバーでボタンを出す */
function hoverMessage(message: HTMLElement): void {
  for (const type of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove']) {
    message.dispatchEvent(pointerish(type, { bubbles: true }))
  }
}

/**
 * メニューを開く対象の候補。
 * TODO(T1): listener が内側の `button` にあるのかホスト (`yt-icon-button`) にあるのかが
 *           未確認のため、両方を順に試す。同時に流すと開いた直後に閉じる恐れがある。
 */
function menuOpenTargets(button: HTMLElement): HTMLElement[] {
  const host = button.closest<HTMLElement>('yt-icon-button, #menu-button, #menu')
  return host && host !== button ? [button, host] : [button]
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

  hoverMessage(el)

  // メニュー項目はサーバから取りに行くため、開いてから並ぶまでに時間がかかる。
  const timeoutMs = opts.menuTimeoutMs ?? 4000
  const intervalMs = opts.menuIntervalMs ?? 50

  for (const target of menuOpenTargets(menuButton)) {
    pressLikeAHuman(target)
    const item = await waitFor(() => findPinMenuItem(root), { timeoutMs, intervalMs })
    if (item) {
      item.click()
      // TODO(T1): 固定に確認ダイアログが挟まる場合、もう一段の確定操作が要る。未確認。
      return 'pinned'
    }
    closeMenu(root)
  }

  // popupCount が 0 / visible が false なら「メニューが開いていない」、
  // items にラベルが並んでいるのに固定が無いなら「固定できない権限・画面」。
  log.warn('メニューに「固定」項目が見つからない。固定をスキップする', describeMenuState(root))
  return 'unavailable'
}
