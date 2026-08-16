/**
 * コメント返しを出すかどうかの判断 (004 / AC4 / AC5 / AC7 / AC8 / AC10 / AC16)。
 *
 * **DOM にも保存にも触らない純関数**にしてある。ここは plan.md R2(降りる箇所)—
 * 自己ループの歯止めと抑止 — が集まる場所で、[main.ts](./main.ts) の中に置くと
 * **単体テストが書けない。**この repo は「歯止めが効いているか」を実配信でしか確かめられない
 * 状態を繰り返し作ってきたので、判断だけを切り出してテストで固定する。
 *
 * 決めるのは「投稿するか / しないなら何故か」まで。**実際に投稿するのは呼び出し側。**
 */
import { composeText } from './composer'
import { findEntryByChannelId, resolveCommentDisplayName, resolveCommentMessage } from './directory'
import type { Directory, DirectoryEntry } from './directory'
import { findCommentReplyBlocker } from './post-log'
import type { PostLog, PostRecord } from './post-log'
import type { CommentAuthor } from './comment-detector'

/** 出さない理由。**そのまま診断ログに出す**(無言で捨てない) */
export type CommentReplySkip =
  /** スイッチが OFF (AC1)。**キューに積んだ後に切られた場合もここで止まる** */
  | { reason: 'コメント返しが無効' }
  /** 自分が投稿した本文と一致する (AC10 の 2 枚目) */
  | { reason: '自分の投稿と本文が一致' }
  /** 配信者自身のコメント (AC10 の 3 枚目) */
  | { reason: '配信者自身のコメント' }
  /** 辞書に該当が無い。**未解決 (`channelId` が空) の行も引っかからない** (AC4 / AC17) */
  | { reason: '辞書に該当が無い' }
  /** 該当はあるがフラグが OFF (AC2) */
  | { reason: 'コメントに反応しない設定' }
  /** 同じ配信で投稿済み (AC7 / AC8)。種別を問わない */
  | { reason: 'この配信では投稿済み'; blocker: PostRecord }

export type CommentReplyDecision =
  | { action: 'post'; entry: DirectoryEntry; text: string }
  | ({ action: 'skip' } & CommentReplySkip)

export type DecideParams = {
  author: CommentAuthor
  /** コメントの本文。**照合には使わない** — 自分の投稿と一致するかを見るだけ (AC10) */
  messageText: string
  directory: Directory
  postLog: PostLog
  /** コメント返しのテンプレート (AC5) */
  commentTemplate: string
  streamId: string
  now: number
  /** 自分が投稿した本文 (AC10 の 2 枚目) */
  ownTexts: ReadonlySet<string>
  /**
   * コメント返しが有効か (AC1)。
   *
   * ⚠️ **投稿の直前にも見る。**キューに積んだ後にスイッチを切られた 1 件は、
   *    `post-queue` の破棄が**待ちの明けにしか効かない**(投稿中の 1 件は止まらない)ので、
   *    ここでも止める。
   */
  enabled: boolean
}

/** 自分の投稿の本文と一致する / それを含むか (AC10 の 2 枚目) */
function containsOwnText(ownTexts: ReadonlySet<string>, messageText: string): boolean {
  if (ownTexts.has(messageText)) return true
  if (!messageText) return false
  for (const own of ownTexts) {
    if (own && messageText.includes(own)) return true
  }
  return false
}

/**
 * コメント 1 件に対して、返すかどうかを決める。
 *
 * **順番に意味がある** — 自己ループの遮断を先に置き、辞書の照合より前で切る。
 * 逆にすると、自分の投稿が辞書に載っている相手を指していたときに 1 段深く進む。
 */
export function decideCommentReply(params: DecideParams): CommentReplyDecision {
  const { author } = params

  // AC1: OFF の間は何もしない。**積んだ後に切られた場合もここで止まる**
  if (!params.enabled) return { action: 'skip', reason: 'コメント返しが無効' }

  // AC10 の 2 枚目: 投稿本文と一致するコメント(1 枚目=要素の記憶が外れたときの受け皿)。
  //
  // ⚠️ **完全一致だけにしない。**`getMessageText` は `#message` が取れないと
  //    要素全体のテキスト(タイムスタンプ・表示名込み)に落ちるので、完全一致だと
  //    **その状態で 2 枚目が黙って常に外れる**(fail-open)。**含んでいれば自分の投稿とみなす。**
  //    代償として、視聴者が自分の投稿を引用したコメントにも反応しなくなるが、それは安全側。
  if (containsOwnText(params.ownTexts, params.messageText)) {
    return { action: 'skip', reason: '自分の投稿と本文が一致' }
  }

  // AC10 の 3 枚目: 配信者自身のコメント。**2 通りとも見る** —
  // `author-type` は DOM 属性、持ち主の ID は `params` のデコード結果で、出所が独立している
  if (author.authorType === 'owner' || author.channelId === author.ownerChannelId) {
    return { action: 'skip', reason: '配信者自身のコメント' }
  }

  // AC4: 照合は `channelId`。**辞書の鍵は `@handle` 形なので URL では一致しない**
  const entry = findEntryByChannelId(params.directory, author.channelId)
  if (!entry) return { action: 'skip', reason: '辞書に該当が無い' }
  if (!entry.replyToComment) return { action: 'skip', reason: 'コメントに反応しない設定' }

  // AC7 / AC8: 同じ配信でその人へ**どちらの種別でも**投稿済みなら出さない(非対称の前半)
  const blocker = findCommentReplyBlocker(params.postLog, {
    streamId: params.streamId,
    url: entry.url,
    now: params.now,
  })
  if (blocker) return { action: 'skip', reason: 'この配信では投稿済み', blocker }

  // AC5 / AC16: 文面は**辞書の値だけ**で作る。コメント側の表示名は使わない
  const text = composeText(
    params.commentTemplate,
    {
      name: resolveCommentDisplayName(params.directory, entry.url),
      url: entry.url,
    },
    { message: resolveCommentMessage(params.directory, entry.url) },
  )
  return { action: 'post', entry, text }
}
