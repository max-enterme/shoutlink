---
feature: reply-guard-and-test-send
test: npm run typecheck && npx vitest run
---

# 実装計画 — 006 返礼の抑止を配信単位に統一し、テスト送信の導線を作る

> plan.md — 「どう作るか」。spec.md の受け入れ条件を満たす設計。

## アプローチ

**抑止の正本を「保存された投稿履歴」1 本にする。**そのうえで、履歴を消費しない試し撃ちの経路を別に生やす。

現状は抑止の記録が **2 か所**にある — 保存された `postLog` と、[dedupe.ts](../../src/dedupe.ts) が
メモリに持つ `lastFiredAt`。後者があるせいで「履歴を消しても効かない」(AC14)が起きているし、
判定の規則も 2 つに割れている(秒数クールダウン / 同一配信 1 回)。
**`dedupe.ts` を畳んで [post-log.ts](../../src/post-log.ts) に寄せると、この 2 つが同時に消える。**
`postLog` を差し替えれば抑止が解ける、という状態になるので、AC14 は購読を 1 本足すだけで済む。

3 本の柱:

1. **抑止の判定を `post-log.ts` の 1 関数に一般化する。** `findCommentReplyBlocker` は既に
   「秒数を見ない / 同一配信 1 回 / 配信 ID が空なら 6 時間の窓」という欲しい形をしている。
   **違うのは「どの種別の記録を抑止に数えるか」だけ**(004 / AC8 の非対称)。そこを引数にする。
2. **`dedupe.ts` を廃止する。** メモリ側の抑止が消え、`cooldownSec` の居場所も無くなる。
3. **テスト送信は `main.ts` の `handle()` を通さない別経路にする。** `handle()` を通すと
   固定もするし履歴にも残る(AC8 / AC12 に反する)。**ただし `main.ts` に直書きしない** —
   [comment-runner.ts](../../src/comment-runner.ts) の冒頭が書いているとおり、`main.ts` は
   `chrome` と実 DOM が無いと動かず、**歯止めが配線されているかを自動で確かめられない。**
   依存を注入で受ける `createTestSendHandler` を `test-send.ts` に置き、`main.ts` は生成と配線だけを持つ。

## 変更点

