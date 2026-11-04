/**
 * dsh-liya-skills —— 把莉娅工作区的 skill 库接进 DSH 的 skills 服务。
 *
 * 形态：host 插件，**零第三方依赖**（只用 node: 内建），所以可以被 file:// 路径直接挂载，
 * 不走 profile 的 pnpm 链接。
 *
 * 干的事：注册一个 SkillProvider，扫描 skillsRoot 下的 SKILL.md（目录包式或平铺 .md 都认），
 * 把「名字 + 描述」交给 ctx.skills 生成目录，正文按需读给 `skill` 工具。
 *
 * 策略（对应「方案二」）：
 *   - curated.json 里点名的技能 = 模型可见 → 进每轮技能目录，本天使可主动调；
 *   - 其余技能 = 只给用户调（invocation.modelInvocable=false）→ 不进目录、不占上下文，
 *     但阁下打 `/技能名` 照样注入。curated.json 改完自动失效重扫，不用重启。
 */

import { readFile, readdir } from 'node:fs/promises'
import { watchFile, unwatchFile, watch, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerSkillAdmin } from './host/skill-admin.js'

export const name = 'dsh-liya-skills'
export const inject = ['skills', 'webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
/**
 * 插件被 profile 的 node_modules **符号链接**引入时（宿主 preserve-symlinks），
 * import.meta.url 是链接路径（…\profiles\desktop\node_modules\dsh-liya-skills），
 * 直接往上算两级会落到 profile 目录里 —— 先 realpath 回真实插件目录再算。
 */
function realDir(dir) {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}
/** 插件在 workspace/dsh-plugins/dsh-liya-skills/ 下，技能库在 workspace 根旁的 ../../skills。 */
const DEFAULT_ROOT = resolve(realDir(HERE), '..', '..', 'skills')
const CURATED_FILE = join(HERE, 'curated.json')
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** 扫描结果的重读节流：正文永远现读，这里只缓存「有哪些技能」。 */
const SCAN_TTL_MS = 3000

export function apply(ctx, config = {}) {
  const skillsRoot = resolve(String(config.skillsRoot ?? DEFAULT_ROOT))
  const providerName = String(config.providerName ?? 'liya-skills')
  const rank = Number.isSafeInteger(config.rank) ? config.rank : 300

  ctx.skills.registerProvider((control) => {
    let cache = { at: 0, skills: [] }

    const invalidate = () => {
      cache = { at: 0, skills: [] }
      control.invalidate()
    }

    // curated.json 改了 → 目录重算；技能目录增删 → 目录重算。都走 invalidate，无需重启。
    watchFile(CURATED_FILE, { interval: 1000 }, invalidate)
    let dirWatcher
    try {
      dirWatcher = watch(skillsRoot, { persistent: false }, invalidate)
    } catch {
      dirWatcher = undefined
    }
    control.signal.addEventListener('abort', () => {
      unwatchFile(CURATED_FILE, invalidate)
      dirWatcher?.close()
    }, { once: true })

    async function scan() {
      const now = Date.now()
      if (now - cache.at < SCAN_TTL_MS) return cache.skills
      const visible = await readCurated()
      let entries
      try {
        entries = await readdir(skillsRoot, { withFileTypes: true })
      } catch {
        entries = []
      }
      const skills = []
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        let file
        let dir
        if (entry.isDirectory()) {
          file = join(skillsRoot, entry.name, 'SKILL.md')
          dir = join(skillsRoot, entry.name)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          file = join(skillsRoot, entry.name)
          dir = skillsRoot
        } else continue
        const parsed = await readSkill(file)
        if (parsed === undefined || !SKILL_NAME.test(parsed.name)) continue
        if (skills.some((skill) => skill.name === parsed.name)) continue
        skills.push({
          ...parsed,
          file,
          dir,
          modelInvocable: visible.has(parsed.name),
        })
      }
      cache = { at: now, skills }
      return skills
    }

    return {
      name: providerName,

      async list() {
        const skills = await scan()
        return skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          invocation: { modelInvocable: skill.modelInvocable, userInvocable: true },
          source: 'custom',
          provider: providerName,
          rank,
          path: skill.file,
          resourceBase: { kind: 'directory', path: skill.dir },
          locator: { file: skill.file, dir: skill.dir },
        }))
      },

      async get(candidate, options) {
        const locator = candidate.locator ?? {}
        if (typeof locator.file !== 'string') return undefined
        const parsed = await readSkill(locator.file, options?.signal)
        if (parsed === undefined) return undefined
        return {
          name: parsed.name,
          description: parsed.description,
          invocation: {
            modelInvocable: candidate.invocation?.modelInvocable !== false,
            userInvocable: true,
          },
          source: 'custom',
          provider: providerName,
          resourceBase: { kind: 'directory', path: locator.dir ?? HERE },
          path: locator.file,
          content: parsed.content,
        }
      },
    }
  })

  // 设置页「莉娅技能管理」用的 host 路由：状态扫描 / 生成适配稿 / 应用 / 精选开关。
  // 只处理公开仓库（private 一律拒绝），且**不自动覆盖**——先出适配稿，人工确认后才写本地。
  registerSkillAdmin(ctx, { skillsRoot, curatedFile: CURATED_FILE })
}

