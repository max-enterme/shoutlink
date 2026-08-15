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
        showManualTrigger: true,
        debug: true,
        commentReplyEnabled: true,
        commentTemplate: '{name} {url}',
      }),
    ).toEqual({
      enabled: false,
      template: '{url}',
      pinMode: 'always',
      cooldownSec: 30,
      showManualTrigger: true,
      debug: true,
      commentReplyEnabled: true,
      commentTemplate: '{name} {url}',
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
  // --- 004: コメント返し ---------------------------------------------------

  it('commentReplyEnabled は既定 OFF (004 / AC1)', () => {
    expect(DEFAULT_CONFIG.commentReplyEnabled).toBe(false)
    expect(normalizeConfig({}).commentReplyEnabled).toBe(false)
  })

  it('commentReplyEnabled が真偽値でなければ既定 (false) に倒す (AC14)', () => {
    for (const value of ['true', 1, null, {}, []]) {
      expect(normalizeConfig({ commentReplyEnabled: value }).commentReplyEnabled).toBe(false)
    }
  })

  it('commentReplyEnabled の true はそのまま通す', () => {
    expect(normalizeConfig({ commentReplyEnabled: true }).commentReplyEnabled).toBe(true)
  })

  it('commentTemplate の既定は {name} と {url} を持ち、リダイレクト返礼と別物 (AC5)', () => {
    expect(DEFAULT_CONFIG.commentTemplate).toContain('{name}')
    expect(DEFAULT_CONFIG.commentTemplate).toContain('{url}')
    expect(DEFAULT_CONFIG.commentTemplate).not.toBe(DEFAULT_CONFIG.template)
    // 文面が嘘にならないこと(「リダイレクト」はコメント返しには出てこない)
    expect(DEFAULT_CONFIG.commentTemplate).not.toContain('リダイレクト')
  })

  it('空・非文字列の commentTemplate は既定に落とす (AC14)', () => {
    expect(normalizeConfig({ commentTemplate: '   ' }).commentTemplate).toBe(
      DEFAULT_CONFIG.commentTemplate,
    )
    expect(normalizeConfig({ commentTemplate: 42 }).commentTemplate).toBe(
      DEFAULT_CONFIG.commentTemplate,
    )
  })

  it('004 の設定を足しても 001 の既定は変わらない (AC15)', () => {
    expect(DEFAULT_CONFIG.enabled).toBe(true)
    expect(DEFAULT_CONFIG.pinMode).toBe('ifEmpty')
    expect(DEFAULT_CONFIG.showManualTrigger).toBe(false)
    expect(DEFAULT_CONFIG.cooldownSec).toBe(6 * 60 * 60)
  })
})
