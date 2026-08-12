---
feature: comment-link
test: npm run typecheck && npx vitest run
---

# 実装計画 — 004 登録した人のコメントに反応してリンクを投稿

> plan.md — 「どう作るか」。spec.md の受け入れ条件を満たす設計。

## アプローチ

**既存のパイプラインを増やさず、引き金だけを 1 本足す。**
`RedirectEvent`(自動検知 / 手動トリガー)と同じく、コメント検知も
**「誰に・どの URL で投稿するか」に落としてから共通の投稿処理へ流す**。
分岐を 2 系統に割らない([main.ts](../../src/main.ts) の `handle` と同じ考え方)。

ただし**リダイレクト返礼とは規則が違う**ので、そこは明確に分ける。

| | リダイレクト返礼 (001) | コメント返し (004) |
|---|---|---|
| 引き金 | 通知ノードの出現 | 辞書で ON にした人のコメント |
| 起動時の既存ノード | **拾う**(初期走査が唯一の経路) | **拾わない** (AC9) |
| 固定 | `pinMode` に従う | **しない** (AC6) |
| 文面 | `template` | `commentTemplate` (AC5) |
| 表示名 | 検知した表示名を使う | **辞書側の値だけ**を使う (AC5) |
| 抑止 | 同一配信・クールダウン | 同一配信 1 回 + 種別の非対称 (AC7 / AC8) |

### 1. 検知 — `src/comment-detector.ts`(新規)

- **抽出は純関数** `extractCommentAuthor(el): CommentAuthor | null` として切り出す
  ([detector.ts](../../src/detector.ts) の `extractRedirectEvent` と同じ作り)。テスト対象はここ
- **MutationObserver は追加ノードだけを見る。`scanExisting` を持たない** (AC9)
- **対象の判定に `SELECTORS.chatTextMessage` を流用しない。**この定数は
  `yt-live-chat-paid-message-renderer`(スパチャ)と `yt-live-chat-membership-item-renderer`
  (メンバー加入)を含み、**除外用に使われている**定数でもある。
  コメント経路には**通常のテキストメッセージだけ**の定数を別に持つ (AC3)
- **タイムスタンプで新旧を切る** (AC9)。要素からタイムスタンプが取れるかは T1 の採取項目。
  取れない場合は「監視開始から N 秒は投稿しない」猶予に落とす

```ts
export type CommentAuthor = {
  /** 正規化済みチャンネル URL。取れなければ null → 何もしない (AC4) */
  channelUrl: string | null
  /** 表示名。**投稿文には使わない**(照合の説明とログのため / AC5) */
  displayName: string
  /** メッセージのタイムスタンプ。取れなければ null (AC9) */
  postedAt: number | null
  detectedAt: number
}
```

### 2. 照合 — 辞書のフラグ

```ts
export type DirectoryEntry = {
  url: string
  nickname: string
  lastSeenAt: number
  /** コメントに反応するか。**既定 false**(自動登録でも false) */
  replyToComment: boolean
}
```

- 照合は `findEntry(directory, author.channelUrl)` の結果が
  `replyToComment === true` のときだけ通す。**`channelUrl` が null なら即座に捨てる** (AC4)
- `findEntry` は**正規化済み URL の文字列比較**なので、`@handle` と `/channel/UC…` は一致しない。
  **T1 でコメント側の形を確認し、辞書と揃わないなら spec.md D1 (c) の判断へ返す**
- 辞書にフラグを書き換える口が無い(`upsertNickname` だけ)ので、
  `setReplyToComment(directory, url, value)` を同じ形の純関数として足す

### 3. 文面 — `composer.ts` の汎用化

`compose(template, event: RedirectEvent)` は `{name}` `{url}` しか見ていないので、
**`{ name, url }` を受ける形へ広げ**、既存の呼び出しは薄いラッパで維持する
(既存の出力が 1 文字も変わらないことをテストで固定 / AC15)。
渡す値は**辞書の呼び名と辞書の URL**だけで、コメント側の表示名は入れない (AC5)。

