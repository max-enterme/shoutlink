---
feature: docs-by-reader
test: npm run typecheck && npm test && npm run check-links
---

# 実装計画 — 008 文書を読者別に整理する

## アプローチ
既存の Node 標準のみの検査を拡張してから文書を移す。追加の参照検査は docs 内の md を指す具体的なパスに限定する。ソース一般のファイル参照や過去の未実装コードまで検査範囲を広げない。
CLI の第1引数、exit code、診断形式、README 起点の到達検査は維持する。テストは005の createFixtureRoot / runCheckLinks による子プロセス方式を使う。新しい実行時依存や型定義の追加はない。

## 変更点
| 対象(ファイル / 関数) | 変更 |
|---|---|
| scripts/check-links.mjs: extractMdLinks / checkMdFile / checkLink | Markdown リンク検査に裸パス抽出を追加。checkLink の実在・アンカー・大小文字検査を再利用する |
| scripts/check-links.mjs: listDocsMdRecursive と末尾の走査 | specs の md、src / tests の ts、scripts の js / mjs、CHANGELOG.md、.github の yml / yaml を走査。これらの追加ファイルでは解決先が docs 内の md の参照だけを検査する。.github以外の隠しディレクトリと node_modules は走査しない |
| scripts/check-links.mjs: reachableFromReadme / addEdge | 到達性に数えるのは README と docs の Markdown リンクのみ。裸パス・src/tests/specs の参照を孤立救済に使わない |
| tests/check-links.test.ts: createFixtureRoot / runCheckLinks | 追加範囲、裸パス、除外の局所性、既存4種の回帰をフィクスチャで固定。意図的な不在文字列は行限定マーカーで説明する |
| src/composer.ts: MAX_MESSAGE_LENGTH のコメント(L15) | 存在しない003調査記録パスの案内だけ削除する |
| specs/003-per-source-message/tasks.md、specs/005-docs-link-hygiene/spec.md / plan.md | 過去の未作成予定・不在説明の行へ除外理由だけ加える。受け入れ条件と完了状態は変えない |
| README.md: 開発ドキュメント表と docs 参照 | 読者3区分と全mdへの導線に再構成し、移動先のパスとアンカーへ更新 |
| docs 配下の10本 / docs/index.html / specs の既存参照 / tests/docs.test.ts | 下の配置表に沿って移動、参照更新。docs.test.ts の履歴資料除外キーも移動先へ変える |

## 新規インターフェース
外部API・設定・画面の追加はない。検査内部のデータは次とする（JSDocで表し、TypeScriptの公開型は追加しない）。
- `extractDocReferences(absPath: string, kind: 'markdown' | 'source'): Array<{raw: string, lineNo: number, base: 'root' | 'source', syntax: 'markdown' | 'bare' | 'url'}>` を追加する。sourceはts/js/mjs/yml/yamlで、フェンス除外なしにコメントと文字列を走査する。
- 抽出順はMarkdownリンク、残りから裸のhttp(s) URL全体、残りから裸パスとする。Markdownリンク・URLの抽出範囲は後続の裸パス抽出から除き、重複診断や外部URL内部の誤検出を防ぐ。URLは末尾の引用符・空白・閉じ括弧を含めず、URL全体を既存 checkLink / reduceAbsoluteUrl に渡す。自repo blob/mainとPagesのdocs md URLを実在検査し、他repo/他サイトのURLは従来どおり対象外にする。たとえば .github/ISSUE_TEMPLATE/config.yml のurl値はMarkdown記法がなくても検査する。
- 裸パスは具体的な `docs/<名前>.md`（配下ディレクトリ可、任意の `#アンカー` / `:行番号` を後置可）を対象にする。`*` / `?` を含むパターン、URL内で重複して現れるパス、抽出済みMarkdownリンク内の重複は対象外。ルート表記は root 基準、`./docs` / `../docs` のような相対表記は参照元基準で解決する。裸の行番号接尾辞は実在検査前に外す。
- Markdown は既存 isFenceLine でコードフェンス内を除く。TypeScript はコメントと文字列の両方を走査する。正規表現のサンプルと glob は具体的パスとして扱わない。ソースの引用文字列・バッククォート・句読点をパス終端に含めない。
- 局所除外は md の `<!-- check-links:ignore-next <完全一致raw> -- <理由> -->`、ts/js/mjs の `// check-links:ignore-next <完全一致raw> -- <理由>`、yml/yaml の `# check-links:ignore-next <完全一致raw> -- <理由>`。直後の物理1行で、そのrawに一致する候補だけを除外する。同じ行の他のパス・後続行には効かない。空理由・不正形式・直後に一致候補のないマーカーは違反とする。フェンス内のマーカーには効力を持たせない。マーカー行自体を参照として抽出しない。
- `checkLink` の ctx に `trackGraph` を従来どおり渡し、裸パスと追加範囲は false にする。診断には参照元の相対パスと1始まりの行番号を出す。

