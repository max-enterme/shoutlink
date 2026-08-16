import { beforeEach, describe, expect, it } from 'vitest'
import {
  OBSERVE_GRACE_MS,
  extractCommentAuthor,
  isFreshComment,
  judgeFreshness,
  parseClockText,
  startCommentDetector,
} from '../src/comment-detector'
import type { CommentAuthor } from '../src/comment-detector'

const OWNER = 'UCoooooooooooooooooooooo'
const AUTHOR = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const THIRD = 'UCttttttttttttttttttttttt'.slice(0, 24)
/** 合成値。**実配信の動画 ID を持ち込まない**(public repo) */
const VIDEO = 'fakeVideo01'

/**
 * **T1 で実配信から採った `params` の構造をそのまま組み立てる。**
 *
 * ```
 * 0a 1e 0a 1c 0a 1a <メッセージ ID>
 * 1a 29 2a 27 0a 18 <持ち主の UC> 12 0b <動画 ID>
 * 20 02 28 04
 * 32 1a 0a 18 <投稿者の UC>
 * 38 02 48 00 50 01
 * ```
 *
 * **合成 DOM を仕様にしない**ため、ここは観測した並びから外さない
 * (`docs/004-t1-collect.md`)。
 */
function buildParams(
  options: {
    owner?: string
    author?: string
    video?: string
    withVideo?: boolean
    /** 投稿者側にも動画 ID らしきフィールドを付ける(順序頼みを崩す形) */
    authorHasVideo?: boolean
    extra?: string
  } = {},
): string {
  const owner = options.owner ?? OWNER
  const author = options.author ?? AUTHOR
  const video = options.video ?? VIDEO
  const bytes: number[] = []
  const push = (...xs: number[]): void => {
    bytes.push(...xs)
  }
  const str = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0))

  // メッセージ ID
  // 合成値。長さと文字種だけ実物に合わせる(実物の ID は持ち込まない)
  const messageId = 'FAKEmessageIdFAKEmessageId'
  push(0x0a, messageId.length + 4, 0x0a, messageId.length + 2, 0x0a, messageId.length, ...str(messageId))

  // { 持ち主の UC, 動画 ID }
  const pair = [0x0a, owner.length, ...str(owner)]
  if (options.withVideo !== false) pair.push(0x12, video.length, ...str(video))
  push(0x1a, pair.length + 2, 0x2a, pair.length, ...pair)

  push(0x20, 0x02, 0x28, 0x04)

  // { 投稿者の UC }
  const authorGroup = [0x0a, author.length, ...str(author)]
  if (options.authorHasVideo) authorGroup.push(0x12, video.length, ...str(video))
  push(0x32, authorGroup.length, ...authorGroup)

  if (options.extra) {
    const extraGroup = [0x0a, options.extra.length, ...str(options.extra)]
    push(0x3a, extraGroup.length, ...extraGroup)
  }

  push(0x38, 0x02, 0x48, 0x00, 0x50, 0x01)

  const binary = String.fromCharCode(...bytes)
  return btoa(btoa(binary))
}

function clickableAttr(params: string): string {
  return JSON.stringify({
    commandMetadata: { webCommandMetadata: { ignoreNavigation: true } },
    liveChatItemContextMenuEndpoint: { params },
  })
}

/** vitest の環境が jsdom なので、既存テストと同じくグローバルの document を使う */
const doc = (): Document => document

beforeEach(() => {
  document.body.innerHTML = '<div id="items"></div>'
})

type MessageOptions = {
  tag?: string
  params?: string | null
  authorType?: string
  timestamp?: string | null
  rawAttr?: string
}

function makeMessage(options: MessageOptions = {}): Element {
  const el = doc().createElement(options.tag ?? 'yt-live-chat-text-message-renderer')
  if (options.authorType !== undefined) el.setAttribute('author-type', options.authorType)
  const attr =
    options.rawAttr !== undefined
      ? options.rawAttr
      : options.params === null
        ? null
        : clickableAttr(options.params ?? buildParams())
  if (attr !== null) el.setAttribute('whole-message-clickable', attr)
  if (options.timestamp !== null) {
    const ts = doc().createElement('span')
    ts.id = 'timestamp'
    ts.textContent = options.timestamp ?? '5:17 PM'
    el.appendChild(ts)
  }
  return el
}