> 003 が `{msg}` と削り順(自由文 → 表示名 → 末尾)を入れる。**先に載ったほうに合わせる**
> (下の「依存 / 前提」)。コメント用テンプレートで `{msg}` を使うかは spec.md D4。

### 4. 抑止 — `post-log.ts` に種別を足し、`dedupe.ts` の入力を絞る

```ts
export type PostRecord = {
  …
  /** 投稿の種別。**欠損は 'redirect' / 壊れた値は 'comment'**(AC14) */
  kind: 'redirect' | 'comment'
}
```

- 記録の鍵を `${streamId} ${kind} ${url}` にする。
  **既存レコードは `kind='redirect'` に落ちるので、リダイレクト側の鍵は実質変わらない**
  (既存の抑止を壊さないための条件。回帰テストで固定する)
- 判定は**非対称** (AC8):
  - コメント返し → `redirect` / `comment` **どちらの記録があっても投稿しない**
  - リダイレクト返礼 → `redirect` の記録だけを見る(コメント返し済みでも投稿する)
- **`main.ts` が `createDedupe(…, { history: postLog })` に投稿履歴を全件渡している。**
  ここを絞らないと、**コメント返しの記録がリダイレクト側のクールダウンを起動時から埋め**、
  AC8 の後半が壊れる。`PriorPost` に `kind` を足し、**`comment` を `absorb` しない**
- **`streamId` が空のときの規則** (AC7): `findPostInStream` は `streamId` が空だと
  必ず `undefined` を返すため、そのままだとコメント側の抑止が丸ごと外れる。
  **保存済み履歴に対してだけ 6 時間の下限**(`UNKNOWN_STREAM_MIN_COOLDOWN_SEC`)を適用する
  — リダイレクト側が同じ穴を埋めているのと同じ扱いにする
- **`cooldownSec` は見ない。**コメント返しは「同一配信で 1 回」だけで判定する
  (`cooldownSec = 0` を抑止の逃げ道として使う運用を、コメント側に持ち込まない)
- **保存件数の食い合いに注意** (`POST_LOG_MAX_ENTRIES = 200`)。1 配信・1 人につき
  `redirect` と `comment` で最大 2 レコードになり、**古い `redirect` が押し出されると
  001 の「リロードで再投稿しない」が戻る。** `prunePostLog` を**種別ごとの枠**にするか、
  上限を引き上げる。どちらでもよいが、**回帰テストで「コメント記録が上限を超えても、
  今の配信の `redirect` 記録が残る」ことを固定する**

### 5. 連投の抑制 — `src/post-queue.ts`(新規)

該当者が同時に複数現れたときのために、**逐次処理 + 最低間隔**の小さなキューを作る (AC11)。

- 最低 5 秒間隔 / **1 配信あたり 20 件の上限**(超過分は投稿せずログ)
- **`commentReplyEnabled` が OFF になったら未処理を捨てる**
- `now` を注入できる純粋なロジックにして単体テストする(実時間で待つテストにしない)

### 6. 自己ループの遮断

コメント返しの投稿は**それ自体がチャットコメント**で、検知対象と同じ種類のノードになる。
**歯止めは 3 枚** (AC10):

1. `postMessage` が返した**自分のメッセージ要素**を記録し、その要素は検知の対象外にする
   — ただし [poster.ts](../../src/poster.ts) は要素の特定に失敗しうるので**単独では信用しない**
2. **投稿本文と一致するコメントには反応しない**(1 が外れたときの受け皿)
3. **配信者自身のチャンネル URL を対象外にする** — 辞書には自分が載りうる
   (`rememberSource` は投稿の可否に関わらず載せる)。**判別手段は T1 の採取項目**で、
   採れなかった場合は spec.md **D2** の判断へ返す

