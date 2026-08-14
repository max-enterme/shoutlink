import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_LENGTH, compose, composedLength, remainingLength } from '../src/composer'
import { DEFAULT_CONFIG } from '../src/config'
import type { RedirectEvent } from '../src/types'
import { FAKE_CHANNEL } from './fixtures/live-chat'

const event: RedirectEvent = {
  sourceChannelName: FAKE_CHANNEL.name,
  sourceChannelUrl: FAKE_CHANNEL.url,
  detectedAt: 0,
}

describe('compose', () => {
  it('{name} と {url} を差し込む (AC2 / AC5)', () => {
    expect(compose('{name}さんからリダイレクトありがとうございます! {url}', event)).toBe(
      `${FAKE_CHANNEL.name}さんからリダイレクトありがとうございます! ${FAKE_CHANNEL.url}`,
    )
  })

  it('既定テンプレートに URL と表示名が両方入る (AC2)', () => {
    const text = compose(DEFAULT_CONFIG.template, event)
    expect(text).toContain(FAKE_CHANNEL.url)
    expect(text).toContain(FAKE_CHANNEL.name)
  })

  it('同じプレースホルダを複数回使える', () => {
    expect(compose('{name} / {name} / {url}', event)).toBe(
      `${FAKE_CHANNEL.name} / ${FAKE_CHANNEL.name} / ${FAKE_CHANNEL.url}`,
    )
  })

  it('未知のプレースホルダはそのまま残す', () => {
    expect(compose('{name} {foo}', event)).toBe(`${FAKE_CHANNEL.name} {foo}`)
  })

  it('差し込んだ値の中の {url} を再展開しない', () => {
    const tricky = { ...event, sourceChannelName: '{url}' }
    expect(compose('{name}', tricky)).toBe('{url}')
  })

  it('改行・制御文字を落として 1 行にする', () => {
    const dirty = { ...event, sourceChannelName: 'Multi\nLine\tName' }
    expect(compose('{name}', dirty)).toBe('Multi Line Name')
  })

  it('URL を含まないテンプレートも許す (R2: スパムフィルタ回避の代替文面)', () => {
    expect(compose('{name}さんありがとうございます!', event)).toBe(
      `${FAKE_CHANNEL.name}さんありがとうございます!`,
    )
  })

  it('上限を超えるときは表示名を削り、URL は壊さない', () => {
    const long = { ...event, sourceChannelName: 'あ'.repeat(300) }
    const text = compose('{name}さんからリダイレクトありがとうございます! {url}', long)
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
    expect(text).toContain(FAKE_CHANNEL.url)
  })

  it('表示名を削っても収まらない場合は末尾を切る', () => {
    const text = compose(`${'x'.repeat(300)}{url}`, event, { maxLength: 50 })
    expect(text).toHaveLength(50)
  })
})

