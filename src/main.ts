/**
 * 配線。検知(自動 / 手動)→ 文面生成 → 投稿 → 固定。
 * 全体を try/catch で包み、どこで失敗しても配信に影響させない (AC6)。
 */
import { compose } from './composer'
import { REDIRECT_TEXT_PATTERNS, getChatMessages, getMessageText } from './selectors'
import { DEFAULT_CONFIG, loadConfig, onConfigChanged } from './config'
import { createDedupe } from './dedupe'
import {
  findEntry,
  loadDirectory,
  onDirectoryChanged,
  rememberSource,
  resolveDisplayName,
  saveDirectory,
} from './directory'
import type { Directory } from './directory'
import { startRedirectDetector } from './detector'
import { guardAsync, log } from './log'
import { mountManualTrigger } from './manual-trigger'
import { pin } from './pinner'
import { postMessage } from './poster'
import type { Config, RedirectEvent } from './types'

/** ビルド時刻。esbuild の define で埋める(どのビルドが読み込まれているかの判別用) */
declare const __BUILD_TIME__: string

async function main(): Promise<void> {
  let config: Config = await guardAsync('設定の読み込み', loadConfig, { ...DEFAULT_CONFIG })
  let directory: Directory = await guardAsync('呼び名辞書の読み込み', loadDirectory, [])
  const dedupe = createDedupe(config.cooldownSec)

  onDirectoryChanged((next) => {
    directory = next
  })

  onConfigChanged((next) => {
    config = next
    dedupe.setCooldownSec(next.cooldownSec)
    log.info('設定を更新した', next)
  })

  /**
   * 自動検知・手動トリガーの共通パイプライン。
   * 手動トリガーは検知を飛ばすだけで、以降は自動検知とまったく同じ経路を通る。
   */
  const handle = async (event: RedirectEvent): Promise<void> => {
    // リダイレクトしてきた相手は、**投稿の可否に関わらず**辞書に載せる。
    // 無効化中でも「誰が来たか」は残しておきたいため。呼び名は後から人が付ける。
    if (!findEntry(directory, event.sourceChannelUrl)) {
      log.info('辞書に登録した:', event.sourceChannelUrl)
    }
    directory = rememberSource(directory, event)
    void guardAsync('呼び名辞書の保存', () => saveDirectory(directory), undefined)

    // AC7: 無効化されていれば何もしない
    if (!config.enabled) {
      log.info('無効化されているため何もしない', event.sourceChannelUrl)
      return
    }
    // AC4: 同一送信元・クールダウン内の多重発火を抑止
    if (!dedupe.tryAcquire(event)) {
      log.info('クールダウン中のためスキップ', event.sourceChannelUrl)
      return
    }

    // 辞書に呼び名があればそれを使う。無ければ検知した表示名のまま
    const named = { ...event, sourceChannelName: resolveDisplayName(directory, event) }
    const text = compose(config.template, named)
    log.info(`投稿する (${event.origin ?? 'auto'}):`, text)

    const posted = await postMessage(text)
    if (posted.status !== 'posted') {
      log.warn('投稿に失敗した:', posted.reason)
      return
    }
    if (!posted.element) return

    const result = await pin(posted.element, config.pinMode)
    log.info('固定結果:', result)
  }

  const safeHandle = (event: RedirectEvent): void => {
    void guardAsync<void>('パイプライン', () => handle(event), undefined)
  }

  const detector = startRedirectDetector({ onEvent: safeHandle, debug: () => config.debug })
  detector.scanExisting()

  /**
   * 切り分け用: 投稿せずに固定だけを試す。
   * チャットの**最後のメッセージ**を対象に、設定に関わらず `always` で固定を試みる。
   * ③ が単独で動くかを ①② と切り離して確認するための経路。
   */
  const pinTest = async (): Promise<string> => {
    const messages = getChatMessages(document)
    const target = messages[messages.length - 1]
    if (!target) {
      log.warn('固定テスト: 対象のメッセージが見つからない')
      return 'メッセージが見つからない'
    }
    log.info('固定テスト: 対象 =', getMessageText(target).slice(0, 40))
    const result = await pin(target, 'always')
    log.info('固定テスト: 結果 =', result)
    return result
  }

  // 手動トリガーは常設。自動検知が成立しない場合でも投稿 → 固定を通せる。
  mountManualTrigger({
    onTrigger: safeHandle,
    onPinTest: () => guardAsync('固定テスト', pinTest, 'エラー'),
  })

  // 「どのビルドが・どの設定で動いているか」を 1 行で分かるようにする。
  // 拡張の ↻ 忘れ / ページのリロード忘れ / 診断ログの入れ忘れを、ログだけで切り分けるため。
  log.info('起動した', {
    build: __BUILD_TIME__,
    enabled: config.enabled,
    debug: config.debug,
    pinMode: config.pinMode,
    cooldownSec: config.cooldownSec,
    patterns: REDIRECT_TEXT_PATTERNS.length,
    url: location.href,
  })
}

void main().catch((err) => log.error('起動に失敗した:', err))