## 配置と重複の扱い
この表の移動先は実装時に作る予定であり、現時点では未作成。
文書の basename を保持し、3つのディレクトリに分ける。固定URLの2本は直下に残し、README の読者区分に載せる。

```text
docs/install.md          -> docs/users/install.md
docs/setup-and-verify.md -> docs/developers/setup-and-verify.md
docs/for-testers.md      -> docs/testers/for-testers.md
docs/d3-automation-policy.md -> docs/developers/d3-automation-policy.md
docs/security-review.md     -> docs/developers/security-review.md
docs/stability-research.md  -> docs/developers/stability-research.md
docs/t1-findings.md         -> docs/developers/t1-findings.md
docs/004-t1-collect.md      -> docs/developers/004-t1-collect.md
docs/privacy-policy.md     -> 配置を維持（利用者向け）
docs/store-submission.md   -> 配置を維持（開発者向け）
```

- install の一般導入・設定・切り分けを正本にする。setup-and-verify の「2. Chromeへ読み込む」「3.設定」は開発ビルドの dist 指定と利用者手順へのリンクに絞る。ソースの地図、ビルド、DOM採取、配布・提出手順、既知の制約を残す。
- for-testers の「3.インストール」「4.設定を開く」は配布ZIP固有の手順と install へのリンクに絞る。用意するもの、テストA〜H、ログ採取、報告テンプレート、終了時の削除を残す。既存のテスト名・見出しアンカーは保持する。
- install の ZIP導入は tester/developer 手順へのリンクを付け、利用者へビルド作業を要求しない。安全・権限・未検証の注意は利用者・テスターが単独でも読める場所に残す。
- 旧パスの参照は repo 全体を検索して更新する。仕様書はパス・リンクラベルだけを置換し、履歴本文の内容やチェック状態は変えない。旧パスの互換コピーは作らない。画像への相対パスは階層増加分だけ更新する。
- docs/store-submission.md のURLは変更しない。docs/index.html はHTML構造・文言・assetsを変更せず、移動したmdへの blob/main URL があればパスだけ置換する。privacy-policy のパスは変えない。

## 採らない案
- サイトジェネレータ: 決定済みの不導入方針に反し、公開URLとビルド工程を増やす。
- 全種類の裸パスを検査: 過去の未実装コードや外部repoの記述まで巻き込み、今回の文書移動の安全性から外れる。
- src/tests をコメントだけ検査: tests/docs.test.ts の実際のパス文字列を見逃す。
- 移動を先に行う / 旧ファイルの全文コピーを残す: 前者は裸参照の取り残しを検出できず、後者は同じ説明の正本が二重になる。
- 不在パスをファイル単位で無視: 同じファイルに新たな参照切れが入っても見逃す。完全一致・1行限定を採る。

## テスト
- 拡張範囲の不在参照・裸パス・アンカー・大小文字違いは非0と参照元行を返す。正しい参照は0を返す。
- 同じ不在パスでもマーカー直後以外は違反にする。別のパス、空理由、未使用マーカーも違反にする。
- Markdownフェンスとglobは検査外。裸パスだけで docs の孤立を解消できない。
- 既存005の相対リンク・自repo URL・アンカー・孤立のテストを保つ。
- yamlやソースに裸で書かれた自repo URLも検査する。移動後の旧URLは非0、現在の正しいURLは0、他repoの同じdocsパスは対象外になる。
- B1 の実repo検査が移動前に成功する。B2 で全mdが README から到達でき、旧パスをフィクスチャに残すと失敗する。
- 固定URL群・privacy-policy と index.html の配置を維持し、docs.test.ts の否定検査が移動後も有効になる。

