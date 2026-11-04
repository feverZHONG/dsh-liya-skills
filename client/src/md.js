// 极简 markdown 渲染（零依赖，手写）。
// 为什么不用 marked 之类：DSH client bundle 的 require 只解析平台种子词/已注册 bundle，
// 未注册的第三方库直接抛错（见 dsh-plugin-dev/references/bundle-publish-flow.md §7.5）。
// 只支持技能文档实际会用到的语法：标题 / 段落 / 列表 / 表格 / 代码块 / 行内代码 / 粗体 / 链接 / 引用 / 分隔线。
var react = require('react')

var T = {
  label: 'var(--dsw-alias-label-primary, currentColor)',
  labelSoft: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.9))',
  bgSoft: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.14))',
  border: 'var(--dsw-alias-border-l2, rgba(127,127,127,0.28))',
  brand: 'var(--dsw-alias-brand-primary, #4d6bfe)',
  mono: 'ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace',
}

var ST = {
  p: { fontSize: 13, lineHeight: 1.85, margin: '0 0 10px', color: T.label, overflowWrap: 'anywhere' },
  h1: { fontSize: 17, fontWeight: 600, margin: '16px 0 8px', color: T.label },
  h2: { fontSize: 15, fontWeight: 600, margin: '14px 0 7px', color: T.label },
  h3: { fontSize: 13.5, fontWeight: 600, margin: '12px 0 6px', color: T.label },
  h4: { fontSize: 13, fontWeight: 600, margin: '10px 0 5px', color: T.labelSoft },
  ul: { margin: '0 0 10px', paddingLeft: 20, color: T.label, fontSize: 13, lineHeight: 1.8 },
  ol: { margin: '0 0 10px', paddingLeft: 22, color: T.label, fontSize: 13, lineHeight: 1.8 },
  li: { margin: '2px 0', overflowWrap: 'anywhere' },
  pre: { margin: '0 0 10px', padding: '10px 12px', borderRadius: 8, background: T.bgSoft, color: T.label, fontFamily: T.mono, fontSize: 12, lineHeight: 1.6, overflow: 'auto', maxHeight: '40vh', whiteSpace: 'pre', boxSizing: 'border-box' },
  codeInline: { fontFamily: T.mono, fontSize: 12, padding: '1px 5px', borderRadius: 4, background: T.bgSoft, color: T.label },
  quote: { margin: '0 0 10px', padding: '2px 0 2px 10px', borderLeft: '3px solid ' + T.border, color: T.labelSoft, fontSize: 12.5, lineHeight: 1.8 },
  hr: { border: 'none', borderTop: '1px solid ' + T.border, margin: '14px 0' },
  tableWrap: { overflowX: 'auto', margin: '0 0 12px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid ' + T.border, color: T.labelSoft, fontWeight: 500, whiteSpace: 'nowrap' },
  td: { padding: '6px 8px', borderBottom: '1px solid ' + T.border, color: T.label, verticalAlign: 'top', overflowWrap: 'anywhere' },
  a: { color: T.brand, textDecoration: 'underline' },
  strong: { fontWeight: 600, color: T.label },
  em: { fontStyle: 'italic' },
  lang: { fontSize: 10, color: T.labelSoft, marginBottom: 4 },
}

var INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|\*[^*\n]+\*)/g

