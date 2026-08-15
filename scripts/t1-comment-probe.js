/*
 * yt-redirect-pin — 004 T1 採取スニペット(ブラウザの DevTools コンソールに貼る)
 *
 * ⚠️ **node スクリプトではない。**`scripts/` の他のファイル (*.mjs) はビルド用で、これだけは
 *    ブラウザのコンソールに貼って使う。手順は docs/004-t1-collect.md。
 *
 * 採るのは 3 点(004 tasks.md T1 / #25):
 *   ① コメント要素から投稿者のチャンネルが取れるか
 *   ② 取れる形が `@handle` / `UC…` のどちらで、辞書の鍵(`normalizeChannelUrl` の出力)と
 *      同じ正規形になるか
 *   ③ 配信者自身の投稿を見分ける手掛かりと、メッセージのタイムスタンプが取れるか
 *
 * **読み取りしかしない。**投稿もクリックもメニュー操作もしない。
 *
 * ⚠️ **出力は既定で匿名化する。**ハンドル・表示名・チャンネル ID・本文は伏せ、
 *    「取れたか / どの形か / 何文字か」だけを出す。この repo は public で、
 *    docs/t1-findings.md も「構造だけを記録する」方針で書かれている。
 *    生の値を見たいときだけ `YTRP.raw(i)`(**出力を貼らないこと**)。
 *
 * ⚠️ **ワールドの区別が本題。**コンソールはページと同じ「メインワールド」で動くが、
 *    content script は「隔離ワールド」で動く。**DOM の属性・href・テキストは両方から見えるが、
 *    ページの JS が要素に付けたプロパティ(Polymer の `__data` 等)は隔離ワールドからは見えない。**
 *    したがって「コンソールで取れた」は「拡張から取れる」を意味しない。
 *    出力の `世界` 列が `DOM` のものだけが、今の構成の content script で使える。
 */
