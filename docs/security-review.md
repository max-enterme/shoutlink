# セキュリティ点検 / インシデント点検 (2026-08-06)

対象: `main` 相当 (`2f04acf`) の全ソース・ドキュメント・git 履歴。
観点は 2 つ:

1. **セキュリティ点検** — この拡張が「配信者のアカウント名義でチャットへ投稿する」道具である以上、
   *第三者が投稿の内容や発火を操作できないか* / *配布物に秘匿情報や実在第三者の識別子が無いか*。
2. **インシデント点検** — 2026-08-06 に起きた実害 3 件 ([t1-findings.md](t1-findings.md) §🔴)
   が本当に塞がっているか / 同型の再発経路が残っていないか。

検証は jsdom 上で実際に関数を叩いて確認した(推測で書いていない箇所は「確認」と明記する)。

> ⚠️ **「jsdom で確認」の意味に 2 種類ある。**
> - S1 / S2 は、**実装が持っているパターン定数・除外条件そのもの**を叩いている。
>   入力の文言も実配信で観測したもの、または②で実際に踏んだものを使っている。
> - S3 / S4 は、**こちらで書いた DOM を入力にしている。**
>   「その形の DOM が来たらこうなる」を示しただけで、**その形の DOM が実際に来ることは示していない。**
>   初版はこれを区別せず「確認」と書いていた。訂正して格下げした(下記)。
ベースライン: `npm run typecheck` 成功 / `npx vitest run` 102 tests green。

> **対応状況 (2026-08-06):** S1 / S2 / S5 / S8 は**対応済み**(下の各項に追記)。
> 回帰テストを足して 118 tests green。~~S6 / S7 は未対応。~~ → **S6 のみ未対応**(下記の追記)。
> **S3 / S4 は中 → 低に格下げした**(実在する経路とは示せていないため / 各項の訂正を参照)。
>
> **追記 (2026-08-14): S7 は対応済み**(003 で辞書を `chrome.storage.local` へ移した / S7 の項を参照)。
> **未対応は S6 のみ。**

---

## 問題なかった点(確認済み)

| 観点 | 結果 |
|---|---|
| 外部通信 | **点検時は無し。**`fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / 動的 `import()` の使用箇所ゼロ。<br>⚠️ **2026-08-15 に変わった (004 / S10)** — [channel-id.ts](../src/channel-id.ts) が **`fetch` を 1 か所使う**(設定画面から、辞書に登録されたチャンネルのページを取得 / `credentials: 'omit'`)。**開発者のサーバは無いまま**だが、「通信を一切行わない」ではなくなったので、**for-testers.md / privacy-policy.md の文言を T10 で書き換えた** |
| リモートコード実行 | `eval` / `new Function` / 文字列 `setTimeout` 無し。MV3 なので既定 CSP のまま |
| DOM インジェクション | `src/` の `innerHTML` は `manual-trigger.ts:119` の 1 箇所のみで**静的文字列**。動的な値は全て `textContent` / `dataset` 経由。options ページも `createElement` + `textContent` |
| 権限 | `permissions: ["storage"]` のみ。`web_accessible_resources` 無し・background 無し |
| 保存先 | `chrome.storage` だけ。認証情報・トークンの類は扱わない |
| 実在第三者の識別子 | **git 履歴全体を走査して混入なし。**`@example-channel` / `@another-example` / `@your-channel` 等の架空値のみ。`UC9QSYkdpzAe29wNiVfp24` が引っかかるが `package-lock.json` の npm integrity ハッシュの一部で偽陽性 |
| 秘匿情報 | `.env` 等なし。`package.mjs` が同梱する `source/` に `node_modules` / `dist` / `release` は含まれない |

---

## インシデント点検 — 2026-08-06 の 3 件

| # | 事象 | 現状 | 回帰テスト |
|---|---|---|---|
| 1 | 他人の配信のチャットへ投稿していた | **コード上は塞がっている。**`manifest.json` の `matches` を `studio.youtube.com/live_chat*` だけにし、`src/scope.ts` の `decideScope` で二重の歯止め。`www` を設定で許可する経路も無い | `tests/scope.test.ts` |
| 2 | リダイレクトを「送った」側のバナーに反応していた | **直接原因(推測セレクタ)は削除済み。**除外文言 `EXCLUDED_TEXT_PATTERNS` も入っている。ただし**同型の再発経路が残っている → S2** | `tests/detector.test.ts:167,177,182` |
| 3 | `decodeURIComponent` の例外でパイプラインが落ちた | **解消。**`safeDecode` が握る。握った結果の検証は無いが、自動経路では問題にならない → S4 | `tests/detector.test.ts:43` |

### ①について残る前提の未検証

①の安全性は **「`studio.youtube.com` のライブ管制室は自分の配信でしか開けない」** の一点に乗っている。
これは**まだ検証していない仮定**であり、崩れると①の対策ごと崩れる。

- **要確認(人手):** 他人のライブ配信の videoId を使って
  `https://studio.youtube.com/live_chat?is_popout=1&v=<他人の videoId>` を開いたとき、
  チャットが描画されるか(描画されるなら content script が注入され、投稿しうる)。
