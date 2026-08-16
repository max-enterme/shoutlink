/**
 * 設定画面の自由文まわりの判定 (AC6 / AC7 / AC8)。
 *
 * `src/options/options.ts` は import した時点で 17 個の要素 id を要求して throw する
 * 副作用モジュールなので、テストの対象は**そこから切り出した純関数**
 * (`src/options/message-field.ts`)。DOM 配線はテストしない(plan.md)。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_ENTRY_MESSAGE_LENGTH,
  MAX_MESSAGE_LENGTH,
  compose,
  composedLength,
} from '../src/composer'
import type { Directory } from '../src/directory'
import {
  captureRowDraft,
  commentMismatchMessage,
  countEntriesWithMessage,
  countReplyToComment,
  focusKey,
  ineffectiveReasons,
  entryRemainingLength,
  entryTemplateValues,
  formatRemaining,
  hasMsgPlaceholder,
  isRowField,
  msgPlaceholderWarning,
  restoreSelection,
  rowDraftValues,
  validateEntryMessage,
} from '../src/options/message-field'
import type { FocusTarget, RowDraft } from '../src/options/message-field'
import {
  alwaysOnNotices,
  channelIdRowStatus,
  duplicateChannelIdGroups,
  duplicateChannelIdWarning,
  hasDuplicateChannelId,
  needsChannelIdResolution,
  retryAllLabel,
  unresolvedChannelIdEntries,
} from '../src/options/notices'
import type { RedirectEvent } from '../src/types'
import { FAKE_CHANNEL } from './fixtures/live-chat'

function entry(over: Partial<Directory[number]> = {}): Directory[number] {
  return {
    url: FAKE_CHANNEL.url,
    nickname: '',
    message: '',
    replyToComment: false,
    commentMessage: '',
    channelId: '',
    lastSeenAt: 0,
    ...over,
  }
}

describe('validateEntryMessage (AC6)', () => {
  it('上限ちょうどは通す', () => {
    const value = 'あ'.repeat(MAX_ENTRY_MESSAGE_LENGTH)
    expect(validateEntryMessage(value)).toEqual({ ok: true, value })
  })

  it('前後の空白を落として保存する', () => {
    expect(validateEntryMessage('  ありがとう  ')).toEqual({ ok: true, value: 'ありがとう' })
  })

  it('上限を超えると保存せず、理由に長さと上限が出る', () => {
    const result = validateEntryMessage('あ'.repeat(MAX_ENTRY_MESSAGE_LENGTH + 13))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.length).toBe(MAX_ENTRY_MESSAGE_LENGTH + 13)
    expect(result.reason).toContain(String(MAX_ENTRY_MESSAGE_LENGTH))
    expect(result.reason).toContain(String(MAX_ENTRY_MESSAGE_LENGTH + 13))
  })

  it('超過分を切り詰めて黙って通さない (AC6)', () => {
    const result = validateEntryMessage('あ'.repeat(MAX_ENTRY_MESSAGE_LENGTH + 1))
    // `{ ok: true, value: 200 字 }` が返ってきたら、書いた本人が消えた部分に気づけない
    expect(result.ok).toBe(false)
  })

  it('絵文字はコードポイントで数える(保存時の切り詰めと単位をそろえる)', () => {
    // UTF-16 で数えると 400 になり、上限ちょうどの入力が弾かれる
    expect(validateEntryMessage('🎉'.repeat(MAX_ENTRY_MESSAGE_LENGTH)).ok).toBe(true)
    expect(validateEntryMessage('🎉'.repeat(MAX_ENTRY_MESSAGE_LENGTH + 1)).ok).toBe(false)
  })

  it('空文字は通る(自由文の未設定)', () => {
    expect(validateEntryMessage('   ')).toEqual({ ok: true, value: '' })
  })
})

describe('msgPlaceholderWarning (AC7)', () => {
  const withMessage: Directory = [entry({ message: 'ありがとう' })]

  it('自由文があるのにテンプレートに {msg} が無いと警告する', () => {
    const warning = msgPlaceholderWarning('{name}さん {url}', withMessage)
    expect(warning).not.toBeNull()
    expect(warning).toContain('{msg}')
  })

  it('件数を出す', () => {
    const directory: Directory = [
      entry({ url: 'https://www.youtube.com/@a', message: 'あ' }),
      entry({ url: 'https://www.youtube.com/@b', message: 'い' }),
      entry({ url: 'https://www.youtube.com/@c', message: '' }),
    ]
    expect(msgPlaceholderWarning('{name} {url}', directory)).toContain('2')
    expect(countEntriesWithMessage(directory)).toBe(2)
  })

  it('テンプレートに {msg} があれば警告しない', () => {
    expect(msgPlaceholderWarning('{name}さん {msg} {url}', withMessage)).toBeNull()
  })

  it('自由文が 1 件も無ければ警告しない', () => {
    expect(msgPlaceholderWarning('{name}さん {url}', [entry()])).toBeNull()
    expect(msgPlaceholderWarning('{name}さん {url}', [])).toBeNull()
  })

  it('空白だけの自由文は「登録されている」と数えない', () => {
    expect(msgPlaceholderWarning('{name} {url}', [entry({ message: '   ' })])).toBeNull()
  })

  it('hasMsgPlaceholder が compose の実挙動と食い違わない', () => {
    // 綴りが composer.ts の PLACEHOLDER とずれると
    // 「警告は出ないのに差し込まれない」が起きるので、実際に差し込んで突き合わせる
    const event: RedirectEvent = {
      sourceChannelName: FAKE_CHANNEL.name,
      sourceChannelUrl: FAKE_CHANNEL.url,
      detectedAt: 0,
    }
    for (const template of ['{msg}', '{name} {msg} {url}', '{name} {url}', 'msg', '{ msg }']) {
      const composed = compose(template, event, { message: 'さしこみ' })
      expect(hasMsgPlaceholder(template)).toBe(composed.includes('さしこみ'))
    }
  })
})

describe('entryRemainingLength / formatRemaining (AC8)', () => {
  const template = '{name}さん {msg} ありがとうございます! {url}'

  it('自由文の 200 字ではなく、展開後の投稿文全体に対する残りを出す', () => {
    const source = { url: FAKE_CHANNEL.url, nickname: 'れい' }
    const message = 'いつもありがとう'
    const expected =
      MAX_MESSAGE_LENGTH -
      composedLength(template, { name: 'れい', url: FAKE_CHANNEL.url, message })
    expect(entryRemainingLength(template, source, message)).toBe(expected)
    // 定型部分と URL が場所を食うので、自由文の保存上限に対する残りとは一致しない
    expect(entryRemainingLength(template, source, message)).not.toBe(
      MAX_ENTRY_MESSAGE_LENGTH - Array.from(message).length,
    )
  })

  it('呼び名が未設定ならハンドルで見積もる', () => {
    const withHandle = entryTemplateValues({ url: FAKE_CHANNEL.url, nickname: '' }, '')
    expect(withHandle.name).toBe(FAKE_CHANNEL.handle)
    const withNickname = entryTemplateValues({ url: FAKE_CHANNEL.url, nickname: ' れい ' }, '')
    expect(withNickname.name).toBe('れい')
  })

  it('テンプレートを変えると残りが変わる(保存を待たない)', () => {
    const source = { url: FAKE_CHANNEL.url, nickname: 'れい' }
    const short = entryRemainingLength('{msg} {url}', source, 'どうも')
    const long = entryRemainingLength(`${'x'.repeat(40)} {msg} {url}`, source, 'どうも')
    expect(long).toBe(short - 41)
  })

  it('自由文が未設定なら {msg} が畳まれた分だけ残りが増える', () => {
    const source = { url: FAKE_CHANNEL.url, nickname: 'れい' }
    expect(entryRemainingLength(template, source, '')).toBeGreaterThan(
      entryRemainingLength(template, source, 'あ'),
    )
  })

  it('超過すると負を返す(保存は妨げない)', () => {
    const source = { url: FAKE_CHANNEL.url, nickname: 'れい' }
    expect(entryRemainingLength(template, source, 'あ'.repeat(200))).toBeLessThan(0)
  })

  it('残りが負であることが表示で分かる', () => {
    expect(formatRemaining(12)).toBe('残り 12 字')
    expect(formatRemaining(0)).toBe('残り 0 字')
    // 「残り -12 字」だと読み飛ばされるので、負は別の言い方にする
    expect(formatRemaining(-12)).not.toContain('残り')
    expect(formatRemaining(-12)).toContain('12')
    expect(formatRemaining(-12)).toContain('超過')
  })

  it('残りが 0 のとき、その自由文は実際に削られずに収まる', () => {
    // `compose` の上限比較と数え方が違うと「あと 0 字」が嘘になる
    const source = { url: FAKE_CHANNEL.url, nickname: 'れい' }
    const base = entryRemainingLength(template, source, '')
    const message = 'あ'.repeat(base - 1) // `{msg}` が畳まれていた分の空白 1 つを戻す
    expect(entryRemainingLength(template, source, message)).toBe(0)

    const event: RedirectEvent = {
      sourceChannelName: 'れい',
      sourceChannelUrl: FAKE_CHANNEL.url,
      detectedAt: 0,
    }
    const posted = compose(template, event, { message })
    expect(posted).toContain(message)
    expect(posted).not.toContain('…')
    expect(posted.length).toBe(MAX_MESSAGE_LENGTH)
  })
})

describe('captureRowDraft / rowDraftValues (再描画で未保存の入力を失わせない)', () => {
  function draft(over: Partial<RowDraft> = {}): RowDraft {
    return { nickname: '', message: '', invalid: false, reason: null, ...over }
  }

  /** 何も入っていない行を描いた直後の状態 */
  const empty = { nickname: '', message: '' }

  it('AC6 で弾かれた自由文は、再描画をまたいでも残る', () => {
    // 設定画面は行を保存・削除・新規登録するたびに全行を作り直す。
    // ここで下書きを落とすと、「200 字までです。保存していません」と言われた本人が、
    // 直す前に別の行へ触っただけで書いた 250 字を復元不能に失う
    const tooLong = 'あ'.repeat(MAX_ENTRY_MESSAGE_LENGTH + 50)
    const current = draft({ message: tooLong, invalid: true, reason: '自由文は 200 字までです' })
    const kept = captureRowDraft(empty, empty, current)
    expect(kept).toEqual(current)
    // 作り直した行には、保存済みの空文字ではなく書いた内容が戻る
    const shown = rowDraftValues(empty, kept ?? undefined)
    expect(shown.message).toBe(tooLong)
    expect(shown.invalid).toBe(true)
    expect(shown.reason).toContain('200 字')
  })

  it('弾かれた入力は、保存済みと同じ内容でも残す(赤枠と理由を消さない)', () => {
    const current = draft({ message: 'ありがとう', invalid: true, reason: 'だめ' })
    expect(captureRowDraft({ nickname: '', message: 'ありがとう' }, empty, current)).toEqual(current)
  })

  it('保存に反映済みなら下書きを残さない(古い値が勝ち続けない)', () => {
    const saved = { nickname: 'れい', message: 'ありがとう' }
    expect(captureRowDraft(saved, empty, draft(saved))).toBeNull()
    // 保存側は trim してから入るので、比較も trim でそろえる
    expect(
      captureRowDraft(saved, empty, draft({ nickname: ' れい ', message: ' ありがとう ' })),
    ).toBeNull()
  })

  it('人が触っていない行は下書きにしない(＋ の欄からの再登録が画面に出る)', () => {
    // 描いたときの値のまま = 誰も打っていない。ここを残すと、同じハンドルを ＋ の欄から
    // 入れ直して呼び名を変えても、行には古い呼び名が出続ける
    const shown = { nickname: 'A', message: '大事な一言' }
    const saved = { nickname: 'A2', message: '大事な一言' }
    expect(captureRowDraft(saved, shown, draft(shown))).toBeNull()
  })

  it('下書きから描いた行は、誰も打たなくても下書きを捨てない(再描画 2 回目で巻き戻らない)', () => {
    // 下書きを入力欄へ戻して描くと、人が何も打たなければ当然 current === shown になる。
    // ここで「打っていない」と判定して捨てると、**再描画 2 回目で保存済みの値へ巻き戻る**。
    // chrome.storage.onChanged は自分の書き込みでも発火するので、1 回の保存で描画は 2 回走る
    const shownFromDraft = { nickname: '打ちかけの呼び名', message: '打ちかけの一言' }
    const saved = { nickname: 'れい', message: '' }
    // 保存済み由来の shown なら「打っていない」= 捨てる(既存の判定)
    expect(captureRowDraft(saved, shownFromDraft, draft(shownFromDraft), false)).toBeNull()
    // 下書き由来なら残す
    expect(captureRowDraft(saved, shownFromDraft, draft(shownFromDraft), true)).toEqual(
      draft(shownFromDraft),
    )
  })

  it('下書き由来でも、保存に反映されたら捨てる(古い値が勝ち続けない)', () => {
    // shownFromDraft を立てても条件 3(保存済みと一致)は生きている必要がある。
    // ここが抜けると、下書きが一度立った行は永久に更新を受け付けなくなる
    const saved = { nickname: 'れい', message: 'ありがとう' }
    expect(captureRowDraft(saved, saved, draft(saved), true)).toBeNull()
  })

  it('まだ保存していない呼び名・自由文は残す', () => {
    expect(captureRowDraft(empty, empty, draft({ nickname: 'れい' }))).not.toBeNull()
    expect(captureRowDraft(empty, empty, draft({ message: '書きかけ' }))).not.toBeNull()
  })

  it('下書きが無ければ保存済みの値を出す', () => {
    const saved = { nickname: 'れい', message: 'ありがとう' }
    expect(rowDraftValues(saved, undefined)).toEqual({ ...saved, invalid: false, reason: null })
  })
})

