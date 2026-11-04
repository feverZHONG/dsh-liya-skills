// 莉娅技能 · 设置页（settings.section）
// 布局对齐「技能管理」常见形态：顶部计数 + 同步按钮，左侧可搜索分组列表，右侧选中技能详情。
// 铁律：本地列表走 /local 秒开（不碰网络）；远端扫描只在「远端更新」页手动触发，绝不阻塞首屏。
var react = require('react')
var md = require('./md')

var S = {
  page: { padding: '18px 22px', fontFamily: 'inherit', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  head: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
  title: { fontSize: 17, fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary)' },
  count: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
  grow: { flex: 1 },
  btn: { padding: '6px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
  btnPrimary: { padding: '6px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--dsw-alias-border-l2)', marginBottom: 10 },
  tab: { padding: '7px 14px', fontSize: 13, background: 'none', border: 'none', borderBottom: '2px solid transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
  tabOn: { color: 'var(--dsw-alias-label-primary)', borderBottomColor: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
  body: { display: 'flex', gap: 14, flex: 1, minHeight: 0 },
  left: { width: 340, flex: '0 0 340px', display: 'flex', flexDirection: 'column', minHeight: 0 },
  right: { flex: 1, minWidth: 0, overflow: 'auto', paddingLeft: 14, borderLeft: '1px solid var(--dsw-alias-border-l2)' },
  search: { width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', marginBottom: 8 },
  list: { overflow: 'auto', flex: 1, minHeight: 0 },
  group: { fontSize: 11, letterSpacing: 0.4, color: 'var(--dsw-alias-label-secondary)', margin: '10px 0 4px', textTransform: 'uppercase' },
  item: { padding: '8px 10px', borderRadius: 8, cursor: 'pointer', border: '1px solid transparent', marginBottom: 2 },
  itemOn: { background: 'var(--dsw-alias-bg-l2)', borderColor: 'var(--dsw-alias-border-l2)' },
  itemName: { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
  itemDesc: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  h2: { fontSize: 18, fontWeight: 600, margin: '2px 0 4px', color: 'var(--dsw-alias-label-primary)' },
  desc: { fontSize: 12, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', margin: '0 0 10px' },
  badges: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  badge: { fontSize: 11, padding: '2px 7px', borderRadius: 6, background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-secondary)' },
  code: { fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 },
  muted: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
  error: { fontSize: 12, color: 'var(--dsw-alias-label-danger, var(--dsw-alias-label-primary))', margin: '4px 0 8px' },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  tag: { fontSize: 11, padding: '1px 6px', borderRadius: 6, background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-secondary)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '7px 6px', borderBottom: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)', fontWeight: 500 },
  td: { padding: '7px 6px', borderBottom: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-primary)', verticalAlign: 'top' },
}

// ── 兼容层（2026-11-04）：token 名对不上 / 宿主没注入某个 token / 设置面板不是 flex 容器时，
// 只靠 S 里写死的值会整块样式失效（背景透明、边框消失、代码字体回退成 serif、页面高度塌掉）。
// 这里统一兜底：能拿到的 token 用 token，拿不到就用近似的 fallback 颜色和稳妥尺寸。──
var C = {
  bgSoft: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.14))',
  bgBase: 'var(--dsw-alias-bg-base, transparent)',
  border: 'var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28))',
  borderSoft: 'var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16))',
  danger: 'var(--dsw-alias-state-error-primary, #d9534f)',
  mono: 'ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace',
}
S.page.height = 'auto'
S.page.minHeight = 0
S.page.boxSizing = 'border-box'
S.body.minHeight = 260
S.left.maxHeight = '64vh'
S.list.maxHeight = '58vh'
S.right.maxHeight = '64vh'
S.code.maxHeight = '52vh'
S.code.overflow = 'auto'
S.code.fontFamily = C.mono
S.code.background = C.bgSoft
S.code.overflowWrap = 'anywhere'
S.desc.overflowWrap = 'anywhere'
S.itemDesc.overflowWrap = 'anywhere'
S.error.color = C.danger
S.error.overflowWrap = 'anywhere'
S.tabs.borderBottom = '1px solid ' + C.border
S.right.borderLeft = '1px solid ' + C.border
S.th.borderBottom = '1px solid ' + C.border
S.td.borderBottom = '1px solid ' + C.border
S.itemOn.background = C.bgSoft
S.itemOn.borderColor = C.border
S.badge.background = C.bgSoft
S.tag.background = C.bgSoft
S.btn.background = C.bgBase
S.btn.border = '1px solid ' + C.border
S.btn.font = 'inherit'
S.btn.boxSizing = 'border-box'
S.btn.appearance = 'none'
S.btnPrimary.background = C.bgSoft
S.btnPrimary.border = '1px solid ' + C.borderSoft
S.btnPrimary.font = 'inherit'
S.btnPrimary.boxSizing = 'border-box'
S.btnPrimary.appearance = 'none'
S.search.background = C.bgBase
S.search.border = '1px solid ' + C.border
S.search.font = 'inherit'
S.search.boxSizing = 'border-box'
S.tab.appearance = 'none'
S.tab.font = 'inherit'
S.tab.boxSizing = 'border-box'
S.tab.padding = '6px 12px'
S.tabs.marginBottom = 8
// 设置面板内容列通常只有 ~590px：左右栏改百分比 + 允许收缩，窄屏不会把右栏挤成一条。
// 页面整体留白也压小一点，和设置里其他页对齐。
S.page.padding = '14px 16px'
S.body.gap = 10
S.left.width = 'auto'
S.left.flex = '1 1 38%'
S.left.minWidth = 200
S.left.maxWidth = 320
S.right.flex = '1 1 62%'
S.right.minWidth = 160
S.right.paddingLeft = 10
S.item.padding = '7px 9px'
S.search.padding = '6px 9px'
S.h2.fontSize = 16
S.code.fontSize = 11.5
S.code.maxHeight = '46vh'
S.head.marginBottom = 4
S.grow.minWidth = 8

function api(path, init) {
  return fetch(path, init).then(function (response) {
    return response.json().then(function (data) {
      if (data && data.ok === false) throw new Error(data.error || '接口失败')
      return data
    })
  })
}
function post(path, body) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

function SkillAdminPage() {
  var state = react.useState({
    tab: 'local',
    user: 'feverZHONG',
    skills: [],
    curatedCount: 0,
    selected: '',
    detail: null,
    detailBusy: false,
    remote: null,
    remoteBusy: false,
    draft: null,
    draftBusy: '',
    search: '',
    view: 'rendered',
    error: '',
  })
  var s = state[0]
  var setState = state[1]
  function set(partial) {
    setState(function (previous) {
      var next = {}
      Object.keys(previous).forEach(function (key) { next[key] = previous[key] })
      Object.keys(partial).forEach(function (key) { next[key] = partial[key] })
      return next
    })
  }

  function selectSkill(name) {
    set({ selected: name, detailBusy: true, detail: null })
    api('/liya-skills/skill?name=' + encodeURIComponent(name))
      .then(function (detail) { set({ detail: detail, detailBusy: false }) })
      .catch(function (error) { set({ detailBusy: false, error: String(error.message || error) }) })
  }

  function loadLocal() {
    return api('/liya-skills/local')
      .then(function (data) {
        set({ skills: data.skills || [], curatedCount: data.curatedCount || 0 })
        if (!s.selected && data.skills && data.skills.length > 0) selectSkill(data.skills[0].name)
      })
      .catch(function (error) { set({ error: String(error.message || error) }) })
  }
  react.useEffect(function () { loadLocal() }, [])

  function toggleCurated(name, visible) {
    post('/liya-skills/curated', { name: name, visible: visible })
      .then(function () { loadLocal() })
      .catch(function (error) { set({ error: String(error.message || error) }) })
  }

  function scanRemote(refresh) {
    set({ remoteBusy: true, error: '' })
    api('/liya-skills/state?user=' + encodeURIComponent(s.user) + (refresh ? '&refresh=1' : ''))
      .then(function (data) { set({ remote: data, remoteBusy: false }) })
      .catch(function (error) { set({ remoteBusy: false, error: String(error.message || error) }) })
  }

  function makeDraft(row) {
    set({ draftBusy: row.repo, error: '' })
    post('/liya-skills/draft', { user: s.user, repo: row.repo, skill: row.name })
      .then(function (report) { set({ draftBusy: '', draft: report }) })
      .catch(function (error) { set({ draftBusy: '', error: String(error.message || error) }) })
  }

  function applyDraft(row) {
    var review = s.draft && s.draft.reviewItems ? s.draft.reviewItems.length : '?'
    if (!window.confirm('把「' + row.name + '」的适配稿写入本地？\n待人工确认项：' + review + ' 处（确认已看过）\n写入前会自动整目录备份。')) return
    set({ draftBusy: row.repo, error: '' })
    post('/liya-skills/apply', { skill: row.name, repo: row.repo })
      .then(function () { set({ draftBusy: '', draft: null }); loadLocal(); scanRemote(true) })
      .catch(function (error) { set({ draftBusy: '', error: String(error.message || error) }) })
  }

  var query = (s.search || '').toLowerCase()
  var filtered = s.skills.filter(function (item) {
    var visible = s.tab === 'curated' ? item.curated : true
    return visible && (query === '' || item.name.toLowerCase().indexOf(query) >= 0 || (item.description || '').toLowerCase().indexOf(query) >= 0)
  })

  var listNodes = []
  var groups = {}
  filtered.forEach(function (item) {
    var key = item.tier || '未标 Tier'
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  })
  Object.keys(groups).sort().forEach(function (key) {
    listNodes.push(react.createElement('div', { key: 'g:' + key, style: S.group }, key + ' · ' + groups[key].length))
    groups[key].forEach(function (item) {
      listNodes.push(
        react.createElement(
          'div',
          { key: item.name, style: Object.assign({}, S.item, s.selected === item.name ? S.itemOn : null), onClick: function () { selectSkill(item.name) } },
          react.createElement('div', { style: S.itemName }, item.name + (item.curated ? ' ★' : '')),
          react.createElement('div', { style: S.itemDesc }, item.description || '（无描述）')
        )
      )
    })
  })

  var detailNode
  if (s.detailBusy) detailNode = react.createElement('div', { style: S.muted }, '读取中…')
  else if (s.detail) {
    var d = s.detail
    detailNode = react.createElement(
      'div',
      null,
      react.createElement('h2', { style: S.h2 }, d.name),
      react.createElement('div', { style: S.badges },
        d.tier ? react.createElement('span', { style: S.badge }, d.tier) : null,
        react.createElement('span', { style: S.badge }, d.curated ? '★ 精选（模型可见）' : '未精选（只认 /名字）'),
        react.createElement('span', { style: S.badge }, d.files.length + ' 个文件')
      ),
      react.createElement('p', { style: S.desc }, d.description || '（无描述）'),
      react.createElement('div', { style: S.row },
        react.createElement('button', { style: S.btnPrimary, onClick: function () { toggleCurated(d.name, !d.curated) } }, d.curated ? '从精选移除' : '加入精选'),
        react.createElement('button', { style: S.btn, onClick: function () { if (navigator.clipboard) navigator.clipboard.writeText(d.dir) } }, '复制目录'),
        d.upstream ? react.createElement('span', { style: S.tag }, '来自 ' + d.upstream.repo + '@' + String(d.upstream.commit || '').slice(0, 7)) : null
      ),
      react.createElement('div', { style: Object.assign({}, S.muted, { margin: '8px 0 12px' }) }, d.dir),
      react.createElement('div', { style: Object.assign({}, S.row, { marginBottom: 6 }) },
        react.createElement('span', { style: S.muted }, 'SKILL.md' + (d.truncated ? '（预览前 260 行）' : '')),
        react.createElement('div', { style: S.grow }),
        react.createElement('button', { style: Object.assign({}, S.btn, { padding: '2px 8px', fontSize: 12 }), onClick: function () { set({ view: 'rendered' }) } }, s.view === 'rendered' ? '预览 ●' : '预览'),
        react.createElement('button', { style: Object.assign({}, S.btn, { padding: '2px 8px', fontSize: 12, marginLeft: 6 }), onClick: function () { set({ view: 'raw' }) } }, s.view === 'raw' ? '原文 ●' : '原文')
      ),
      s.view === 'raw'
        ? react.createElement('pre', { style: S.code }, d.content)
        : react.createElement('div', { style: { fontSize: 13 } }, md.renderMarkdown(d.body || d.content, d.name))
    )
  } else detailNode = react.createElement('div', { style: S.muted }, '左侧选一个技能。')

  var remoteRows = (s.remote && s.remote.rows) || []
  var remoteTable = react.createElement(
    'div',
    null,
    react.createElement('div', { style: S.row },
      react.createElement('span', { style: S.muted }, 'GitHub 用户'),
      react.createElement('input', { style: Object.assign({}, S.search, { width: 180, marginBottom: 0 }), value: s.user, onChange: function (event) { set({ user: event.target.value }) } }),
      react.createElement('button', { style: S.btnPrimary, onClick: function () { scanRemote(true) } }, s.remoteBusy ? '扫描中…（可切回本地页）' : '扫描公开仓'),
      react.createElement('span', { style: S.muted }, '只处理公开仓库；先出适配稿，确认后才写本地'),
      s.remote && s.remote.scannedAt ? react.createElement('span', { style: S.muted }, '上次 ' + String(s.remote.scannedAt).slice(11, 16)) : null
    ),
    !s.remote && !s.remoteBusy ? react.createElement('p', { style: S.muted }, '还没扫过。点「扫描公开仓」开始；这一步会调 gh 拉 30 多个公开仓，可能要几十秒，但页面不会卡住。') : null,
    s.remote ? react.createElement('table', { style: S.table },
      react.createElement('thead', null, react.createElement('tr', null,
        react.createElement('th', { style: S.th }, '技能'),
        react.createElement('th', { style: S.th }, '远端公开仓'),
        react.createElement('th', { style: S.th }, '状态'),
        react.createElement('th', { style: S.th }, '适配')
      )),
      react.createElement('tbody', null, remoteRows.map(function (row) {
        var busy = s.draftBusy === row.repo
        return react.createElement('tr', { key: row.repo },
          react.createElement('td', { style: S.td }, react.createElement('div', { style: { fontWeight: 500 } }, row.name), react.createElement('div', { style: S.muted }, (row.description || '').slice(0, 70))),
          react.createElement('td', { style: S.td }, row.repo, react.createElement('div', { style: S.muted }, row.commit ? '@' + String(row.commit).slice(0, 7) : (row.branch || ''))),
          react.createElement('td', { style: S.td }, react.createElement('span', { style: S.tag }, row.status === 'up-to-date' ? '已是最新' : row.status === 'updatable' ? '可更新' : '仅远端有')),
          react.createElement('td', { style: S.td },
            busy ? react.createElement('span', { style: S.muted }, '处理中…') : null,
            s.draft && s.draft.repo === row.repo
              ? react.createElement('div', null,
                  react.createElement('div', { style: S.muted }, '自动 ' + (s.draft.autoRewrites || []).length + ' / 待确认 ' + (s.draft.reviewItems || []).length),
                  react.createElement('button', { style: S.btnPrimary, onClick: function () { applyDraft(row) } }, '应用适配稿'))
              : react.createElement('button', { style: S.btn, onClick: function () { makeDraft(row) } }, '生成适配稿')
          )
        )
      }))
    ) : null,
    s.draft ? react.createElement('div', { style: { marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--dsw-alias-bg-l2)' } },
      react.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, '适配报告 · ' + s.draft.repo),
      react.createElement('div', { style: S.muted }, '自动改写 ' + (s.draft.autoRewrites || []).length + ' 处，待人工确认 ' + (s.draft.reviewItems || []).length + ' 处'),
      react.createElement('ul', { style: { margin: '6px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' } },
        (s.draft.reviewItems || []).slice(0, 10).map(function (item, index) {
          return react.createElement('li', { key: index }, item.file + ':' + item.line + ' ' + item.reason + ' — ' + item.text)
        })
      )
    ) : null
  )

  var tabs = [
    { id: 'local', label: '本地技能 ' + s.skills.length },
    { id: 'curated', label: '精选 ' + s.curatedCount },
    { id: 'remote', label: '远端更新' },
  ]

  var bodyNode
  if (s.tab === 'remote') bodyNode = react.createElement('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } }, remoteTable)
  else bodyNode = react.createElement('div', { style: S.body },
    react.createElement('div', { style: S.left },
      react.createElement('input', { style: S.search, placeholder: '搜索技能名 / 描述…', value: s.search, onChange: function (event) { set({ search: event.target.value }) } }),
      react.createElement('div', { style: S.list }, listNodes),
      !s.skills.length ? react.createElement('div', { style: S.muted }, '还没读到本地技能（接口 /liya-skills/local 不可用？）') : null
    ),
    react.createElement('div', { style: S.right }, detailNode)
  )

  return react.createElement('div', { style: S.page },
    react.createElement('div', { style: S.head },
      react.createElement('h1', { style: S.title }, '莉娅技能'),
      react.createElement('span', { style: S.count }, '本地 ' + s.skills.length + ' · 精选 ' + s.curatedCount + ' · 远端可更新 ' + remoteRows.filter(function (row) { return row.status === 'updatable' }).length),
      react.createElement('div', { style: S.grow }),
      react.createElement('button', { style: S.btn, onClick: function () { loadLocal() } }, '刷新本地'),
      react.createElement('button', { style: S.btnPrimary, onClick: function () { set({ tab: 'remote' }); if (!s.remote && !s.remoteBusy) scanRemote(true) } }, '同步远端')
    ),
    react.createElement('div', { style: S.tabs }, tabs.map(function (tab) {
      return react.createElement('button', { key: tab.id, style: Object.assign({}, S.tab, s.tab === tab.id ? S.tabOn : null), onClick: function () { set({ tab: tab.id }) } }, tab.label)
    })),
    s.error ? react.createElement('div', { style: S.error }, '⚠️ ' + s.error) : null,
    bodyNode
  )
}

exports.SkillAdminPage = SkillAdminPage
