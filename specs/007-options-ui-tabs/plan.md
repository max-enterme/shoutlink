---
feature: options-ui-tabs
test: npm run typecheck && npx vitest run
---

# 実装計画 — 設定画面をタブに分け、辞書を左右分割にする

> plan.md — 「どう作るか」。spec.md の受け入れ条件を満たす設計。

## アプローチ

3 つを順に入れる。**それぞれ単独で動く状態を保ったまま積む。**

1. **`options.ts` をテストできる形にしてから、タブを入れる。**
   `src/options/options.ts` は**トップレベルで `el()` を 25 回呼ぶ副作用モジュール**で、
   import した瞬間に要素 id を要求して throw する(options.ts:68-95, 968-971)。
   このため `tests/options.test.ts` は**純関数だけを対象にし、DOM 配線をテストしていない**
   (同ファイル冒頭に明記)。今回の受け入れ条件 AC1〜AC13 は**すべて DOM の振る舞い**なので、
   純関数を増やすだけでは 1 本も判定できない。**トップレベルの副作用を `initOptions()` に畳んで
   export し、ビルドのエントリを薄い `src/options/main.ts` へ移す。**
2. **辞書を左右分割にする。** `expandedRows: Set<string>` を `selectedKey: string | null` に置き換え、
   `renderDirectory()` の `if (!expanded) { … continue }`(options.ts:617)を境に、
   前半を左ペイン(全行)・後半を右ペイン(選択された 1 件)へ振り分ける。
3. **アイコンを足す。** `resolveChannelId` が取っている HTML(channel-id.ts:181)から `og:image` も
   拾い、88px 版を data URL にして `DirectoryEntry.iconDataUrl` に控える。
   **チャンネルページの取得は 1 回のまま増やさない。**

### 通信の約束を変えない(この feature の一番の制約)

README.md:154 と docs/privacy-policy.md:14 が「**本拡張が自分で通信するのは、設定画面が
チャンネル ID を控えるときだけ**」と公言しており、ストア掲載の根拠になっている。**引き金を増やさない。**

| 引き金 | 何を取るか | 通信 |
|---|---|---|
| 「コメントに反応する」を ON | チャンネル ID + アイコン | チャンネルページ 1 回 + 画像 1 回 |
| 行の「再試行」を押す | 同上(未取得のものだけ) | 同上 |
| 「まとめて再試行」を押す | チャンネル ID 未解決の行 | 対象行ぶん |
| **「アイコンをまとめて取得」を押す(新規)** | **アイコン未取得の行のアイコンだけ** | 対象行ぶん |
| 辞書タブを開く | **何も取らない** | **なし** |

画像の取得先は `yt3.googleusercontent.com`。**2026-09-10 に `curl` で実測して確認した:**

- `https://www.youtube.com/@YouTube` を取得(1,958,471 バイト)すると
  `<meta property="og:image" content="https://yt3.googleusercontent.com/…=s900-c-k-c0x00ffffff-no-rj">`
- 末尾を `=s88-c-k-c0x00ffffff-no-rj` に差し替えて `Origin: chrome-extension://kpjfmcppkncdmehdpgcochaanbmodaim`
  を付けて取得すると、応答は:
  `HTTP/1.1 200` / `Content-Type: image/jpeg` / `Content-Length: 5219` /
  **`Access-Control-Allow-Origin: *`** / `Cross-Origin-Resource-Policy: cross-origin`
  → **`host_permissions` を足さずに拡張ページから `fetch` できる。**manifest は変えない
- 拡張 ID が `kpjfmcppkncdmehdpgcochaanbmodaim` に固定なのは `public/manifest.json` の `key` による

⚠️ **確認したのは `yt3.googleusercontent.com` の 1 ホストだけ。**別のホストが `og:image` に
出る可能性は検証していないので、`ICON_HOSTS` に推測でホストを足さない(→ リスク / 降りる箇所)。

## 変更点

