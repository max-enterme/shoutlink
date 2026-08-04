import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildManualEvent, mountManualTrigger, parseManualInput } from '../src/manual-trigger'
import type { RedirectEvent } from '../src/types'
import { FAKE_CHANNEL } from './fixtures/live-chat'

describe('parseManualInput', () => {
  it('完全な URL を受ける', () => {
    expect(parseManualInput(FAKE_CHANNEL.url)).toEqual({
      sourceChannelUrl: FAKE_CHANNEL.url,
      sourceChannelName: FAKE_CHANNEL.handle,
    })
  })

  it('@ハンドルだけでも受ける', () => {
    expect(parseManualInput(' @example-channel ')?.sourceChannelUrl).toBe(FAKE_CHANNEL.url)
  })

  it('チャンネル URL でなければ null', () => {
    expect(parseManualInput('こんにちは')).toBeNull()
    expect(parseManualInput('https://www.youtube.com/watch?v=abc')).toBeNull()
  })
})

describe('buildManualEvent', () => {
  it('自動検知と同じ RedirectEvent を作る(origin だけが違う)', () => {
    expect(buildManualEvent(FAKE_CHANNEL.url, FAKE_CHANNEL.name, 123)).toEqual({
      sourceChannelName: FAKE_CHANNEL.name,
      sourceChannelUrl: FAKE_CHANNEL.url,
      detectedAt: 123,
      origin: 'manual',
    })
  })

  it('表示名が空なら URL から補う', () => {
    expect(buildManualEvent(FAKE_CHANNEL.url, '  ', 0)?.sourceChannelName).toBe(FAKE_CHANNEL.handle)
  })

  it('解釈できない入力は null', () => {
    expect(buildManualEvent('???', '', 0)).toBeNull()
  })
})

describe('mountManualTrigger', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function ui() {
    const host = document.getElementById('yt-redirect-pin-manual-trigger')!
    const shadow = host.shadowRoot!
    return {
      host,
      run: shadow.querySelector<HTMLButtonElement>('.run')!,
      url: shadow.querySelector<HTMLInputElement>('#ytrp-url')!,
      name: shadow.querySelector<HTMLInputElement>('#ytrp-name')!,
      status: shadow.querySelector<HTMLElement>('.status')!,
    }
  }

  it('実行すると自動検知と同じパイプラインへ RedirectEvent を流す', () => {
    const events: RedirectEvent[] = []
    mountManualTrigger({ onTrigger: (e) => void events.push(e), now: () => 7 })

    const { url, name, run } = ui()
    url.value = FAKE_CHANNEL.url
    name.value = FAKE_CHANNEL.name
    run.click()

    expect(events).toEqual([
      {
        sourceChannelName: FAKE_CHANNEL.name,
        sourceChannelUrl: FAKE_CHANNEL.url,
        detectedAt: 7,
        origin: 'manual',
      },
    ])
  })

  it('解釈できない入力では発火せず、UI にだけ出す', () => {
    const onTrigger = vi.fn()
    mountManualTrigger({ onTrigger })

    const { url, run, status } = ui()
    url.value = 'not a channel'
    run.click()

    expect(onTrigger).not.toHaveBeenCalled()
    expect(status.textContent).toContain('解釈できない')
  })

  it('destroy で DOM から消える', () => {
    const handle = mountManualTrigger({ onTrigger: () => {} })
    handle.destroy()
    expect(document.getElementById('yt-redirect-pin-manual-trigger')).toBeNull()
  })
})