| 対象(ファイル / 関数) | 変更 |
|---|---|
| `src/post-log.ts` `findCommentReplyBlocker`(:222) | `findReplyBlocker(log, { streamId, url, now, blockedBy })` へ一般化。`blockedBy: readonly PostKind[]` が「抑止に数える種別」 |
| `src/post-log.ts`(新規) | `findRedirectReplyBlocker` = `blockedBy: ['redirect']` / `findCommentReplyBlocker` = `blockedBy: ['redirect','comment']` の薄いラッパ 2 本。**既存の呼び出し(`comment-reply.ts:103`)とテストはそのまま通る** |
| `src/post-log.ts`(新規) `onPostLogChanged` | `directory.ts:454` の `onDirectoryChanged` と**同型**。`STORAGE_KEY`(`post-log.ts:57`)を見て `normalizePostLog` を通して渡す。`getLocalStorageAreaName()` でエリアを絞る |
| `src/post-log.ts` `UNKNOWN_STREAM_MIN_COOLDOWN_SEC` | `dedupe.ts:28` から**移設し、`UNKNOWN_STREAM_WINDOW_SEC` に改名**(値 `6*60*60` は据え置き)。「クールダウン」の語を残さない(AC5) |
| `src/post-log.ts:214-221` の docstring | 「`cooldownSec` を見ない」の説明を書き直す。**`cooldownSec` はもう存在しない**(AC17) |
| `src/post-log.ts` `redirectHistory`(:271) | **削除**。`createDedupe` に渡す用途しか無い。⚠ **`tests/post-log.test.ts:14`(import)と `:263-267`(`describe('redirectHistory (AC8)')`)も一緒に消す** — 残すと `vitest run` がそのまま赤くなる |
| `src/dedupe.ts` | **ファイルごと削除。** `createDedupe` / `Dedupe` / `DedupeOptions` / `PriorPost` / `sourceKey` |
| `src/post-log.ts:7` / `:66` | コメント中の `dedupe` 言及を直す(`:19` の import も消える) |
| `src/self-echo.ts:29` | 「(dedupe と同じ考え方)」を `post-log.ts` の `postLogKey` を指す形に直す |
| `src/self-echo.ts:1-18`(冒頭コメント) | ⚠ **書き直す。**「dedupe も同じ送信元を鍵にしているので通常はそこで止まるが、`cooldownSec = 0` にすると外れる」が丸ごと嘘になる。**dedupe 廃止後、`selfEcho` は「投稿してから履歴に載るまでの窓」を埋める唯一のメモリ側の歯止め**になる。存在理由をその形に書き換える(AC17) |
| `src/self-echo.ts`(新規) `reset()` | `SelfEchoGuard` に追加。AC14 で履歴クリア時に呼ぶ |
| `src/in-flight.ts`(新規) | `createInFlightGuard()`。`self-echo.ts` と同型の小さなモジュール(下記「新規インターフェース」) |
| `src/test-send.ts`(新規) | メッセージの型 / `parseTestSendRequest` / `buildTestSendText` / **`createTestSendHandler`**(すべて依存を注入で受ける。chrome も DOM も要らずにテストできる) |
| `src/options/test-send.ts`(新規) | `testSendAvailability` / `testSendResultMessage`(いずれも純関数)。**`options.ts` には配線だけを置く** |
| `src/main.ts:11, :69, :109` | `createDedupe` の import・生成・`setCooldownSec` を削除 |
| `src/main.ts:143`(`dedupe.tryAcquire`) | `findRedirectReplyBlocker` + `inFlight.begin()` に置き換え。⚠ **`event.origin === 'manual'` が素通しするのは `findRedirectReplyBlocker` だけ。`inFlight` は手動でも見る**(AC6) — 素通しさせると `begin` していないのに `finally` の `end` が走り、**他の経路が持っている枠を解放して `isBusy()` が嘘になる** |
| `src/main.ts:173-186` | `postMessage` の呼び出しを `inFlight` の `try` / `finally` で挟む。**失敗しても `end` する**(AC1: 数えるのは投稿できた回だけ) |
| `src/main.ts:103` 付近 | `onPostLogChanged((next) => { postLog = next; selfEcho.reset() })` を追加(AC14) |
| `src/main.ts:107`(`onConfigChanged`) | `dedupe.setCooldownSec(next.cooldownSec)` を削除 |
| `src/main.ts:287` | 起動ログの `cooldownSec` を削除 |
| `src/main.ts`(新規) | `createTestSendHandler(...)` を生成し、`chrome.runtime.onMessage` に繋ぐだけの配線 |
| `src/options/options.ts` `renderDirectory`(:421-742) | 展開時の `detailRow`(:565-609 のブロックの並び)にテスト送信の 2 ボタン + 結果表示を足す |
| `src/options/options.ts` `captureRowDrafts`(:210) | ⚠ **行ごとの新しい状態(`testSendStates`)を掃除に足す。**:231 の `if (!saved)` ブロック(:232-235 の `delete` の並び)に 1 行 |
| `src/options/options.ts:73, :849, :882` | `cooldownSec` の要素参照・読み込み・保存を削除 |
| `src/options/options.ts:819`(`clearPostLogButton`) | 変更なし。`onPostLogChanged` 側で届く |
| `src/types.ts:25` | `Config.cooldownSec` を削除 |
| `src/config.ts:20, :47-50` | `DEFAULT_CONFIG.cooldownSec` と `normalizeConfig` のクランプを削除(**保存済みの値は返り値に含まれず読み捨てになる** / AC5) |
| `src/directory.ts:4` / `src/detector.ts:301` / `src/comment-detector.ts:411` | コメント中の `dedupe` への言及が宙に浮く。参照先を `post-log.ts` に直す(AC17) |
| `public/options.html:168-180` | クールダウン fieldset を削除 |
| `public/options.html:184-188` | 投稿履歴のヒント文を確定値の「案 1」に差し替え |
| `public/manifest.json` | **変更しない**(下記) |
| `CHANGELOG.md` | **過去のエントリは書き換えない**(当時の事実)。**今回ぶんの新しいエントリを足すだけ** |
| `tests/dedupe.test.ts` | **削除。**ケースは `tests/post-log.test.ts` の `findRedirectReplyBlocker` 節へ移す |
| `tests/config.test.ts:39-61, :84-88, :123-128` | `cooldownSec` の期待値を削除 |
| `tests/in-flight.test.ts` / `tests/test-send.test.ts` / `tests/docs.test.ts`(新規) | 下記「テスト」 |