| 対象(ファイル / 関数) | 変更 |
|---|---|
| `public/options.html` (76-246) | 7 つの `<fieldset>` を **4 つ**の `<section class="panel" id="panel-basic\|panel-directory\|panel-history\|panel-dev">` に入れ直す(**投稿履歴は `panel-history` の単独タブ**。`panel-dev` は診断ログだけ)。タブのボタン列 `<nav id="tabs">` を先頭に足す |
| `public/options.html` (78-84) | studio 限定の `.warn` バナーを**パネルの外**(タブ列の上)へ移し、**`id="studioWarning"` を付ける。** 現状 `.warn` は `#templateWarning` / `#commentMismatch` / `#channelIdDuplicate` / 辞書の取り違え警告にも付いており、クラスでは一意に取れない |
| `public/options.html` (248-251) | `.actions`(`save` / `status`)を**パネルの外**へ出し、`position: sticky; bottom: 0` にする |
| `public/options.html` (187-233) | 辞書の `<table class="directory">` を捨て、`<div class="dir-split">` + 左 `<div id="dirList">` / 右 `<div id="dirDetail">` に置き換える。`newHandle` / `newNickname` / `addEntry` は左ペインの末尾へ。絞り込み欄 `<input id="dirFilter">`、`<button id="fetchAllIcons">`、その隣の状態表示 `<span id="fetchAllIconsStatus"></span>` を左ペインの先頭へ(**3 つとも HTML に静的に置く。JS で作らない** — `el()` で拾えるようにするため) |
| `public/options.html` (6-73) | **`table.directory` の共通指定(35-38: `width` / `border-collapse` / `th` / `td`)を `table.postlog` へリネームして残す。** 投稿履歴は `<table class="directory postlog">`(175)で、`.postlog` 固有の指定は 47-48 の 2 本しか無く、幅とセルの余白を `table.directory` から借りている。**辞書の表を捨てるときに一緒に消すと、履歴タブの投稿履歴だけが崩れる**(自動テストに出ず人手へ流れる)。辞書用の 39-72 は左右分割用に置き換え。タブ / sticky な保存バー / アイコンの丸 / モノグラムの CSS を足す。**左右の独立スクロール(AC6b)**: `.dir-split { display: flex; gap: 16px; align-items: flex-start }` と、`#dirList` / `#dirDetail` の**両方**に `max-height: calc(100vh - 260px); min-height: 240px; overflow-y: auto` |
| `src/options/options.ts` 全体 | **状態も関数もすべて `export function initOptions()` の本体へ移す。**「中へ入れるもの」は網羅的に: `el()` の 25 呼び出し / 状態 11 個(`directory` `templateDependents` `rowDrafts` `liveRows` `expandedRows`→`selectedKey` `commentDrafts` `focusables` `resolvingKeys` `channelIdErrors` `bulkResolving` `testSendStates`)と**新規の 3 個(`currentTab` `dirFilter` `bulkIconFetching`)** / それらを閉包する関数すべて(`registerFocusable` `captureFocusTarget` `restoreFocusTarget` `captureRowDrafts` `currentTemplate` `currentCommentTemplate` `setNotice` `renderAlwaysOnNotices` `refreshTemplateDependent` `setDirectoryStatus` `persistDirectory` `resolveEntryChannelId` `retryUnresolvedChannelIds` `renderChannelIdRetryAll` `orderedStudioTabs` `sendTestSend` `renderDirectory` `renderPostLog` `renderPreview` `apply`)/ 全 `addEventListener` / 起動の 3 本(`loadDirectory` 906・`loadPostLog` 967・`loadConfig` 1031)/ `onDirectoryChanged` 911。**トップレベルに残すのは `import` と `SAMPLE_EVENT` `SAMPLE_MESSAGE` `SAMPLE_COMMENT_MESSAGE` の 3 定数、`el()` の定義、型宣言だけ。** 1000 行の入れ子になるが、移動はインデントだけの機械的な変更で、**これによりテストの 1 ケースごとに状態が完全に独立する** |
| `src/options/main.ts` **(新規)** | `import { initOptions } from './options'` して呼ぶだけの 2 行。ビルドのエントリ |
| `scripts/build.mjs` (24) | `options` の entryPoint を `src/options/options.ts` → `src/options/main.ts` へ |
| `public/options.html` (120) | **「1 配信あたり 20 件までです。」の 1 文を消す。** この上限は #127(2026-09-05)で撤廃済みで、README.md:197 相当・docs/install.md:197・docs/for-testers.md:45 は修正されているが**この 1 行だけ取りこぼしている**。節をタブへ移すだけだと古い文言がそのまま残る |
| `src/options/options.ts` `renderDirectory()` (492-881) | 左右分割へ作り替え。542-555 の caret セル生成を削除。617 の `if (!expanded) … continue` を「左ペインは全行ぶん作り、右ペインは `selectedKey` の行だけ作る」に置き換え。634-876 の詳細生成は `dirDetail` へ出力 |
| `src/options/options.ts` `expandedRows` (156, 239, 526, 550-554, 609, 896) | `selectedKey: string \| null` に置換。609(削除時)は `selectedKey = null`、896(＋ 登録時)は `selectedKey = directoryKey(url)` |
| `src/options/options.ts` `liveRows` (131-144, 617-631, 854-875) | **左ペインは表示専用**(呼び名の `<input>` は右ペインだけに置く)。それでも **`liveRows` には表示中の全行を push する** — `read()` は選択中でない行では `shown` をそのまま返す(入力欄が無いので人が触りようがない)。`comment` 付きの完全版は選択中の 1 行だけ。⚠ **選択中の 1 行だけを push する形にしない**: `captureRowDrafts`(213-260)の掃除が 1 行にしか効かず、**別のタブで削除された行の `rowDrafts` / `commentDrafts` / `channelIdErrors` / `testSendStates` が残る**(同じハンドルを ＋ から再登録すると前の行の失敗理由とテスト送信結果が出る = options.ts:220-224 のコメントが「2 度踏んだ」と名指ししている型の再発)。`shownFromDraft` が真なら `captureRowDraft`(message-field.ts:185-204)は 1 つ目の早期 return を飛ばし、`saved` との trim 比較で下書きを残すので、この形で未保存の値も守られる |
| `src/options/options.ts` `captureRowDrafts()` (213-260) | **2 つの仕事を分ける。** ① **消えた行の状態を捨てる掃除は `liveRows` から切り離し、`rowDrafts` / `commentDrafts` / `channelIdErrors` / `testSendStates` の各キーを `directory` と突き合わせて、辞書に無いキーを全部捨てる**(`selectedKey` も辞書に無ければ `null` に戻す)。② 表示中の行の入力を下書きへ退避する処理は今までどおり `liveRows` に対して行う。⚠ **①を `liveRows` に載せたままにしない**: 絞り込み(`dirFilter`)で外れた行は `#dirList` に作らない = `liveRows` に入らないので、**絞り込んでいる間に別のタブで削除された行の状態が残り続ける**(同じハンドルを ＋ から再登録すると前の行の失敗理由とテスト送信結果が出る)。これは 220-224 のコメントが「2 度踏んだ」と名指ししている型そのもの。⚠ `resolvingKeys` はここで消さない(220-224 の 3 つ目の注意。持ち主は `resolveEntryChannelId` の `finally`) |
| `src/options/options.ts` `resolveEntryChannelId()` (425-461) | `resolveChannelId` の呼び出しを `resolveChannelPage` に差し替え、チャンネル ID とアイコンを同じ HTML から取る |
| `src/options/options.ts` `renderDirectory()` の 0 件時の早期 return (502-516) | 現状は右ペインに触れずに `return` する。**左に「まだ登録がありません」・右に案内文を出してから return する**(AC12)。`renderAlwaysOnNotices()` と `restoreFocusTarget()` を呼ぶ現行の約束は維持 |
| `src/options/options.ts` (末尾) | 「アイコンをまとめて取得」(`fetchAllIcons`)と絞り込み(`dirFilter`)のハンドラを足す。まとめて取得は **`bulkResolving` とは別のフラグ `bulkIconFetching` で二度押しを止める**(引き金も対象も別なので、片方が走っている間にもう片方を止める必要が無い) |
| `src/channel-id.ts` (67-84 の `ID_SOURCES` の後) | `extractChannelIconUrl` / `iconUrlAtSize` / `ICON_HOSTS` を足す |
| `src/channel-id.ts` (153-189 の `resolveChannelId` の後) | `fetchIconAsDataUrl` / `resolveChannelPage` を足す。**`resolveChannelId` は消さない**(単体で使える形を残す。テストも既存のまま通る) |
| `src/directory.ts` `DirectoryEntry` (17-57) | `iconDataUrl: string` を足す(**空文字 = 未取得**。`channelId` と同じ流儀) |
| `src/directory.ts` `blankEntry()` (164-176) | `iconDataUrl: ''` を足す |
| `src/directory.ts` `normalizeDirectory()` (303-332) | `iconDataUrl` の正規化。**`data:image/` で始まり `MAX_ICON_DATA_URL_LENGTH` 以下の文字列だけ通し、それ以外は空文字に落とす** |
| `src/directory.ts` `upsertChannelId()` (250-258) の隣 | `upsertChannelIcon()` を足す |
| `src/directory.ts` `displayHandle()` の隣 | `initialForAvatar()` を足す |
| `tests/fixtures/chrome.ts` **(新規)** | `chrome.storage`(local / sync / onChanged)と `chrome.tabs`(query / sendMessage)のスタブ。`tests/directory.test.ts:287` の `stubChrome` と同じ形を、`tabs` まで足して外へ出したもの |
| `tests/options-dom.test.ts` **(新規)** | `public/options.html` を jsdom に流し込んで `initOptions()` を呼び、AC1〜AC13 / AC18 / AC21〜AC23 を判定する |
| `tests/channel-id.test.ts` | `extractChannelIconUrl` / `iconUrlAtSize` / `resolveChannelPage` のテストを追加 |
| `tests/directory.test.ts` | `iconDataUrl` の正規化・`upsertChannelIcon` / `initialForAvatar` のテストを追加 |
| `README.md` (139, 154-157) | 「チャンネル ID を控える」の説明に**アイコンも同時に控える**ことと**「アイコンをまとめて取得」**の引き金を追記 |
| `docs/privacy-policy.md` (14-25) | 同上。**取得先ホスト `yt3.googleusercontent.com`** も明記 |
| `docs/install.md` (131, 188) / `docs/setup-and-verify.md` (80, 237) / `docs/for-testers.md` (284, 329, 341, 385) | `▸` を押して展開する前提の記述を、**左の一覧から選ぶ**操作に書き換える。**`install.md:131` と `setup-and-verify.md:80` は設定画面の構成そのものを説明する表**なので、`▸` の置換だけでなく **4 タブの構成にも書き換える** |
| `public/options.html` `.dir-row` | **B7(追加の塊): `justify-content: space-between` を `flex-start` にする**(または宣言ごと削除)。子が 2 個/3 個で入れ替わり、名前が右端に張り付いていた実機の見え方を直す(AC7) |
| `public/options.html` `.dir-row-main` | **B7**: `flex: 1;` を足す(`min-width: 0` は維持)。`.dir-row .mark` を `margin-left: auto` に変え、⚠ を常に右端に固定する |
| `src/channel-id.ts` `MAX_ICON_DATA_URL_LENGTH` の隣 | **B7**: `extractChannelName(html: string): string` を足す(`og:title` の `content` を実体参照デコードして返す。`MAX_CHANNEL_NAME_LENGTH` 超は空文字。例外を投げない) |
| `src/channel-id.ts` `resolveChannelPage()` | **B7**: 戻り値に `name: string` を足す。**`want` に名前用のフラグは足さない** — HTML を取った経路では `want` に関わらず常に `extractChannelName` を呼ぶ(同じ HTML から追加コスト 0) |
| `src/directory.ts` `DirectoryEntry` | **B7**: `channelName: string` を足す(空文字 = 未取得。`iconDataUrl` と同じ流儀。表示専用) |
| `src/directory.ts` `blankEntry()` / `normalizeDirectory()` | **B7**: `channelName: ''` の既定値と、`MAX_CHANNEL_NAME_LENGTH` 超・非文字列を空文字に落とす正規化を足す |
| `src/directory.ts` `upsertChannelIcon()` の隣 | **B7**: `upsertChannelName()` を足す(同じ形。アイコンとは独立して保存する) |
| `src/directory.ts` `initialForAvatar()` / `displayHandle()` の隣 | **B7**: `initialForAvatar` の優先順を「呼び名 → 表記名 → ハンドル」に広げる(`channelName` は省略可能な追加引数として受ける。既存呼び出しを壊さない)。表示名を決める純関数 `displayNameFor()` を新設し、`{ text, source: 'nickname' \| 'channelName' \| 'handle' }` を返す |
| `src/options/options.ts` `resolveEntryChannelId()` | **B7**: `resolveChannelPage` の戻りの `name` が空でなければ `upsertChannelName` で控える(`channelId` / `iconDataUrl` と独立) |
| `src/options/options.ts` `fetchAllIcons()` | **B7**: 取得した `name` も同様に控える。対象条件を `iconDataUrl === '' \|\| channelName === ''` に広げる(アイコンだけ済んでいる行が永久に表記名を取らない退行を防ぐ)。ボタン文言を「アイコンと表記名をまとめて取得」に変える(`#fetchAllIcons` の id は変えない) |
| `src/options/options.ts` `renderDirectory()` の左の行 | **B7**: `displayNameFor(entry)` で 1 段目を決める。`source === 'channelName'` のときだけ `.placeholder` クラスを付けてグレーにする。`source === 'handle'`(=どちらも空)なら 1 段目は出さず、今までどおりハンドルだけ |
| `public/options.html` CSS | **B7**: `.dir-row-nickname.placeholder { color: #777; }` を足す(ハンドルの `#666` とは別の色にして、呼び名/表記名/ハンドルが見分けられるようにする) |