describe('focusKey / isRowField / restoreSelection (再描画でフォーカスを落とさない)', () => {
  const key = 'https://www.youtube.com/@a'
  const target = (over: Partial<FocusTarget> = {}): FocusTarget => ({
    key,
    field: 'commentMessage',
    selectionStart: 3,
    selectionEnd: 3,
    ...over,
  })

  it('**行 × 欄で一意になる**(呼び名の位置に自由文のキャレットを載せない)', () => {
    expect(focusKey(key, 'nickname')).not.toBe(focusKey(key, 'message'))
    expect(focusKey(key, 'message')).not.toBe(focusKey(key, 'commentMessage'))
    // 同じ組み合わせなら安定して同じ鍵(作り直した行を引ける)
    expect(focusKey(key, 'message')).toBe(focusKey(key, 'message'))
    expect(focusKey(key, 'message')).not.toBe(focusKey('https://www.youtube.com/@b', 'message'))
  })

  it('欄の名前は 3 つだけ受ける(`dataset` は文字列なら何でも入る)', () => {
    expect(isRowField('nickname')).toBe(true)
    expect(isRowField('message')).toBe(true)
    expect(isRowField('commentMessage')).toBe(true)
    expect(isRowField('channelId')).toBe(false)
    expect(isRowField(undefined)).toBe(false)
    expect(isRowField('')).toBe(false)
  })

  it('キャレットの位置をそのまま戻す', () => {
    expect(restoreSelection(target({ selectionStart: 2, selectionEnd: 5 }), 10)).toEqual({
      start: 2,
      end: 5,
    })
  })

  it('**フォーカスが辞書の入力欄に無ければ戻さない**', () => {
    expect(restoreSelection(null, 10)).toBeNull()
  })

  it('**欄が消えていれば戻さない**(行を削除した / 展開を畳んだ)', () => {
    // 解決が返った瞬間の再描画で、対象の行がもう無いことがある。ここで例外にしない
    expect(restoreSelection(target(), null)).toBeNull()
  })

  it('**値の長さで丸める**(下書きの書き戻しで値が変わっていることがある)', () => {
    expect(restoreSelection(target({ selectionStart: 99, selectionEnd: 99 }), 4)).toEqual({
      start: 4,
      end: 4,
    })
    expect(restoreSelection(target({ selectionStart: -3, selectionEnd: -1 }), 4)).toEqual({
      start: 0,
      end: 0,
    })
  })

  it('位置が取れなかった欄は**末尾**に置く(先頭に戻すと続きが頭に入る)', () => {
    expect(restoreSelection(target({ selectionStart: null, selectionEnd: null }), 6)).toEqual({
      start: 6,
      end: 6,
    })
  })

  it('終端が開始より前でも、逆転した範囲を返さない', () => {
    expect(restoreSelection(target({ selectionStart: 5, selectionEnd: 2 }), 10)).toEqual({
      start: 5,
      end: 5,
    })
  })

  it('空の欄でも落ちない', () => {
    expect(restoreSelection(target({ selectionStart: 0, selectionEnd: 0 }), 0)).toEqual({
      start: 0,
      end: 0,
    })
  })
})