### manifest を変更しない根拠

`chrome.tabs.query({ url })` は **`tabs` 権限が無くても、`host_permissions` が対象 URL を覆っていれば
タブの `url` が読める。**`public/manifest.json:14` に `https://studio.youtube.com/*` があるので条件を満たす。
[tests/manifest.test.ts:67](../../tests/manifest.test.ts) が host 権限を 2 つに、`:74` が `permissions` を
`['storage']` に固定し、`:78` が `optional_permissions` / `optional_host_permissions` の宣言を禁じている。
**この 3 本を緑のまま通すこと**(= `manifest.json` を触らない)。

### 宛先タブの決め方

⚠ **`content_scripts.matches` は `live_chat*` だけ**(`manifest.json:17`)なのに対し、**管制室の埋め込み
チャットはタブの URL が `studio.youtube.com/video/<id>/livestreaming`** で、チャットは `all_frames: true`
で入った iframe 側にいる。**`tabs.query` に `live_chat*` だけを渡すと管制室のタブが見つからない。**

決め方:

1. `chrome.tabs.query({ url: 'https://studio.youtube.com/*' })` で候補を集める
2. **`lastAccessed` の降順で先頭に並べ替える**(`src/options/test-send.ts` の `orderStudioTabsForTestSend`)。
   `lastAccessed` が無いタブは最後へ回し、同値・未定義どうしは元の並び順を保つ(安定ソート)。
   Studio のタブを複数開いていると、並び順まかせでは**別の配信へテスト投稿が出る**。
   ⚠ **`active: true` は当てにしない** — `manifest.json` は `options_ui.open_in_tab: true` なので、
   ボタンを押した時点で「最後にフォーカスされたウィンドウのアクティブなタブ」は設定画面そのものであり、
   Studio タブがこの条件を満たすことはほぼ無い(並べ替えが一度も効かない)。
3. 先頭から `sendMessage` し、**最初に応答したところで打ち切る。**打ち切りを忘れると複数タブへ二重投稿する。
   コンテントスクリプトが入っていないタブは接続エラーで即座に落ちる(投稿の副作用は起きない)
4. どれも応答しなければ `no-tab`

⚠ **同一タブ内の複数フレームは、この手順では防げない。** `frameId` を指定しない `sendMessage` は
一致する全フレームでリスナーを走らせ、options が受け取る応答が 1 つに絞られるだけ。
**歯止めは受け側に置く** — `getChatInput()` が入力欄を見つけられないフレームは**投稿せずに** `no-input` を返す。
現実には 1 タブに `live_chat*` へ一致するフレームは 1 つのはずだが、**実機で数えるまでは仮定**
(→「リスク / 降りる箇所」)。

**どの配信へ出したかを応答に載せる**(`posted.streamId`)。上の 2 で並べ替えても宛先は完全には固定できないので、
**結果表示で人が確認できるようにする**(AC9)。

## 新規インターフェース

### `src/test-send.ts`

