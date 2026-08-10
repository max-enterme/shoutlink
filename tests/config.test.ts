import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, isActionAllowed, normalizeConfig } from '../src/config'

/**
 * ここは**公開ドキュメントの主張を固定するテスト**。
 * README / docs/install.md / docs/index.html は「『有効にする』を外しても
 * 手動の『↩ 返礼』からは実行できる」と説明している。これが崩れたら文書が嘘になる。
 */
describe('isActionAllowed (AC7)', () => {
  it('有効なら自動も手動も通す', () => {
    expect(isActionAllowed(true, 'auto')).toBe(true)
    expect(isActionAllowed(true, 'manual')).toBe(true)
  })

  it('無効なら自動検知は止まる', () => {
    expect(isActionAllowed(false, 'auto')).toBe(false)
  })

  it('無効でも手動トリガーは通る', () => {
    expect(isActionAllowed(false, 'manual')).toBe(true)
  })

  it('origin が無いものは自動として扱う (安全側に倒す)', () => {
    expect(isActionAllowed(false, undefined)).toBe(false)
    expect(isActionAllowed(true, undefined)).toBe(true)
  })
})

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
        debug: true,
      }),
    ).toEqual({
      enabled: false,
      template: '{url}',
      pinMode: 'always',
      cooldownSec: 30,
      debug: true,
    })
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
