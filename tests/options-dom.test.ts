import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config'
import { initialForAvatar } from '../src/directory'
import type { Directory, DirectoryEntry } from '../src/directory'
import { initOptions } from '../src/options/options'
import type { OptionsHandle } from '../src/options/options'
import { stubChrome } from './fixtures/chrome'
import type { ChromeStub } from './fixtures/chrome'
import { FAKE_CHANNEL, FAKE_OTHER_CHANNEL } from './fixtures/live-chat'

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

// --- 007 / B2: 辞書の左右分割 --------------------------------------------------

function entry(patch: Partial<DirectoryEntry> & { url: string }): DirectoryEntry {
  return {
    nickname: '',
    message: '',
    replyToComment: false,
    commentMessage: '',
    channelId: '',
    lastSeenAt: 0,
    iconDataUrl: '',
    channelName: '',
    ...patch,
  }
}

/**
 * 辞書を差し替えて `initOptions()` を取り直す。`beforeEach` の既定(0 件)では書けないケース用。
 *
 * ⚠️ **`beforeEach` と同じ手順で DOM も張り直す(F1)。**`dispose()` は `chrome.storage.onChanged`
 *    の購読を外すだけで、DOM に張った `addEventListener` は 1 つも外れない。DOM を使い回すと
 *    1 個目の `initOptions()` のハンドラが残ったまま 2 個目のハンドラが重ねて載り、
 *    クリックのたびに両方が発火する(先に登録された 1 個目が先に走る)。
 */