## 新規インターフェース

```ts
// src/directory.ts — DirectoryEntry に足すフィールド(1 本だけ)
export type DirectoryEntry = {
  // …既存…
  /**
   * チャンネルアイコンの data URL。**空文字は「未取得」**(`channelId` と同じ流儀)。
   * チャンネルページの `og:image` から 88px 版を取って控える。**表示専用**で、
   * 照合・投稿文には一切使わない。
   */
  iconDataUrl: string
}

/** 控えてよい data URL の上限。88px の JPEG が実測 5,219 バイト = base64 で約 7KB なので、
 *  十分な余裕を見て 64KB。超えたものは控えない(切り詰めない) */
export const MAX_ICON_DATA_URL_LENGTH = 64 * 1024

/** `channelId` を書き込む `upsertChannelId` と同じ形 */
export function upsertChannelIcon(directory: Directory, url: string, dataUrl: string): Directory

/**
 * アイコンが無い行に出す頭文字 1 文字。
 * 呼び名があれば呼び名の先頭、無ければハンドルの `@` を除いた先頭。
 * **サロゲートペアを割らない**(`Array.from` で先頭 1 要素)。取れなければ `'?'`
 */
export function initialForAvatar(entry: Pick<DirectoryEntry, 'nickname' | 'url'>): string
```

```ts
// src/channel-id.ts

/** アイコンを取りに行ってよいホスト。**og:image が指す先を無検査で fetch しない** —
 *  壊れた / 手で編集された HTML が任意のホストを指しうる(`parseYouTubeUrl` と同じ考え方)。
 *  **実測(2026-09-10)で確認できたのは `yt3.googleusercontent.com` の 1 つだけなので、
 *  ここに推測でホストを足さない。** 別のホストが返るようになったら `ok: false` になって
 *  アイコンが出なくなるだけで機能は壊れない(→ リスク / 降りる箇所) */
const ICON_HOSTS = ['yt3.googleusercontent.com'] as const

export type IconExtractResult = { ok: true; url: string } | { ok: false; reason: string }

/**
 * チャンネルページの HTML から `og:image` の URL を取り出す純関数。
 * **`extractChannelId` の「複数の出所を突き合わせて食い違ったら失敗」はやらない** —
 * 誤ったアイコンが出ても「違う画像が出る」だけで、誤った `UC…` のような実害が無い。
 * ホストが `ICON_HOSTS` に無ければ `ok: false`。
 */
export function extractChannelIconUrl(html: string): IconExtractResult

/**
 * googleusercontent の URL のサイズ指定を差し替える純関数。
 * `…=s900-c-k-c0x00ffffff-no-rj` → `…=s88-c-k-c0x00ffffff-no-rj`。
 * **パターンに合わなければ元の URL をそのまま返す**(取得を諦めない。大きすぎれば
 * `fetchIconAsDataUrl` の上限で弾かれる)。
 */
export function iconUrlAtSize(url: string, size: number): string

export type IconDataUrlResult = { ok: true; dataUrl: string } | { ok: false; reason: string }

/**
 * 画像 URL を取得して data URL にする。**例外を投げない**(`resolveChannelId` と同じ規約)。
 * `Content-Length` か実バイト数が `maxBytes` を超えたら失敗として返す —
 * **切り詰めて壊れた画像を保存しない**(`validateEntryMessage` と同じ思想)。
 */
export async function fetchIconAsDataUrl(
  imageUrl: string,
  options: ResolveOptions & { maxBytes?: number },
): Promise<IconDataUrlResult>

export type ChannelIconResult = { status: 'resolved'; dataUrl: string } | { status: 'failed'; reason: string }

/**
 * **チャンネルページを 1 回だけ取って、要求されたものを両方返す。**
 * 片方が失敗しても、もう片方は成功のまま返す(AC19)。
 *
 * **HTML を取りに行くかどうかは、次の擬似コードのとおり**(散文で読むと両義的になるので、
 * こちらが正):
 *
 * ```
 * if (!parseYouTubeUrl(url)) → 要求されたほうを両方 failed で返す。fetch しない
 * idFromUrl   = want.channelId ? channelIdFromUrl(url) : null
 * needsFetch  = (want.channelId && idFromUrl === null) || want.icon
 * if (!needsFetch) → { channelId: idFromUrl ? {already} : null, icon: null }。fetch しない
 * html = fetch(url)          ← ここだけがチャンネルページへの通信。多くても 1 回
 * channelId = want.channelId ? (idFromUrl ? {already} : extractChannelId(html)) : null
 * icon      = want.icon ? extractChannelIconUrl(html) → iconUrlAtSize(88) →
 *                         fetchIconAsDataUrl(...)     ← 画像への通信 1 回
 *                       : null
 * ```
 *
 * **`want.icon` が true なら、URL が `/channel/UC…` 形でも必ず fetch する**(アイコンは
 * URL からは分からない / AC20)。**`want: { channelId: false, icon: true }`(まとめて取得)は
 * 必ず fetch する。**
 *
 * 4 つの呼び出し経路が渡す `want`:
 * | 経路 | `want` |
 * |---|---|
 * | 「コメントに反応する」を ON | `{ channelId: true, icon: entry.iconDataUrl === '' }` |
 * | 行の「再試行」 | 同上 |
 * | 「まとめて再試行」(既存) | `{ channelId: true, icon: false }` |
 * | 「アイコンをまとめて取得」(新規) | `{ channelId: false, icon: true }` |
 */
export async function resolveChannelPage(
  url: string,
  want: { channelId: boolean; icon: boolean },
  options?: ResolveOptions & { maxBytes?: number },
): Promise<{ channelId: ChannelIdResult | null; icon: ChannelIconResult | null }>
```

```ts
// src/options/options.ts — 起動処理を包む
export type OptionsHandle = {
  /**
   * **起動時の読み込みが 3 本とも終わると解決する。**
   * `loadDirectory()`(options.ts:906) / `loadPostLog()`(967) / `loadConfig()`(1031)。
   * ⚠️ **`void` を返す形にしない。** `loadDirectory` は `migrateDirectoryToLocal()` を挟んで
   *    複数回 await する(directory.ts:438-446)ので、`initOptions()` の直後に `#dirList` を
   *    数えると 0 行になる。**テストケースの大半がこの `ready` を待てないと書けない。**
   */
  ready: Promise<void>
  /**
   * `chrome.storage.onChanged` の購読(`onDirectoryChanged` / options.ts:911。
   * 現状は戻り値を捨てている)を解除する。**テストの `afterEach` で呼ぶ。**
   * ⚠️ **無いと、1 ファイル 20 ケースぶんのリスナが積み上がり**、1 回の変更で
   *    前のケースの `renderDirectory` まで走る。
   */
  dispose(): void
}