describe('extractCommentAuthor (AC3 / AC4)', () => {
  it('**視聴者のコメントから投稿者を取り出す**', () => {
    const result = extractCommentAuthor(makeMessage(), { streamId: VIDEO, now: 1_000 })
    expect(result.ok).toBe(true)
    expect(result.ok && result.author).toEqual({
      channelId: AUTHOR,
      ownerChannelId: OWNER,
      // **実測どおりの判定(動画 ID の一致)で当たったこと**を固定する
      ownerMatchedBy: 'video-id',
      authorType: '',
      timestampText: '5:17 PM',
      detectedAt: 1_000,
    })
  })

  it('**配信者自身のコメントはここで捨てる**(持ち主を投稿者として返さない / AC4)', () => {
    const el = makeMessage({ params: buildParams({ author: OWNER }), authorType: 'owner' })
    const result = extractCommentAuthor(el, { streamId: VIDEO })
    expect(result).toEqual({ ok: false, reason: '投稿者が配信の持ち主と同じ' })
  })

  it('**配信 ID が無くても、構造で持ち主を切り分ける**(理由は structure として残る)', () => {
    const result = extractCommentAuthor(makeMessage(), { streamId: '' })
    expect(result.ok && result.author.ownerMatchedBy).toBe('structure')
  })

  it('**両方が「持ち主に見える」なら捨てる**(先に出てきたほうを採らない)', () => {
    // 投稿者側にも動画 ID らしきフィールドが続く形。順序頼みだと投稿者を持ち主と誤判定する
    const el = makeMessage({ params: buildParams({ authorHasVideo: true }) })
    const result = extractCommentAuthor(el, { streamId: '' })
    expect(result).toEqual({ ok: false, reason: '持ち主の候補が複数ある' })
  })

  it('**配信 ID が空でも切り分けられる**(埋め込みチャットで機能が死なない)', () => {
    const result = extractCommentAuthor(makeMessage(), { streamId: '' })
    expect(result.ok && result.author.channelId).toBe(AUTHOR)
  })

  it('**配信 ID が食い違えば切り分けない**(別の配信の DOM を読んでいる可能性)', () => {
    const result = extractCommentAuthor(makeMessage(), { streamId: 'otherVideo1' })
    expect(result).toEqual({ ok: false, reason: '配信の持ち主を切り分けられない' })
  })

  it('**動画 ID とのペアが無ければ捨てる**(持ち主を投稿者として採らない)', () => {
    const el = makeMessage({ params: buildParams({ withVideo: false }) })
    const result = extractCommentAuthor(el, { streamId: VIDEO })
    expect(result).toEqual({ ok: false, reason: '配信の持ち主を切り分けられない' })
  })

  it('**持ち主以外の候補が 2 つ以上なら捨てる**(順序で決めない)', () => {
    const el = makeMessage({ params: buildParams({ extra: THIRD }) })
    const result = extractCommentAuthor(el, { streamId: VIDEO })
    expect(result).toEqual({ ok: false, reason: '投稿者を 1 つに絞れない' })
  })

  it('スパチャ・メンバー加入・システムメッセージは対象外 (AC3)', () => {
    for (const tag of [
      'yt-live-chat-paid-message-renderer',
      'yt-live-chat-membership-item-renderer',
      'yt-live-chat-viewer-engagement-message-renderer',
    ]) {
      const result = extractCommentAuthor(makeMessage({ tag }), { streamId: VIDEO })
      expect(result).toEqual({ ok: false, reason: 'コメントではない' })
    }
  })

  it('属性が無い / 壊れている場合は理由つきで捨てる', () => {
    expect(extractCommentAuthor(makeMessage({ params: null }))).toEqual({
      ok: false,
      reason: '投稿者の属性が無い',
    })
    expect(extractCommentAuthor(makeMessage({ rawAttr: 'JSON ではない' }))).toEqual({
      ok: false,
      reason: '属性が JSON でない',
    })
    expect(extractCommentAuthor(makeMessage({ rawAttr: '{"foo":1}' }))).toEqual({
      ok: false,
      reason: 'params が無い',
    })
  })

  it('デコードできない params は捨てる', () => {
    const el = makeMessage({ rawAttr: clickableAttr('!!!これは base64 ではない!!!') })
    const result = extractCommentAuthor(el)
    expect(result.ok).toBe(false)
  })

  it('チャンネル ID を含まない params は捨てる', () => {
    const el = makeMessage({ rawAttr: clickableAttr(btoa(btoa('no channel id here'))) })
    expect(extractCommentAuthor(el)).toEqual({ ok: false, reason: 'チャンネル ID が無い' })
  })

  it('タイムスタンプの要素が無ければ null で返す(捨てるのは AC9 側の判断)', () => {
    const result = extractCommentAuthor(makeMessage({ timestamp: null }), { streamId: VIDEO })
    expect(result.ok && result.author.timestampText).toBeNull()
  })
})

