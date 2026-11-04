# dsh-liya-skills

**v0.1.0** · 适配 DSH **0.2.1-rc.2**（桌面版）· 零第三方依赖

把工作区 `skills/` 里的技能库（一堆 `SKILL.md`）接进 DSH 原生的 skill 系统：
`skill` 工具能加载、每轮技能目录里能看见、用 `/技能名` 能直接点名。

## 它解决什么

DSH 的 `skill-filesystem` 只认这几个目录：项目根 `.dsh/skills`、`.agents/skills`，用户级
`~/.dsh/skills`、`~/.agents/skills`。工作区自己的 `skills/` 恰好不在里面 —— 技能再多也进不了目录。
本插件注册自己的 `SkillProvider`，直接扫 `skillsRoot`，不改 DSH 自带配置。

## 策略（方案二）

| 名单 | modelInvocable | 效果 |
|:-----|:---------------|:-----|
| `curated.json` 里 `modelVisible` 点名的 | `true` | 进每轮技能目录，模型可主动 `skill` 调用 |
| 其余技能 | `false` | 不进目录、**不占上下文**，但用户打 `/技能名` 照样注入正文 |

`curated.json` 保存即生效（文件监视 → 让 skills 服务缓存失效 → 下一轮目录重发），不用重启。

## 安装

```powershell
# 1. 装进 profile（pnpm 活链接 + 自动追加到 dsh.profile.bundles）
#    也可以在 DSH 设置页 / plugin_manager 里 install_bundle，target 填插件目录绝对路径
dsh plugin --profile <profile> add "<插件目录绝对路径>"
```

```yaml
# 2. profile 补丁（$DSH_HOME/profiles/<profile>/cordis.patch.yml）里指定技能库位置。
#    插件被 node_modules 符号链接引入时 import.meta.url 是链接路径，
#    默认的相对路径会算到 profile 目录里，所以这里显式给绝对路径。
- id: skill-liya-skills
  name: 'dsh-liya-skills'
  config:
    skillsRoot: '<工作区绝对路径>/skills'
```

`skillsRoot` 也可以写 `customSkillDirs`、`providerName`、`rank`（都有默认值，见 `index.js` 的 `apply`）。
改插件源码要**重启 DSH** 才生效（宿主热重载 profile 补丁的 config，不热重载插件模块）。

### 备选：没有 shell 时用 `file://` 直挂

```yaml
- insert:
    - id: skill-liya-skills
      name: 'file:///<插件目录绝对路径>/index.js'
      config:
        skillsRoot: '<工作区绝对路径>/skills'
```

（同一个插件**只能挂一次**：bundle 已装上就不要再留这条，否则 provider 重名报错。）

## 验证

1. 下一轮对话里，`<available_skills>` 目录出现 `curated.json` 里点名的技能。
2. `skill` 工具加载其中一个 → 返回正文 + `resourceBase` 指向 `<skillsRoot>/<技能名>`，
   `references/`、`scripts/` 按这个基准去读。
3. 对非精选技能调 `skill` 工具 → 报 `not available for model invocation`（分类生效，且没白占目录）；
   用户打 `/技能名` 仍能注入正文。
4. `plugin_manager list_plugins` 里 `include:skill-liya-skills` 应为 `fiberPhase: active`。

## 坑

- **正文永远现读**，只缓存「有哪些技能」（3 秒节流）：改 `SKILL.md` 正文立刻生效。
- frontmatter 用极简解析（只取顶层 `name` / `description`，不引 `yaml` 依赖）：缩进的嵌套块和折行续行会被忽略，
  所以 `name` / `description` 必须写成**单行**。
- 技能目录只认一层：`<skillsRoot>/<名字>/SKILL.md` 或 `<skillsRoot>/<名字>.md`；更深的嵌套不扫。
- 插件崩溃只会让这一条 entry 失效，不会带走整个 host —— 但 `inject` 里只能写确定存在的服务（本插件只要 `skills`）。
- 没有 client 半、没有网络请求，`publish-plugin.mjs` 那套流程对它是可用的，只是没有构建步骤。

## 姊妹仓库

- [dsh-puzzle](https://github.com/feverZHONG/dsh-puzzle) 莉娅拼图
- [dsh-chess-xq](https://github.com/feverZHONG/dsh-chess-xq) 天界象棋

## 许可

代码 MIT（[LICENSE](./LICENSE)）；文档 CC BY 4.0（[LICENSE-DOCS](./LICENSE-DOCS)）。

*莉娅（[@feverZHONG](https://github.com/feverZHONG)）· 宇宙美好记录官*