```ts
export const TEST_SEND_TYPE = 'shoutlink.testSend'
export type TestSendKind = 'redirect' | 'comment'

/** options → コンテントスクリプト。**文面は送らない** — 保存済みの辞書と設定で受け側が組む */
export type TestSendRequest = { type: typeof TEST_SEND_TYPE; kind: TestSendKind; url: string }

export type TestSendFailReason =
  /** チャット側の辞書にその URL が無い(行を足したがまだ保存されていない) */
  | 'no-entry'
  /** チャットの入力欄が見つからない(`poster.ts` の `PostOutcome` から) */
  | 'no-input'
  /** `kind: 'comment'` で `entry.channelId` が空。**返礼文側では起きない** */
  | 'unresolved-channel-id'
  /** 他の投稿が走っている (AC13) */
  | 'busy'

export type TestSendResponse =
  | { status: 'posted'; text: string; streamId: string }
  | { status: 'failed'; reason: TestSendFailReason }

/** 壊れた / 未知のメッセージを弾く (AC16)。返り値が null なら**黙って無視する** */
export function parseTestSendRequest(raw: unknown): TestSendRequest | null

/** 保存済みの辞書 + テンプレートから文面を組む。`composer.ts` の再利用だけ */
export function buildTestSendText(params: {
  kind: TestSendKind
  directory: Directory
  url: string
  template: string        // kind に応じて config.template / config.commentTemplate
}): { status: 'ok'; text: string } | { status: 'failed'; reason: 'no-entry' | 'unresolved-channel-id' }

/**
 * テスト送信の本体。**依存はすべて注入で受ける** — chrome も実 DOM も要らずにテストできる。
 * `comment-runner.ts` の `createCommentRunner` と同じ作り。
 */
export type TestSendDeps = {
  getDirectory: () => Directory
  /** kind に応じたテンプレートを返す(`config.template` / `config.commentTemplate`) */
  getTemplate: (kind: TestSendKind) => string
  streamId: string
  /** 投稿だけを行う。**固定はしない** (AC12) */
  post: (text: string) => Promise<CommentPostOutcome>
  /** 004 / AC10 の 1・2 枚目。`commentRunner.rememberOwnPost` をそのまま渡す */
  rememberOwnPost: (text: string, element: Element | null) => void
  /** 他の投稿が走っているか (AC13)。`inFlight.isBusy` を渡す */
  isBusy: () => boolean
  onLog?: (message: string, detail?: unknown) => void
}
export function createTestSendHandler(deps: TestSendDeps): (raw: unknown) => Promise<TestSendResponse | null>
```

- **`null` を返したら黙って無視する**(未知のメッセージ / AC16)。`onMessage` 側は `sendResponse` を呼ばない。
- ⚠ **`rememberOwnPost(text, null)` を投稿の前に、`rememberOwnPost(text, element)` を投稿の後に呼ぶ**
  (AC11)。`comment-runner.ts:105-117` と同じ順序で、理由も同じ —
  `MutationObserver` は自分の投稿をマイクロタスクで配送するのに対し `postMessage` の要素確認は
  マクロタスクなので、**後だと間に合わない。**
- ⚠ **`postLog` に触る依存を渡さない。**渡す口が無いこと自体が AC8 の担保になる。
- **文面をリクエストに載せない。**載せると options 側の未保存の下書きで送れてしまい、
  「保存した設定でどう出るか」を確かめるという目的から外れる。受け側は `onDirectoryChanged` /
  `onConfigChanged` で常に最新の**保存済み**の値を持っている。
- `kind: 'redirect'` は `resolveDisplayName` / `resolveMessage`、`kind: 'comment'` は
  `resolveCommentDisplayName` / `resolveCommentMessage`(いずれも `directory.ts`)で解決する。

### `src/options/test-send.ts`(純関数)

```ts
/** ボタンを押せるか (確定値 B4)。押せない理由は `title` に出す */
export function testSendAvailability(entry: DirectoryEntry): {
  redirect: { enabled: true }
  comment: { enabled: true } | { enabled: false; reason: 'チャンネル ID が未解決です' }
}

/** 行に返す文言 (AC9 の 6 通り)。`'no-tab'` は options 側だけで起きる */
export function testSendResultMessage(
  result: TestSendResponse | { status: 'failed'; reason: 'no-tab' },
): string
```

### `src/in-flight.ts`

```ts
export type InFlightGuard = {
  /** 投稿を始める。**同じ URL が処理中なら false**(始めてはいけない) */
  begin(url: string): boolean
  /** **必ず `finally` で呼ぶ。**投稿に失敗しても呼ぶ (AC1) */
  end(url: string): void
  /** 何かの投稿が走っているか (AC13)。テスト送信はこれが true なら `busy` を返す */
  isBusy(): boolean
}
export function createInFlightGuard(): InFlightGuard
```