// --- 004: 組(テンプレート × 自由文)ごとの判定 (AC16) -------------------------

describe('countEntriesWithMessage — field ごとに数える (AC16)', () => {
  const directory: Directory = [
    entry({ url: FAKE_CHANNEL.url, message: 'リダイレクト用', commentMessage: '' }),
    entry({ url: 'https://www.youtube.com/@b', message: '', commentMessage: 'コメント用' }),
    entry({ url: 'https://www.youtube.com/@c', message: 'A', commentMessage: 'B' }),
  ]

  it('既定は 003 の自由文を数える', () => {
    expect(countEntriesWithMessage(directory)).toBe(2)
  })

  it('コメント返し用の自由文だけを数えられる', () => {
    expect(countEntriesWithMessage(directory, 'commentMessage')).toBe(2)
  })

  it('空白だけは数えない', () => {
    expect(countEntriesWithMessage([entry({ commentMessage: '   ' })], 'commentMessage')).toBe(0)
  })
})

describe('msgPlaceholderWarning — 組を跨がない (AC16)', () => {
  const onlyComment: Directory = [entry({ message: '', commentMessage: 'コメント用' })]

  it('**組を跨がない** — リダイレクト側に {msg} があっても、コメント側の判定は独立している', () => {
    const redirectTemplate = '{name} {msg} {url}' // {msg} あり
    const commentTemplateWithout = '{name} {url}' // {msg} なし

    // リダイレクト側: 自由文が 0 件なので出ない
    expect(msgPlaceholderWarning(redirectTemplate, onlyComment, 'message')).toBeNull()
    // コメント側: 自由文が 1 件あってテンプレートに {msg} が無いので**出る**
    expect(msgPlaceholderWarning(commentTemplateWithout, onlyComment, 'commentMessage')).not.toBeNull()
  })

  it('自分の組のテンプレートに {msg} があれば出ない', () => {
    expect(msgPlaceholderWarning('{msg}', onlyComment, 'commentMessage')).toBeNull()
  })

  it('自分の組の自由文が 0 件なら出ない', () => {
    const onlyRedirect: Directory = [entry({ message: 'リダイレクト用', commentMessage: '' })]
    expect(msgPlaceholderWarning('{name} {url}', onlyRedirect, 'commentMessage')).toBeNull()
    expect(msgPlaceholderWarning('{name} {url}', onlyRedirect, 'message')).not.toBeNull()
  })

  it('文面にどちらの自由文かが出る', () => {
    expect(msgPlaceholderWarning('{name}', onlyComment, 'commentMessage')).toContain(
      'コメント返し用の自由文',
    )
  })
})