describe('parseClockText (AC9)', () => {
  it('AM / PM 表記を読む', () => {
    expect(parseClockText('5:17 PM')).toBe(17 * 60 + 17)
    expect(parseClockText('5:17 AM')).toBe(5 * 60 + 17)
    expect(parseClockText('12:00 AM')).toBe(0)
    expect(parseClockText('12:00 PM')).toBe(12 * 60)
    expect(parseClockText(' 3:46 pm ')).toBe(15 * 60 + 46)
  })

  it('24 時間表記も読む', () => {
    expect(parseClockText('17:17')).toBe(17 * 60 + 17)
    expect(parseClockText('0:05')).toBe(5)
  })

  it('**それ以外は読めなかったことにする**', () => {
    // 配信開始からの相対時刻(`0:12`)は 24 時間表記と区別できないが、
    // 実配信では時計表記だった。ここでは「形が違うもの」を落とすことだけ固定する
    for (const text of ['', 'あとで', '25:00', '5:99', '5:17 XM', '5-17', '517']) {
      expect(parseClockText(text)).toBeNull()
    }
  })
})

describe('judgeFreshness (AC9)', () => {
  /** 2026-08-15 17:20 ちょうどに監視を張った、という状況 */
  const startedAt = new Date(2026, 7, 15, 17, 20, 0).getTime()

  it('監視開始より前の分なら before', () => {
    expect(judgeFreshness('5:17 PM', startedAt)).toBe('before')
  })

  it('監視開始より後の分なら after', () => {
    expect(judgeFreshness('5:21 PM', startedAt)).toBe('after')
  })

  it('**同じ分は after になる**(分単位なので秒では切れない / 残る穴)', () => {
    expect(judgeFreshness('5:20 PM', startedAt)).toBe('after')
  })

  it('要素が無ければ missing', () => {
    expect(judgeFreshness(null, startedAt)).toBe('missing')
  })

  it('読めない文字列は unreadable', () => {
    expect(judgeFreshness('あとで', startedAt)).toBe('unreadable')
  })

  it('**12 時間以上離れて見える値は unreadable**(日付をまたぐ配信で取り違えない)', () => {
    const midnight = new Date(2026, 7, 16, 0, 0, 0).getTime()
    // ちょうど 12 時間離れると、前日か当日かを決められない
    expect(judgeFreshness('12:00 PM', midnight)).toBe('unreadable')
    // **直前の 23:59 は「少し前」として読める**(ここを取り違えると古いコメントに反応する)
    expect(judgeFreshness('11:59 PM', midnight)).toBe('before')
    // 12 時間の手前は当日として読む
    expect(judgeFreshness('11:59 AM', midnight)).toBe('after')
  })
})

describe('isFreshComment (AC9)', () => {
  const startedAt = new Date(2026, 7, 15, 17, 20, 0).getTime()
  const author = (over: Partial<CommentAuthor>): Pick<CommentAuthor, 'timestampText' | 'detectedAt'> => ({
    timestampText: '5:21 PM',
    detectedAt: startedAt + OBSERVE_GRACE_MS,
    ...over,
  })

  it('猶予を抜けた新しいコメントには反応する', () => {
    expect(isFreshComment(author({}), startedAt).fresh).toBe(true)
  })

  it('**猶予の中は反応しない**(起動直後の一斉投稿を止める)', () => {
    expect(isFreshComment(author({ detectedAt: startedAt + 1 }), startedAt).fresh).toBe(false)
  })

  it('**監視開始より前のコメントは、猶予を抜けていても反応しない**(再挿入対策)', () => {
    const old = author({ timestampText: '5:17 PM', detectedAt: startedAt + 60_000 })
    expect(isFreshComment(old, startedAt)).toEqual({ fresh: false, freshness: 'before' })
  })

  it('**タイムスタンプの要素が無ければ反応しない**(構造が変わった = 安全側)', () => {
    const broken = author({ timestampText: null, detectedAt: startedAt + 60_000 })
    expect(isFreshComment(broken, startedAt)).toEqual({ fresh: false, freshness: 'missing' })
  })

  it('**読めないだけなら猶予で判定する**(生きているコメントを取りこぼさない)', () => {
    const odd = author({ timestampText: 'あとで', detectedAt: startedAt + 60_000 })
    expect(isFreshComment(odd, startedAt)).toEqual({ fresh: true, freshness: 'unreadable' })
    const inGrace = author({ timestampText: 'あとで', detectedAt: startedAt + 1 })
    expect(isFreshComment(inGrace, startedAt).fresh).toBe(false)
  })
})