⚠ **これが無いと二重投稿が戻る。**現状は `dedupe.tryAcquire` が「投稿の前に同期的に枠を予約する」
ので、同じ相手の通知が 1 tick に 2 件来ても 2 件目が弾かれる。`postLog` は
**投稿できたときだけ**(`main.ts:184`)記録するので、置き換えただけだと 1 件目の `await` 中に
2 件目が素通りする。コメント側は `post-queue.ts` が直列化しているのでこの穴が無い。

⚠ **`isBusy` は「チャットの入力欄が 1 つしかない」ことへの手当て。** `postMessage` は入力欄に値を入れて
送信し、最大 5 秒ポーリングで自分の要素を探す(`poster.ts:113-116`)。**人がタイミングを選べる
テスト送信**が他の投稿に割り込むと、入力欄の上書きと要素の取り違えが起きる。
**リダイレクト返礼とコメント返しが互いに競合する経路は 006 以前から存在するが、それは範囲外**
(006 が新しく開けるのはテスト送信の 1 本だけなので、そこだけ塞ぐ)。

### `src/post-log.ts`

```ts
export function findReplyBlocker(
  log: PostLog,
  params: { streamId: string; url: string; now: number; blockedBy: readonly PostKind[] },
): PostRecord | undefined

export function findRedirectReplyBlocker(log: PostLog, p: { streamId: string; url: string; now: number }): PostRecord | undefined
export function findCommentReplyBlocker(log: PostLog, p: { streamId: string; url: string; now: number }): PostRecord | undefined

export function onPostLogChanged(handler: (log: PostLog) => void): () => void
```

## 採らない案

- **`findCommentReplyBlocker` をそのままリダイレクト側にも呼ぶ。**
  あれは**種別を問わない**設計なので、コメント返し済みの相手へのリダイレクト返礼まで止まる。
  004 / AC8 の非対称(こちらが本命)が壊れる。→ `blockedBy` を引数にして分ける。
- **`dedupe.ts` を残し、中の判定だけ差し替える。**
  同じ規則が `dedupe.ts`(メモリの `lastFiredAt` ベース)と `post-log.ts`(履歴を舐める)の
  2 つの言葉で存在し続ける。何より**メモリ側の記録が残るので AC14 が構造的に直らない**
  (履歴を消してもそちらが生きている)。今回いちばん直したい形が残る。
- **記録側の `streamId` が空でも、配信が違えば通す**(= 現行 `dedupe.ts:87` の `absorb` の規則を維持する)。
  管制室で返礼 → 次の配信をポップアウトで開く、で**同じ相手に 2 回目が出る。**
  004 が同じ穴に 6 時間の窓を当てているので**規則を揃える**(AC2)。代償は「6 時間以内に別の配信を
  始めると 1 回取りこぼす」だが、**取りこぼしより二重投稿を避ける**が 001 からの一貫した判断。
- **テスト送信で `selfEcho.remember(url)` を打つ。**
  `selfEcho` が塞いでいるのは**固定バナー**の経路(`self-echo.ts:1-13`)で、テスト送信は固定しない(AC12)。
  一方 `remember` すると**その相手が 30 秒以内に本当にリダイレクトしてきたときの返礼が消える。**
  「配信の直前に設定を試す」という本 feature の用途と正面から噛み合わない。
  → **`rememberOwnPost`(本文と要素の記憶)だけを打つ。**コメント経路の自己ループはこちらが塞ぐ。
- **テスト送信を手動トリガー([manual-trigger.ts](../../src/manual-trigger.ts))で代替する。**
  ① 辞書の行と紐付かず URL を手打ちする ② `handle()` を通るので固定まで走る(AC12 違反)
  ③ 同じく `postLog` に残る(AC8 違反) ④ 配信画面に常駐するパネルで、既定 OFF(security-review S8)。
  4 点とも要件と逆。**手動トリガーは残す**(AC6 で抑止の対象外にするだけ)。