- 描画される場合は、`decideScope` をホスト名だけの判定から
  「自分の配信であることの DOM/URL 上の裏付け」まで見る判定へ広げる必要がある。

### ②の教訓が適用されきっていない

t1-findings.md が書いている教訓は
**「未確認の推測を、チェックを飛ばす強い経路に置かない」**。
これは `selectors.ts` の**セレクタ**には適用されたが、**文言パターン**には適用されていない(→ S2)。

---

## 指摘事項

### S1 (高) 自分の返礼 → 固定 → その固定バナーを通知として再検知する自己ループ

既定テンプレートは `{name}さんからリダイレクトありがとうございます! {url}` で、
**「リダイレクト」という語とチャンネル URL の両方を含む。**

投稿された返礼メッセージ自体は `isChatTextMessage` / `isInsideChatTextMessage` で除外されるが、
**それが固定されたときに現れる固定バナーは別のノード**である。
`MutationObserver` は `body` 全体を見ているのでバナーの追加も拾う。

jsdom で確認(固定バナーの形をした要素に返礼文を入れた場合):

```
入力: <yt-live-chat-banner-renderer><yt-live-chat-pinned-message-renderer>
        <span id="message">@sender さんからリダイレクトありがとうございます! </span>
        <a href="/@sender">…</a>
      </yt-live-chat-pinned-message-renderer></yt-live-chat-banner-renderer>
結果: [{"sourceChannelName":"@sender","sourceChannelUrl":"https://www.youtube.com/@sender",...}]
```

**成立条件と歯止め:**

- 歯止めになりうるのは `containsChatTextMessage`(実バナーの中に
  `yt-live-chat-text-message-renderer` が入っていれば通知とみなされない)。
  **実際の固定バナーの DOM は未確認** ([t1-findings.md](t1-findings.md) ❓C)なので、
  効いているかどうか分からない。
- もうひとつの歯止めは投稿履歴に基づく抑止(現在は `findRedirectReplyBlocker`)。ただし
  **同じ配信で同じ相手にすでに 1 回投稿している場合しか効かない**。初回の投稿(履歴がまだ無い状態)
  には効かない。
- `seen` の WeakSet はノード単位なので、固定のたびに新しいバナー要素が生えれば効かない。

**したがって「固定バナーに `yt-live-chat-text-message-renderer` が含まれない」かつ
「その相手への初回の投稿」なら、再検知した通知が投稿 → 固定に進んでしまう。** ただし
`main.ts` の `handle()` は **`postMessage` が成功した直後(固定より前)に投稿履歴へ記録する**ため、
続けて再検知されても 2 回目は `findRedirectReplyBlocker` に止まる。無限にはならず、
**最大でも 1 回余分に出るだけ**で収まる。

**対処案(いずれか / 併用):**

1. 固定バナー領域 (`yt-live-chat-banner-manager` 配下) を検知の対象から除外する。
   通知はバナー領域にも出るので「バナー全体を除外」はできないが、
   **自分が投稿した本文と一致するものは除外する**ことはできる。
2. **直近に自分が投稿した本文を覚えておき、それを含む要素は通知とみなさない。**
   自己ループ一般に効く。
