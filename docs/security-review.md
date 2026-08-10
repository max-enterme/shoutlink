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
> 回帰テストを足して 118 tests green。**S6 / S7 は未対応。**
> **S3 / S4 は中 → 低に格下げした**(実在する経路とは示せていないため / 各項の訂正を参照)。

---

## 問題なかった点(確認済み)

| 観点 | 結果 |
|---|---|
| 外部通信 | **無し。**`fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / 動的 `import()` の使用箇所ゼロ。for-testers.md の「外部のサーバーとは通信しません」は正確 |
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
- もうひとつの歯止めは dedupe。ただし**送信元が同一なので効くのはクールダウンの間だけ**で、
  **`cooldownSec = 0` では無効化される**(`cooldown > 0` の条件で抑止ごと外れる)。
- `seen` の WeakSet はノード単位なので、固定のたびに新しいバナー要素が生えれば効かない。

**したがって「固定バナーに `yt-live-chat-text-message-renderer` が含まれない」かつ
「クールダウン 0」なら、投稿 → 固定 → 再検知 → 投稿 … の無限ループになる。**
`docs/for-testers.md` は**テスターに クールダウン `0` を指示している**ので、
この組み合わせは実際に起こりうる。

**対処案(いずれか / 併用):**

1. 固定バナー領域 (`yt-live-chat-banner-manager` 配下) を検知の対象から除外する。
   通知はバナー領域にも出るので「バナー全体を除外」はできないが、
   **自分が投稿した本文と一致するものは除外する**ことはできる。
2. **直近に自分が投稿した本文を覚えておき、それを含む要素は通知とみなさない。**
   自己ループ一般に効く。
3. クールダウン 0 でも最低限のノード単位・本文単位の抑止を残す。

**✅ 対応済み (2026-08-06) — 二重に塞いだ:**

- **文言側:** S2 の降格で `/リダイレクト/` が自動発火から外れた。既定テンプレートの返礼文は
  どの確認済みパターンにも当たらなくなり、**バナーに出ても検知されない。**
  回帰テスト: `tests/detector.test.ts`「自分の返礼が固定バナーとして出ても通知として拾わない (S1)」
- **パイプライン側:** `src/self-echo.ts` を追加。**投稿した送信元を 30 秒覚えておき、
  その間の自動検知イベントを捨てる。**窓の長さは**設定から独立**していて、
  `cooldownSec = 0` でも外れない。手動トリガーは人が明示的に押しているので抑止を受けない。
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
  ZIP の `START-HERE.md` として同梱される。
- `docs/setup-and-verify.md` §4「動く場所」→ 同上。
  さらに冒頭の警告が「T1 未実施 / セレクタはすべて推測」のままで、現状と合っていなかった。

→ **この点検で修正した。**

### S6 (低) `host_permissions` が必要より広い

`"host_permissions": ["https://studio.youtube.com/*"]`。
background も `fetch` も無く、content script の注入は `content_scripts.matches` が決めるので、
この宣言は実質不要(少なくとも `https://studio.youtube.com/live_chat*` で足りる)。
拡張の権限表示は「入れてもらう」ときの信頼に直結するので、絞っておくほうがよい。

### S7 (低) 呼び名辞書が上限なく増え、`chrome.storage.sync` の上限で保存が黙って失敗する

`rememberSource` はリダイレクトを受けるたびに追記し、削除は手動のみ。
`chrome.storage.sync` は 1 項目 8KB 上限で、1 エントリ 60〜80 バイト程度なので **100 件強で頭打ち**。
超えると `set` が reject するが `guardAsync` が握るため、**コンソールに 1 行出るだけで
以後の登録が保存されない**。件数上限(古い順に切る)か `local` への退避を検討。

### S8 (低・情報) 手動トリガー UI がチャット文書に常駐する

`↩ 返礼` ボタンは `position: fixed; z-index: 2147483647` でチャット文書の右下に出る。
**ポップアウトしたチャット窓を OBS で配信画面に載せている場合、そのまま映る。**

**✅ 対応済み (2026-08-06):** 設定「手動トリガーを出す」(`showManualTrigger`) を足し、**既定 OFF** にした。

機能そのものは残す。消すと**テスターが検証できるものが実質無くなる**ため —
[for-testers.md](for-testers.md) のテスト A / A' / B / C / D / E / F は全部このパネル経由で、
自動検知を使うテスト G は「実際にリダイレクトを受けられる場合のみ」(送る側に登録者 1,000 人以上の要件)。
plan.md R1 の「通知形式が変わったときの逃げ道」と、③固定の切り分け経路
([t1-findings.md](t1-findings.md)「切り分けの経路を常設した」)としても要る。

切り替えは `onConfigChanged` で拾って mount / destroy するので、ページの再読み込みは不要。

### S9 (低・情報) 診断ログに第三者のテキストと href が出る

`debug` が ON のとき、`describeNode` が要素のテキスト 200 文字と全 `a[href]` をコンソールへ出す。
ローカルの DevTools 内に留まるが、**ログをそのまま貼って共有すると第三者の識別子が混じる。**
for-testers.md §7 には④の採取について注意書きがあるので、診断ログ側にも同じ注意を足すとよい。

---

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
| S6 / S7 | `host_permissions` を絞る / 辞書に件数上限 | ❌ 未対応 |
| ①の前提 | 他人の videoId で Studio の live_chat が開けるか(人手・実機) | ❌ 未検証 |