describe('startCommentDetector (AC9)', () => {
  /** 2026-08-15 17:20 に監視を張った、という状況 */
  const BASE = new Date(2026, 7, 15, 17, 20, 0).getTime()
  /** 監視開始と同じ分。**猶予を抜けていれば通る** */
  const FRESH_TS = '5:21 PM'

  /** 1 回目(監視開始)は BASE、以降は猶予を抜けた時刻を返す */
  function clock(): () => number {
    let first = true
    return () => {
      if (first) {
        first = false
        return BASE
      }
      return BASE + OBSERVE_GRACE_MS + 1_000
    }
  }

  function detect(onComment: (a: CommentAuthor) => void, now = clock()) {
    return startCommentDetector({ root: doc(), streamId: VIDEO, now, onComment })
  }

  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('**追加されたコメントだけを渡す。既にあるものは走査しない**', async () => {
    const items = doc().getElementById('items') as HTMLElement
    items.appendChild(makeMessage({ timestamp: FRESH_TS })) // 起動前からあるもの

    const got: CommentAuthor[] = []
    const handle = detect((a) => got.push(a))
    expect(got).toEqual([])

    items.appendChild(makeMessage({ timestamp: FRESH_TS }))
    await tick()

    expect(got).toHaveLength(1)
    expect(got[0].channelId).toBe(AUTHOR)
    handle.stop()
  })

  it('**監視開始より前のタイムスタンプは渡さない**(再挿入対策 / AC9)', async () => {
    const items = doc().getElementById('items') as HTMLElement
    const got: CommentAuthor[] = []
    const handle = detect((a) => got.push(a))

    items.appendChild(makeMessage({ timestamp: '5:17 PM' }))
    await tick()

    expect(got).toEqual([])
    handle.stop()
  })

  it('**タイムスタンプの要素が無ければ渡さない**(構造が変わった = 安全側 / AC9)', async () => {
    const items = doc().getElementById('items') as HTMLElement
    const got: CommentAuthor[] = []
    const handle = detect((a) => got.push(a))

    items.appendChild(makeMessage({ timestamp: null }))
    await tick()

    expect(got).toEqual([])
    handle.stop()
  })

  it('**猶予の中は渡さない**(起動直後の一斉投稿を止める / AC9)', async () => {
    const items = doc().getElementById('items') as HTMLElement
    const got: CommentAuthor[] = []
    // 監視開始から 1ms しか経っていない時計
    const handle = detect((a) => got.push(a), () => BASE + 1)

    items.appendChild(makeMessage({ timestamp: FRESH_TS }))
    await tick()

    expect(got).toEqual([])
    handle.stop()
  })

  it('**読めないタイムスタンプは猶予だけで判定する**(生きているコメントを落とさない)', async () => {
    const items = doc().getElementById('items') as HTMLElement
    const got: CommentAuthor[] = []
    const handle = detect((a) => got.push(a))

    items.appendChild(makeMessage({ timestamp: 'あとで' }))
    await tick()

    expect(got).toHaveLength(1)
    handle.stop()
  })

  it('コメント以外の追加ノードは無視する', async () => {
    const items = doc().getElementById('items') as HTMLElement
    const got: CommentAuthor[] = []
    const handle = detect((a) => got.push(a))

    items.appendChild(makeMessage({ tag: 'yt-live-chat-paid-message-renderer' }))
    items.appendChild(doc().createElement('div'))
    await tick()

    expect(got).toEqual([])
    handle.stop()
  })

  it('同じ要素が付け替えられても 2 度は出さない', async () => {
    const items = doc().getElementById('items') as HTMLElement
    const got: CommentAuthor[] = []
    const handle = detect((a) => got.push(a))

    const el = makeMessage({ timestamp: FRESH_TS })
    items.appendChild(el)
    await tick()
    items.removeChild(el)
    items.appendChild(el)
    await tick()

    expect(got).toHaveLength(1)
    handle.stop()
  })

  it('**取れないコメントで例外を投げない**(配信に影響させない / AC12)', async () => {
    const items = doc().getElementById('items') as HTMLElement
    const got: CommentAuthor[] = []
    const handle = detect((a) => got.push(a))

    items.appendChild(makeMessage({ rawAttr: 'JSON ではない' }))
    items.appendChild(makeMessage({ params: null }))
    await tick()

    expect(got).toEqual([])
    handle.stop()
  })

  it('stop() 以降は渡さない', async () => {
    const items = doc().getElementById('items') as HTMLElement
    const got: CommentAuthor[] = []
    const handle = detect((a) => got.push(a))
    handle.stop()

    items.appendChild(makeMessage({ timestamp: FRESH_TS }))
    await tick()

    expect(got).toEqual([])
  })
})