/** 設定画面を DOM に配線して動かす。**この関数を呼ぶまで DOM に触らない。** */
export function initOptions(): OptionsHandle

// src/options/main.ts (新規) — ビルドのエントリ。戻り値は使わない
import { initOptions } from './options'
initOptions()
```

```ts
// src/options/options.ts — 内部の状態。**export せず、すべて initOptions() の本体に置く**
// (モジュールのトップレベルに置くと、initOptions() を 2 回呼んだとき前の呼び出しの状態が漏れる)
type OptionsTab = 'basic' | 'directory' | 'dev'   // ← 型宣言だけはトップレベルでよい

// --- 以下はすべて initOptions() の中 ---
/** いま選ばれているタブ。初期値は 'basic'(AC1) */
let currentTab: OptionsTab = 'basic'
/** 右ペインに出している行。`directoryKey(url)`。null は「まだ選んでいない」 */
let selectedKey: string | null = null
/** 左の一覧の絞り込み。空文字は「絞らない」 */
let dirFilter = ''
/** 「アイコンをまとめて取得」が走っているか。**`bulkResolving` とは別**(引き金も対象も別) */
let bulkIconFetching = false
```

```ts
// tests/fixtures/chrome.ts (新規)
export type FakeStore = Record<string, unknown>

export type ChromeStub = {
  /** いま保存されている内容。テストから直接読む */
  local: FakeStore
  sync: FakeStore
  /**
   * **`chrome.storage.onChanged` のリスナを発火する。**
   * `onDirectoryChanged`(directory.ts:454-469)は第 2 引数の areaName を
   * `getLocalStorageAreaName()`(config.ts:100-105)の戻り値と突き合わせるので、
   * **`'local'` を渡す**(スタブが `chrome.storage.local` を持つ限りこれで一致する)。
   * ⚠️ **これが無いと AC21 / AC22 のテストが書けない。**参照元にした
   *    `tests/directory.test.ts:287` の stub は `addListener() {}` の空実装で、発火の口が無い。
   */
  emitChange(key: string, newValue: unknown, areaName?: string): void
}

/** `chrome.storage`(local / sync / onChanged)と `chrome.tabs` を差し替える。
 *  `afterEach` で `delete (globalThis as …).chrome` する運用は directory.test.ts と同じ */
export function stubChrome(options?: {
  local?: FakeStore
  sync?: FakeStore
  tabs?: chrome.tabs.Tab[]
  sendMessage?: (tabId: number, request: unknown) => Promise<unknown>
}): ChromeStub
```

```ts
// src/channel-id.ts — B7(追加の塊): 表記名(og:title)の取得

/** 表記名として控えてよい長さの上限。超えたら空文字(切り詰めない)。directory.ts で定義し、
 *  channel-id.ts / directory.ts の両方から参照する(MAX_ICON_DATA_URL_LENGTH と同じ置き場の作法) */
export const MAX_CHANNEL_NAME_LENGTH = 100 // src/directory.ts 側

/**
 * チャンネルページの HTML から `og:title`(= チャンネルの表記名)を取り出す純関数。
 * 例外は投げない。取れなければ空文字。`extractChannelId` のような
 * 「複数の出所を突き合わせて食い違ったら失敗」はしない(誤表示の実害が無いため)。
 */
export function extractChannelName(html: string): string

// resolveChannelPage の戻り値に `name` を追加(want に名前用のフラグは無い)
export async function resolveChannelPage(
  url: string,
  want: { channelId: boolean; icon: boolean },
  options?: ResolveOptions & { maxBytes?: number },
): Promise<{ channelId: ChannelIdResult | null; icon: ChannelIconResult | null; name: string }>
```

```ts
// src/directory.ts — B7: DirectoryEntry に足すフィールド
export type DirectoryEntry = {
  // …既存…
  /**
   * チャンネルの表記名。**空文字は「未取得」**(`iconDataUrl` と同じ流儀)。
   * チャンネルページの `og:title` から取って控える。**表示専用。照合・投稿文には一切使わない。**
   * 呼び名が空の行に、ハンドルの代わりにグレーで出す(AC7)。
   */
  channelName: string
}

/** `upsertChannelIcon` と同じ形。アイコンとは独立して保存する */
export function upsertChannelName(directory: Directory, url: string, name: string): Directory

export type DisplayName = { text: string; source: 'nickname' | 'channelName' | 'handle' }

/**
 * 左ペインの行に出す表示名を決める純関数(AC7)。
 * 呼び名 → 表記名 → ハンドルの順。**どれを返したかも分かる形**にして、
 * 呼び出し側が「表記名で埋めているときだけグレーにする」判定に使う。
 */