// --- 004: 「効かない行」の印 (AC13 / AC17) ------------------------------------

describe('ineffectiveReasons (AC13)', () => {
  const withMsg = { template: '{name} {msg} {url}', commentTemplate: '{name} {msg} {url}' }
  const noMsg = { template: '{name} {url}', commentTemplate: '{name} {url}' }
  const row = (over: Partial<Directory[number]> = {}) =>
    entry({ replyToComment: false, channelId: '', ...over })

  it('何も設定していない行には印を出さない', () => {
    expect(ineffectiveReasons(row(), '', '', withMsg)).toEqual([])
  })

  it('**「フラグ ON で自由文が空」は撃たない**(AC16 の既定。撃つと全行が印で埋まる)', () => {
    const reasons = ineffectiveReasons(
      row({ replyToComment: true, channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }),
      '',
      '',
      withMsg,
    )
    expect(reasons).toEqual([])
  })

  it('コメント用の自由文があるのにフラグが OFF なら出す', () => {
    const reasons = ineffectiveReasons(row(), '', 'コメント用', withMsg)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('OFF')
  })

  it('**テンプレートの {msg} 不在は組ごとに判定する**(組を跨がない / AC16)', () => {
    // リダイレクト側だけ {msg} が無い
    const onlyRedirectMissing = { template: '{name} {url}', commentTemplate: '{name} {msg} {url}' }
    const reasons = ineffectiveReasons(
      row({ replyToComment: true, channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }),
      'リダイレクト用',
      'コメント用',
      onlyRedirectMissing,
    )
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('リダイレクト返礼の文面')
  })

  it('**フラグ ON なのにチャンネル ID が未解決なら出す** (AC17)', () => {
    const reasons = ineffectiveReasons(row({ replyToComment: true, channelId: '' }), '', '', withMsg)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('チャンネル ID が未解決')
  })

  it('複数当てはまればすべて出す', () => {
    const reasons = ineffectiveReasons(row(), 'リダイレクト用', 'コメント用', noMsg)
    // フラグ OFF + {msg} 不在 × 2
    expect(reasons).toHaveLength(3)
  })

  it('空白だけの自由文は「書いた」とみなさない', () => {
    expect(ineffectiveReasons(row(), '   ', '   ', noMsg)).toEqual([])
  })
})