3. 投稿履歴が無い初回でも、最低限のノード単位・本文単位の抑止を残す。

**✅ 対応済み (2026-08-06) — 二重に塞いだ:**

- **文言側:** S2 の降格で `/リダイレクト/` が自動発火から外れた。既定テンプレートの返礼文は
  どの確認済みパターンにも当たらなくなり、**バナーに出ても検知されない。**
  回帰テスト: `tests/detector.test.ts`「自分の返礼が固定バナーとして出ても通知として拾わない (S1)」
- **パイプライン側:** `src/self-echo.ts` を追加。**投稿した送信元を 30 秒覚えておき、
  その間の自動検知イベントを捨てる。**窓の長さは**設定から独立**していて、
  投稿履歴の抑止(同じ配信・同じ相手への 1 回)とは無関係に効く。
  手動トリガーは人が明示的に押しているので抑止を受けない。
  回帰テスト: `tests/self-echo.test.ts`
- 文言側だけだと**利用者が独自テンプレートを使った瞬間に戻る**ため、パイプライン側も入れてある。

### S2 (高) 未確認の文言パターンが、②と同じ「チェックを飛ばす強い経路」になっている

`REDIRECT_TEXT_PATTERNS` のうち確認済みは `とその視聴者が参加しました` の 1 つだけで、
残りの `/リダイレクト/` `/redirect(ed|ing)?\b/i` `/\braid(ed|ing)?\b/i`
`/viewers? (have )?joined/i` `/誘導されました/` はすべて**推測**。
これらに当たれば `isRedirectNotice` は true になり、そのまま投稿まで走る。

条件は緩い — **通常のチャットメッセージでない要素で、テキストが 300 文字以下、
除外文言 3 つに当たらず、中に `@ハンドル` かチャンネルリンクがあること**だけ。
`EXCLUDED_TEXT_PATTERNS` は②で実際に見た 1 種類のバナーしか塞いでいない。

jsdom で確認(いずれも投稿まで到達するイベントが出る):

```
<tp-yt-paper-dialog>リダイレクトの送信先を選択しました<a href="/@target">…</a></tp-yt-paper-dialog>
  → sourceChannelUrl = https://www.youtube.com/@target
<yt-toast>リダイレクトを開始しました<a href="/@somebody">…</a></yt-toast>
  → sourceChannelUrl = https://www.youtube.com/@somebody
<div>Raid settings updated<a href="/@someone">someone</a></div>
  → sourceChannelUrl = https://www.youtube.com/@someone
```

content script が入るのは live_chat の文書だけなので Studio 本体の UI は範囲外だが、
**②で実際に踏んだのはまさにチャット文書内のバナー**であり、同じ形の別の文言が出れば同じ事故になる。
「リダイレクト」を含む別のバナー・トーストが出ないという保証はどこにも無い。

**対処案:** **確認済みの文言だけを自動発火の対象にし、推測のパターンは
「診断ログに候補として出すだけ」に降格する。**現に `NOTICE_HINT` という緩い
ログ専用パターンが既にあるので、推測パターンはそちらへ寄せられる。
実際に別形式の通知を観測したら、確認済みとして昇格させる。

**✅ 対応済み (2026-08-06):** `selectors.ts` のパターンを 2 つに分けた。

| 定数 | 中身 | 使われ方 |
|---|---|---|
| `REDIRECT_TEXT_PATTERNS` | `とその視聴者が参加しました` / `視聴者が参加しました` / `and their viewers` / `viewers joined` | **自動発火する** |
| `UNCONFIRMED_REDIRECT_TEXT_PATTERNS` | `リダイレクト` / `誘導されました` / `redirect(ed\|ing)` / `raid(ed\|ing)` | **診断ログに出すだけ** |

英語 2 つを自動発火側に残したのは、**確認済みの日本語文言をそのまま英訳した形**であり
「リダイレクトを受けた」以外の意味では出てこないため。危ないのは
「リダイレクトという話題に触れているだけ」の汎用語(送信側のバナー・設定画面・自分の返礼文)で、
そちらは全部降格させた。