> **既存の `self-echo.ts` はここに数えない。**あれが覚えるのは*投稿した相手*の URL で、
> コメント経路で照合するのは*コメントの投稿者*。**自分の投稿を弾く役には立たない**
> (効くのは「返礼直後に同じ相手が書き込んだ場合の二重返し抑止」で、それは AC7 が既に止める)。

## 主要コンポーネント / 変更点

| 層 | 変更 |
|---|---|
| `src/comment-detector.ts` | **新規。**コメント要素 → `CommentAuthor` の抽出(純関数)と observer |
| `src/post-queue.ts` | **新規。**逐次処理 + 最低間隔 + 上限 + 破棄 (AC11) |
| `src/selectors.ts` | コメント専用の要素定数と、投稿者 / タイムスタンプ / 自分の判別のアクセサ。**T1 の採取結果だけを入れる**(推測は入れない) |
| `src/types.ts` | `Config` に `commentReplyEnabled` / `commentTemplate`。`CommentAuthor` |
| `src/config.ts` | 既定値(**`commentReplyEnabled: false`**)と正規化 (AC1 / AC14) |
| `src/directory.ts` | `DirectoryEntry.replyToComment`(既定 false)、`setReplyToComment`、`normalizeDirectory` / `rememberSource` / `upsertNickname` の追従 |
| `src/composer.ts` | `{ name, url }` を受ける形へ広げる(既存の出力は不変 / AC15) |
| `src/post-log.ts` | `PostRecord.kind`。鍵・検索・`prune` を種別込みに。**欠損は `redirect` / 壊れた値は `comment`** |
| `src/dedupe.ts` | `PriorPost.kind`。**`absorb` で `comment` を取り込まない** (AC8) |
| `src/main.ts` | コメント経路の配線。投稿は共通処理へ。起動ログに `commentReplyEnabled` と ON 件数を載せる |
| `public/options.html` / `src/options/options.ts` | 有効化スイッチ / コメント用テンプレート + プレビュー / 辞書テーブルのフラグ列 / 不整合の常時表示 / 投稿履歴の種別列 (AC13) |
| `scripts/make-site-assets.mjs` | 撮影版下の見本データにフラグを足す(列が空の絵にしないため) |
| `tests/comment-detector.test.ts` ほか | 新規 + 既存の回帰(001 の挙動が変わらないこと) |
| `README.md` / `docs/install.md` / `docs/index.html` / `docs/for-testers.md` / `docs/privacy-policy.md` / `docs/setup-and-verify.md` | 引き金が増えたこと・既定 OFF・保存項目の追加 |

## 依存 / 前提

- **T1(実 DOM の採取)が全体の前提。** `selectors.ts` に入れてよいのは採取できた形だけで、
  推測は入れない(2026-08-06 の事故 2 件目と同じ轍を踏まない)。
  T2〜T6 は DOM に触らないので**先に進めてよい**が、**T7 は T1 の後**にしか書けない
  (先に書くと合成 DOM を仕様として固めることになる)。
- **003(送信元ごとの自由文)は spec が main にマージ済みで、実装はこれから。** 触る面が重なる:
  - `directory.ts` — 003 T2 が `message`、004 T3 が `replyToComment` を足す
  - `composer.ts` — 003 T3 が `{msg}` と削り順、004 T4 が `{ name, url }` 化
  - `public/options.html` — 辞書テーブルに 003 が自由文列、004 がフラグ列
  - **辞書の保存先** — 003 T1 が `sync` → `local`。**004 は保存先に触らない。**
    004 が先に入ると、辞書に真偽値が 1 つ増えた状態で `sync` の 8KB 上限に近づく期間ができる
    (件数上限の実装はしない / security-review S7)
  **どちらを先に main へ載せるかは実装順の判断**で、後から載るほうがコンフリクトを引き取る。
- **002(i18n)が先に載る場合**、004 が足す UI 文言はすべて `_locales/` へのキー追加になる(T9 / T10)。

## テスト戦略