describe('ineffectiveReasons — チャンネル ID まわり (AC17)', () => {
  const withMsg = { template: '{name} {msg} {url}', commentTemplate: '{name} {msg} {url}' }
  const ON = { replyToComment: true, channelId: '' }

  it('**失敗の理由が分かっていれば印にも載せる**(畳んだままでも読める)', () => {
    const reasons = ineffectiveReasons(entry(ON), '', '', {
      ...withMsg,
      channelIdError: '取得に失敗した (HTTP 404)',
    })
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('チャンネル ID が未解決')
    expect(reasons[0]).toContain('HTTP 404')
  })

  it('理由が無ければ理由なしの文面のまま(空の括弧を出さない)', () => {
    const reasons = ineffectiveReasons(entry(ON), '', '', { ...withMsg, channelIdError: null })
    expect(reasons[0]).not.toContain('(')
  })

  it('**同じチャンネル ID の行が他にもあれば出す**(何もしない状態を画面で気づけるように)', () => {
    const reasons = ineffectiveReasons(
      entry({ replyToComment: true, channelId: FAKE_CHANNEL.channelId }),
      '',
      '',
      { ...withMsg, duplicateChannelId: true },
    )
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('同じチャンネル ID')
  })

  it('重複していてもフラグが OFF の行には出さない(反応しないのが正常)', () => {
    const reasons = ineffectiveReasons(
      entry({ replyToComment: false, channelId: FAKE_CHANNEL.channelId }),
      '',
      '',
      { ...withMsg, duplicateChannelId: true },
    )
    expect(reasons).toEqual([])
  })

  it('未解決の行には重複の理由を出さない(空文字は重複ではない)', () => {
    const reasons = ineffectiveReasons(entry(ON), '', '', { ...withMsg, duplicateChannelId: true })
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('未解決')
  })
})

