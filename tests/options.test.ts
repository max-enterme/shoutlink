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
  countEntriesWithMessage,
  entryRemainingLength,
  entryTemplateValues,
  formatRemaining,
  hasMsgPlaceholder,
  msgPlaceholderWarning,
  rowDraftValues,
  shouldUpsertMessage,
  validateEntryMessage,
} from '../src/options/message-field'
import type { RowDraft } from '../src/options/message-field'
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

describe('shouldUpsertMessage (＋ の欄からの再登録)', () => {
  it('既に登録がある相手を、空の自由文欄で上書きしない', () => {
    expect(shouldUpsertMessage({ nickname: '', message: '大事な一言' }, '')).toBe(false)
    expect(shouldUpsertMessage({ nickname: '', message: '大事な一言' }, '   ')).toBe(false)
  })

  it('自由文を書いてあれば既存の登録でも上書きする', () => {
    expect(shouldUpsertMessage({ nickname: '', message: '古い一言' }, '新しい一言')).toBe(true)
  })

  it('新規の登録は空でも行を作る(呼び名だけの登録と同じ)', () => {
    expect(shouldUpsertMessage(undefined, '')).toBe(true)
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