/** 模型可见清单：curated.json 的 modelVisible；读不到就退回代码里的默认名单。 */
async function readCurated() {
  try {
    const parsed = JSON.parse(await readFile(CURATED_FILE, 'utf8'))
    if (Array.isArray(parsed.modelVisible)) return new Set(parsed.modelVisible.filter((x) => typeof x === 'string'))
  } catch {}
  return new Set(DEFAULT_MODEL_VISIBLE)
}

async function readSkill(file, signal) {
  let raw
  try {
    raw = await readFile(file, 'utf8', { signal })
  } catch {
    return undefined
  }
  const split = splitFrontmatter(raw)
  if (split === undefined) return undefined
  const meta = parseSimpleFrontmatter(split.head)
  if (typeof meta.name !== 'string' || typeof meta.description !== 'string') return undefined
  if (meta.name.length === 0 || meta.description.length === 0) return undefined
  return { name: meta.name, description: meta.description, content: split.body.trim() }
}

/** 首行 `---`、下一行 `---` 之间的部分 = frontmatter；其余是正文。 */
function splitFrontmatter(raw) {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const firstBreak = text.indexOf('\n')
  if (firstBreak < 0) return undefined
  if (text.slice(0, firstBreak).replace(/\r$/, '') !== '---') return undefined
  let lineStart = firstBreak + 1
  while (lineStart <= text.length) {
    const nextBreak = text.indexOf('\n', lineStart)
    const lineEnd = nextBreak < 0 ? text.length : nextBreak
    if (text.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return {
        head: text.slice(firstBreak + 1, lineStart),
        body: text.slice(nextBreak < 0 ? text.length : nextBreak + 1),
      }
    }
    if (nextBreak < 0) return undefined
    lineStart = nextBreak + 1
  }
  return undefined
}

/**
 * 只认顶层 `key: value` 的极简 frontmatter 读取（不引 yaml 依赖）。
 * 缩进行（嵌套块、折行的续行）一律忽略；值两侧的引号和行尾注释会去掉。
 * 我们只取 name / description 两个字段，够用且不会被复杂 YAML 带偏。
 */
function parseSimpleFrontmatter(head) {
  const meta = {}
  for (const line of head.split('\n')) {
    if (line.length === 0 || line.startsWith(' ') || line.startsWith('\t') || line.startsWith('#')) continue
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line.replace(/\r$/, ''))
    if (match === null) continue
    const key = match[1]
    let value = match[2].trim()
    if (value.length > 1) {
      const quote = value[0]
      if ((quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1)
    }
	const hash = value.search(/[ \t]#/)
    if (hash > 0) value = value.slice(0, hash).trim()
    if (key in meta) continue
    meta[key] = value
  }
  return meta
}

/**
 * 代码里的默认可见名单（curated.json 缺失时的兜底）：
 * 本天使日常真要用的那一批，其余技能留给阁下 `/技能名` 手动点名。
 */
const DEFAULT_MODEL_VISIBLE = [
  'dsh-plugin-dev',
  'skill-curation',
  'knowledge-persistence',
  'dev-workflow',
  'debug',
  'source-code-investigation',
  'environment-hygiene',
  'info-hunt',
  'quick-fact-check',
  'news-verification',
  'link-safety-check',
  'documents',
  'diary-writer',
  'record-officer-daily',
  'persona-authoring',
  'vision-recognition-traps',
  'video-analysis',
  'platform-content-extraction',
  'image-batch-archive',
  'location',
]