/** 行内格式：`代码` / **粗** / *斜* / [文字](链接)。 */
function inline(text, keyBase) {
  var nodes = []
  var parts = String(text).split(INLINE)
  parts.forEach(function (part, index) {
    if (!part) return
    var key = keyBase + '-' + index
    if (/^`[^`]+`$/.test(part)) nodes.push(react.createElement('code', { key: key, style: ST.codeInline }, part.slice(1, -1)))
    else if (/^\*\*[^*]+\*\*$/.test(part)) nodes.push(react.createElement('strong', { key: key, style: ST.strong }, part.slice(2, -2)))
    else if (/^\*[^*]+\*$/.test(part)) nodes.push(react.createElement('em', { key: key, style: ST.em }, part.slice(1, -1)))
    else if (/^\[[^\]]+\]\([^)]+\)$/.test(part)) {
      var match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
      nodes.push(react.createElement('a', { key: key, style: ST.a, href: match[2], target: '_blank', rel: 'noreferrer' }, match[1]))
    } else nodes.push(part)
  })
  return nodes
}

/** 表格：当前行以 | 开头，下一行是分隔行时成立。 */
function tryTable(lines, start) {
  if (start + 1 >= lines.length) return null
  if (!/^\s*\|/.test(lines[start])) return null
  if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[start + 1]) || lines[start + 1].indexOf('-') < 0) return null
  var cells = function (line) {
    return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map(function (cell) { return cell.trim() })
  }
  var header = cells(lines[start])
  var rows = []
  var index = start + 2
  while (index < lines.length && /^\s*\|/.test(lines[index])) {
    rows.push(cells(lines[index]))
    index += 1
  }
  return { header: header, rows: rows, next: index }
}

function listBlock(lines, start) {
  var ordered = /^\s*\d+\.\s+/.test(lines[start])
  var items = []
  var index = start
  while (index < lines.length) {
    var line = lines[index]
    var match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line)
    if (match === null) break
    var indent = match[1].length
    items.push({ indent: indent, text: match[3] })
    index += 1
  }
  return { ordered: ordered, items: items, next: index }
}

function renderList(block, key) {
  function build(items, start, baseIndent) {
    var nodes = []
    var index = start
    while (index < items.length) {
      var item = items[index]
      if (item.indent < baseIndent) break
      var children = []
      var nextIndex = index + 1
      if (nextIndex < items.length && items[nextIndex].indent > item.indent) {
        var nested = build(items, nextIndex, items[nextIndex].indent)
        children = nested.nodes
        nextIndex = nested.next
      }
      nodes.push(react.createElement('li', { key: key + '-' + index, style: ST.li },
        inline(item.text, key + '-' + index),
        children.length > 0
          ? react.createElement(block.ordered ? 'ol' : 'ul', { key: key + '-sub-' + index, style: block.ordered ? ST.ol : ST.ul }, children)
          : null
      ))
      index = nextIndex
    }
    return { nodes: nodes, next: index }
  }
  var built = build(block.items, 0, block.items.length > 0 ? block.items[0].indent : 0)
  return react.createElement(block.ordered ? 'ol' : 'ul', { style: block.ordered ? ST.ol : ST.ul }, built.nodes)
}

/** 把 markdown 文本渲染成 React 节点数组。传入内容可能被截断（代码块没闭合），按容错处理。 */
function renderMarkdown(text, keyBase) {
  var lines = String(text === undefined || text === null ? '' : text).replace(/\r\n/g, '\n').split('\n')
  var out = []
  var index = 0
  var key = 0
  var paragraph = []
  function flushParagraph() {
    if (paragraph.length === 0) return
    out.push(react.createElement('p', { key: keyBase + '-p' + key++, style: ST.p }, inline(paragraph.join(' '), keyBase + '-p' + key)))
    paragraph = []
  }
  while (index < lines.length) {
    var line = lines[index]
    if (/^\s*$/.test(line)) {
      flushParagraph()
      index += 1
      continue
    }
    var fence = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/.exec(line)
    if (fence !== null) {
      flushParagraph()
      var code = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      out.push(
        react.createElement('div', { key: keyBase + '-cb' + key++ },
          fence[1] ? react.createElement('div', { style: ST.lang }, fence[1]) : null,
          react.createElement('pre', { style: ST.pre }, code.join('\n'))
        )
      )
      continue
    }
    var heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushParagraph()
      var level = Math.min(heading[1].length, 4)
      out.push(react.createElement('h' + level, { key: keyBase + '-h' + key++, style: ST['h' + level] }, inline(heading[2], keyBase + '-h' + key)))
      index += 1
      continue
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph()
      out.push(react.createElement('hr', { key: keyBase + '-hr' + key++, style: ST.hr }))
      index += 1
      continue
    }
    var table = tryTable(lines, index)
    if (table !== null) {
      flushParagraph()
      var headCells = table.header.map(function (cell, cellIndex) {
        return react.createElement('th', { key: 'th' + cellIndex, style: ST.th }, inline(cell, keyBase + '-th' + cellIndex))
      })
      var bodyRows = table.rows.map(function (row, rowIndex) {
        return react.createElement('tr', { key: 'tr' + rowIndex }, row.map(function (cell, cellIndex) {
          return react.createElement('td', { key: 'td' + cellIndex, style: ST.td }, inline(cell, keyBase + '-td' + rowIndex + '-' + cellIndex))
        }))
      })
      out.push(react.createElement('div', { key: keyBase + '-tw' + key++, style: ST.tableWrap },
        react.createElement('table', { style: ST.table },
          react.createElement('thead', null, react.createElement('tr', null, headCells)),
          react.createElement('tbody', null, bodyRows)
        )
      ))
      index = table.next
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      flushParagraph()
      var quote = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      out.push(react.createElement('div', { key: keyBase + '-q' + key++, style: ST.quote }, inline(quote.join(' '), keyBase + '-q' + key)))
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flushParagraph()
      var block = listBlock(lines, index)
      out.push(renderList(block, keyBase + '-l' + key++))
      index = block.next
      continue
    }
    paragraph.push(line.trim())
    index += 1
  }
  flushParagraph()
  return out
}

exports.renderMarkdown = renderMarkdown