診断ログ (`debug`) の各ノードに `matchedUnconfirmed` を出すようにしたので、
**「昔の版なら発火していた候補」がログで見える。**それが本当に受信通知だったら、
その文言を確認済みとして昇格させる。回帰テスト: `tests/detector.test.ts`「推測の文言では自動発火させない (S2)」

### S3 (低) 表示名の経路に内容の検査が無い

> **⚠️ 初版では「中」とし「第三者が制御する表示名がそのまま投稿に載る(jsdom で確認)」と書いた。
> 格下げして訂正する。**流した DOM は**こちらで書いたもの**で、`#author-name` に任意の文字列を
> 入れれば任意の文字列が出るのは当然であり、**そういう DOM が実際に来ることは示していない。**

`extractRedirectEvent` の `name` は
`getRedirectNoticeChannelName(el) || textOf(link) || handleFromChannelUrl(url)`。
`composer` は制御文字と空白を潰すだけで、内容の検査はしない。

**実配信の観測は逆を示している。**[t1-findings.md](t1-findings.md) の通しが成立した回のログは

```
投稿する (auto): @<送信元>さんからリダイレクトありがとうございます! https://www.youtube.com/@<送信元>
```

で、**名前が表示名ではなくハンドルになっている。**つまり `redirectNoticeChannelName` の候補
(`#author-name` / `#channel-name` / `yt-formatted-string#text` / `.channel-name`)は
**実際の通知ノードに 1 つも当たっていない**(当たっていれば表示名か通知文全体が入る)。
落ちた先の `textOf(link)` / `handleFromChannelUrl(url)` が返すのはハンドルで、
**YouTube のハンドルは空白も `/` も `:` も含めない。**

したがって「第三者が任意の文字列を投稿に混ぜる」経路は、**現時点の観測では存在しない。**
残るのは「`redirectNoticeChannelName` は今も `TODO(T1)` 付きの推測で、
YouTube の UI 次第では表示名がそこに入りうる」という**未知の DOM に対する備えの話**。

**対処案(急がない):** 表示名に長さ上限(例 40 文字)を掛け、URL 風のトークン
(`http://` / `https://` / `://`)を落とす。⚠️ **正規のチャンネル表示名は空白を普通に含む**
(`Example Channel`)ので、空白そのものを弾いてはいけない。
T1 で実際の通知 DOM を採るときに、その形に合わせて入れるのが確実。

### S4 (低) `normalizeChannelUrl` が名前どおりに正規化していない(自動経路では起きない)

> **⚠️ 初版では「中」とし「投稿文に任意の URL を混ぜられる」と書いた。格下げして訂正する。**

`safeDecode` はパスから切り出した後に呼ばれるため、**パーセントエンコードで潰していた
空白や区切り文字が復活する。**機構としては本物:

```
normalizeChannelUrl('/@a%20https:%2F%2Fevil.example')
  → 'https://www.youtube.com/@a https://evil.example'   ← 空白と 2 つ目の URL が復活
normalizeChannelUrl('/@%3Cscript%3E')
  → 'https://www.youtube.com/@<script>'
```

**しかし、この `href` を書けるのは YouTube だけ。**自動経路の入力は通知ノード内の
`a[href^="/@"]` 等で、YouTube が生成するチャンネルリンクである。
`safeDecode` が必要なのは**日本語ハンドルが `%E6%97%A5…` の形で来るから**であって、
デコードは 1:1 だから `%20` が空白に戻るには**元のハンドルに空白が入っている**必要がある。
**YouTube のハンドルに空白・`/`・`:` は入らない**ので、正規のリンクからは出てこない。

残る入口は**手動トリガーの入力欄と設定画面の辞書 — どちらも本人が打つ。**自傷であって攻撃経路ではない。

→ セキュリティではなく**正確性**の指摘。実害は「同じチャンネルが表記違いで辞書に二重登録されうる」程度。

**対処案(急がない):** デコード後のハンドルを `[^\s@/?#]{1,40}` で再検証し、
通らなければデコード前の値を使う(または `null` を返す)。

### S5 (中) ドキュメントが manifest と食い違い、`www.youtube.com` でも動くと書いてある