- **options → コンテントスクリプトの合図を storage キーで渡す。**
  ① **「チャットのタブが開いていない」を判定できない**(書き込みは誰も居なくても成功する。
  タイムアウトで擬似判定するしかない) ② 開いている全タブが拾って**二重投稿**する
  ③ 1 対 1 のリクエスト/レスポンスに `requestId` の対応付けが要る。
  → `chrome.tabs.sendMessage` は「タブを選べる」「Promise がそのまま応答になる」の 2 点で素直。
- **`cooldownSec` を残したまま「同一配信 1 回」を足す。**
  設定に効かない項目が残り、いまの誤解([public/options.html:169](../../public/options.html))が
  そのまま残る。AC5 で消す。
- **Playwright を入れて設定画面を自動操作する。**
  ⚠ **SPEC-OPS §05 は「GUI 要件がある feature はブラウザ自動化を 1 本含める」を求めており、これはその例外。
  §12 S1 で本人に確認して「入れない」を確定した**(親が plan.md で勝手に降りたのではない)。
  根拠: この repo は「`options.ts` は import 時に 17 個の要素 id を要求する副作用モジュールなので、
  判断は純関数へ切り出してテストする」で一貫している([tests/options.test.ts:1-7](../../tests/options.test.ts))。
  Chrome 拡張の設定画面を Playwright で動かすには拡張をロードした persistent context と
  `chrome.storage` のスタブが要り、それで確かめられるのは「ボタンが出る」程度。
  → **判断を純関数と注入で受けるハンドラに切り出して vitest で固める**(`createTestSendHandler` を
  `main.ts` に直書きしないのはこのため)。
  **代償として残る人手は T11(実機での挙動確認とスクリーンショット)と T12(実配信の通し確認)の 2 本**で、
  どちらも §08 の「実機・非コード成果物」に当たる。**Playwright を入れてもこの 2 本は減らない** —
  フレーム数・`tabs.query` の権限・実配信での投稿可否・ストア掲載画像は、いずれも拡張を読み込んだ
  実 Chrome と実配信でしか判定できない。

## 確定値

モック → http://localhost:19052/published/yt-redirect-pin/006-test-send-mock.html
(実体はダッシュボードの `published/yt-redirect-pin/006-test-send-mock.html`)

| 決定 | 確定 | 実装への落とし方 |
|---|---|---|
| A. テスト送信ボタンの配置 | **展開したときだけ出す** | `renderDirectory` の `detailRow`(`options.ts:565-609` のブロック)に置く。畳んだ行(`actionCell`)には**出さない** |
| C. 送信する種別 | **ボタン 2 つ**「返礼文をテスト送信」「コメント返しをテスト送信」 | それぞれ `kind: 'redirect'` / `'comment'` を送る |
| B4. チャンネル ID 未解決の行 | **押す前からボタンを無効化**し、`title` に理由を出す | `testSendAvailability` が返すのは**コメント側だけ** `enabled: false`。**返礼文側は常に押せる**(URL で照合するため) |
| D. 投稿履歴のヒント文 | **案 1** | 下記の実文をそのまま入れる |
| 二度押し | **応答が返るまでその行の 2 ボタンとも無効**(AC13) | 行ごとの状態 `testSendStates` で持つ。⚠ `captureRowDrafts` の掃除に足すこと |

**D の実文**(`public/options.html:184-188` のヒント段落を丸ごと差し替え):

> 投稿できたときだけ、**誰に・何を・いつ**をこの端末に記録します(再投稿の判定に使う。同期はしない)。
> 同じ配信で同じ相手にもう一度すぐ投稿したいときは、ここを消します。
> 設定を試したいだけなら、辞書の行にある「テスト送信」を使えば履歴を残さず何度でも試せます。

## テスト

`npm run typecheck && npx vitest run` が緑になること。中身の期待値:

**抑止の統一 (`tests/post-log.test.ts`)**
- `findRedirectReplyBlocker`: 同じ配信・同じ相手に `kind='redirect'` の記録があれば止める
- `findRedirectReplyBlocker`: 同じ配信・同じ相手に **`kind='comment'` の記録しか無ければ止めない**(AC3 / 004 AC8)
- `findCommentReplyBlocker`: `kind='redirect'` でも `kind='comment'` でも止める(既存の期待値が変わらないこと)
- **配信が違えば止めない**(両方。記録側の `streamId` が入っている場合)
- **記録側の `streamId` が空なら、違う配信 ID で問い合わせても 6 時間以内は止める**(AC2。両方)
- **問い合わせ側の `streamId` が空なら、6 時間以内の記録だけが止める**(AC2。両方)
- `findReplyBlocker` は**秒数の設定を引数に取らない**(型に `cooldownSec` を渡す口が無いこと)
- `UNKNOWN_STREAM_WINDOW_SEC` が `6*60*60` であること

**履歴の購読 (`tests/post-log.test.ts`)**
- `onPostLogChanged`: `chrome` が無い環境では何もせず、解除関数を返す
  (`tests/directory.test.ts:287` の `stubChrome` / `fakeArea` パターンを流用)
- 自分のエリア以外の `onChanged` では発火しない
- 空配列に変わったとき、ハンドラに `[]` が渡る(AC14)

**多重発火 (`tests/in-flight.test.ts`)**
- 同じ URL で `begin` を 2 回呼ぶと 2 回目は `false`
- `end` の後は再び `true`(**投稿に失敗した後も再び試せる** / AC1)
- 違う URL は互いに影響しない
- URL の表記ゆれ(前後の空白・大文字小文字)を同じ鍵として扱う(`postLogKey` と同じ規則)
- `begin` してから `end` するまで `isBusy()` が `true`、`end` の後は `false`
- 違う URL でも `begin` されていれば `isBusy()` は `true`(入力欄は 1 つしかない)

**設定 (`tests/config.test.ts`)**
- `DEFAULT_CONFIG` に `cooldownSec` が無い
- **保存済みの設定に `cooldownSec` が残っていても `normalizeConfig` が落ちず、返り値に含めない**(AC5)
- 既存の他のキー(`enabled` / `template` / `pinMode` / `commentReplyEnabled` / `commentTemplate` 等)の
  正規化が変わらないこと

**テスト送信の判断 (`tests/test-send.test.ts`)**
- `parseTestSendRequest`: 正しい形を通す / `type` 違い・`kind` が enum 外・`url` が非文字列や空・
  `null`・非オブジェクトは `null`(AC16)
- `buildTestSendText` `kind='redirect'`: 呼び名と `message` が `template` の `{name}` `{msg}` に入る
- `buildTestSendText` `kind='comment'`: **`commentMessage` が入り、`message` は入らない**(004 / AC16)
- `buildTestSendText`: 辞書に無い URL は `reason: 'no-entry'`
- `buildTestSendText` `kind='comment'` かつ `channelId` が空 → `reason: 'unresolved-channel-id'`
- `buildTestSendText` `kind='redirect'` かつ `channelId` が空 → **通る**(URL で照合するため)

**テスト送信の歯止め (`tests/test-send.test.ts` / `createTestSendHandler`)**
- ⚠ **投稿の前に `rememberOwnPost(text, null)` が呼ばれる**(呼び出し順を記録して `post` より前だと確かめる / AC11)
- ⚠ **投稿できたら `rememberOwnPost(text, element)` が呼ばれる**(2 回目の登録 / AC11)
- ⚠ **投稿履歴に触る依存を 1 つも呼ばない**(AC8。`TestSendDeps` に口が無いことに加え、
  返り値が `postLog` を含まないことを型と実行の両方で確かめる)
- `isBusy()` が `true` のときは **`post` を呼ばずに** `{ status:'failed', reason:'busy' }`(AC13)
- 投稿に失敗したら `{ status:'failed', reason:'no-input' }` を返し、**`rememberOwnPost` の 2 回目は呼ばない**
- 投稿できたら `{ status:'posted', text, streamId }` を返す(AC9 の「どの配信へ出したか」)
- 未知の形のメッセージには `null` を返し、**`post` を呼ばない**(AC16)

**結果の文言 (`tests/test-send.test.ts`)**
- `testSendAvailability`: `channelId` が空の行はコメント側だけ `enabled: false`、返礼文側は `true`
- `testSendResultMessage`: `posted` / `no-input` / `no-tab` / `unresolved-channel-id` / `no-entry` / `busy`
  の **6 通りが互いに違う文言**を返す(AC9)