describe('commentMismatchMessage (AC13)', () => {
  it('**ON なのにフラグが 0 件**なら出す', () => {
    expect(commentMismatchMessage(true, 0)).toContain('0 件')
  })

  it('**OFF なのにフラグが付いている**なら件数つきで出す', () => {
    expect(commentMismatchMessage(false, 3)).toContain('3 人')
  })

  it('食い違っていなければ出さない', () => {
    expect(commentMismatchMessage(true, 1)).toBeNull()
    expect(commentMismatchMessage(false, 0)).toBeNull()
  })

  it('countReplyToComment はフラグが ON の件数を数える', () => {
    const directory: Directory = [
      entry({ url: FAKE_CHANNEL.url, replyToComment: true }),
      entry({ url: 'https://www.youtube.com/@b', replyToComment: false }),
      entry({ url: 'https://www.youtube.com/@c', replyToComment: true }),
    ]
    expect(countReplyToComment(directory)).toBe(2)
  })
})

// --- 004 T17: チャンネル ID の解決まわり (AC17) -------------------------------

const ID = FAKE_CHANNEL.channelId
const OTHER_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'

describe('duplicateChannelIdGroups / duplicateChannelIdWarning (AC17)', () => {
  it('同じチャンネル ID の行が 2 件あれば、両方のハンドルと ID を出す', () => {
    // 同一人物が `@handle` 形と `/channel/UC…` 形で 2 行に載る = 別の鍵になるので気づきにくい
    const directory: Directory = [
      entry({ url: 'https://www.youtube.com/@a', channelId: ID }),
      entry({ url: `https://www.youtube.com/channel/${ID}`, channelId: ID }),
    ]
    expect(duplicateChannelIdGroups(directory)).toEqual([
      { channelId: ID, handles: ['@a', `https://www.youtube.com/channel/${ID}`] },
    ])
    const warning = duplicateChannelIdWarning(directory)
    expect(warning).not.toBeNull()
    expect(warning).toContain('@a')
    expect(warning).toContain(ID)
    // 「反応しない」ことまで書く(AC17 でこの状態は「何もしない」と決めた側)
    expect(warning).toContain('反応しません')
  })

  it('**未解決(空文字)同士は重複ではない**(付けた直後の全行が警告になる)', () => {
    const directory: Directory = [
      entry({ url: 'https://www.youtube.com/@a', channelId: '' }),
      entry({ url: 'https://www.youtube.com/@b', channelId: '' }),
    ]
    expect(duplicateChannelIdGroups(directory)).toEqual([])
    expect(duplicateChannelIdWarning(directory)).toBeNull()
  })

  it('違う ID なら警告しない', () => {
    const directory: Directory = [
      entry({ url: 'https://www.youtube.com/@a', channelId: ID }),
      entry({ url: 'https://www.youtube.com/@b', channelId: OTHER_ID }),
    ]
    expect(duplicateChannelIdWarning(directory)).toBeNull()
  })

  it('3 件以上でも 1 つの組にまとめる / 組が 2 つあれば両方出す', () => {
    const directory: Directory = [
      entry({ url: 'https://www.youtube.com/@a', channelId: ID }),
      entry({ url: 'https://www.youtube.com/@b', channelId: ID }),
      entry({ url: 'https://www.youtube.com/@c', channelId: ID }),
      entry({ url: 'https://www.youtube.com/@d', channelId: OTHER_ID }),
      entry({ url: 'https://www.youtube.com/@e', channelId: OTHER_ID }),
    ]
    const groups = duplicateChannelIdGroups(directory)
    expect(groups).toHaveLength(2)
    expect(groups[0].handles).toEqual(['@a', '@b', '@c'])
    const warning = duplicateChannelIdWarning(directory)
    expect(warning).toContain('@d')
    expect(warning).toContain('@e')
  })

  it('**形が壊れた値は重複として数えない**(findEntryByChannelId と同じ強さで見る)', () => {
    const directory: Directory = [
      entry({ url: 'https://www.youtube.com/@a', channelId: 'UCshort' }),
      entry({ url: 'https://www.youtube.com/@b', channelId: 'UCshort' }),
    ]
    expect(duplicateChannelIdWarning(directory)).toBeNull()
  })

  it('hasDuplicateChannelId は行ごとの印に使える', () => {
    const directory: Directory = [
      entry({ url: 'https://www.youtube.com/@a', channelId: ID }),
      entry({ url: 'https://www.youtube.com/@b', channelId: ID }),
      entry({ url: 'https://www.youtube.com/@c', channelId: OTHER_ID }),
    ]
    expect(hasDuplicateChannelId(directory, ID)).toBe(true)
    expect(hasDuplicateChannelId(directory, OTHER_ID)).toBe(false)
    // 空文字で真を返すと、未解決の行が全部「重複」になる
    expect(hasDuplicateChannelId(directory, '')).toBe(false)
  })
})