;(() => {
  const YOUTUBE_ORIGIN = 'https://www.youtube.com'

  // --- src/detector.ts の normalizeChannelUrl の写し ------------------------
  // **実装と同じ判定にするための写しであって、独自の規則を作らない。**
  // src 側を変えたらここも合わせる(採取結果の意味が変わるため)。
  const safeDecode = (value) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  const normalizeChannelUrl = (raw) => {
    if (!raw) return null
    const input = String(raw).trim()
    if (!input) return null
    if (/^@[^\s@/?#]{1,40}$/u.test(input)) return `${YOUTUBE_ORIGIN}/${input}`
    let url
    try {
      url = new URL(input, YOUTUBE_ORIGIN)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null
    const handle = url.pathname.match(/^\/(@[^\s/?#]{1,40})/u)
    if (handle) return `${YOUTUBE_ORIGIN}/${safeDecode(handle[1])}`
    const channel = url.pathname.match(/^\/channel\/(UC[\w-]{20,})/)
    if (channel) return `${YOUTUBE_ORIGIN}/channel/${channel[1]}`
    const legacy = url.pathname.match(/^\/(c|user)\/([\w.\-]+)/)
    if (legacy) return `${YOUTUBE_ORIGIN}/${legacy[1]}/${legacy[2]}`
    return null
  }

  /** 正規形がどちらの鍵の形か。辞書の鍵は実配信の観測では `@handle` 側 */
  const keyShape = (normalized) => {
    if (!normalized) return 'なし'
    if (/\/@/.test(normalized)) return '@handle'
    if (/\/channel\/UC/.test(normalized)) return 'UC…'
    if (/\/(c|user)\//.test(normalized)) return 'c/user(旧)'
    return '不明'
  }

  // --- 匿名化 ---------------------------------------------------------------
  const isAscii = (s) => /^[\x20-\x7e]*$/.test(s)

  /** 値を「形と長さ」だけにする。**生の文字は出さない** */
  const mask = (value) => {
    if (value == null) return null
    const s = String(value)
    if (!s) return '(空)'
    const uc = s.match(/UC[\w-]{20,}/)
    if (uc) return `UC…(${uc[0].length}字)`
    const at = s.match(/@[^\s@/?#]{1,40}/u)
    if (at) return `@…(${Array.from(at[0]).length - 1}字/${isAscii(at[0]) ? 'ASCII' : '非ASCII'})`
    return `(${Array.from(s).length}字/${isAscii(s) ? 'ASCII' : '非ASCII'})`
  }

  /** href は「パスの形」だけを出す(`/@…` `/channel/UC…` の判別が目的) */
  const maskHref = (href) => {
    if (!href) return null
    let path = String(href)
    try {
      path = new URL(path, location.href).pathname
    } catch {
      /* 相対でも絶対でもない値はそのまま形だけ見る */
    }
    if (/^\/@/.test(path)) return '/@…'
    if (/^\/channel\/UC/.test(path)) return '/channel/UC…'
    if (/^\/(c|user)\//.test(path)) return '/c|user/…'
    return path.replace(/[^/]+/g, '…')
  }

  /** 値をそのまま出してよい属性(列挙値・真偽値だけ。識別子を含みうるものは伏せる) */
  const SAFE_ATTR = /^(author-type|is-[a-z-]+|has-[a-z-]+|hidden|disable-upgrade|role|aria-label|type|show-[a-z-]+|whitespace)$/

  // --- チャット項目の取得 ---------------------------------------------------
  const ITEM_LIST_SELECTORS = [
    'yt-live-chat-item-list-renderer #items',
    '#chat #items',
    '#items.yt-live-chat-item-list-renderer',
    '#item-scroller #items',
  ]

  const getItemList = () => {
    for (const sel of ITEM_LIST_SELECTORS) {
      const found = document.querySelector(sel)
      if (found) return { el: found, selector: sel }
    }
    return { el: null, selector: null }
  }

  // --- ページ側(メインワールド)のプロパティ探索 ---------------------------
  /**
   * Polymer が要素に載せているデータ。**content script(隔離ワールド)からは見えない。**
   * どこに載っているかは版で変わるので、候補を順に見る。
   */
  const getPolymerData = (el) => {
    const candidates = [
      ['__data.data', () => el.__data && el.__data.data],
      ['__data', () => el.__data],
      ['data', () => el.data],
      ['polymerController.data', () => el.polymerController && el.polymerController.data],
      ['__dataHost.data', () => el.__dataHost && el.__dataHost.data],
    ]
    for (const [path, get] of candidates) {
      let value
      try {
        value = get()
      } catch {
        continue
      }
      if (value && typeof value === 'object') return { path, value }
    }
    return { path: null, value: null }
  }

  /** データの中から「チャンネル・タイムスタンプらしいキー」を深さ制限つきで拾う */
  const findKeys = (obj, pattern, depth = 0, seen = new Set(), prefix = '') => {
    const out = []
    if (!obj || typeof obj !== 'object' || depth > 3 || seen.has(obj)) return out
    seen.add(obj)
    for (const key of Object.keys(obj)) {
      let value
      try {
        value = obj[key]
      } catch {
        continue
      }
      const path = prefix ? `${prefix}.${key}` : key
      if (pattern.test(key) && (typeof value === 'string' || typeof value === 'number')) {
        out.push({ path, value })
      }
      if (value && typeof value === 'object') {
        out.push(...findKeys(value, pattern, depth + 1, seen, path))
      }
    }
    return out
  }

  /**
   * **キー名ではなく「値の形」で探す。**
   *
   * ⚠️ 2026-08-14 の初回採取での取りこぼし: キー名を `channel|author.*id|externalId` で
   *    探していたため、**ハンドルが入りうるキー(`canonicalBaseUrl` 等)を最初から見ていなかった。**
   *    「UC しか無い」と結論しかけたが、それは**探していないだけ**だった可能性がある。
   *    ここは `@ハンドル` らしい**値**を、キー名に関係なく拾う。
   */
  const findHandleValues = (obj, depth = 0, seen = new Set(), prefix = '') => {
    const out = []
    if (!obj || typeof obj !== 'object' || depth > 5 || seen.has(obj)) return out
    seen.add(obj)
    for (const key of Object.keys(obj)) {
      let value
      try {
        value = obj[key]
      } catch {
        continue
      }
      const path = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'string' && /(^|\/)@[^\s/?#]{1,40}$/u.test(value.trim())) {
        out.push({ path, value: mask(value), 正規形: keyShape(normalizeChannelUrl(value.trim())) })
      }
      if (value && typeof value === 'object') {
        out.push(...findHandleValues(value, depth + 1, seen, path))
      }
    }
    return out
  }

  // --- `whole-message-clickable`(DOM 属性)から投稿者を取り出す ------------
  //
  // 2026-08-15 に Elements で発見: メッセージ要素の **DOM 属性** `whole-message-clickable` に
  // `liveChatItemContextMenuEndpoint.params` が入っており、**base64 を 2 回**解くと
  // protobuf が出てくる。中には **UC が 2 つ**ある:
  //   - {チャンネルID, 動画ID} … 動画とセットなので**配信の持ち主**
  //   - {チャンネルID}         … **投稿者**
  // **DOM 属性なので content script(隔離ワールド)から読める。**
  //
  // ⚠️ **これは公開された仕様ではない。**フィールド番号や順序が変わればいつでも壊れる。
  //    そのため「2 つ目を採る」のような位置頼みにせず、**動画 ID と隣り合っているほうを
  //    配信者として除外する**(`v=` と突き合わせられるので、位置が変わっても効く)。

  /** 現在の配信の動画 ID(ポップアウトの `v=`)。切り分けの基準に使う */
  const currentVideoId = () => {
    try {
      return new URL(location.href).searchParams.get('v') || ''
    } catch {
      return ''
    }
  }

  const decodeBase64 = (value) => {
    try {
      const s = decodeURIComponent(String(value)).replace(/-/g, '+').replace(/_/g, '/')
      return atob(s + '='.repeat((4 - (s.length % 4)) % 4))
    } catch {
      return ''
    }
  }

  /**
   * DOM 属性から投稿者のチャンネル ID を取り出す。
   * **切り分けられなければ null を返す**(推測しない)。
   */
  const authorIdFromDom = (el) => {
    const raw = el.getAttribute('whole-message-clickable')
    if (!raw) return { status: '属性なし', id: null, count: 0 }
    let json
    try {
      json = JSON.parse(raw)
    } catch {
      return { status: 'JSONでない', id: null, count: 0 }
    }
    const params = json?.liveChatItemContextMenuEndpoint?.params
    if (!params) return { status: 'paramsなし', id: null, count: 0 }

    const blob = decodeBase64(decodeBase64(params))
    if (!blob) return { status: 'デコード失敗', id: null, count: 0 }

    const found = []
    const re = /UC[A-Za-z0-9_-]{22}/g
    let m
    while ((m = re.exec(blob)) != null) found.push({ id: m[0], at: m.index })
    if (found.length === 0) return { status: 'UCなし', id: null, count: 0 }

    // **動画 ID と隣り合っている ID は配信の持ち主**なので投稿者ではない
    const videoId = currentVideoId()
    const isOwner = (hit) =>
      !!videoId && blob.slice(hit.at + 24, hit.at + 24 + 20).includes(videoId)

    const others = found.filter((hit) => !isOwner(hit))
    // 配信者自身の投稿では全部が「持ち主」になる。その場合の投稿者は持ち主自身
    const picked = others.length > 0 ? others[others.length - 1] : found[found.length - 1]
    const distinct = new Set(others.map((h) => h.id))
    if (distinct.size > 1) return { status: '候補が複数', id: null, count: found.length }
    return { status: '取れた', id: picked.id, count: found.length }
  }

  // --- 1 件のメッセージを調べる ---------------------------------------------
  const inspect = (el) => {
    const tag = el.tagName.toLowerCase()

    // ① DOM 側(= content script からも取れる)の手掛かり
    const attrs = {}
    for (const name of el.getAttributeNames()) {
      const value = el.getAttribute(name)
      attrs[name] = SAFE_ATTR.test(name) ? value : mask(value)
    }

    const anchors = Array.from(el.querySelectorAll('a[href]')).map((a) => ({
      where: a.id ? `a#${a.id}` : a.className ? `a.${String(a.className).split(/\s+/)[0]}` : 'a',
      href: maskHref(a.getAttribute('href')),
      normalized: normalizeChannelUrl(a.getAttribute('href')),
    }))

    /** 属性値にチャンネル ID / ハンドルが入っていないか(要素自身と子孫すべて) */
    const attrHits = []
    const walk = (node) => {
      for (const name of node.getAttributeNames()) {
        const value = node.getAttribute(name) || ''
        if (/UC[\w-]{20,}|\/@|^@[^\s@/?#]/u.test(value)) {
          attrHits.push({
            where: `${node.tagName.toLowerCase()}[${name}]`,
            value: mask(value),
            normalized: normalizeChannelUrl(value),
          })
        }
      }
      for (const child of Array.from(node.children)) walk(child)
    }
    walk(el)

    // ② 自分(配信者)の判別に使えそうな手掛かり。
    // **`type` も `aria-label` も無いものは数えない** — `[id*="badge"]` だけだと
    // 中身の `span` を 3 つ拾って「バッジ 3 個」に見え、判別の手掛かりが有るように誤読させる
    const badges = Array.from(
      el.querySelectorAll('yt-live-chat-author-badge-renderer, [id*="badge" i]'),
    )
      .map((b) => ({
        tag: b.tagName.toLowerCase(),
        type: b.getAttribute('type'),
        ariaLabel: b.getAttribute('aria-label') ? mask(b.getAttribute('aria-label')) : null,
      }))
      .filter((b) => b.type || b.ariaLabel || b.tag === 'yt-live-chat-author-badge-renderer')

    // ③ タイムスタンプ
    const timestampEl = el.querySelector('#timestamp, [id*="timestamp" i]')
    const timestampText = timestampEl ? (timestampEl.textContent || '').trim() : null

    // メインワールドのデータ(拡張からは見えない)
    const polymer = getPolymerData(el)
    const channelKeys = polymer.value
      ? findKeys(polymer.value, /channel|author.*id|externalId/i).map((k) => ({
          path: k.path,
          value: mask(k.value),
          normalized: normalizeChannelUrl(
            /^UC[\w-]{20,}$/.test(String(k.value)) ? `/channel/${k.value}` : String(k.value),
          ),
        }))
      : []
    const timeKeys = polymer.value
      ? findKeys(polymer.value, /timestamp|time.*usec|publishedAt/i).map((k) => ({
          path: k.path,
          // タイムスタンプは識別子ではないので実値を出す(µs か ms かの判別に要る)
          value: k.value,
        }))
      : []

    // **ハンドルが内部データのどこかに入っていないか**(キー名に頼らず値の形で探す)。
    // ここに `@handle` があれば、辞書の鍵とそのまま一致するので対応付けが要らなくなる
    const handleValues = polymer.value ? findHandleValues(polymer.value) : []

    // **DOM 属性から投稿者を取り出せるか**(= メインワールド注入が要らなくなるか)。
    // 正解(Polymer の `authorExternalChannelId`)と突き合わせて検証する
    const fromDom = authorIdFromDom(el)
    const truth = polymer.value
      ? findKeys(polymer.value, /^authorExternalChannelId$/).map((k) => String(k.value))[0] || null
      : null
    const domVerdict = !truth
      ? '正解が無い'
      : fromDom.id == null
        ? `取れない(${fromDom.status})`
        : fromDom.id === truth
          ? '一致'
          : '**不一致**'

    return {
      tag,
      attrs,
      anchors,
      attrHits,
      badges,
      timestampText,
      polymerPath: polymer.path,
      channelKeys,
      handleValues,
      timeKeys,
      domAuthor: { status: fromDom.status, ucCount: fromDom.count, verdict: domVerdict },
    }
  }

  /**
   * その値が**表示名**の場所か。
   *
   * ⚠️ 2026-08-15 の採取: `authorName.simpleText` が `@…` の形をしていたため、
   *    「ハンドルが取れた」と読めてしまった。**チャンネル名は誰でも自由に決められる**ので、
   *    形が `@…` でも「その人のハンドル」である保証はない。**鍵にしてはいけない。**
   */
  const isDisplayNamePath = (h) => /(^|\.)author(Name|Text)/i.test(h.path)

  /** 鍵に使える見込みのある出所(表示名を除いた、URL 系のキー)だけのパス一覧 */
  const urlHandlePaths = (info) =>
    info.handleValues.filter((h) => !isDisplayNamePath(h)).map((h) => h.path)

  /** 1 件の調査結果を「表の 1 行」に畳む */
  const summarize = (info, index) => {
    const domSource =
      info.anchors.find((a) => a.normalized) || info.attrHits.find((a) => a.normalized) || null
    const mainSource = info.channelKeys.find((k) => k.normalized) || null
    return {
      '#': index,
      要素: info.tag.replace(/^yt-live-chat-/, ''),
      // **ここが本命**: DOM 属性だけで投稿者を特定できるか(= メインワールド注入が要らないか)
      'DOM属性から投稿者': info.domAuthor.verdict,
      'UC の個数': info.domAuthor.ucCount || '—',
      'DOMで取れる': domSource ? keyShape(domSource.normalized) : '—',
      'DOMの出所': domSource ? domSource.where || domSource.path : '—',
      'Polymerで取れる': mainSource ? keyShape(mainSource.normalized) : '—',
      // **ここが本題**: URL 系のキーにハンドルがあるなら、辞書の鍵とそのまま一致する。
      // **1 件目だけ出さない** — `authorName` が先に当たると本命が隠れる(2026-08-15 に一度そうなった)
      'Polymerのハンドル(URL系)': urlHandlePaths(info).join(',') || '—',
      // ⚠️ **表示名は鍵にしてはいけない。**チャンネル名は誰でも自由に決められるので、
      //    `@…` の形でも「その人のハンドル」である保証がない(spec.md D1 (a) の誤爆そのもの)。
      //    参考として「形が @ かどうか」だけ出す
      '表示名が@形式': info.handleValues.some(isDisplayNamePath) ? 'はい' : 'いいえ',
      'author-type': info.attrs['author-type'] || '—',
      バッジ: info.badges.length ? info.badges.map((b) => b.type || b.tag).join(',') : '—',
      'timestamp(DOM)': info.timestampText || '—',
      'timestamp(Polymer)': info.timeKeys.length ? info.timeKeys[0].value : '—',
    }
  }

  // --- 公開 API -------------------------------------------------------------
  const state = { last: [], watched: [], observer: null }

  const probe = (limit = 20) => {
    const { el: list, selector } = getItemList()
    if (!list) {
      console.warn(
        '[YTRP] チャット項目リストが見つからない。' +
          'Studio の管制室ならフレームを live_chat に切り替えてから実行する(docs/004-t1-collect.md)。',
      )
      return null
    }
    const children = Array.from(list.children)
    const targets = children.slice(-limit)
    state.last = targets.map(inspect)

    console.log(`[YTRP] 項目リスト: ${selector} / 全 ${children.length} 件 / 直近 ${targets.length} 件を調べた`)

    const tally = {}
    for (const child of children) {
      const t = child.tagName.toLowerCase()
      tally[t] = (tally[t] || 0) + 1
    }
    console.log('[YTRP] 項目リストに出ている要素の内訳(AC3 の対象を決めるのに使う):')
    console.table(tally)

    const rows = state.last.map(summarize)
    console.log('[YTRP] 直近のメッセージ:')
    console.table(rows)
    console.log('[YTRP] 詳しく見るには YTRP.detail(i) / 生の値は YTRP.raw(i)(出力を貼らないこと)')

    // ⚠️ **`state.last` を返さない。**中には正規化後の URL(= 実際のチャンネル ID)が入っており、
    //    コンソールが戻り値を展開表示すると**匿名化を素通りして生の値が画面に出る。**
    //    2026-08-14 の採取で実際にそうなった(貼り付け先が公開の場だと事故になる)。
    return rows
  }

  /**
   * 出所の一覧から**正規化後の URL の実値を落とす**(形だけにする)。
   *
   * ⚠️ `normalizeChannelUrl` の出力は `https://www.youtube.com/@<実際のハンドル>` そのもので、
   *    そのまま出すと匿名化を素通りする。`detail()` の出力は docs へ貼る前提なので、
   *    ここで必ず形へ落とす。**生の値が要るときは `raw(i)`。**
   */
  const maskSources = (sources) =>
    sources.map(({ normalized, ...rest }) => ({ ...rest, 正規形: keyShape(normalized) }))

  const detail = (i = 0) => {
    const info = state.last[i]
    if (!info) return console.warn('[YTRP] まず YTRP.probe() を実行する')
    console.log(`[YTRP] #${i} ${info.tag}`)
    console.log('  属性:', info.attrs)
    console.log('  a[href](DOM / 拡張から取れる):', maskSources(info.anchors))
    console.log('  チャンネルらしい属性値(DOM / 拡張から取れる):', maskSources(info.attrHits))
    console.log('  バッジ:', info.badges)
    console.log('  timestamp(DOM のテキスト):', info.timestampText)
    console.log(`  Polymer データの場所: ${info.polymerPath || '(見つからない)'}`)
    console.log('  Polymer のチャンネル系キー ※隔離ワールドからは見えない:', maskSources(info.channelKeys))
    console.log(
      '  Polymer の中の @ハンドルらしい値 ※同上(author* は表示名なので鍵にしない):',
      info.handleValues.map((h) => ({ ...h, 表示名の場所: isDisplayNamePath(h) ? 'はい' : 'いいえ' })),
    )
    console.log('  Polymer の時刻系キー ※同上:', info.timeKeys)
    return info
  }

  /** **生の値。出力を docs へ貼らない。**自分の目で形を確かめるためだけに使う */
  const raw = (i = 0) => {
    const { el: list } = getItemList()
    const el = list && Array.from(list.children).slice(-state.last.length)[i]
    if (!el) return console.warn('[YTRP] まず YTRP.probe() を実行する')
    console.warn('[YTRP] ⚠️ ここから先は生の値。**この出力は docs / issue / PR へ貼らないこと**')
    console.log(el)
    const polymer = getPolymerData(el)
    console.log('Polymer:', polymer.path, polymer.value)
    return el
  }

  /**
   * 新しく現れるコメントを一定時間ぶん拾う。
   * **AC9(起動時の既存コメントに反応しない)の材料**になる — 追加ノードとして流れる要素が
   * 何で、絶対時刻が取れるかを見る。
   */
  const watch = (sec = 60) => {
    const { el: list } = getItemList()
    if (!list) return console.warn('[YTRP] 項目リストが見つからない')
    if (state.observer) state.observer.disconnect()
    state.watched = []
    const startedAt = Date.now()

    state.observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node.nodeType !== 1) continue
          const info = inspect(node)
          const usec = info.timeKeys.length ? Number(info.timeKeys[0].value) : null
          state.watched.push({
            経過秒: Math.round((Date.now() - startedAt) / 1000),
            要素: info.tag.replace(/^yt-live-chat-/, ''),
            'author-type': info.attrs['author-type'] || '—',
            'DOMで取れる': (info.anchors.find((a) => a.normalized) ||
              info.attrHits.find((a) => a.normalized)) ? 'あり' : 'なし',
            'timestamp(DOM)': info.timestampText || '—',
            // µs なら 1e15 以上。ms との判別と「今 追加されたものか」の判定に使う
            'Polymer時刻と現在の差(秒)':
              usec && Number.isFinite(usec)
                ? Math.round((Date.now() - usec / (usec > 1e14 ? 1000 : 1)) / 1000)
                : '—',
          })
        }
      }
    })
    state.observer.observe(list, { childList: true })

    console.log(
      `[YTRP] ${sec} 秒間、新しく現れるコメントを拾う。` +
        '**自分でも 1 回コメントする**(自分の投稿の判別 ③ に要る)。',
    )
    setTimeout(() => {
      if (state.observer) state.observer.disconnect()
      state.observer = null
      console.log(`[YTRP] 監視を終えた。${state.watched.length} 件:`)
      console.table(state.watched)
    }, sec * 1000)
    return '監視中'
  }

  /** 貼り戻し用の Markdown(匿名化済み)。`copy(YTRP.md())` でクリップボードへ */
  const md = () => {
    if (!state.last.length) return '(先に YTRP.probe() を実行する)'
    const rows = state.last.map(summarize)
    const cols = Object.keys(rows[0])
    const line = (values) => `| ${values.join(' | ')} |`
    const out = [
      `採取日時: ${new Date().toISOString().slice(0, 10)}`,
      `URL の形: ${location.pathname}${location.search ? '?(略)' : ''}`,
      `フレーム: ${window.top === window ? 'トップ(ポップアウト)' : 'iframe(管制室の埋め込み)'}`,
      '',
      line(cols),
      line(cols.map(() => '---')),
      ...rows.map((r) => line(cols.map((c) => String(r[c])))),
    ]
    if (state.watched.length) {
      const wcols = Object.keys(state.watched[0])
      out.push(
        '',
        '監視中に現れたコメント:',
        '',
        line(wcols),
        line(wcols.map(() => '---')),
        ...state.watched.map((r) => line(wcols.map((c) => String(r[c])))),
      )
    }
    return out.join('\n')
  }

  /**
   * 貼り戻し用の Markdown を**そのまま読める形で**出す。
   *
   * DevTools の `copy()`(コマンドラインAPI)は環境によって使えないことがある
   * (studio.youtube.com では `copy is not a function` になった / 2026-08-14)。
   * こちらは素の `console.log` なので必ず出る。出たテキストを選択してコピーする。
   */
  const show = () => {
    console.log(md())
    return '(上のテキストをコピーする)'
  }

  window.YTRP = { probe, detail, raw, watch, md, show, normalizeChannelUrl, state }
  console.log(
    '[YTRP] 用意できた。順に実行する:\n' +
      '  1) YTRP.probe()      … いま出ているコメントを調べる\n' +
      '  2) YTRP.watch(60)    … 60 秒ぶん新しいコメントを拾う(途中で自分でも 1 回コメントする)\n' +
      '  3) YTRP.show()       … 貼り戻し用の Markdown を出す(選択してコピー)\n' +
      '                        ※ copy(YTRP.md()) は環境によって使えない\n' +
      '  詳細: YTRP.detail(i) / 生の値: YTRP.raw(i)(**出力を貼らない**)',
  )
})()