export function displayNameFor(entry: Pick<DirectoryEntry, 'nickname' | 'channelName' | 'url'>): DisplayName
```

## 採らない案

- **`iconFetchedAt` のような「いつ取ったか」のフィールドを持たない。** 足すと「失敗した行を
  しばらく取りに行かない」が書けるが、**失敗を保存しないのがこの repo の流儀**
  (`channelIdErrors` は Map で持ち、画面を開き直すと消える / options.ts:330-336)。
  「まとめて取得」は人が押したときだけ走るので、押されたなら失敗した行も取り直すのが期待どおり。
  フィールドは `iconDataUrl` の 1 本だけにする。
- **`resolveChannelId` を残したまま `resolveChannelIcon` を別に生やして 2 回 fetch する形にしない。**
  チャンネルページは実測 1.3〜1.9MB(channel-id.ts:180 のコメント)で、2 回取ると通信量が倍になる。
  `resolveChannelPage` が HTML を 1 回取って両方に渡す。
- **逆に、`resolveChannelId` の戻り値にアイコンを混ぜて 1 つの型にしない。** 混ぜると
  「チャンネル ID は解決済みだがアイコンだけ取り直したい」が表現できなくなる。
  `want: { channelId, icon }` で要求を分け、結果も `{ channelId, icon }` で別々に返す。
- **`resolvingKeys`(多重起動の歯止め / options.ts:328)をアイコン用に増やさない。**
  取得はどちらも `resolveChannelPage` の 1 呼び出しに畳まれるので、鍵は 1 本で足りる。
- **左ペインと右ペインを別々の描画関数に分けない。** 分けると「右だけ再描画したときに左のフォーカスを
  壊さない」「左だけ再描画したときに右の入力中キャレットを壊さない」という保証が 2 か所に増える。
  現行は `renderDirectory()` が 1 つの出入口で下書き退避(`captureRowDrafts`)とフォーカス復元
  (`captureFocusTarget` / `restoreFocusTarget`)を握っており、**004 T17 の保証がこの単一性に依存している。**
  辞書は多くても数百行なので、まとめて作り直す現行の単位を維持する。
- **`options.ts` の DOM 配線をテストしない現状路線を続けない。** 「判定を純関数へ追い出し、
  `options.ts` は薄く保つ」方針は続けるが、**それだけでは AC1〜AC13 が 1 本も判定できない**
  (タブが切り替わる・左を選ぶと右が出る・アイコンが無い行は丸になる、はすべて DOM の事実)。
  `initOptions()` に畳んで jsdom から呼べるようにする。
- **Playwright を入れない。** 拡張を読み込むには headed Chrome が要り、CI に画面まわりの前提と
  不安定な失敗が増える。**CI の正本は #128(2026-09-09)で GitHub Actions から
  Jenkins(`max/shoutlink`)へ移っており、パイプライン定義は別リポジトリ
  `max-enterme/jenkins-pipelines` にある** — このリポジトリの変更だけでは stage を足せず、
  導入は向こうの変更とセットになる。見た目の崩れ・重なり・幅・左右の独立スクロールだけを
  人手に残す(spec.md 降りる箇所)。
- **`unlimitedStorage` 権限を足さない。** 88px の JPEG は実測 5,219 バイト = base64 で約 7KB。
  辞書 100 件でも 700KB 程度で、`chrome.storage.local` の既定 10MB に収まる。
  権限を増やすとインストール時の警告が変わる。
- **`tests/directory.test.ts` のローカルな `stubChrome`(287-295)を新しい fixture に置き換えない。**
  動いているテストを触る必要が無い。新しい `tests/fixtures/chrome.ts` は新規のテストだけが使う。
- **アイコンの取得失敗を `ineffectiveReasons` の ⚠ に載せない。** ⚠ は「設定したのに効かない行」の印で、
  アイコンが無くても返礼もコメント返しも動く。載せると印の意味が薄まる。
- **「アイコンをまとめて取得」の対象を、件数を見せずに全件へ広げない。**
  既存の「まとめて再試行」の対象は `unresolvedChannelIdEntries`(notices.ts:84 =
  `replyToComment && channelId が空`)で通常数件だが、**アイコンの対象は `iconDataUrl` が空の全行**で、
  AC20 により `/channel/UC…` 形の行も含む。**辞書 100 件なら 1 クリックで 130〜190MB を取りに行く。**
  notices.ts:79-82 は「ボタン 1 つで辞書の全件を取りに行くことになる」のを避ける判断をしており、
  そこと正面から衝突する。**対象を絞る**(= 一部の行のアイコンが永久に出ない)のではなく、
  **押す前に件数と通信量の目安をボタン文言に出す**ことで解く(確定値)。
  `retryAllLabel`(notices.ts)が件数をラベルに出しているのと同じ流儀。
- **`renderDirectory()` を左右で分けない代わりに、絞り込みだけを差分更新する形にもしない。**
  絞り込みのたびに `renderDirectory()` を丸ごと走らせる。下書き退避とフォーカス復元が
  1 つの出入口に閉じている状態を崩さないため。

## 確定値

モック: ダッシュボードの Pages `yt-redirect-pin / 007-options-ui-mock`(2026-09-09 に確定済み)。
**モックは正本ではない。**確定した内容はこの表が正本で、下の 3 点はモックと違う形に倒してある。

| 項目 | 確定値 |
|---|---|
| タブ | **「基本設定」「辞書」「履歴」「開発」の 4 つ。**初期選択は「基本設定」(モックの確定 2026-09-09: `tabs-ok` / `postlog-in-dev` がどちらも否、備考「履歴タブを追加」) |
| 基本設定タブの中身 | リダイレクト返礼 → コメント返し → 手動トリガー → 固定モード(現行の並び順のまま) |
| 辞書タブの中身 | 呼び名の辞書のみ |
| **履歴タブの中身** | **投稿履歴のみ**(独立したタブにする) |
| 開発タブの中身 | **診断ログのみ** |
| **辞書タブのスクロール** | **左の一覧と右の詳細がそれぞれ独立してスクロールする**(モックの確定 2026-09-09 の備考)。両方に `overflow-y: auto` と高さの上限を付け、ページ全体は縦に伸ばさない |
| タブの外(常時表示) | **保存バー(下・sticky)だけ。** studio 限定の警告バナーは **基本設定タブの中**(2026-09-10 に AC4 を変更。全タブに常駐すると、一番使う辞書タブの左右ペインの背をそのぶん削るため) |
| 保存の単位 | Config 7 項目をまとめて 1 回(現行のまま)。タブをまたいだ変更も 1 回で保存される |
| 辞書の左右比 | 左 280px 固定 / 右は残り。全体の最大幅 1000px・中央寄せ |
| 左ペインの並び | 絞り込み欄 → 「アイコンをまとめて取得」→ 一覧 → ＋ 追加欄 |
| 左の 1 行 | アイコン(丸 32px) + 呼び名(1 段目) + ハンドル(2 段目・小さく) + ⚠(効かない行) |
| **左の 1 行(呼び名が空のとき)** | **1 段だけにして、そこにハンドルを出す**(2 段目は出さない)。⚠ モックは 2 段ともハンドルを出しているが**採らない** — 同じ文字列が 2 回並ぶだけで情報が増えない。spec.md AC7 が正 |
| **左ペインは表示専用** | 入力欄を置かない。呼び名の編集は右ペインだけ(現行は一覧に呼び名の `<input>` があったが、左右分割で右へ移す) |
| 未取得アイコン | 頭文字 1 文字を描いた丸。文字は `initialForAvatar` |
| 選択の見せ方 | 行の背景色。選択は 1 件のみ |
| 右ペインの並び | **⚠ の理由(効かない行のときだけ)** → ハンドル → 呼び名 → コメントに反応する → チャンネル ID の状態と再試行 → 自由文(リダイレクト返礼) → 自由文(コメント返し) → テスト送信 2 ボタンと結果 → 削除 |
| 未選択のときの右ペイン | `← 左の一覧から選んでください`(モックの文言にそろえる) |
| ⚠ の理由の出し方 | 左は印だけ(`title` に理由)。**選ぶと右ペインの先頭に理由を文で出す** |
| 絞り込みの対象 | 呼び名 と ハンドル。大文字小文字を区別しない |
| **絞り込みで外れた行** | **`#dirList` に作らない(行数が減る)。** ⚠ モックは `style.display = 'none'` で行数を保つが**採らない** — jsdom で表示状態を判定できず、テストが行数で書けなくなる |
| **「アイコンをまとめて取得」のボタン文言** | **対象件数と通信量の目安を出す**: `アイコンをまとめて取得 (23 件 / 約 35MB)`。件数は `iconDataUrl === ''` の行数、目安は 件数 × 1.5MB。**0 件のときはボタンごと隠す**(`retryChannelIds` / `renderChannelIdRetryAll` と同じ流儀 / options.ts:407-415) |
| **まとめて取得の実行中** | ボタンを `disabled` にし、隣の `#fetchAllIconsStatus` に `取得中… (3/23)` を出す。**中断はできない**(既存の「まとめて再試行」と同じ) |
| **まとめて取得の完了メッセージ** | `#fetchAllIconsStatus` に `23 件中 21 件取得しました(2 件は失敗)`。全部成功なら `23 件取得しました` |
| **まとめて取得の直列 / 並列** | **直列(1 件ずつ順に)。** 既存の `retryUnresolvedChannelIds` と同じ。1 件 1.3〜1.9MB を並列に投げない |
| **まとめて取得の二度押し防止** | `bulkResolving` とは**別のフラグ** `bulkIconFetching`。引き金も対象も別なので、片方が走っている間にもう片方を止めない |
| 絞り込みで選択中の行が消えたとき | 右ペインはその行を出したまま(選択を外さない) |
| 辞書タブの常時表示警告の置き場 | 左右分割の**上**(重複チャンネル ID の警告 → まとめて再試行の案内 の順) |
| 字数超過の表記 | 現行のまま。超過時 `N 字超過` / 通常 `残り N 字`(`formatRemaining` / message-field.ts:133-136) |
| まだリダイレクトを受けていない行 | 左の一覧でハンドルを薄く出す(現行 `.unseen` と同じ扱い) |

## テスト

`npm run typecheck && npx vitest run` が通ること。内訳:

### タブ
- 初期表示で `#panel-basic` が見え、`#panel-directory` `#panel-history` `#panel-dev` が `hidden`
- 「辞書」を押すと `#panel-directory` だけが見える
- **各タブが受け持つ節を持っている**(AC3。基本設定に `#enabled` `#template` `#commentReplyEnabled`
  `#commentTemplate` `#showManualTrigger` `#pinMode` / 辞書に `#dirList` `#dirDetail` /
  **履歴に `#postLogRows` `#clearPostLog` / 開発に `#debug`**)
- **`#dirList` と `#dirDetail` の両方に `overflow-y: auto` の指定がある**(AC6b)。
  ⚠ これは**CSS の規則が存在することだけ**を見る検査で、実際にスクロールが分かれて見えるかは
  人手(spec.md 降りる箇所)。規則を誤って消したときに気付ける