describe('unresolvedChannelIdEntries / retryAllLabel (AC17)', () => {
  const directory: Directory = [
    entry({ url: 'https://www.youtube.com/@on-unresolved', replyToComment: true, channelId: '' }),
    entry({ url: 'https://www.youtube.com/@on-resolved', replyToComment: true, channelId: ID }),
    entry({ url: 'https://www.youtube.com/@off-unresolved', replyToComment: false, channelId: '' }),
  ]

  it('**ON かつ未解決の行だけ**を対象にする', () => {
    // OFF の行まで含めると、ボタン 1 つで辞書の全件を取りに行くことになる
    expect(unresolvedChannelIdEntries(directory).map((e) => e.url)).toEqual([
      'https://www.youtube.com/@on-unresolved',
    ])
  })

  it('解決済みの行は対象にしない(一度解決した ID は取り直さない)', () => {
    expect(
      unresolvedChannelIdEntries([entry({ replyToComment: true, channelId: ID })]),
    ).toEqual([])
  })

  it('件数を文言に出す(押す前に規模が分かる)', () => {
    expect(retryAllLabel(2)).toContain('2 件')
    expect(retryAllLabel(0)).toContain('0 件')
  })
})

describe('needsChannelIdResolution (AC17)', () => {
  it('**既に解決済みなら取りに行かない**(自動で解決し直さない)', () => {
    expect(needsChannelIdResolution(entry({ channelId: ID }))).toBe(false)
  })

  it('未解決なら取りに行く', () => {
    expect(needsChannelIdResolution(entry({ channelId: '' }))).toBe(true)
  })

  it('待っている間に消えた行には何もしない(upsert で行が復活しないように)', () => {
    expect(needsChannelIdResolution(undefined)).toBe(false)
  })
})