async function withDirectory(directory: Directory): Promise<void> {
  handle.dispose()
  delete (globalThis as { chrome?: unknown }).chrome
  const parsed = new DOMParser().parseFromString(OPTIONS_HTML, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML
  stub = stubChrome({
    local: { 'ytRedirectPin.directory': directory },
    sync: { 'ytRedirectPin.config': DEFAULT_CONFIG },
  })
  handle = initOptions()
  await handle.ready
}

function dirList(): HTMLElement {
  return document.querySelector('#dirList') as HTMLElement
}

function dirDetail(): HTMLElement {
  return document.querySelector('#dirDetail') as HTMLElement
}

function dirRows(): HTMLElement[] {
  return [...dirList().querySelectorAll(':scope > .dir-row')] as HTMLElement[]
}

/** ハンドル文字列を含む左の行を探す(呼び名が付いても 2 段目のハンドルで引ける) */
function rowByHandle(handleText: string): HTMLElement {
  const found = dirRows().find((row) => (row.textContent ?? '').includes(handleText))
  if (!found) throw new Error(`行が見つからない: ${handleText}`)
  return found
}

describe('辞書の左右分割 (AC6〜AC13)', () => {
  it('左に全行が出て caret が無い (AC6)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])

    expect(dirRows().length).toBe(2)
    expect(document.querySelectorAll('button.caret').length).toBe(0)
  })

  it('未選択なら右は案内文 (AC8)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])

    expect(dirDetail().textContent).toContain('左の一覧から選んでください')
  })

  it('行を選ぶと右に詳細が出る (AC9)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url, nickname: 'れい' })])

    rowByHandle(FAKE_CHANNEL.handle).click()

    const detail = dirDetail()
    const classNames = [...detail.children].map((el) => el.className)
    // ⚠ の理由(無し) / ハンドル / 呼び名の input / チャンネル ID の行 /
    // 自由文 2 欄 / コメントに反応する / テスト送信 2 ボタン / 削除、の DOM 順 (007 D3)
    expect(classNames).toEqual([
      'dir-detail-handle',
      'dir-detail-nickname',
      'channel-id',
      'detail-field',
      'detail-field',
      'row',
      'row test-send',
      '',
    ])
    expect(detail.textContent).toContain(FAKE_CHANNEL.url)
    expect(detail.querySelector('.dir-detail-nickname input')).not.toBeNull()
    expect(detail.textContent).toContain('コメントに反応する')
    expect(detail.querySelectorAll('.test-send button').length).toBe(2)
    expect([...detail.querySelectorAll('button')].some((b) => b.textContent === '削除')).toBe(true)
  })

  it('Enter で選択が変わる(キーボード操作 / F4)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])

    const row = rowByHandle(FAKE_CHANNEL.handle)
    expect(row.tabIndex).toBe(0)
    expect(row.getAttribute('role')).toBe('button')
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(dirDetail().textContent).toContain(FAKE_CHANNEL.url)
  })

  it('左の一覧に入力欄が無い (AC9)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])

    expect(dirList().querySelectorAll('input').length).toBe(0)
    expect(dirList().contains(document.querySelector('#newHandle'))).toBe(false)
    expect(dirList().contains(document.querySelector('#addEntry'))).toBe(false)
  })

  it('追加ボタンの文言が「追加」になっている', async () => {
    await withDirectory([])

    const button = document.querySelector('#addEntry') as HTMLButtonElement
    expect(button.textContent).toBe('追加')
    expect(button.textContent).not.toContain('＋')
  })

  it('呼び名が空ならハンドルだけ出る (AC7)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url, nickname: '' })])

    const row = rowByHandle(FAKE_CHANNEL.handle)
    const occurrences = (row.textContent ?? '').split(FAKE_CHANNEL.handle).length - 1
    expect(occurrences).toBe(1)
  })

  it('呼び名が空なら表記名をグレーで出す (AC7)', async () => {
    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, nickname: '', channelName: 'YouTube' }),
    ])

    const row = rowByHandle(FAKE_CHANNEL.handle)
    const placeholder = row.querySelector('.dir-row-nickname.placeholder')
    expect(placeholder).not.toBeNull()
    expect(placeholder?.textContent).toBe('YouTube')
  })

  it('呼び名も表記名も空ならハンドルだけ (AC7)', async () => {
    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, nickname: '', channelName: '' }),
    ])

    const row = rowByHandle(FAKE_CHANNEL.handle)
    expect(row.querySelectorAll('.dir-row-nickname').length).toBe(0)
    const occurrences = (row.textContent ?? '').split(FAKE_CHANNEL.handle).length - 1
    expect(occurrences).toBe(1)
  })

  it('効かない行の理由は選ぶと右に出る (AC10)', async () => {
    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, replyToComment: true, channelId: '' }),
    ])

    const row = rowByHandle(FAKE_CHANNEL.handle)
    expect(row.querySelector('.mark')).not.toBeNull()

    row.click()
    expect(dirDetail().textContent).toContain('チャンネル ID が未解決のため')
  })

  it('絞り込みは呼び名とハンドルに当たる (AC11)', async () => {
    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, nickname: 'れい' }),
      entry({ url: FAKE_OTHER_CHANNEL.url, nickname: 'まっくす' }),
    ])

    const filter = document.querySelector('#dirFilter') as HTMLInputElement
    filter.value = 'another'
    filter.dispatchEvent(new Event('input'))
    expect(dirRows().length).toBe(1)

    // 呼び名にも当たる (F7)
    filter.value = 'まっくす'
    filter.dispatchEvent(new Event('input'))
    expect(dirRows().length).toBe(1)
    expect(dirRows()[0].textContent).toContain('まっくす')

    // 大小無視 (F7)
    filter.value = 'ANOTHER'
    filter.dispatchEvent(new Event('input'))
    expect(dirRows().length).toBe(1)

    filter.value = ''
    filter.dispatchEvent(new Event('input'))
    expect(dirRows().length).toBe(2)
  })

  it('絞り込みは表記名にも当たる (AC11)', async () => {
    // 呼び名は空で、控えてある表記名だけがある行を、表記名の一部で絞る
    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, nickname: '', channelName: 'ようつべ公式' }),
      entry({ url: FAKE_OTHER_CHANNEL.url, nickname: 'まっくす' }),
    ])

    const filter = document.querySelector('#dirFilter') as HTMLInputElement
    filter.value = 'ようつべ'
    filter.dispatchEvent(new Event('input'))

    expect(dirRows().length).toBe(1)
    expect(dirRows()[0].textContent).toContain('ようつべ公式')
  })

  it('絞り込みで消えても選択は外れない (AC11)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])

    rowByHandle(FAKE_CHANNEL.handle).click()

    const filter = document.querySelector('#dirFilter') as HTMLInputElement
    filter.value = FAKE_OTHER_CHANNEL.handle
    filter.dispatchEvent(new Event('input'))

    expect(dirRows().length).toBe(1)
    expect(dirDetail().textContent).toContain(FAKE_CHANNEL.url)
  })

  it('辞書 0 件の左右 (AC12)', async () => {
    await withDirectory([])

    expect(dirList().textContent).toContain('まだ登録がありません')
    expect(dirDetail().textContent).toContain('左の一覧から選んでください')
  })

  it('選択中の行を削除すると右が戻る (AC13)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url })])

    rowByHandle(FAKE_CHANNEL.handle).click()
    const remove = [...dirDetail().querySelectorAll('button')].find((b) => b.textContent === '削除')!
    remove.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(dirDetail().textContent).toContain('左の一覧から選んでください')
  })

  it('効かない行の理由は右ペインの先頭に出る (AC9 / AC10)', async () => {
    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, replyToComment: true, channelId: '' }),
    ])

    rowByHandle(FAKE_CHANNEL.handle).click()
    const detail = dirDetail()
    expect((detail.children[0] as HTMLElement).className).toBe('dir-detail-reason')
    const handleIndex = [...detail.children].findIndex((el) => el.className === 'dir-detail-handle')
    expect(handleIndex).toBeGreaterThan(0)
  })

  // ⚠ **plan.md のテストケース表は「保存される」としているが、これは現行の
  //    `validateEntryMessage`(message-field.ts)の挙動と食い違う。**自由文が
  //    `MAX_ENTRY_MESSAGE_LENGTH`(200)を超えると保存はされない
  //    (docs/for-testers.md のテスト H / `tests/options.test.ts` の
  //    「AC6 で弾かれた自由文は、再描画をまたいでも残る」と同じ規約)。AC23 は
  //    「**現行のまま**」を求める回帰条件なので、挙動は変えず、期待値を実際の現行動作に
  //    合わせて書いている(表の「保存されている」は採らない — plan.md の記載ミスと判断)。
  it('200 字超は赤枠のまま保存されない、現行のまま (AC23)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url })])

    // `{msg}` だけのテンプレートにして、自由文の生の長さ = 投稿文全体の長さにそろえる
    const template = document.querySelector('#template') as HTMLTextAreaElement
    template.value = '{msg}'
    template.dispatchEvent(new Event('input'))

    rowByHandle(FAKE_CHANNEL.handle).click()
    const field = dirDetail().querySelectorAll('.detail-field input')[0] as HTMLInputElement
    field.value = 'あ'.repeat(250)
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new Event('change'))

    expect(field.classList.contains('invalid')).toBe(true)
    const remaining = field.closest('label')!.querySelector('.remaining') as HTMLElement
    expect(remaining.textContent).toBe('50 字超過')

    const saved = (stub.local['ytRedirectPin.directory'] as Directory).find(
      (e) => e.url === FAKE_CHANNEL.url,
    )!
    expect(saved.message).toBe('')
  })

  it('未保存の自由文は他の行の保存で消えない (AC21)', async () => {
    await withDirectory([
      entry({ url: FAKE_CHANNEL.url }),
      entry({ url: FAKE_OTHER_CHANNEL.url }),
    ])

    rowByHandle(FAKE_CHANNEL.handle).click()
    const field = dirDetail().querySelectorAll('.detail-field input')[0] as HTMLInputElement
    field.value = 'あ'.repeat(250)
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new Event('change'))

    rowByHandle(FAKE_OTHER_CHANNEL.handle).click()
    const nickname = dirDetail().querySelector('.dir-detail-nickname input') as HTMLInputElement
    nickname.value = 'まっくす'
    nickname.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    rowByHandle(FAKE_CHANNEL.handle).click()
    const restored = dirDetail().querySelectorAll('.detail-field input')[0] as HTMLInputElement
    expect(restored.value).toBe('あ'.repeat(250))
    expect(restored.classList.contains('invalid')).toBe(true)
  })

  it('絞り込み中に消えた行の状態も掃除される (AC21)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])

    // 1. 行 A(FAKE_CHANNEL)を選ぶ → 自由文を打つ
    rowByHandle(FAKE_CHANNEL.handle).click()
    const field = dirDetail().querySelectorAll('.detail-field input')[0] as HTMLInputElement
    field.value = 'あ'.repeat(250)
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new Event('change'))

    // 2. 行 B(FAKE_OTHER_CHANNEL)を選ぶ。ここで A の下書きが rowDrafts に確定し、
    //    A は非選択の表示専用行として liveRows に入る(まだ選択されていない状態を作る)
    rowByHandle(FAKE_OTHER_CHANNEL.handle).click()

    // 3. 絞り込みで A を #dirList から外す。この描画で A は liveRows から完全に消える
    const filter = document.querySelector('#dirFilter') as HTMLInputElement
    filter.value = FAKE_OTHER_CHANNEL.handle
    filter.dispatchEvent(new Event('input'))

    // 4. 別のタブで A が削除された辞書が届く
    const remaining = (stub.local['ytRedirectPin.directory'] as Directory).filter(
      (e) => e.url !== FAKE_CHANNEL.url,
    )
    stub.emitChange('ytRedirectPin.directory', remaining)

    // 5. 絞り込みを戻し、A と同じハンドルを ＋ から再登録する
    filter.value = ''
    filter.dispatchEvent(new Event('input'))

    const newHandleInput = document.querySelector('#newHandle') as HTMLInputElement
    newHandleInput.value = FAKE_CHANNEL.handle
    ;(document.querySelector('#addEntry') as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 6. rowDrafts(下書き)が残っていなければ、再登録した行の自由文欄は空のまま
    rowByHandle(FAKE_CHANNEL.handle).click()
    const reregistered = dirDetail().querySelectorAll('.detail-field input')[0] as HTMLInputElement
    expect(reregistered.value).toBe('')
    expect(reregistered.classList.contains('invalid')).toBe(false)
  })

  it('再描画でフォーカスとキャレットが戻る (AC22)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url })])

    rowByHandle(FAKE_CHANNEL.handle).click()
    const field = dirDetail().querySelectorAll('.detail-field input')[0] as HTMLInputElement
    field.value = 'こんにちは'
    field.focus()
    field.setSelectionRange(3, 3)

    // 人の操作と無関係な再描画(fetch の完了 / 他端末の変更)を模す
    stub.emitChange('ytRedirectPin.directory', stub.local['ytRedirectPin.directory'])

    const active = document.activeElement as HTMLInputElement
    expect(active.dataset.rowField).toBe('message')
    expect(active.selectionStart).toBe(3)
  })
})