describe('compose — 送信元ごとの自由文 {msg} (003)', () => {
  const TEMPLATE = '{name}さん {msg} ありがとうございます! {url}'
  /** 自由文が無いときの形。AC2 / AC4 の「落とした結果」の期待値でもある */
  const WITHOUT_MESSAGE = `${FAKE_CHANNEL.name}さん ありがとうございます! ${FAKE_CHANNEL.url}`

  it('{msg} に自由文を差し込む (AC1)', () => {
    expect(compose(TEMPLATE, event, { message: 'いつも助かってます' })).toBe(
      `${FAKE_CHANNEL.name}さん いつも助かってます ありがとうございます! ${FAKE_CHANNEL.url}`,
    )
  })

  it('自由文が未登録なら {msg} が消え、前後の空白が 1 つに畳まれる (AC2)', () => {
    expect(compose(TEMPLATE, event)).toBe(WITHOUT_MESSAGE)
    expect(compose(TEMPLATE, event, { message: '' })).toBe(WITHOUT_MESSAGE)
  })

  it('空白だけの自由文は未登録と同じ扱い (AC2)', () => {
    expect(compose(TEMPLATE, event, { message: '   ' })).toBe(WITHOUT_MESSAGE)
  })

  it('自由文の中の {name} {url} {msg} を再展開しない (AC9)', () => {
    // 1 パス置換の不変条件。`{msg}` だけ先に別の replace で埋めると、ここが破れる
    expect(compose('{msg}', event, { message: '{name} {url} {msg}' })).toBe('{name} {url} {msg}')
  })

  it('自由文の中の {msg} を無限に展開しない(自己参照)', () => {
    expect(compose('[{msg}]', event, { message: '{msg}' })).toBe('[{msg}]')
  })

  it('自由文の改行・制御文字も 1 行に潰す', () => {
    expect(compose('{msg}', event, { message: 'ふたつの\n行\tです' })).toBe('ふたつの 行 です')
  })

  // --- AC11: {msg} を含まないテンプレートの出力が現状と 1 文字も変わらない -------
  describe('{msg} を含まないテンプレートの出力は自由文の有無で変わらない (AC11)', () => {
    const cases: { label: string; template: string; ev: RedirectEvent; maxLength?: number }[] = [
      { label: '既定テンプレート', template: DEFAULT_CONFIG.template, ev: event },
      { label: '未知のプレースホルダ', template: '{name} {foo}', ev: event },
      {
        label: '表示名を削る経路',
        template: '{name}さんからリダイレクトありがとうございます! {url}',
        ev: { ...event, sourceChannelName: 'あ'.repeat(300) },
      },
      { label: '末尾を切る経路', template: `${'x'.repeat(300)}{url}`, ev: event, maxLength: 50 },
    ]

    for (const { label, template, ev, maxLength } of cases) {
      it(label, () => {
        const before = compose(template, ev, { maxLength })
        const after = compose(template, ev, { maxLength, message: 'あ'.repeat(150) })
        expect(after).toBe(before)
      })
    }
  })

  // --- AC3: 削り順は 自由文 → 表示名 → 末尾 ---------------------------------
  it('自由文を削って収まる場合、表示名も URL も壊さない (AC3)', () => {
    const text = compose(TEMPLATE, event, { message: 'あ'.repeat(200) })
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
    expect(text).toContain(FAKE_CHANNEL.url) // 末尾切りに落ちていない
    expect(text).toContain(`${FAKE_CHANNEL.name}さん`) // 表示名は削られていない
    expect(text).toContain('あ…') // 自由文だけが末尾から削られている
  })

  it('自由文を落としても収まらない場合は表示名を削り、URL は壊さない (AC3)', () => {
    const long = { ...event, sourceChannelName: 'あ'.repeat(300) }
    // 自由文には定型部分に出てこない文字を使う(残っているかを取り違えないため)
    const text = compose(TEMPLATE, long, { message: 'ヱ'.repeat(200) })
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
    expect(text).toContain(FAKE_CHANNEL.url)
    expect(text).not.toContain('ヱ') // 自由文が先に落ちている
    expect(text).toContain('あ…') // 削られたのは表示名の側
  })

  // --- AC4: コードポイント単位で削る / 残せないなら丸ごと落とす ----------------
  it('自由文を削るときサロゲートペアを割らない (AC4)', () => {
    // '🎉' は UTF-16 で 2。slice で切ると壊れた文字 (U+FFFD) になる。
    // 上限 50 に対して残せるのは 24 字(24×2 + 「…」= 49)。25 字だと 51 で溢れる
    expect(`${'🎉'.repeat(24)}…`.length).toBeLessThanOrEqual(50)
    expect(`${'🎉'.repeat(25)}…`.length).toBeGreaterThan(50)

    const text = compose('{msg}', event, { message: '🎉'.repeat(30), maxLength: 50 })
    expect(text).toBe(`${'🎉'.repeat(24)}…`) // 残せるだけ残す(過剰に削らない)
    expect(text).not.toContain('�')
  })

  it('絵文字の自由文を、上限の数え方の違いで過剰に削らない (AC4)', () => {
    // 削る量を「超過分」から算術で見積もると、上限(UTF-16)と削る単位(コードポイント)が
    // 絵文字で 1 : 2 にずれ、**まだ残せるのに丸ごと落ちる。**
    // MAX_ENTRY_MESSAGE_LENGTH = 200(コードポイント)以内なので設定画面から普通に保存できる入力
    const text = compose(TEMPLATE, event, { message: '🎉'.repeat(150) })
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
    expect(text).toContain('🎉…') // 落ちていない
    expect(text).toContain(FAKE_CHANNEL.url)
    // 残せた長さが AC4 の下限(10 字)を大きく上回っていること
    const kept = Array.from(text.split('…')[0].replace(`${FAKE_CHANNEL.name}さん `, ''))
    expect(kept.length).toBeGreaterThanOrEqual(60)
  })

  it('残せる長さが 10 字未満になるなら自由文ごと落とす (AC4)', () => {
    // 自由文入りの長さは「自由文なしの長さ + 1(空白)+ 自由文」。
    // 上限を +20 に置くと絵文字は 9 字(9×2 + 「…」= 19)しか残せない → 10 字未満なので落とす。
    // 「あ…」だけが残る文面を作らない。落とした結果は AC2 と同じ形になる
    const text = compose(TEMPLATE, event, {
      message: '🎉'.repeat(30),
      maxLength: WITHOUT_MESSAGE.length + 20,
    })
    expect(text).toBe(WITHOUT_MESSAGE)
  })

  it('ちょうど 10 字残せるなら落とさない (AC4 の境界)', () => {
    // 上限を +22 に置くと 10 字(10×2 + 「…」= 21)残せる。ここは落とす側ではない
    const text = compose(TEMPLATE, event, {
      message: '🎉'.repeat(30),
      maxLength: WITHOUT_MESSAGE.length + 22,
    })
    expect(text).toBe(
      `${FAKE_CHANNEL.name}さん ${'🎉'.repeat(10)}… ありがとうございます! ${FAKE_CHANNEL.url}`,
    )
  })

  it('テンプレートに {msg} が複数あっても過剰に削らない', () => {
    // 1 コードポイント削ると出力が 1 減る、という前提で見積もると 2 倍以上削ってしまう
    const text = compose('{msg} / {msg} {url}', event, { message: 'あ'.repeat(120) })
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
    expect(text).toContain(FAKE_CHANNEL.url)

    // 残せるだけ残していること: 1 字増やすと上限を超える
    const kept = text.split('…')[0].length
    const rebuild = (n: number): string =>
      `${'あ'.repeat(n)}… / ${'あ'.repeat(n)}… ${FAKE_CHANNEL.url}`
    expect(text).toBe(rebuild(kept))
    expect(rebuild(kept + 1).length).toBeGreaterThan(MAX_MESSAGE_LENGTH)
  })
})