- 保存バーは、どのタブでも `hidden` にならない。**警告バナー(`#studioWarning`)は基本設定タブでだけ見える**(AC4)
- **タブを切り替えても、入力中の未保存の値が消えない**(切り替えはパネルの `hidden` の
  付け外しだけで、DOM を作り直さない)
- 開発タブで `#debug` を切り替え → 基本設定タブへ移動 → `#save` を押すと、
  保存された Config の `debug` が切り替え後の値になる(AC5)

### 辞書の左右分割
- 2 件の辞書で、左に 2 行が出る。`▸`(caret ボタン)がどこにも無い(AC6)
- 何も選んでいないとき、右ペインに `← 左の一覧から選んでください` が出る(AC8 / AC12)
- 1 行目を押すと、右にその行の詳細が AC9 の順で出る
- 呼び名が空の行は、左にハンドルだけが出る(AC7)
- 効かない行に ⚠ が出て、選ぶと右ペインの先頭に理由が文で出る(AC10)
- 絞り込みに `abc` と入れると、呼び名かハンドルに `abc` を含む行だけが残る。
  空に戻すと全件に戻る。**選択中の行が絞り込みで消えても右ペインは残る**(AC11)
- 辞書 0 件で、左に「まだ登録がありません」・右に `← 左の一覧から選んでください`(AC12)
- 選択中の行を削除すると、右が `← 左の一覧から選んでください` に戻る(AC13)

### アイコン
- `extractChannelIconUrl`: `og:image` の meta があれば URL を返す / 無ければ `ok: false` /
  **`ICON_HOSTS` 以外のホストなら `ok: false`**
- `iconUrlAtSize`: `…=s900-c-k-c0x00ffffff-no-rj` → `…=s88-c-k-c0x00ffffff-no-rj` /
  パターンに合わない URL は変えずに返す
- `fetchIconAsDataUrl`: 応答が `maxBytes` 以下なら `data:image/jpeg;base64,…` を返す /
  超えたら `ok: false`(切り詰めない) / 応答が `!ok` なら `ok: false`
- `resolveChannelPage`: **fetch が 1 回だけ呼ばれ**、`channelId` と `icon` の両方が返る /
  アイコンの取得に失敗しても `channelId` は `resolved` のまま(AC19) / その逆も同じ /
  `want.icon: false` かつ `/channel/UC…` 形の URL では**fetch が 1 回も呼ばれない**
- `normalizeDirectory`: `data:image/` で始まらない `iconDataUrl` は空文字に落ちる /
  `MAX_ICON_DATA_URL_LENGTH` を超えるものも空文字に落ちる
- `initialForAvatar`: 呼び名があれば呼び名の先頭 / 無ければハンドルの `@` を除いた先頭 /
  絵文字の呼び名でサロゲートペアを割らない / 取れなければ `'?'`
- 左の一覧で、`iconDataUrl` がある行は `<img>`、無い行は頭文字の丸(AC18)
- **辞書タブを開いただけでは fetch が 1 回も呼ばれない**(AC16)
- 「アイコンをまとめて取得」を押すと、`iconDataUrl` が空の行の数だけチャンネルページが取られる(AC15)。
  **ボタンの文言に対象件数が出る。0 件なら隠れる**
- 「コメントに反応する」を ON にすると、**チャンネルページの取得は 1 回のまま**で
  `channelId` と `iconDataUrl` の両方が入る(AC14)
- `iconDataUrl` が入っている辞書で起動すると、**fetch が 1 回も呼ばれずにアイコンが出る**(AC17)
- **`/channel/UC…` 形の行も「まとめて取得」の対象に入る**(AC20)

### 回帰(003 / 004)
- 自由文を 250 字入れた未保存の状態で、**別の行を保存**しても入力が消えない(AC21)
- 同じ状態で `onDirectoryChanged` を発火させても入力が消えない(AC21)
- 入力欄にフォーカスを置いたまま `renderDirectory()` を走らせると、
  **同じ欄にフォーカスとキャレットが戻る**(AC22)
- 自由文が 200 字超のとき、赤枠が付き `N 字超過`(`formatRemaining` / message-field.ts:133-136)が
  出て、**保存はできる**(AC23)

### ドキュメント
- README.md と docs/privacy-policy.md の両方に `yt3.googleusercontent.com` と「アイコン」の
  記述がある(AC24)。判定は `tests/docs.test.ts` の `import.meta.glob(?raw)` + 文字列検査で、
  同ファイルに既にある前例をそのまま使う
- `public/options.html` に「20 件」の上限を書いた文が残っていない(AC25)。
  同じ `tests/docs.test.ts` の `publicFiles` の glob をそのまま使う

## テストケース

**`tests/options-dom.test.ts` の共通の前提**(全ケースに効く。各行の「入力・前提」では繰り返さない):

```ts
// public/options.html を jsdom へ流し込む。tests/docs.test.ts と同じ ?raw の glob を使う
//(ファイルは <!doctype html> から <script src="options.js"> まで含む全文なので、
//  document.body.innerHTML に丸ごと入れることはできない)
const htmlFiles = (import.meta as any).glob('../public/options.html', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>
const OPTIONS_HTML = Object.values(htmlFiles)[0]

let handle: OptionsHandle
let stub: ChromeStub
beforeEach(async () => {
  const parsed = new DOMParser().parseFromString(OPTIONS_HTML, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML   // innerHTML 経由なので <script> は実行されない
  stub = stubChrome({ local: { …辞書 }, sync: { …設定 } })
  handle = initOptions()
  await handle.ready                                 // ⚠ 待たないと #dirList が 0 行
})
afterEach(() => {
  handle.dispose()
  delete (globalThis as { chrome?: unknown }).chrome
  document.body.innerHTML = ''
})
```

**`fetch` の数え方**: アイコンありの経路は 1 行につき**チャンネルページ 1 回 + 画像 1 回 = 2 回**呼ばれる。
以下の表で「fetch が N 回」と書いてあるものは、**`https://www.youtube.com/` で始まる URL への呼び出しだけ**を数える。