describe('タブ (AC1〜AC5)', () => {
  it('初期表示では基本設定タブだけが見える (AC1)', () => {
    expect(panel('panel-basic').hidden).toBe(false)
    expect(panel('panel-directory').hidden).toBe(true)
    expect(panel('panel-history').hidden).toBe(true)
    expect(panel('panel-dev').hidden).toBe(true)
    // 選択中タブの唯一の手掛かりである aria-selected も見る (F6)
    expect(tabButton('basic').getAttribute('aria-selected')).toBe('true')
    expect(tabButton('directory').getAttribute('aria-selected')).toBe('false')
    expect(tabButton('history').getAttribute('aria-selected')).toBe('false')
    expect(tabButton('dev').getAttribute('aria-selected')).toBe('false')
  })

  it('タブを押すとそのタブだけが見える (AC2)', () => {
    tabButton('directory').click()

    expect(panel('panel-directory').hidden).toBe(false)
    expect(panel('panel-basic').hidden).toBe(true)
    expect(panel('panel-history').hidden).toBe(true)
    expect(panel('panel-dev').hidden).toBe(true)
    expect(tabButton('directory').getAttribute('aria-selected')).toBe('true')
    expect(tabButton('basic').getAttribute('aria-selected')).toBe('false')
    expect(tabButton('history').getAttribute('aria-selected')).toBe('false')
    expect(tabButton('dev').getAttribute('aria-selected')).toBe('false')
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

  it('警告バナーは基本設定タブにだけ出る (AC4)', () => {
    const studioWarning = document.querySelector('#studioWarning') as HTMLElement
    for (const tab of ['basic', 'directory', 'history', 'dev']) {
      tabButton(tab).click()
      // 直接の hidden だけでなく、祖先が hidden になっていないかも見る (F6)
      if (tab === 'basic') {
        expect(studioWarning.closest('[hidden]')).toBeNull()
      } else {
        expect(studioWarning.closest('[hidden]')).not.toBeNull()
      }
    }
  })

  it('保存バーはどのタブでも消えない (AC5)', () => {
    for (const tab of ['basic', 'directory', 'history', 'dev']) {
      tabButton(tab).click()
      const actions = document.querySelector('.actions') as HTMLElement
      expect(actions.hidden).toBe(false)
      expect(actions.closest('[hidden]')).toBeNull()
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

// --- 007 / B4: アイコン (AC14〜AC20) -------------------------------------------
//
// `resolveChannelPage` は `options.ts` から `fetchImpl` を渡さずに呼ばれる(通常運用と同じ)ので、
// ここは `tests/channel-id.test.ts` の `fakePageAndIconFetch` と同じ形の偽物を**グローバルの
// `fetch` に差し替える**ことで検証する。`afterEach` で必ず元に戻す。

const ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const ICON_URL = 'https://yt3.googleusercontent.com/x=s900-c-k-c0x00ffffff-no-rj'
const canonical = (id: string) =>
  `<link rel="canonical" href="https://www.youtube.com/channel/${id}">`
const ogImage = (url: string) => `<meta property="og:image" content="${url}">`
const ogTitle = (name: string) => `<meta property="og:title" content="${name}">`

/** 架空の 3 人目。実在する第三者の識別子は使わない */
const THIRD_URL = 'https://www.youtube.com/@third-example-channel'

/**
 * `www.youtube.com` へのアクセスは `html` を返し、それ以外(画像)は `imageBytes` の
 * バイト列を返す偽の `fetch`。`pageCalls` は `www.youtube.com` への呼び出しだけを数える。
 */
function stubFetch(html: string, imageBytes = 100): { pageCalls: string[]; allCalls: string[] } {
  const pageCalls: string[] = []
  const allCalls: string[] = []
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    allCalls.push(url)
    if (url.includes('www.youtube.com')) {
      pageCalls.push(url)
      return { ok: true, status: 200, text: async () => html } as Response
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null) },
      arrayBuffer: async () => new ArrayBuffer(imageBytes),
    } as unknown as Response
  }) as typeof fetch
  ;(globalThis as { fetch: typeof fetch }).fetch = impl
  return { pageCalls, allCalls }
}

describe('アイコン (AC14〜AC20)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('アイコンがある行は img、無い行は頭文字 (AC18)', async () => {
    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, iconDataUrl: 'data:image/jpeg;base64,AAA' }),
      entry({ url: FAKE_OTHER_CHANNEL.url, iconDataUrl: '' }),
    ])

    const withIcon = rowByHandle(FAKE_CHANNEL.handle)
    expect(withIcon.querySelector('img[src^="data:image/"]')).not.toBeNull()

    const withoutIcon = rowByHandle(FAKE_OTHER_CHANNEL.handle)
    const monogram = withoutIcon.querySelector('.monogram') as HTMLElement
    expect(monogram).not.toBeNull()
    expect(monogram.textContent).toBe(
      initialForAvatar({ nickname: '', url: FAKE_OTHER_CHANNEL.url }),
    )
  })

  it('辞書タブを開くだけでは取りに行かない (AC16)', async () => {
    const { allCalls } = stubFetch('<html></html>')

    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])
    tabButton('directory').click()

    expect(allCalls).toHaveLength(0)
  })

  it('まとめて取得は未取得の行だけ取る (AC15)', async () => {
    const html = `<html><head>${canonical(ID)}${ogImage(ICON_URL)}</head></html>`
    const { pageCalls } = stubFetch(html)

    await withDirectory([
      // アイコン・表記名とも既に控えてある行だけが対象から外れる(007: 片方だけ未取得でも対象)
      entry({ url: FAKE_CHANNEL.url, iconDataUrl: 'data:image/jpeg;base64,AAA', channelName: 'あああ' }),
      entry({ url: FAKE_OTHER_CHANNEL.url }),
      entry({ url: THIRD_URL }),
    ])

    const button = document.querySelector('#fetchAllIcons') as HTMLButtonElement
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pageCalls).toHaveLength(2)
    expect(pageCalls).not.toContain(FAKE_CHANNEL.url)
  })

  it('まとめて取得は表記名だけ未取得の行も対象にする (AC15)', async () => {
    // FAKE_CHANNEL は**アイコンは既に控えてあるが、表記名だけ未取得**。
    // 対象条件を `iconDataUrl === ''` だけで見ていると、この行は永久に対象から漏れる
    const html = `<html><head>${canonical(ID)}${ogImage(ICON_URL)}${ogTitle('YouTube')}</head></html>`
    const { pageCalls } = stubFetch(html)

    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, iconDataUrl: 'data:image/jpeg;base64,AAA', channelName: '' }),
    ])

    const button = document.querySelector('#fetchAllIcons') as HTMLButtonElement
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pageCalls).toContain(FAKE_CHANNEL.url)
    const saved = (stub.local['ytRedirectPin.directory'] as Directory).find(
      (e) => e.url === FAKE_CHANNEL.url,
    )
    expect(saved?.channelName).toBe('YouTube')
  })

  it('待っている間に削除された行を復活させない (F14 / Critical)', async () => {
    const html = `<html><head>${canonical(ID)}${ogImage(ICON_URL)}</head></html>`
    // ⚠️ プレーンな `let` だと、クロージャの中だけで代入する変数を TS が誤って `null` に
    //    narrow することがあるため、保持先をオブジェクトにしてある
    const paused: { resolve: (() => void) | null } = { resolve: null }
    let pageCallCount = 0
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('www.youtube.com')) {
        pageCallCount++
        // 1 件目のページ取得だけ、外から進められるまで待たせる
        if (pageCallCount === 1) {
          await new Promise<void>((resolve) => {
            paused.resolve = resolve
          })
        }
        return { ok: true, status: 200, text: async () => html } as Response
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null) },
        arrayBuffer: async () => new ArrayBuffer(10),
      } as unknown as Response
    }) as typeof fetch
    globalThis.fetch = impl

    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])

    const button = document.querySelector('#fetchAllIcons') as HTMLButtonElement
    button.click()

    // 1 件目(FAKE_CHANNEL)の取得中に、2 件目(FAKE_OTHER_CHANNEL)を選んで削除する
    rowByHandle(FAKE_OTHER_CHANNEL.handle).click()
    const remove = [...dirDetail().querySelectorAll('button')].find((b) => b.textContent === '削除')!
    remove.click()

    // 1 件目の取得を進めてループを完了させる
    paused.resolve?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const restored = (stub.local['ytRedirectPin.directory'] as Directory).find(
      (e) => e.url === FAKE_OTHER_CHANNEL.url,
    )
    expect(restored).toBeUndefined()
  })

  it('まとめて取得のボタンに件数が出る (AC15)', async () => {
    await withDirectory([
      // アイコン・表記名とも控えてある行だけが対象から外れる
      entry({ url: FAKE_CHANNEL.url, iconDataUrl: 'data:image/jpeg;base64,AAA', channelName: 'あああ' }),
      entry({ url: FAKE_OTHER_CHANNEL.url }),
      entry({ url: THIRD_URL }),
    ])

    const button = document.querySelector('#fetchAllIcons') as HTMLButtonElement
    expect(button.textContent).toContain('2 件')

    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, iconDataUrl: 'data:image/jpeg;base64,AAA', channelName: 'あああ' }),
    ])
    const buttonAllDone = document.querySelector('#fetchAllIcons') as HTMLButtonElement
    expect(buttonAllDone.hidden).toBe(true)
  })

  it('まとめて取得のボタンはラベルと目安の 2 行に分かれている', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])

    const button = document.querySelector('#fetchAllIcons') as HTMLButtonElement
    expect(button.children).toHaveLength(2)
    const [label, detail] = [...button.children]
    expect(label.textContent).toBe('アイコンと表記名を取得')
    expect(detail.textContent).toMatch(/件/)
    expect(detail.textContent).toMatch(/MB/)
  })

  it('ON にするとアイコンも同時に控える (AC14)', async () => {
    const html = `<html><head>${canonical(ID)}${ogImage(ICON_URL)}</head></html>`
    const { pageCalls } = stubFetch(html)

    await withDirectory([entry({ url: FAKE_CHANNEL.url })])

    rowByHandle(FAKE_CHANNEL.handle).click()
    const flag = dirDetail().querySelector('input[type="checkbox"]') as HTMLInputElement
    flag.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pageCalls).toHaveLength(1)
    const saved = (stub.local['ytRedirectPin.directory'] as Directory).find(
      (e) => e.url === FAKE_CHANNEL.url,
    )!
    expect(saved.channelId).toBe(ID)
    expect(saved.iconDataUrl).toMatch(/^data:image\//)
  })

  it('片方(アイコン)が失敗しても、成功した側(チャンネル ID)は保存する (AC19 / F18)', async () => {
    // canonical はあるが og:image が無い HTML(アイコンだけ失敗する)
    const html = `<html><head>${canonical(ID)}</head></html>`
    const { pageCalls } = stubFetch(html)

    await withDirectory([entry({ url: FAKE_CHANNEL.url })])

    rowByHandle(FAKE_CHANNEL.handle).click()
    const flag = dirDetail().querySelector('input[type="checkbox"]') as HTMLInputElement
    flag.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pageCalls).toHaveLength(1)
    const saved = (stub.local['ytRedirectPin.directory'] as Directory).find(
      (e) => e.url === FAKE_CHANNEL.url,
    )!
    expect(saved.channelId).toBe(ID)
    expect(saved.iconDataUrl).toBe('')
  })

  it('控えたアイコンは次に開いても取りに行かない (AC17)', async () => {
    const { allCalls } = stubFetch('<html></html>')

    await withDirectory([
      entry({ url: FAKE_CHANNEL.url, iconDataUrl: 'data:image/jpeg;base64,AAA' }),
    ])

    expect(allCalls).toHaveLength(0)
    const row = rowByHandle(FAKE_CHANNEL.handle)
    expect(row.querySelector('img[src^="data:image/"]')).not.toBeNull()
  })

  it('/channel/UC… 形の行もまとめて取得の対象 (AC20)', async () => {
    const channelUrl = `https://www.youtube.com/channel/${ID}`
    const html = `<html><head>${ogImage(ICON_URL)}</head></html>`
    const { pageCalls } = stubFetch(html)

    await withDirectory([entry({ url: channelUrl, iconDataUrl: '' })])

    const button = document.querySelector('#fetchAllIcons') as HTMLButtonElement
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pageCalls).toHaveLength(1)
  })
})
