// 自测：不经 DSH 宿主，直接驱动 host/skill-admin.js 的路由处理函数（本地/远端/详情三条路径）。
// 用法：node host/self-test.mjs（技能库位置默认按插件相对路径推，或用 LIYA_SKILLS_ROOT 覆盖）
import { registerSkillAdmin } from './skill-admin.js'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_ROOT = process.env.LIYA_SKILLS_ROOT ?? resolve(PLUGIN_DIR, '..', '..', '..', 'skills')
const CURATED = join(PLUGIN_DIR, 'curated.json')

let handler
const fakeCtx = {
  effect: (fn) => fn(),
  webServer: { register: (route) => { handler = route.handler; return () => {} } },
}
registerSkillAdmin(fakeCtx, { skillsRoot: SKILLS_ROOT, curatedFile: CURATED })
if (!handler) throw new Error('路由没有注册上')

async function call(method, path, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = {
    method,
    url: path,
    [Symbol.asyncIterator]() {
      let sent = false
      return {
        next: async () => {
          if (sent) return { done: true }
          sent = true
          return { done: false, value: Buffer.from(payload) }
        },
      }
    },
  }
  const res = {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers },
    end(value) { this.body = value },
  }
  await handler(req, res)
  return { code: res.statusCode, json: JSON.parse(res.body) }
}

const started = Date.now()
const local = await call('GET', '/liya-skills/local')
console.log(`[local] ${Date.now() - started}ms code=${local.code} skills=${local.json.skills?.length} curated=${local.json.curatedCount}`)
console.log('[local] first 3:', (local.json.skills || []).slice(0, 3).map((item) => `${item.name}(T${item.tier || '-'}${item.curated ? ',★' : ''})`).join(', '))

const detail = await call('GET', '/liya-skills/skill?name=skill-curation')
console.log(`[detail] code=${detail.code} name=${detail.json.name} files=${detail.json.files?.length} contentLines=${String(detail.json.content || '').split('\n').length}`)

const bad = await call('GET', '/liya-skills/skill?name=../etc')
console.log(`[detail traversal] code=${bad.code} ok=${bad.json.ok} error=${bad.json.error}`)

const scanStart = Date.now()
const state = await call('GET', '/liya-skills/state?user=feverZHONG&refresh=1')
if (!Array.isArray(state.json.rows)) console.log('[state raw]', JSON.stringify(state.json).slice(0, 600))
const rows = state.json.rows || []
console.log(`[state] ${Date.now() - scanStart}ms code=${state.code} rows=${rows.length} updatable=${rows.filter((row) => row.status === 'updatable').length} onlyRemote=${rows.filter((row) => row.status === 'only-remote').length}`)
console.log('[state] sample:', rows.slice(0, 8).map((row) => `${row.name}<=${row.repo}(${row.status})`).join(', '))

// ── 适配稿端到端（挑一个「可更新」的远端仓，只产草稿，绝不写本地） ──
const target = rows.find((row) => row.status === 'updatable')
if (target) {
  const draft = await call('POST', '/liya-skills/draft', { user: 'feverZHONG', repo: target.repo, skill: target.name })
  console.log('[draft]', target.repo, '->', JSON.stringify({ ok: draft.json.ok, error: draft.json.error, files: draft.json.files?.length, auto: draft.json.autoRewrites?.length, review: draft.json.reviewItems?.length, draftDir: draft.json.draftDir }).slice(0, 500))
  console.log('[draft] rewrites:', (draft.json.autoRewrites || []).slice(0, 4).map((item) => item.rule + '@' + item.file).join(' | ') || '(none)')
  console.log('[draft] reviews:', (draft.json.reviewItems || []).slice(0, 4).map((item) => item.reason + ' @' + item.file + ':' + item.line).join(' | ') || '(none)')
}