## テストケース
| テスト名 | 置き場(ファイル) | 入力・前提 | 期待値 |
|---|---|---|---|
| expanded sources | tests/check-links.test.ts | specs md、src ts、tests ts に各々不在docs参照を置く | 各々exit 1、source:lineと対象パス |
| bare URLs | tests/check-links.test.ts | yamlの自repo blob/main・Pages URL、srcの同URL、他repoのURL。移動先だけ存在するfixtureで旧URLを残す | 正しい自repo URLは0、旧URLは1で参照元行を出す。他repo URLは検査外。Markdown URLとその内部パスは二重診断しない |
| bare paths | tests/check-links.test.ts | README/docs/specs/src/testsの各々に裸パス、存在するmdとアンカー、行番号接尾辞 | 不在は1、存在は0。大小文字違いと不在アンカーは1 |
| local ignore | tests/check-links.test.ts | マーカーと次行、同じ行の別パス、2行後の同じパス、空理由、未使用 | 指定した次行の対象だけ除外、それ以外は1 |
| fence and glob | tests/check-links.test.ts | mdフェンス内の不在パスとdocsのglob | 違反なし。フェンス外の具体的パスは1 |
| orphan remains | tests/check-links.test.ts | READMEは裸パスだけ、docsに対象md | 孤立で1 |
| relocated links | tests/check-links.test.ts | 3ディレクトリのmdとREADMEリンク、旧パスを参照するsrc | 正例0、旧パス残存で1 |
| fixed public targets | tests/check-links.test.ts | 実repoのstore-submission内URL集合とprivacy-policy/index.htmlの存在 | 事前に固定したURL集合と一致し2ファイルが存在 |
| history exclusions | tests/docs.test.ts | 移動後のt1-findings除外キーと全docs glob | 従来の否定検査が成功。移動後の一般文書に禁止語を加えたfixtureは検出 |

## 実装ブロック
| ブロック | 対象タスク | 触るファイル | 確認コマンド |
|---|---|---|---|
| B1 | T1 | scripts/check-links.mjs、tests/check-links.test.ts、src/composer.ts、specs/003-per-source-message/tasks.md、specs/005-docs-link-hygiene/spec.md、specs/005-docs-link-hygiene/plan.md | npm run typecheck && npm test && npm run check-links |
| B2 | T2 | README.md、docs内の配置表の移動元・移動先10本、docs/index.html、tests/docs.test.ts、tests/check-links.test.ts、下記の参照更新対象 | npm run typecheck && npm test && npm run check-links |

両ブロックとも specs/008-docs-by-reader/spec.md / tasks.md の状態・完了欄だけは進捗更新できる。B2の個別参照更新対象は調査結果を下に列挙する。ここにない対象の書換えが必要なら、対象と理由を記録して実装を止める。

B2でパス更新のみ許可する追加ファイル:
```text
CHANGELOG.md
.github/workflows/release.yml
.github/ISSUE_TEMPLATE/config.yml
scripts/check-links.mjs
scripts/package-store.mjs
scripts/t1-comment-probe.js
src/types.ts
src/comment-detector.ts
src/config.ts
src/directory.ts
tests/comment-detector.test.ts
tests/config.test.ts
tests/fixtures/live-chat.ts
tests/manifest.test.ts
tests/options-dom.test.ts
specs/001-redirect-pin/spec.md
specs/001-redirect-pin/plan.md
specs/001-redirect-pin/tasks.md
specs/002-i18n/spec.md
specs/003-per-source-message/spec.md
specs/003-per-source-message/tasks.md
specs/004-comment-link/spec.md
specs/004-comment-link/plan.md
specs/004-comment-link/tasks.md
specs/005-docs-link-hygiene/spec.md
specs/005-docs-link-hygiene/plan.md
specs/005-docs-link-hygiene/tasks.md
specs/006-reply-guard-and-test-send/spec.md
specs/006-reply-guard-and-test-send/plan.md
specs/006-reply-guard-and-test-send/tasks.md
specs/007-options-ui-tabs/plan.md
specs/007-options-ui-tabs/tasks.md
```
新しい検査を避けるためにリンクをフェンスへ移したり、現用参照へ除外マーカーを付けたりしない。008自身の将来配置表・参照更新許可リストはフェンス内の計画記録なので検査外である。実装による移動後も、008の説明を過去の記録として保持する。

## 依存 / 前提
005 が完了していること。基準は origin/main 36a933e。B2 は B1 が集約ブランチに統合され、移動前の合否コマンドが緑になってから着手する。
package.jsonのtestは `vitest run` なので、確定済みの `npm test` はwatchせず1回で終了する。

## リスク / 降りる箇所
- 公開push、GitHub issue/PR作成、mainへのマージ、Pages本番反映の前で止め、対象と検査結果を示して MAX の許可を得る。
- 固定URLの変更や資料の意味変更が必要になったら、編集せず理由と案を人の判断タスクに記録する。
- 今回の文書整理と検査に実配信・実機の操作は含まれない。