①の事故そのものの話を、**テスターに渡す説明文が古いまま**だった。

- `docs/for-testers.md` §1「何をする拡張か(権限の説明)」→
  「`youtube.com/live_chat` と `studio.youtube.com/live_chat`」と書いてあった。
  この文書は**外部のテスターに「この拡張は何をするか」を説明する唯一の資料**で、
  ~~ZIP の `START-HERE.md` として同梱される。~~

  > **訂正 (2026-08-16 / 004 T10): `docs/for-testers.md` は ZIP に同梱されていない。**
  > [scripts/package.mjs](../scripts/package.mjs) が ZIP に入れるのは **`dist/` の中身と
  > `INSTALL.txt` だけ**で、`START-HERE.md` は存在しない(for-testers.md は別途手渡す /
  > [setup-and-verify.md](setup-and-verify.md) §8)。
  > **したがって「ZIP を展開した人がまず読む文書」は `INSTALL.txt`** であり、
  > 配布物と食い違ってはいけないのはそちら。S5 と同型の食い違いは 004 の
  > `host_permissions` 追加でも起こりうるため、**T10 で `INSTALL.txt` にも許可の説明を入れた。**
- `docs/setup-and-verify.md` §4「動く場所」→ 同上。
  さらに冒頭の警告が「T1 未実施 / セレクタはすべて推測」のままで、現状と合っていなかった。

→ **この点検で修正した。**

### S6 (低) `host_permissions` が必要より広い

`"host_permissions": ["https://studio.youtube.com/*"]`。
background も `fetch` も無く、content script の注入は `content_scripts.matches` が決めるので、
この宣言は実質不要(少なくとも `https://studio.youtube.com/live_chat*` で足りる)。
拡張の権限表示は「入れてもらう」ときの信頼に直結するので、絞っておくほうがよい。

> **⚠️ 前提が変わった (2026-08-15 / [004](../specs/004-comment-link/spec.md) AC17)。**
> 「`fetch` も無いので実質不要」という理由は、**`fetch` を使うようになったことで成り立たなくなった。**
> 004 は `host_permissions` に **`https://www.youtube.com/*` を足す**(下の S10)。
> **`studio.youtube.com` 側を `live_chat*` へ絞る話は S6 のまま残る**(こちらは今も未対応)。

### S7 (低) 呼び名辞書が上限なく増え、`chrome.storage.sync` の上限で保存が黙って失敗する

`rememberSource` はリダイレクトを受けるたびに追記し、削除は手動のみ。
`chrome.storage.sync` は 1 項目 8KB 上限で、1 エントリ 60〜80 バイト程度なので **100 件強で頭打ち**。
超えると `set` が reject するが `guardAsync` が握るため、**コンソールに 1 行出るだけで
以後の登録が保存されない**。件数上限(古い順に切る)か `local` への退避を検討。

**✅ 対応済み (2026-08-14 / [003](../specs/003-per-source-message/spec.md) T1) — `local` へ退避した:**

- 保存先を `chrome.storage.local`(上限 10MB)へ移した。**件数上限は設けていない** —
  `sync` の 8KB と桁が違い、自由文 200 字 × 実用的な件数では問題にならないため。
  古い順に切る案を採らなかったのは、**利用者が手で付けた呼び名を無言で捨てる**ことになるから。
- 移行は **`local` にキーが存在しないときだけ / 1 度きり**(移行済みフラグ
  `ytRedirectPin.directoryMigratedAt`)。**「空配列かどうか」では判定しない** —
  それだと全件削除した次の起動で `sync` の古い辞書が復活し、削除の意図が無言で覆る。
- **フラグは辞書の書き込みが成功した後にだけ立てる。** 失敗時は立てず、次回に再試行する
  (設定画面に再移行の導線が無いため、立ててしまうと二度と引き継げない)。
  逆に**フラグだけ書けなかった場合は `migrated` 扱い** — 辞書は `local` にあり、次回は
  「既に local に辞書がある」で止まるので、「次回再試行する」と出すと事実と食い違う。