describe('channelIdRowStatus (AC17)', () => {
  const base = { channelId: '', replyToComment: false, resolving: false, error: null }

  it('解決中は再試行を出さない(多重に走らせない)', () => {
    const status = channelIdRowStatus({ ...base, resolving: true, replyToComment: true })
    expect(status.text).toContain('解決中')
    expect(status.canRetry).toBe(false)
  })

  it('解決済みなら ID を出し、再試行は出さない', () => {
    const status = channelIdRowStatus({ ...base, channelId: ID, replyToComment: true })
    expect(status.text).toContain(ID)
    expect(status.canRetry).toBe(false)
    expect(status.failed).toBe(false)
  })

  it('**解決済みなら古い失敗の理由は出さない**', () => {
    const status = channelIdRowStatus({ ...base, channelId: ID, error: '取得に失敗した' })
    expect(status.text).toContain(ID)
    expect(status.failed).toBe(false)
  })

  it('**失敗したら理由をそのまま出し、再試行を出す**', () => {
    const status = channelIdRowStatus({
      ...base,
      replyToComment: true,
      error: '取得に失敗した (HTTP 404)',
    })
    expect(status.text).toContain('HTTP 404')
    expect(status.canRetry).toBe(true)
    expect(status.failed).toBe(true)
    expect(status.retryLabel).toBe('再試行')
  })

  it('ON なのに未解決なら「反応しない」と出す', () => {
    const status = channelIdRowStatus({ ...base, replyToComment: true })
    expect(status.text).toContain('反応しません')
    expect(status.failed).toBe(true)
    expect(status.canRetry).toBe(true)
  })

  it('**OFF の行はまだ壊れていない**(失敗扱いにしない)', () => {
    const status = channelIdRowStatus(base)
    expect(status.failed).toBe(false)
    // 1 度も取りに行っていない行に「再試行」とは出さない
    expect(status.retryLabel).not.toBe('再試行')
    expect(status.canRetry).toBe(true)
  })
})

describe('alwaysOnNotices — 常時表示を 1 か所で作る (AC13 / AC16 / AC17)', () => {
  /** 4 本とも同時に成立する状態 */
  const broken = {
    template: '{name} {url}',
    commentTemplate: '{name} {url}',
    commentReplyEnabled: false,
    directory: [
      entry({
        url: 'https://www.youtube.com/@a',
        message: 'リダイレクト用',
        commentMessage: 'コメント用',
        replyToComment: true,
        channelId: ID,
      }),
      entry({ url: 'https://www.youtube.com/@b', channelId: ID }),
    ] as Directory,
  }

  it('**4 本とも返す**(1 本だけ描き忘れる形を値で防ぐ)', () => {
    // ⚠️ 2026-08-16 に `renderAlwaysOnNotices()` が自分自身を呼ぶ版が型検査を通り、
    //    設定画面が開いた瞬間に落ちて**辞書も常時表示も 1 つも描かれなかった。**
    //    判定を 1 つの純関数へ寄せてあるので、ここが 4 本まとめて見張る
    const notices = alwaysOnNotices(broken)
    expect(notices.templateWarning).not.toBeNull()
    expect(notices.commentTemplateWarning).not.toBeNull()
    expect(notices.commentMismatch).not.toBeNull()
    expect(notices.duplicateChannelId).not.toBeNull()
    expect(Object.keys(notices).sort()).toEqual([
      'commentMismatch',
      'commentTemplateWarning',
      'duplicateChannelId',
      'templateWarning',
    ])
  })

  it('問題が無ければ 4 本とも null(出しっぱなしにしない)', () => {
    const notices = alwaysOnNotices({
      template: '{name} {msg} {url}',
      commentTemplate: '{name} {msg} {url}',
      commentReplyEnabled: true,
      directory: [
        entry({ url: 'https://www.youtube.com/@a', replyToComment: true, channelId: ID }),
      ],
    })
    expect(notices).toEqual({
      templateWarning: null,
      commentTemplateWarning: null,
      commentMismatch: null,
      duplicateChannelId: null,
    })
  })

  it('辞書が空でも落ちない(最後の 1 件を消した直後の状態)', () => {
    const notices = alwaysOnNotices({
      template: '{name} {url}',
      commentTemplate: '{name} {url}',
      commentReplyEnabled: true,
      directory: [],
    })
    // 「ON なのに付けた人が 0 件」だけが出る
    expect(notices.commentMismatch).not.toBeNull()
    expect(notices.templateWarning).toBeNull()
    expect(notices.duplicateChannelId).toBeNull()
  })

  it('**組を跨がない** — 片方のテンプレートに {msg} があっても、もう片方の警告は消えない', () => {
    const notices = alwaysOnNotices({
      ...broken,
      template: '{name} {msg} {url}',
    })
    expect(notices.templateWarning).toBeNull()
    expect(notices.commentTemplateWarning).not.toBeNull()
  })
})