describe('composedLength / remainingLength (AC8 の材料)', () => {
  const values = { name: 'れい', url: 'https://www.youtube.com/@rei', message: '' }

  it('展開後の投稿文全体の長さを返す(自由文の 200 字に対する残りではない)', () => {
    expect(composedLength('{name}さん {msg} ありがとう! {url}', values)).toBe(
      'れいさん ありがとう! https://www.youtube.com/@rei'.length,
    )
    expect(composedLength('{name}さん {msg} ありがとう! {url}', { ...values, message: 'どうも' })).toBe(
      'れいさん どうも ありがとう! https://www.youtube.com/@rei'.length,
    )
  })

  it('compose が上限と比べるのと同じ数え方をする(切り詰め前の長さ)', () => {
    const template = '{name}さん {msg} {url}'
    const message = 'あ'.repeat(250)
    const ev: RedirectEvent = { ...event, sourceChannelName: values.name }
    // 残りが負 = 投稿時に削られる、が一致していること
    expect(remainingLength(template, { ...values, message })).toBeLessThan(0)
    expect(compose(template, ev, { message }).length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
  })

  it('収まっているときの残りは正の値', () => {
    expect(remainingLength('{name}さん {msg} {url}', values)).toBe(
      MAX_MESSAGE_LENGTH - 'れいさん https://www.youtube.com/@rei'.length,
    )
  })
})
