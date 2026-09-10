import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config'
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
    ...patch,
  }
}

/** 辞書を差し替えて `initOptions()` を取り直す。`beforeEach` の既定(0 件)では書けないケース用 */
async function withDirectory(directory: Directory): Promise<void> {
  handle.dispose()
  delete (globalThis as { chrome?: unknown }).chrome
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
    // ⚠ の理由(無し) / ハンドル / 呼び名の input / コメントに反応する /
    // チャンネル ID の行 / 自由文 2 欄 / テスト送信 2 ボタン / 削除、の DOM 順
    expect(classNames).toEqual([
      'dir-detail-handle',
      'dir-detail-nickname',
      'row',
      'channel-id',
      'detail-field',
      'detail-field',
      'row test-send',
      '',
    ])
    expect(detail.textContent).toContain(FAKE_CHANNEL.url)
    expect(detail.querySelector('.dir-detail-nickname input')).not.toBeNull()
    expect(detail.textContent).toContain('コメントに反応する')
    expect(detail.querySelectorAll('.test-send button').length).toBe(2)
    expect([...detail.querySelectorAll('button')].some((b) => b.textContent === '削除')).toBe(true)
  })

  it('左の一覧に入力欄が無い (AC9)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url }), entry({ url: FAKE_OTHER_CHANNEL.url })])

    expect(dirList().querySelectorAll('input').length).toBe(0)
    expect(dirList().contains(document.querySelector('#newHandle'))).toBe(false)
    expect(dirList().contains(document.querySelector('#addEntry'))).toBe(false)
  })

  it('呼び名が空ならハンドルだけ出る (AC7)', async () => {
    await withDirectory([entry({ url: FAKE_CHANNEL.url, nickname: '' })])

    const row = rowByHandle(FAKE_CHANNEL.handle)
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

    filter.value = ''
    filter.dispatchEvent(new Event('input'))
    expect(dirRows().length).toBe(2)
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

    rowByHandle(FAKE_CHANNEL.handle).click()
    const field = dirDetail().querySelectorAll('.detail-field input')[0] as HTMLInputElement
    field.value = 'あ'.repeat(250)
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new Event('change'))

    const filter = document.querySelector('#dirFilter') as HTMLInputElement
    filter.value = FAKE_OTHER_CHANNEL.handle
    // captureRowDrafts が下書きを拾うのはこの再描画(絞り込みで 1 行目が #dirList から消える)
    filter.dispatchEvent(new Event('input'))

    // 別のタブで 1 行目が削除された辞書が届く
    const remaining = (stub.local['ytRedirectPin.directory'] as Directory).filter(
      (e) => e.url !== FAKE_CHANNEL.url,
    )
    stub.emitChange('ytRedirectPin.directory', remaining)

    filter.value = ''
    filter.dispatchEvent(new Event('input'))

    // 同じハンドルを ＋ から再登録する
    const newHandleInput = document.querySelector('#newHandle') as HTMLInputElement
    newHandleInput.value = FAKE_CHANNEL.handle
    ;(document.querySelector('#addEntry') as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    rowByHandle(FAKE_CHANNEL.handle).click()
    const reregistered = dirDetail().querySelectorAll('.detail-field input')[0] as HTMLInputElement
    expect(reregistered.value).toBe('')
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