**ドキュメントとコード中の言及 (`tests/docs.test.ts` 新規)**
- **`src/` と `public/` に `cooldownSec` の出現が 0 件**(AC5 / AC17)
- **`README.md` と `docs/*` に「クールダウン」の出現が 0 件。**ただし
  **`docs/t1-findings.md` は除外**(過去の実機ログの記録)
- `src/` に `dedupe` の出現が 0 件(ファイル削除とコメントの直し漏れを同時に見る / AC17)

## 依存 / 前提

- 依存する feature は無い。005(docs-link-hygiene)は未着手だが、006 は `check-links` に依存しない。
- 004 の受け入れ条件(AC7 / AC8 / AC9 / AC10 / AC11 / AC16)を**壊さないこと**が前提。
  特に AC8 の非対称は `blockedBy` 引数がそのまま表す。

## リスク / 降りる箇所

- **同一タブ内のフレーム数を実機で数える。** `all_frames: true` なので `frameId` 無しの
  `sendMessage` は一致する全フレームでリスナーを走らせる。**2 つ以上あると 1 回のテスト送信で
  2 通出る。** → 拡張を読み込んだ Chrome で管制室を開き、**DevTools のフレームセレクタに
  `live_chat` がいくつ出るか**を数える。ポップアウトを同時に開いた状態でも見る。
  2 つ以上なら `frameId` を指定する設計に変える判断が要る(その判断は人がする)。
- **`tabs.query({ url })` が `tabs` 権限なしで通るかを実機で確かめる。** 仕様上は
  `host_permissions` で足りる読みだが、外していると **`tabs.query` が常に空を返し、
  AC9 が永久に「タブが開いていない」を返す。** → 拡張を読み込んだ Chrome でチャットを開き、
  設定画面から**テスト送信を 1 回押して `posted` が返ること**を見る。ここが赤なら
  `tabs` 権限の追加が要り、`tests/manifest.test.ts:74` の意図(権限を増やさない)と衝突するので人に返す。
- **スクリーンショットの撮り直しは人手。** `docs/index.html:494` の alt と
  `docs/store-submission.md:173` の説明文が「クールダウンの秒数入力欄」を指しており、
  **画像そのものにクールダウン欄が写っている**(#88 で 4 枚に撮り直したばかり)。
  → 実装後、拡張を読み込んだ Chrome で設定画面を開き、**クールダウン欄が消えテスト送信ボタンが
  写った状態で撮り直す。**枚数と構図は #88 に合わせる。ストア掲載画像でもあるので、差し替えるかも人が決める。
- **AC1 / AC4 の実配信での通し確認は人手。** リロードで再投稿しないことは、実際にリダイレクトを
  受けないと最終確認ができない(001 の不具合が出た経路そのもの)。
  → 配信中に 1 人からリダイレクトを受け、投稿された後にチャットをポップアウトし直して
  **2 回目が出ないこと**を見る。`docs/for-testers.md` のテスト B をこの形に書き換える。
- **`chrome.runtime.onMessage` の非同期応答。** 応答を `await` の後に返すなら、リスナーは
  **同期的に `true` を返す**必要がある(返さないとチャネルが閉じて options 側に応答が届かない)。
  ここを外すと「押しても何も返らない」になる。**実装時に必ず踏むので、レビューで見る。**
- **`onPostLogChanged` は自分の書き込みでも発火する**(`options.ts:108` に同じ注意がある)。
  チャット側が `savePostLog` した直後に自分の変更を読み戻すが、`normalizePostLog` を通した
  同じ内容が入るだけなので無害。**ただし `postLog` を差し替える処理に重い副作用を足さないこと**
  (`selfEcho.reset()` は冪等なので可)。
- **`docs/t1-findings.md` と `specs/001` / `specs/004` と `CHANGELOG.md` の過去エントリは書き換えない。**
  過去の調査・決定・リリースの記録であり、当時 `cooldownSec` があったことは事実。
  書き換えると記録が嘘になる。`CHANGELOG.md` は**新しいエントリを足すだけ。**