| テスト名 | 置き場(ファイル) | 入力・前提 | 期待値 |
|---|---|---|---|
| `各タブが受け持つ節を持っている (AC3)` | `tests/options-dom.test.ts` | 既定の前提 | `#panel-basic` が `#enabled` `#template` `#commentReplyEnabled` `#commentTemplate` `#showManualTrigger` `#pinMode` を含む / `#panel-directory` が `#dirList` `#dirDetail` を含む / **`#panel-history` が `#postLogRows` `#clearPostLog` を含む / `#panel-dev` が `#debug` を含む** |
| `左右のペインに独立スクロールの指定がある (AC6b)` | `tests/docs.test.ts` | `import.meta.glob('../public/**/*.html', ?raw)` | `public/options.html` の `<style>` に `#dirList` と `#dirDetail` の両方を対象にした `overflow-y: auto` の規則がある |
| `初期表示では基本設定タブだけが見える (AC1)` | `tests/options-dom.test.ts` | `options.html` を流し込んで `initOptions()` | `#panel-basic.hidden === false` / `#panel-directory` `#panel-history` `#panel-dev` がすべて `hidden === true` |
| `タブを押すとそのタブだけが見える (AC2)` | `tests/options-dom.test.ts` | 「辞書」ボタンを `click()` | `#panel-directory` だけ `hidden === false` |
| `警告バナーは基本設定タブにだけ出る (AC4)` | `tests/options-dom.test.ts` | 4 タブを順に `click()` | 基本設定タブのときだけ `#studioWarning` の祖先に `[hidden]` が無い。他の 3 タブでは祖先が `[hidden]` になる |
| `保存バーはどのタブでも消えない (AC5)` | `tests/options-dom.test.ts` | 4 タブを順に `click()` | 毎回 `.actions` が `hidden === false` |
| `別タブで変えた診断ログも保存される (AC5)` | `tests/options-dom.test.ts` | 開発タブで `#debug` を `click()` → 基本設定タブへ → `#save` を `click()` | `chrome.storage.sync` に書かれた `debug` が `true` |
| `左に全行が出て caret が無い (AC6)` | `tests/options-dom.test.ts` | 辞書 2 件(`FAKE_CHANNEL` / `FAKE_OTHER_CHANNEL`) | `#dirList` の行が 2 / `button.caret` が 0 件 |
| `未選択なら右は案内文 (AC8)` | `tests/options-dom.test.ts` | 辞書 2 件、何も押さない | `#dirDetail` の `textContent` に `左の一覧から選んでください` |
| `行を選ぶと右に詳細が出る (AC9)` | `tests/options-dom.test.ts` | 1 行目を `click()` | `#dirDetail` に ハンドル / 呼び名の `input` / `コメントに反応する` / チャンネル ID の行 / 自由文 2 欄 / テスト送信 2 ボタン / 削除 が、この DOM 順で存在 |
| `左の一覧に入力欄が無い (AC9)` | `tests/options-dom.test.ts` | 辞書 2 件 | `#dirList` の中に `input` が 0 個(＋ 追加欄は `#dirList` の外) |
| `呼び名が空ならハンドルだけ出る (AC7)` | `tests/options-dom.test.ts` | `nickname: ''` の 1 件 | 左の行の `textContent` に現れる `@example-channel` が 1 回だけ(2 段にしない) |
| `効かない行の理由は選ぶと右に出る (AC10)` | `tests/options-dom.test.ts` | `replyToComment: true` かつ `channelId: ''` の 1 件 | 左に `⚠` / 選ぶと `#dirDetail` に `ineffectiveReasons` の文言 |
| `絞り込みは呼び名とハンドルに当たる (AC11)` | `tests/options-dom.test.ts` | 2 件、`#dirFilter` に片方のハンドルの一部を `input` | 左の行が 1 / 空に戻すと 2 |
| `絞り込みで消えても選択は外れない (AC11)` | `tests/options-dom.test.ts` | 1 行目を選んだ後、2 行目だけに当たる語で絞る | `#dirDetail` は 1 行目のまま |
| `辞書 0 件の左右 (AC12)` | `tests/options-dom.test.ts` | 辞書 0 件 | 左に `まだ登録がありません` / 右に `左の一覧から選んでください` |
| `選択中の行を削除すると右が戻る (AC13)` | `tests/options-dom.test.ts` | 1 行目を選び「削除」を `click()` | `#dirDetail` に `左の一覧から選んでください` |
| `効かない行の理由は右ペインの先頭に出る (AC9 / AC10)` | `tests/options-dom.test.ts` | `replyToComment: true` / `channelId: ''` の行を選ぶ | `#dirDetail` の最初の子要素が理由の段落で、ハンドルより前にある |
| `アイコンがある行は img、無い行は頭文字 (AC18)` | `tests/options-dom.test.ts` | 1 件目 `iconDataUrl: 'data:image/jpeg;base64,AAA'` / 2 件目 `''` | 1 行目に `img[src^="data:image/"]` / 2 行目に `.monogram` でその `textContent` が頭文字 |
| `辞書タブを開くだけでは取りに行かない (AC16)` | `tests/options-dom.test.ts` | `fetch` スパイを置き、辞書タブを `click()` | `fetch` の呼び出し 0 回(どの URL へも) |
| `まとめて取得は未取得の行だけ取る (AC15)` | `tests/options-dom.test.ts` | 3 件のうち 1 件だけ `iconDataUrl` あり、`#fetchAllIcons` を `click()` | `www.youtube.com` への呼び出しが未取得の 2 件ぶん(= 2 回)。取得済みの 1 件の URL は呼ばれない |
| `まとめて取得のボタンに件数が出る (AC15)` | `tests/options-dom.test.ts` | 3 件のうち 1 件だけ `iconDataUrl` あり | `#fetchAllIcons` の `textContent` に `2 件` を含む。全件取得済みなら `#fetchAllIcons` が `hidden` |
| `ON にするとアイコンも同時に控える (AC14)` | `tests/options-dom.test.ts` | 行を選び「コメントに反応する」を `click()`。`fetchImpl` は `UC…` と `og:image` の両方を含む HTML を返す | `www.youtube.com` への呼び出しが 1 回(2 回ではない)。保存後の行の `channelId` が `UC…`、`iconDataUrl` が `data:image/` で始まる |
| `控えたアイコンは次に開いても取りに行かない (AC17)` | `tests/options-dom.test.ts` | `iconDataUrl: 'data:image/jpeg;base64,AAA'` の 1 件で `initOptions()` | `fetch` の呼び出し 0 回 / 左の行に `img[src^="data:image/"]` |
| `/channel/UC… 形の行もまとめて取得の対象 (AC20)` | `tests/options-dom.test.ts` | `url: 'https://www.youtube.com/channel/UC…'` かつ `iconDataUrl: ''` の 1 件で `#fetchAllIcons` を `click()` | `www.youtube.com` への呼び出しが 1 回(`channelId` は URL から決まるが、アイコンのために取りに行く) |
| `200 字超は赤枠で保存できる (AC23)` | `tests/options-dom.test.ts` | 行を選び自由文に 250 字を入れて `change` | その `input` に `invalid` クラスが付き、`.remaining` の `textContent` が `50 字超過` / `chrome.storage.local` に 250 字が保存されている |
| `通信の記述にアイコンが書かれている (AC24)` | `tests/docs.test.ts` | `import.meta.glob('../README.md' / '../docs/privacy-policy.md', ?raw)` | 2 ファイルとも `yt3.googleusercontent.com` と `アイコン` を含む |
| `設定画面に撤廃した 20 件の上限が残っていない (AC25)` | `tests/docs.test.ts` | `import.meta.glob('../public/**/*.html', ?raw)`(同ファイルに既存の glob) | `public/options.html` が `/20\s*件/` に一致しない |
| `未保存の自由文は他の行の保存で消えない (AC21)` | `tests/options-dom.test.ts` | 1 行目を選び自由文に 250 字 → 2 行目を選んで呼び名を `change` | 1 行目に戻すと 250 字が残っている |
| `絞り込み中に消えた行の状態も掃除される (AC21)` | `tests/options-dom.test.ts` | 1 行目に下書きを残す → 2 行目だけに当たる語で絞り込む → `stub.emitChange` で 1 行目が消えた辞書を流す → 絞り込みを空に戻し、同じハンドルを ＋ から再登録 | 再登録した行の自由文が空(前の下書きが復活しない) |
| `再描画でフォーカスとキャレットが戻る (AC22)` | `tests/options-dom.test.ts` | 自由文にフォーカス・キャレットを 3 に置き `onDirectoryChanged` を発火 | `document.activeElement` が同じ欄 / `selectionStart === 3` |
| `og:image を取り出す` | `tests/channel-id.test.ts` | `<meta property="og:image" content="https://yt3.googleusercontent.com/x=s900-c-k-c0x00ffffff-no-rj">` を含む HTML | `{ ok: true, url: 'https://yt3.googleusercontent.com/x=s900-c-k-c0x00ffffff-no-rj' }` |
| `og:image が無ければ失敗` | `tests/channel-id.test.ts` | meta の無い HTML | `ok: false` |
| `知らないホストの og:image は採らない` | `tests/channel-id.test.ts` | `content="https://example.com/a.jpg"` | `ok: false` |
| `サイズ指定を 88 に差し替える` | `tests/channel-id.test.ts` | `https://yt3.googleusercontent.com/x=s900-c-k-c0x00ffffff-no-rj` / `88` | `https://yt3.googleusercontent.com/x=s88-c-k-c0x00ffffff-no-rj` |
| `サイズ指定が無い URL はそのまま` | `tests/channel-id.test.ts` | `https://yt3.googleusercontent.com/x` / `88` | 入力と同じ文字列 |
| `上限を超える画像は控えない` | `tests/channel-id.test.ts` | `fetchImpl` が `maxBytes + 1` バイトを返す | `{ ok: false, reason: … }`(data URL を返さない) |
| `ページの取得は 1 回だけ` | `tests/channel-id.test.ts` | `want: { channelId: true, icon: true }`、`fetchImpl` をスパイ | `www.youtube.com` への呼び出しが 1 回(画像への 1 回は別に数える) |
| `アイコンだけ要求しても取りに行く` | `tests/channel-id.test.ts` | `@handle` 形の URL / `want: { channelId: false, icon: true }` | `www.youtube.com` への呼び出しが 1 回 / `channelId === null` / `icon.status === 'resolved'` |
| `/channel/UC… でもアイコンが要るなら取りに行く` | `tests/channel-id.test.ts` | `https://www.youtube.com/channel/UC…` / `want: { channelId: false, icon: true }` | `www.youtube.com` への呼び出しが 1 回 / `icon.status === 'resolved'` |
| `アイコンが失敗しても channelId は成功` | `tests/channel-id.test.ts` | HTML に `UC…` はあるが `og:image` が無い | `channelId.status === 'resolved'` / `icon.status === 'failed'` |
| `channelId が失敗してもアイコンは成功` | `tests/channel-id.test.ts` | `UC…` が食い違い、`og:image` は正常 | `channelId.status === 'failed'` / `icon.status === 'resolved'` |
| `/channel/UC… でアイコン不要なら取りに行かない` | `tests/channel-id.test.ts` | `https://www.youtube.com/channel/UC…` / `want: { channelId: true, icon: false }` | `fetchImpl` の呼び出し 0 回 / `channelId.status === 'already'` |
| `壊れた iconDataUrl は空になる` | `tests/directory.test.ts` | 保存内容の `iconDataUrl` が `'http://x/a.png'` | `normalizeDirectory` 後に `''` |
| `大きすぎる iconDataUrl は空になる` | `tests/directory.test.ts` | `'data:image/jpeg;base64,' + 'A'.repeat(MAX_ICON_DATA_URL_LENGTH)` | `''` |
| `upsertChannelIcon が書き込む` | `tests/directory.test.ts` | 既存 1 件に data URL を渡す | その行の `iconDataUrl` が渡した値 |
| `頭文字は呼び名を優先する` | `tests/directory.test.ts` | `{ nickname: 'まっくす', url: '…/@example-channel' }` | `'ま'` |
| `呼び名が空ならハンドルの先頭` | `tests/directory.test.ts` | `{ nickname: '', url: '…/@example-channel' }` | `'e'` |
| `絵文字の呼び名を割らない` | `tests/directory.test.ts` | `{ nickname: '🎉ぱーてぃ', url: … }` | `'🎉'`(長さ 2 の文字列 1 文字ぶん) |
| `og:title から表記名を取り出す` | `tests/channel-id.test.ts` | `<meta property="og:title" content="YouTube">` | `'YouTube'` |
| `実体参照をデコードする` | `tests/channel-id.test.ts` | `content="Tom &amp; Jerry"` | `'Tom & Jerry'` |
| `長すぎる表記名は控えない` | `tests/channel-id.test.ts` | `content` が 101 文字 | `''` |
| `og:title が無ければ空文字` | `tests/channel-id.test.ts` | meta の無い HTML | `''` |
| `ページを取ったときは表記名も返す` | `tests/channel-id.test.ts` | `want: { channelId: true, icon: false }` で `og:title` を含む HTML を返す `fetchImpl` | `result.name === 'YouTube'`(`want` に名前の指定は無いが常に返る) |
| `呼び名が空なら表記名をグレーで出す (AC7)` | `tests/options-dom.test.ts` | `nickname: ''`, `channelName: 'YouTube'` の 1 件 | 左の行に `.dir-row-nickname.placeholder` があり `textContent` が `'YouTube'` |
| `呼び名も表記名も空ならハンドルだけ (AC7)` | `tests/options-dom.test.ts` | `nickname: ''`, `channelName: ''` の 1 件 | `.dir-row-nickname` が 0 個、ハンドルだけが出る(既存 `呼び名が空ならハンドルだけ出る` と同じ観点を表記名にも広げる) |
| `まとめて取得は表記名だけ未取得の行も対象にする (AC15)` | `tests/options-dom.test.ts` | `iconDataUrl` あり・`channelName: ''` の行を含む 2 件で `#fetchAllIcons` を `click()` | その行ぶんも `www.youtube.com` への呼び出しに含まれる(アイコン済みでも対象から漏れない) |
| `頭文字は呼び名 → 表記名 → ハンドルの順 (AC18)` | `tests/directory.test.ts` | `{ nickname: '', channelName: 'YouTube', url: … }` | `'Y'` |
| `左の行は左寄せになっている` | `tests/docs.test.ts` | `public/options.html` の `<style>` | `.dir-row { … }` の規則に `justify-content: space-between` が無い |

