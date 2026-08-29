// ビルドの出力先を 1 か所に決める。
// **worktree で作業していても、拡張の中身は常に本体(メインの作業ツリー)の dist/ に出す。**
//
// ⚠ Chrome の「パッケージ化されていない拡張機能を読み込む」は、**読み込んだフォルダのパスで拡張 ID が決まる。**
//    worktree ごとに dist/ が散ると、その都度 ID が変わって
//    **設定・呼び名の辞書・投稿履歴が引き継がれない**(別の拡張として入る)。
//    さらに古い方を消し忘れると**両方が動いて同じ相手へ 2 回投稿する。**
//    出力先を本体へ固定しておけば、どの worktree でビルドしても
//    Chrome 側は**拡張の ↻ とチャットページの再読み込みだけ**で反映される。
//
// **どのビルドが載っているかは、起動ログの `build`(ビルド時刻)で見分ける。**
// 出力先が 1 つになるぶん、最後にビルドした worktree のものが載っている。
//
// 出力先を変えたいときは環境変数 `SHOUTLINK_DIST_DIR` を置く(CI や、本体を汚したくないとき)。
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** このスクリプトが入っているチェックアウトの root(worktree で走らせれば worktree 側) */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 本体(メインの作業ツリー)の root。
 *
 * `git rev-parse --git-common-dir` は、worktree から呼んでも**本体の `.git`** を指す
 * (本体で呼べば相対の `.git`)。git が無い / リポジトリでない場合は自分のチェックアウトに落とす。
 */
function mainWorktreeRoot() {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (commonDir) return path.dirname(path.resolve(repoRoot, commonDir))
  } catch {
    // git が使えない環境。自分のチェックアウトの下に出す
  }
  return repoRoot
}

/** 拡張の読み込み先。**Chrome に登録するのはここだけ。** */
export const distDir = process.env.SHOUTLINK_DIST_DIR
  ? path.resolve(process.env.SHOUTLINK_DIST_DIR)
  : path.join(mainWorktreeRoot(), 'dist')

/** 出力先が自分のチェックアウトの外にあるか(= worktree から本体の dist/ を上書きしている) */
export const distIsElsewhere = path.resolve(repoRoot, 'dist') !== distDir
