import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config'
import { initOptions } from '../src/options/options'
import type { OptionsHandle } from '../src/options/options'
import { stubChrome } from './fixtures/chrome'
import type { ChromeStub } from './fixtures/chrome'

// public/options.html を jsdom へ流し込む。tests/docs.test.ts と同じ ?raw の glob を使う
// (ファイルは <!doctype html> から <script src="options.js"> まで含む全文なので、
//  document.body.innerHTML に丸ごと入れることはできない)
const htmlFiles = (import.meta as any).glob('../public/options.html', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>
const OPTIONS_HTML = Object.values(htmlFiles)[0]

let handle: OptionsHandle
let stub: ChromeStub

beforeEach(async () => {
  const parsed = new DOMParser().parseFromString(OPTIONS_HTML, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML // innerHTML 経由なので <script> は実行されない
  stub = stubChrome({
    local: { 'ytRedirectPin.directory': [] },
    sync: { 'ytRedirectPin.config': DEFAULT_CONFIG },
  })
  handle = initOptions()
  await handle.ready // ⚠ 待たないと #dirList が 0 行
})

afterEach(() => {
  handle.dispose()
  delete (globalThis as { chrome?: unknown }).chrome
  document.body.innerHTML = ''
})

function panel(id: string): HTMLElement {
  return document.querySelector(`#${id}`) as HTMLElement
}

function tabButton(tab: string): HTMLButtonElement {
  return document.querySelector(`#tabs [data-tab="${tab}"]`) as HTMLButtonElement
}

describe('タブ (AC1〜AC5)', () => {
  it('初期表示では基本設定タブだけが見える (AC1)', () => {
    expect(panel('panel-basic').hidden).toBe(false)
    expect(panel('panel-directory').hidden).toBe(true)
    expect(panel('panel-history').hidden).toBe(true)
    expect(panel('panel-dev').hidden).toBe(true)
  })

  it('タブを押すとそのタブだけが見える (AC2)', () => {
    tabButton('directory').click()

    expect(panel('panel-directory').hidden).toBe(false)
    expect(panel('panel-basic').hidden).toBe(true)
    expect(panel('panel-history').hidden).toBe(true)
    expect(panel('panel-dev').hidden).toBe(true)
  })

  it('各タブが受け持つ節を持っている (AC3)', () => {
    expect(panel('panel-basic').querySelector('#enabled')).not.toBeNull()
    expect(panel('panel-basic').querySelector('#template')).not.toBeNull()
    expect(panel('panel-basic').querySelector('#commentReplyEnabled')).not.toBeNull()
    expect(panel('panel-basic').querySelector('#commentTemplate')).not.toBeNull()
    expect(panel('panel-basic').querySelector('#showManualTrigger')).not.toBeNull()
    expect(panel('panel-basic').querySelector('#pinMode')).not.toBeNull()

    expect(panel('panel-directory').querySelector('#dirList')).not.toBeNull()
    expect(panel('panel-directory').querySelector('#dirDetail')).not.toBeNull()

    expect(panel('panel-history').querySelector('#postLogRows')).not.toBeNull()
    expect(panel('panel-history').querySelector('#clearPostLog')).not.toBeNull()

    expect(panel('panel-dev').querySelector('#debug')).not.toBeNull()
  })

  it('警告バナーと保存バーはどのタブでも消えない (AC4)', () => {
    for (const tab of ['basic', 'directory', 'history', 'dev']) {
      tabButton(tab).click()
      expect((document.querySelector('#studioWarning') as HTMLElement).hidden).toBe(false)
      expect((document.querySelector('.actions') as HTMLElement).hidden).toBe(false)
    }
  })

  it('別タブで変えた診断ログも保存される (AC5)', async () => {
    tabButton('dev').click()
    const debug = document.querySelector('#debug') as HTMLInputElement
    debug.click()

    tabButton('basic').click()
    ;(document.querySelector('#save') as HTMLButtonElement).click()
    // 保存は `save` のクリックハンドラの中で非同期に走る。待たずに読むと書き込み前を見てしまう
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect((stub.sync['ytRedirectPin.config'] as { debug: boolean }).debug).toBe(true)
  })
})