## 実装ブロック

| ブロック | 対象タスク | 触るファイル | 確認コマンド |
|---|---|---|---|
| B1 | T1, T2, T3 | `src/options/options.ts` / `src/options/main.ts`(新規) / `public/options.html` / `scripts/build.mjs` / `tests/fixtures/chrome.ts`(新規) / `tests/options-dom.test.ts`(新規) | `npm run typecheck && npx vitest run tests/options-dom.test.ts` |
| B2 | T4, T5, T6 | `src/options/options.ts` / `public/options.html` / `tests/options-dom.test.ts` | `npm run typecheck && npx vitest run tests/options-dom.test.ts` |
| B3 | T7, T8 | `src/channel-id.ts` / `src/directory.ts` / `tests/channel-id.test.ts` / `tests/directory.test.ts` | `npm run typecheck && npx vitest run tests/channel-id.test.ts tests/directory.test.ts` |
| B4 | T9, T10 | `src/options/options.ts` / `public/options.html` / `tests/options-dom.test.ts` | `npm run typecheck && npx vitest run` |
| B5 | T11 | `README.md` / `docs/privacy-policy.md` / `docs/install.md` / `docs/setup-and-verify.md` / `docs/for-testers.md` | `npm run typecheck && npx vitest run` |

**順序**: B1 → B2 → B4 → B5。**B3 は B1 / B2 と並行してよい**(純関数だけで画面に触らない)。
B4 は B2 と B3 の両方が入ってから。**T12(スクリーンショットの撮り直し)は人手なのでブロックに入れない。**

## 依存 / 前提

- 先行して main に入っている必要のある feature は無い。
- 006(`specs/006-reply-guard-and-test-send`)が入れたテスト送信の 2 ボタンは、
  **右ペインへそのまま移す**。挙動は変えない。
- `docs/for-testers.md` の手順が `▸` の展開を前提にしているため、B5 で書き換えるまで
  **テスターの手順書と実物が食い違う。**B4 と B5 を続けて出す。

## リスク / 降りる箇所

- **`options.ts` を `initOptions()` に畳む変更は 1031 行に及ぶ機械的な移動で、差分が大きい。**
  B1 の PR は「移動だけで挙動を変えない」ことを守る。タブの追加は同じ PR に入れてよいが、
  **辞書の作り替えは B2 まで持ち込まない。**
- **`og:image` が `yt3.googleusercontent.com` を指さなくなったら止まる。** `ICON_HOSTS` に無い
  ホストが返るようになった場合、**推測で `ICON_HOSTS` や `host_permissions` を足さない。**
  `extractChannelIconUrl` が `ok: false` を返してアイコンが出なくなるだけなので、機能は壊れない。
  その状態を報告して人が決める。
- **`Access-Control-Allow-Origin: *` が返らなくなったら止まる。** `fetchIconAsDataUrl` が失敗し続ける。
  `host_permissions` を足せば回避できるが、**インストール時の権限表示が変わるので人が決める。**
- **`docs/assets/screenshot-1-options.png` と `screenshot-3-directory.png` の撮り直しは人手。**
  実装が main に入った後、Chrome の拡張管理から `dist/` を読み込み、設定画面を開いて
  同じ構図で撮り直して差し替える。
- **ストアへの掲載更新の要否**は、実装が入った後に [docs/store-submission.md](../../docs/store-submission.md)
  の手順で判断する。権限を変えないので再審査の説明は不要の見込み。