`test: npm run typecheck && npx vitest run`(既存の宣言と同じ)。**jsdom で書けるものだけを書く。**

- 純関数(照合・種別つき抑止・文面・キュー・正規化)は単体テスト
- **回帰として固定するもの:**
  - `commentReplyEnabled` が OFF のとき、既存の投稿・固定・ログが 1 つも変わらない (AC15)
  - 既存の投稿履歴(`kind` を持たない)が `redirect` として読まれ、001 の抑止が変わらない
  - **コメント返しの記録が `dedupe` に取り込まれない**(リダイレクト返礼が抑止されない / AC8)
  - **コメント記録が `POST_LOG_MAX_ENTRIES` を押し上げても、今の配信の `redirect` 記録が残る**
  - `streamId` が空でもコメント返しが 2 度出ない (AC7)
  - 表示名だけが一致して URL が取れない / 正規形が違うコメントで**投稿しない** (AC4)
  - スパチャ・メンバー加入・削除済みプレースホルダで**投稿しない** (AC3)
  - 自分が投稿したメッセージを引き金に再投稿しない (AC10)
- **合成 DOM を「仕様」にしない。**コメント要素の fixture は T1 で採った構造に合わせて作る。
  T1 の前に書いた fixture をそのまま残さない
  ([security-review.md](../../docs/security-review.md) の指摘と同じ)。

## リスク / 降りる箇所

- **R1(高): 投稿者の特定手段と鍵の形が未確認。** spec.md D1。
  T1 の結果で照合方式が変わり、取れなければ feature ごと畳む選択肢もある。
  **エージェントは表示名照合へ勝手に降りない。**

- **R2(高): 自己ループの距離が近い。** spec.md D2。
  歯止め 3 枚(上記 6)のうち**1 枚でも欠けた状態で実配信に出さない。**
  特に 3 枚目(自分のチャンネルの除外)は T1 の採取に依存しており、
  **採れなかった場合に「本文一致 1 枚で出す」かどうかは人間が決める。**

- **R3(中): 起動時・再構築時の一斉投稿。**
  コメントはチャットに残り続ける。`scanExisting` を作らなくても、**項目リストが再構築される経路**
  (ポップアウトの開き直し・フィルタ切替・仮想スクロール)では既存コメントが追加ノードとして流れ、
  **その配信で初回の該当者が複数いれば一斉に出る。**
  AC9 のタイムスタンプ / 猶予を 1 枚目の歯止めにする。投稿履歴 (AC7) は 2 枚目であって 1 枚目にしない。

- **R4(中): 抑止の鍵を変えることが 001 の回帰になる。**
  `post-log` の鍵に種別を混ぜる変更は、**既存の保存内容の読み方を変える。**
  欠損を `'redirect'` に倒すこと・`dedupe` の入力を絞ること・件数の食い合いの 3 点を、
  既存テストが素通りしない形で確認する。

- **R5(中): 頻度が上がることの規約上の判断。** spec.md D3。
  実装で下げられるのは頻度だけで、判断そのものは人間が行う。

- **R6(中): 投稿のたびにチャット入力欄を上書きする。**
  [poster.ts](../../src/poster.ts) の `setInputValue` は入力欄の中身を丸ごと置き換えて送信する。
  リダイレクト経路は 1 配信に数回だが、コメント経路は該当者数ぶん走るので
  **配信者が手で打ちかけている文字を消す確率が上がる。**
  実装で完全には避けられない(入力欄は 1 つしかない)ので、**T12 の確認項目に入れる。**

- **R7(低): 最小化・非前面での `MutationObserver` の発火が未確認**
  ([t1-findings.md](../../docs/t1-findings.md) ❓F)。コメント経路はこれを直接受ける。T12 で見る。

- **R8(低): 設定の増加で options 画面が混む。**
  「有効にする」(自動検知)と「コメントに反応する」の 2 つのスイッチができる。
  どちらが何を止めるかを画面上で明示しないと、切ったつもりで動く/動かないが起きる。
