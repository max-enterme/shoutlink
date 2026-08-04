/**
 * 配線。検知(自動 / 手動)→ 文面生成 → 投稿 → 固定。
 * 全体を try/catch で包み、どこで失敗しても配信に影響させない (AC6)。
 */
import { compose } from './composer'
import { DEFAULT_CONFIG, loadConfig, onConfigChanged } from './config'
import { createDedupe } from './dedupe'
import { startRedirectDetector } from './detector'
import { guardAsync, log } from './log'
import { mountManualTrigger } from './manual-trigger'
import { pin } from './pinner'
import { postMessage } from './poster'
import type { Config, RedirectEvent } from './types'

async function main(): Promise<void> {
  let config: Config = await guardAsync('設定の読み込み', loadConfig, { ...DEFAULT_CONFIG })
  const dedupe = createDedupe(config.cooldownSec)

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

    const text = compose(config.template, event)
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

  const detector = startRedirectDetector({ onEvent: safeHandle })
  detector.scanExisting()

  // 手動トリガーは常設。自動検知が成立しない場合でも投稿 → 固定を通せる。
  mountManualTrigger({ onTrigger: safeHandle })

  log.info('起動した', location.href)
}

void main().catch((err) => log.error('起動に失敗した:', err))