- **移行の成否はログに 1 行出す**(無言で失敗すると「辞書が消えた」ようにしか見えない)。
  ログは `migrateDirectoryToLocal` の中で出す — 辞書はチャットと**設定画面の両方**から読まれ、
  `docs/install.md` は設定画面を先に開く導線を書いているので、呼び出し側に任せるとその経路だけ無言になる。
- **`sync` 側のキーは消さない**(片方向コピー)。消すと、まだ移行していない別 PC の Chrome から
  辞書が消えて復元できない。
- **代償: 辞書が端末間で同期されなくなる**(配信は 1 台で回す前提。投稿履歴と同じ判断)。
  利用者から見える挙動の変更なので README / install.md / privacy-policy.md / 公開ページに明記した。
- `onDirectoryChanged` は**実際に使っているエリア名**で絞る(`getLocalStorageAreaName()`)。
  絞らないと別 PC の `sync` 更新で辞書が巻き戻り、`'local'` 決め打ちにすると
  `local` が無い環境へのフォールバック時に変更通知が届かなくなる。
- 回帰テスト: `tests/directory.test.ts`「辞書の保存先の移行 (AC5)」(`chrome.storage` はスタブ)

### S8 (低・情報) 手動トリガー UI がチャット文書に常駐する

`↩ 返礼` ボタンは `position: fixed; z-index: 2147483647` でチャット文書の右下に出る。
**ポップアウトしたチャット窓を OBS で配信画面に載せている場合、そのまま映る。**

**✅ 対応済み (2026-08-06):** 設定「手動トリガーを出す」(`showManualTrigger`) を足し、**既定 OFF** にした。

機能そのものは残す。消すと**テスターが検証できるものが実質無くなる**ため —
[for-testers.md](for-testers.md) のテスト A / A' / C / D / E / F / G / G' は全部このパネル経由で、
自動検知を使うテスト B は「実際にリダイレクトを受けられる場合のみ」(送る側に登録者 1,000 人以上の要件)。
plan.md R1 の「通知形式が変わったときの逃げ道」と、③固定の切り分け経路
([t1-findings.md](t1-findings.md)「切り分けの経路を常設した」)としても要る。

切り替えは `onConfigChanged` で拾って mount / destroy するので、ページの再読み込みは不要。

### S9 (低・情報) 診断ログに第三者のテキストと href が出る

`debug` が ON のとき、`describeNode` が要素のテキスト 200 文字と全 `a[href]` をコンソールへ出す。
ローカルの DevTools 内に留まるが、**ログをそのまま貼って共有すると第三者の識別子が混じる。**
for-testers.md §7 には④の採取について注意書きがあるので、診断ログ側にも同じ注意を足すとよい。

---

### S10 (中・情報) `host_permissions` に `www.youtube.com` を足した (2026-08-15 / 004)

**何のためか**: コメントから取れる投稿者の ID は `UC…` 形だが、辞書の鍵は `@handle` 形で
文字列比較が一致しない。**照合用に `DirectoryEntry.channelId` を埋める**ため、
登録されているチャンネルのページを**1 回だけ取得**して `UC…` を取り出す
([channel-id.ts](../src/channel-id.ts) / 004 AC17)。

**⚠️ 事故 1(`www.youtube.com` で content script が動いた)とは別物。**
混同されやすいので、違いを明示する。

| | 事故 1(2026-08-06) | 今回 (S10) |
|---|---|---|
| 何が起きるか | **他人の配信のチャットを開いているだけで拡張が動いた** | 設定画面が**チャンネルページを 1 回取得する** |
| 仕組み | `content_scripts.matches` に `www` が入っていた(**注入**) | `host_permissions`(**fetch の許可**) |
| いつ動くか | そのページを開いている間ずっと | **人が「コメントに反応する」を ON にしたとき / 再試行を押したとき**だけ |
| 配信中は | 動く(投稿しうる) | **ライブチャットの画面では通信しない** |
| 対象 | 開いた任意のライブチャット | **自分が辞書に登録したチャンネルのページ**だけ |

**注入範囲は 1 つも増えていない。** `content_scripts.matches` は
`https://studio.youtube.com/live_chat*` のまま。
**この点は文書だけでなく [tests/manifest.test.ts](../tests/manifest.test.ts) で機械的に固定した** —
事故 1 の再発防止はこれまで `tests/scope.test.ts`(実行時の判定)と本書の記述だけで、
**manifest の中身そのものを押さえるテストが無かった。**

