import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config'

describe('normalizeConfig', () => {
  it('空なら既定を返す', () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it('既定の固定モードは ifEmpty (AC8)', () => {
    expect(DEFAULT_CONFIG.pinMode).toBe('ifEmpty')
  })

  it('有効な値はそのまま通す', () => {
    expect(
      normalizeConfig({
        enabled: false,
        template: '{url}',
        pinMode: 'always',
        cooldownSec: 30,
        showManualTrigger: true,
        debug: true,
      }),
    ).toEqual({
      enabled: false,
      template: '{url}',
      pinMode: 'always',
      cooldownSec: 30,
      showManualTrigger: true,
      debug: true,
    })
  })

  // security-review.md S8: チャット窓を配信画面に載せていると常時映り込むため、
  // 手動トリガーは既定で出さない。
  it('手動トリガーは既定で出さない', () => {
    expect(DEFAULT_CONFIG.showManualTrigger).toBe(false)
    expect(normalizeConfig({}).showManualTrigger).toBe(false)
    expect(normalizeConfig({ showManualTrigger: 'yes' }).showManualTrigger).toBe(false)
  })

  it('診断ログは既定で無効', () => {
    expect(DEFAULT_CONFIG.debug).toBe(false)
    expect(normalizeConfig({ debug: 'yes' }).debug).toBe(false)
  })

  it('未知の pinMode は既定に落とす', () => {
    expect(normalizeConfig({ pinMode: 'sometimes' }).pinMode).toBe(DEFAULT_CONFIG.pinMode)
  })

  it('空テンプレートは既定に落とす', () => {
    expect(normalizeConfig({ template: '   ' }).template).toBe(DEFAULT_CONFIG.template)
  })

  it('不正なクールダウンは既定に落とし、0 は許す', () => {
    expect(normalizeConfig({ cooldownSec: -1 }).cooldownSec).toBe(DEFAULT_CONFIG.cooldownSec)
    expect(normalizeConfig({ cooldownSec: 'abc' }).cooldownSec).toBe(DEFAULT_CONFIG.cooldownSec)
    expect(normalizeConfig({ cooldownSec: 0 }).cooldownSec).toBe(0)
  })
})
