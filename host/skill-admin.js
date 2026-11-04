/**
 * skill 管理（host 半）：本地技能浏览 + 指定 GitHub 用户**公开**仓库的「适配稿 → 人工确认 → 应用」同步。
 *
 * 铁律（2026-11-04 阁下定死）：
 *   - 只处理**公开仓库**，`private !== false` 或 `visibility !== 'public'` 一律拒绝；
 *   - **禁止备份+盲覆盖**：远端内容先产出「适配稿」（自动改写 + 待人工确认清单）到 `skills/.incoming/<技能名>/`，
 *     只有显式 apply 才写入本地，写入前整目录备份到 `skills/.backup/`；
 *   - **不要用同步子进程**：宿主是单线程事件循环，`execFileSync` 会卡死整个 WebUI（2026-11-04 踩过：
 *     页面「卡在扫描中」、所有路由不响应）。GitHub 访问一律用 `execFile` 异步 + 超时。
 *
 * 数据通道：本机直连 HTTPS 全被挡，只有 `gh` CLI 通，所以 GitHub 访问都走 `gh api`（需 gh 已登录）。
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

const run = promisify(execFile)
const GH_TIMEOUT_MS = 25000
const GITHUB_USER_DEFAULT = 'feverZHONG'
/** 只同步这些文件；仓库专属文件（LICENSE/README/.gitignore/.github）不进本地技能目录。 */
const KEEP = [/^SKILL\.md$/u, /^references\//u, /^scripts\//u, /^templates\//u, /^assets\//u]
const DROP = [/^LICENSE/iu, /^README\.md$/iu, /^\.gitignore$/u, /^\.github\//u, /^\.git\//u, /^archive\//u, /^dist\//u]
/** 自动改写规则：跨环境写法 → 本机写法（每条命中都记进报告）。 */
const REWRITES = [
  { id: 'python3-to-python', re: /\bpython3\b/g, to: 'python', note: '本机 Python 用 `python`' },
  { id: 'posix-opt-data-bin', re: /\/opt\/data\/bin\//g, to: 'bin/', note: '/opt/data/bin → 工作区 bin/' },
  { id: 'posix-opt-data-scripts', re: /\/opt\/data\/scripts\//g, to: 'scripts/', note: '/opt/data/scripts → 工作区 scripts/' },
  { id: 'crlf', re: /\r\n/g, to: '\n', note: '统一 LF' },
]
/** 待人工确认的线索（不自动改，只报告）。 */
const REVIEWS = [
  { id: 'hermes-env', re: /(~\/\.hermes|\/opt\/hermes|OpenClaw|hermes)/iu, note: '旧 Hermes 环境残留' },
  { id: 'posix-abs', re: /(^|[\s"'`])\/(opt|usr|etc|home|root)\//u, note: 'POSIX 绝对路径' },
  { id: 'posix-cmd', re: /(^|[\s"'`])(apt|apt-get|chmod|sudo|systemctl)\s/u, note: 'POSIX 命令' },
  { id: 'legacy-tool', re: /\b(credman|apiproxy|settingsScope)\b/u, note: '旧工具/旧 API' },
  { id: 'win-abs', re: /[A-Za-z]:\\[^\s'"`]+/u, note: '本机绝对路径（公开仓不该出现）' },
]

export function registerSkillAdmin(ctx, options) {
  const skillsRoot = options.skillsRoot
  const curatedFile = options.curatedFile
  const incomingRoot = join(skillsRoot, '.incoming')
  const backupRoot = join(skillsRoot, '.backup')
  const stateCache = new Map()
  const STATE_TTL_MS = 5 * 60 * 1000

  // 路由注册走 ctx.effect：插件卸载时自动摘掉
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/liya-skills',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const sub = url.pathname.slice('/liya-skills'.length) || '/'
      try {
        if (req.method === 'GET' && sub === '/local') return json(res, 200, await localState())
        if (req.method === 'GET' && sub === '/skill') return json(res, 200, await skillDetail(url.searchParams.get('name')))
        if (req.method === 'GET' && sub === '/state') {
          const user = sanitizeUser(url.searchParams.get('user')) ?? GITHUB_USER_DEFAULT
          return json(res, 200, await buildState(user, url.searchParams.get('refresh') === '1'))
        }
        if (req.method === 'POST' && sub === '/draft') return json(res, 200, await makeDraft(await readJson(req)))
        if (req.method === 'GET' && sub === '/draft') return json(res, 200, await readDraftReport(url.searchParams.get('repo')))
        if (req.method === 'POST' && sub === '/apply') return json(res, 200, await applyDraft(await readJson(req)))
        if (req.method === 'POST' && sub === '/curated') return json(res, 200, await toggleCurated(await readJson(req)))
        return json(res, 404, { ok: false, error: `unknown route ${req.method} ${sub}` })
      } catch (error) {
        return json(res, 200, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }))

  // ── 本地技能（快路径：不碰网络，页面首屏用它） ────────────────────────
  async function localState() {
    const curated = await readCuratedSet()
    let entries = []
    try {
      entries = await readdir(skillsRoot, { withFileTypes: true })
    } catch {
      return { ok: true, skills: [], curatedCount: curated.size }
    }
    const skills = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = join(skillsRoot, entry.name)
      const parsed = await readSkillFile(join(dir, 'SKILL.md'))
      if (parsed === undefined) continue
      const info = await stat(join(dir, 'SKILL.md')).catch(() => undefined)
      skills.push({
        name: parsed.name,
        description: parsed.description,
        dirName: entry.name,
        dir,
        tier: parsed.tier,
        curated: curated.has(parsed.name),
        updatedAt: info?.mtime?.toISOString() ?? null,
        files: await countFiles(dir),
      })
    }
    skills.sort((left, right) => left.name.localeCompare(right.name))
    return { ok: true, skills, curatedCount: skills.filter((item) => item.curated).length }
  }

  async function countFiles(dir) {
    let total = 0
    const walk = async (current) => {
      const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isDirectory()) await walk(join(current, entry.name))
        else total += 1
      }
    }
    await walk(dir)
    return total
  }

  /** 单个技能详情：frontmatter + SKILL.md 原文 + 目录文件清单。 */
  async function skillDetail(name) {
    if (typeof name !== 'string' || !/^[a-z0-9-]+$/u.test(name)) throw new Error('技能名不合法')
    const curated = await readCuratedSet()
    const dirEntry = (await readdir(skillsRoot, { withFileTypes: true })).find((entry) => entry.isDirectory() && entry.name === name)
    if (dirEntry === undefined) throw new Error(`没有本地技能 ${name}`)
    const dir = join(skillsRoot, dirEntry.name)
    const text = await readFile(join(dir, 'SKILL.md'), 'utf8')
    const files = []
    const walk = async (current) => {
      const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const path = join(current, entry.name)
        if (entry.isDirectory()) await walk(path)
        else files.push(path.slice(dir.length + 1).replace(/\\/gu, '/'))
      }
    }
    await walk(dir)
    const parsed = parseSkillText(text) ?? { name, description: '', tier: '' }
    const upstreamFile = join(dir, '_upstream.json')
    // body = 去掉 frontmatter 的正文，给设置页做 markdown 预览；content = 原文（给「原文」视图）
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '')
    return {
      ok: true,
      name: parsed.name,
      description: parsed.description,
      tier: parsed.tier,
      curated: curated.has(parsed.name),
      dir,
      files: files.sort(),
      upstream: existsSync(upstreamFile) ? JSON.parse(readFileSync(upstreamFile, 'utf8')) : null,
      body: body.split('\n').slice(0, 260).join('\n'),
      content: text.split('\n').slice(0, 160).join('\n'),
      truncated: text.split('\n').length > 160,
    }
  }

  // ── 远端：指定用户的公开仓 × 本地 ───────────────────────────────────
  async function buildState(user, refresh) {
    const cached = stateCache.get(user)
    if (!refresh && cached !== undefined && Date.now() - cached.at < STATE_TTL_MS) return cached.value
    const local = await localState()
    const byName = new Map(local.skills.map((item) => [item.name, item]))
    const repos = await listPublicRepos(user)
    const found = await mapLimit(repos, 8, async (repo) => {
      const remote = await readRepoSKILL(user, repo)
      return remote === undefined ? undefined : { repo: repo.name, branch: repo.branch, skill: remote }
    })
    const rows = found.filter(Boolean).map((remote) => {
      const mine = byName.get(remote.skill.name)
      const status = mine === undefined ? 'only-remote' : mine.description === remote.skill.description ? 'up-to-date' : 'updatable'
      return {
        repo: remote.repo,
        branch: remote.branch,
        name: remote.skill.name,
        description: remote.skill.description,
        status,
        localDir: mine?.dir ?? null,
        draft: readDraftSummary(remote.repo),
      }
    })
    const value = { ok: true, user, scannedAt: new Date().toISOString(), rows, localCount: local.skills.length }
    stateCache.set(user, { at: Date.now(), value })
    return value
  }

  async function listPublicRepos(user) {
    const repos = await ghJson([`users/${user}/repos`, '-f', 'per_page=100'])
    const visible = repos.filter((repo) => repo.private === false && repo.visibility === 'public')
    // 只带名字+分支：commit 等到「生成适配稿」时再查（少 30+ 次 gh 调用，扫描快一截）
    return visible.map((repo) => ({ name: repo.name, branch: repo.default_branch }))
  }

  async function repoHead(user, repo, branch) {
    return ghJq([`repos/${user}/${repo}/commits/${branch}`], '.sha')
  }

  async function readRepoSKILL(user, repo) {
    let text
    try {
      const encoded = await ghJq([`repos/${user}/${repo.name}/contents/SKILL.md`, '-f', `ref=${repo.branch}`], '.content')
      text = Buffer.from(String(encoded).replace(/\s+/gu, ''), 'base64').toString('utf8')
    } catch {
      return undefined
    }
    const parsed = parseSkillText(text)
    if (parsed === undefined) return undefined
    return { ...parsed, text }
  }

  async function makeDraft({ user, repo, skill }) {
    assertRef(user, repo)
    if (typeof skill !== 'string' || skill.length === 0) throw new Error('skill 不能为空')
    const meta = await ghJson([`repos/${user}/${repo}`])
    if (meta.private !== false || meta.visibility !== 'public') {
      throw new Error(`拒绝：${user}/${repo} 不是公开仓库（private=${String(meta.private)} visibility=${String(meta.visibility)}）`)
    }
    const tree = await ghJq([`repos/${user}/${repo}/git/trees/${meta.default_branch}`, '-f', 'recursive=1'], '.tree[] | select(.type=="blob") | .path')
    const paths = String(tree).split(/\r?\n/u).filter(Boolean).filter(shouldKeep)
    const files = []
    for (const path of paths) files.push({ path, text: await readRepoFile(user, repo, path, meta.default_branch) })
    const draft = adapt(files, join(skillsRoot, skill))
    const draftDir = join(incomingRoot, safeSegment(repo))
    await rm(draftDir, { recursive: true, force: true })
    for (const file of draft.files) {
      const target = join(draftDir, ...file.path.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.text, 'utf8')
    }
    const commit = await repoHead(user, repo, meta.default_branch)
    const report = { ok: true, user, repo, branch: meta.default_branch, commit, skill, exists: draft.targetExists, autoRewrites: draft.autoRewrites, reviewItems: draft.reviewItems, files: files.map((file) => file.path), draftDir }
    await writeFile(join(draftDir, '_adapt-report.json'), JSON.stringify(report, null, 2), 'utf8')
    stateCache.delete(user)
    return report
  }

  async function readRepoFile(user, repo, path, branch) {
    const encoded = await ghJq([`repos/${user}/${repo}/contents/${path}`, '-f', `ref=${branch}`], '.content')
    return Buffer.from(String(encoded).replace(/\s+/gu, ''), 'base64').toString('utf8')
  }

  /** 适配器：远端原文 → 本地技能格式；只报告 + 产出草稿，不写本地。 */
  function adapt(files, localDir) {
    const autoRewrites = []
    const reviewItems = []
    const out = []
    for (const file of files) {
      let text = file.text
      for (const rule of REWRITES) {
        const before = text
        text = text.replace(rule.re, rule.to)
        if (text !== before) autoRewrites.push({ file: file.path, rule: rule.id, note: rule.note })
      }
      if (file.path === 'SKILL.md') text = normalizeSkillFrontmatter(text, autoRewrites, reviewItems, file.path)
      text.split('\n').forEach((line, index) => {
        for (const rule of REVIEWS) {
          if (!rule.re.test(line) || reviewItems.length >= 200) continue
          reviewItems.push({ file: file.path, line: index + 1, text: line.trim().slice(0, 160), reason: rule.note })
        }
      })
      out.push({ path: file.path, text })
    }
    return { files: out, targetDir: localDir, targetExists: existsSync(join(localDir, 'SKILL.md')), autoRewrites, reviewItems: dedupeReviews(reviewItems) }
  }

  /** frontmatter 适配：折行（>- / |）说明压成单行；缺 tier 标一条待确认。 */
  function normalizeSkillFrontmatter(text, autoRewrites, reviewItems, path) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)
    if (match === null) {
      reviewItems.push({ file: path, line: 1, text: '(无 frontmatter)', reason: '远端 SKILL.md 缺 frontmatter' })
      return text
    }
    const lines = match[1].split(/\r?\n/u)
    const folded = []
    let changed = false
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      const start = /^([A-Za-z][A-Za-z0-9_-]*):\s*([>|])[-+]?\s*$/u.exec(line)
      if (start === null) {
        folded.push(line)
        continue
      }
      const parts = []
      let cursor = index + 1
      while (cursor < lines.length && /^\s+/u.test(lines[cursor])) {
        parts.push(lines[cursor].trim())
        cursor += 1
      }
      folded.push(`${start[1]}: ${parts.join(' ').replace(/\s+/gu, ' ').trim()}`)
      autoRewrites.push({ file: path, rule: 'frontmatter-folded', note: `${start[1]} 折行压成单行` })
      changed = true
      index = cursor - 1
    }
    if (!/^tier:/mu.test(lines.join('\n'))) reviewItems.push({ file: path, line: 2, text: 'tier: 缺失', reason: '本地技能惯例要标 T0/T1/T2' })
    if (!changed) return text
    return `---\n${folded.join('\n')}\n---\n${text.slice(match[0].length)}`
  }

  // ── 应用：备份 → 拷入 ─────────────────────────────────────────────
  async function applyDraft({ skill, repo }) {
    if (typeof skill !== 'string' || typeof repo !== 'string') throw new Error('参数不完整')
    const draftDir = join(incomingRoot, safeSegment(repo))
    const report = JSON.parse(await readFile(join(draftDir, '_adapt-report.json'), 'utf8'))
    if (report.skill !== skill) throw new Error('草稿技能名与请求不一致')
    const targetDir = join(skillsRoot, safeSegment(skill))
    const backupDir = join(backupRoot, `${skill}-${Date.now()}`)
    if (existsSync(join(targetDir, 'SKILL.md'))) {
      await mkdir(backupRoot, { recursive: true })
      await cp(targetDir, backupDir, { recursive: true })
    }
    await rm(targetDir, { recursive: true, force: true })
    await mkdir(targetDir, { recursive: true })
    for (const name of await readdir(draftDir)) {
      if (name === '_adapt-report.json') continue
      await cp(join(draftDir, name), join(targetDir, name), { recursive: true })
    }
    const record = { repo: report.repo, user: report.user, commit: report.commit, appliedAt: new Date().toISOString(), autoRewrites: report.autoRewrites.length, reviewItems: report.reviewItems.length, backup: existsSync(backupDir) ? backupDir : null }
    await writeFile(join(targetDir, '_upstream.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await rm(draftDir, { recursive: true, force: true })
    stateCache.clear()
    return { ok: true, skill, targetDir, backup: record.backup, record }
  }

  async function toggleCurated({ name, visible }) {
    const current = JSON.parse(await readFile(curatedFile, 'utf8'))
    const set = new Set(Array.isArray(current.modelVisible) ? current.modelVisible : [])
    if (visible === true) set.add(name)
    else set.delete(name)
    current.modelVisible = [...set].sort()
    await writeFile(curatedFile, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
    stateCache.clear()
    return { ok: true, name, visible: set.has(name), count: current.modelVisible.length }
  }

  function readDraftSummary(repo) {
    const reportFile = join(incomingRoot, safeSegment(repo), '_adapt-report.json')
    if (!existsSync(reportFile)) return null
    try {
      const report = JSON.parse(readFileSync(reportFile, 'utf8'))
      return { autoRewrites: report.autoRewrites?.length ?? 0, reviewItems: report.reviewItems?.length ?? 0, commit: report.commit }
    } catch {
      return null
    }
  }

  async function readDraftReport(repo) {
    if (typeof repo !== 'string' || repo.length === 0) throw new Error('repo 不能为空')
    const reportFile = join(incomingRoot, safeSegment(repo), '_adapt-report.json')
    if (!existsSync(reportFile)) return { ok: false, error: '还没有适配稿' }
    return JSON.parse(await readFile(reportFile, 'utf8'))
  }

  async function readCuratedSet() {
    try {
      const parsed = JSON.parse(await readFile(curatedFile, 'utf8'))
      return new Set(Array.isArray(parsed.modelVisible) ? parsed.modelVisible : [])
    } catch {
      return new Set()
    }
  }

  function assertRef(user, repo) {
    if (typeof user !== 'string' || !/^[A-Za-z0-9-]{1,39}$/u.test(user)) throw new Error('GitHub 用户名不合法')
    if (typeof repo !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/u.test(repo)) throw new Error('仓库名不合法')
  }
}

// ── 小工具 ────────────────────────────────────────────────────────────
function sanitizeUser(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return /^[A-Za-z0-9-]{1,39}$/u.test(trimmed) ? trimmed : undefined
}
function safeSegment(value) {
  const clean = String(value).replace(/[^A-Za-z0-9._-]/gu, '_')
  if (clean.length === 0 || clean === '.' || clean === '..') throw new Error('非法名称')
  return clean
}
function shouldKeep(path) {
  if (DROP.some((re) => re.test(path))) return false
  return KEEP.some((re) => re.test(path))
}
function dedupeReviews(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = `${item.file}:${item.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length === 0 ? {} : JSON.parse(raw)
}
async function ghArgsAsync(args) {
  try {
    const { stdout } = await run('gh', ['api', ...args, '--method', 'GET'], { timeout: GH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch (error) {
    throw new Error(`gh api ${args.join(' ')} 失败：${String(error?.stderr ?? error?.message ?? error).slice(0, 400)}`)
  }
}
async function ghJq(args, jq) {
  return (await ghArgsAsync([...args, '--jq', jq])).trim()
}
async function ghJson(args) {
  return JSON.parse(await ghArgsAsync(args))
}
/** 限流并发执行（gh 调用既不能一次全轰出去，也不能串行几十个）。 */
async function mapLimit(items, limit, worker) {
  const results = []
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}
function parseSkillText(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)
  if (match === null) return undefined
  const data = {}
  for (const line of match[1].split(/\r?\n/u)) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line)
    if (field === null) continue
    data[field[1]] = field[2].trim().replace(/^(['"])(.*)\1$/u, '$2')
  }
  const name = data.name
  const description = data.description
  if (typeof name !== 'string' || typeof description !== 'string' || name.length === 0 || description.length === 0) return undefined
  const tier = typeof data.tier === 'string' ? data.tier.replace(/\s*#.*$/u, '').trim() : ''
  return { name, description, tier, hash: createHash('sha256').update(text, 'utf8').digest('hex') }
}
async function readSkillFile(file) {
  try {
    return parseSkillText(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}