**残る面**:
- 取得先は利用者が辞書に登録した URL。**登録されていない URL は取りに行かない**
- 取得は `credentials: 'omit'`(ログイン状態を送らない)
- 失敗しても壊れない。`channelId` が空のままになり、**その行はコメント照合の対象外になるだけ**
  (リダイレクト返礼は今までどおり動く / AC17)
- **抽出を間違えると別人に反応する。**チャンネルページには他人の `UC…` が大量に載っているため、
  「最初に見つかった `UC…`」は採らない。**ページ自身を表す metadata(canonical / og:url /
  itemprop / externalId)だけを見て、出所が食い違ったら失敗にする**([channel-id.ts](../src/channel-id.ts))
- **利用者から見た許可表示は変わる。**インストール時に `www.youtube.com` が出るので、
  README / install.md / index.html / for-testers.md / privacy-policy.md と
  **配布 ZIP の `INSTALL.txt`**(`scripts/package.mjs`)に説明を入れる(004 T10)
  → **反映済み (2026-08-16 / T10)。**この表の「事故 1 との違い」を各文書の言葉で書き分けた。
  **privacy-policy.md には「どこへ・いつ・何のために・何を送るか」を書いた** —
  同ポリシーは「ネットワーク通信を一切行いません」と書いていたので、**そのままだと嘘になる**

## 回帰テストの穴

点検時の 102 tests は 2026-08-06 の 3 件をすべて押さえていたが、上の指摘には何も無かった。
S1 / S2 の対応にあわせて追加し、**118 tests** になった。

- ✅ S1: `tests/self-echo.test.ts`(6) + `tests/detector.test.ts`「自分の返礼が固定バナーとして出ても〜」
- ✅ S2: `tests/detector.test.ts`「推測の文言では自動発火させない (S2)」(8)
- ✅ S8: `tests/config.test.ts`「手動トリガーは既定で出さない」
- ➖ S3 / S4: 未カバー。ただし**格下げ済みで、塞ぐべき経路が実在するとは示せていない**(各項参照)。
  テストを足すなら T1 で実際の通知 DOM を採ってからにする(今書くと、また合成 DOM を仕様として固めることになる)

### 副作用として直したもの

`tests/fixtures/live-chat.ts` の `makeRedirectNotice` の既定文言が
`からリダイレクトされました`(**推測**)だったため、S2 の降格でこの fixture を使うテストが 4 件落ちた。
文言を確認済みの `とその視聴者が参加しました` に差し替えた。
実装をテストに合わせて緩めてはいない(tasks.md 補足の「fixture を実装に合わせて歪めない」の逆方向)。

---

## 対応状況

| # | 内容 | 状態 |
|---|---|---|
| S2 | 推測パターンを自動発火から外し、診断ログ専用へ降格 | **✅ 対応済み** |
| S1 | 自己反射の抑止(文言側 + `self-echo.ts`。設定と独立した 30 秒の窓) | **✅ 対応済み** |
| S8 | 手動トリガーを設定制にして既定 OFF | **✅ 対応済み** |
| S5 | ドキュメントの `www.youtube.com` 記述の食い違い | **✅ 対応済み** |
| S3 / S4 | 表示名と `safeDecode` 後の URL の検査 | ➖ **中 → 低に格下げ。**実在する経路とは示せていない。T1 で通知 DOM を採るときに一緒に見る |
| S7 | 辞書を `chrome.storage.local` へ退避(`sync` からは 1 度だけ引き継ぐ) | **✅ 対応済み** (2026-08-14 / 003) |
| S6 | `host_permissions` を `live_chat*` へ絞る | ❌ 未対応(**004 で前提が変わった** → S10) |
| S10 | `host_permissions` に `www.youtube.com` を追加(fetch 用)。**注入範囲は不変で、テストで固定** | ➖ **情報**(2026-08-15 / 004) |
| ①の前提 | 他人の videoId で Studio の live_chat が開けるか(人手・実機) | ❌ 未検証 |
