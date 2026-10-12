# sz-dev-engine

SoftZilla SZ 端到端自动化工程的独立仓库：**ai-flow 编排器 + sz-dev 工作流技能** 打包为一个自包含项目，与 ccsrc 产品仓库解耦。

本仓库就是"宿主仓库"（harness repo）。它不改产品代码——产品代码的修改发生在 `sz-workspace` 解析/克隆出来的 **ccsrc 工作区**（`/project/<user>_sz<n>_ai/ccsrc` 或现有 ccsrc checkout）里；本仓库只提供编排、技能与工具。

## 布局

```
ai-flow/        无头编排器：驱动 sz-dev 四个阶段、校验 gate 证据、打包交付物
skills/sz-dev/  sz-dev 工作流技能：SKILL.md + workflows/ + tools/ + references/(模块包)
```

保持 `skills/sz-dev` 这一层级不变：ai-flow 的默认配置 `szdev.skillDir = "skills/sz-dev"`、replay 播种（`replayHarnessEnv` 检查 `<repo>/skills/sz-dev/SKILL.md`）和 harness 路径前缀（`ai-flow/`、`skills/`）都依赖它。

## 安装与运行

前置：Node >= 20、npm、bash、git、rsync；运行时为 **Linux-only**（run-lock 的 `/proc` 探测、`pkill`、POSIX ref-lock）。

```bash
cd ai-flow
npm install
npm run build
# 在本仓库根目录执行：
node ai-flow/dist/cli.js init        # 选择 agent 与 model，写入 ai-flow.config.json
node ai-flow/dist/cli.js run SZ34623
node ai-flow/dist/cli.js status      # 或 node ai-flow/dist/cli.js ui 打开状态页
```

详细说明见 [ai-flow/AGENTS.md](ai-flow/AGENTS.md)（阶段、gate、replay 模式、模块适配器、硬规则）。

## sz-dev 技能的安装与同步

- 技能的**唯一真源**是本仓库的 `skills/sz-dev/`。
- `skills/sz-dev/tools/sz-workspace sync-skill` 把本仓库的技能副本推送到安装副本（`~/.zcode/skills/sz-dev`，可用 `SZ_SKILL_INSTALL_DIR` 覆盖）及所有已注册工作区的播种副本，并用 `diff -rq` 验证。
- 修改技能后，在本仓库运行一次 `sync-skill` 即可三处同步。

## 与 ccsrc 的关系

- `sz-workspace ensure` 会克隆 ccsrc（`SZ_CC_SRC_URL` 可指向带 PAT 的地址，见 `sz-workspace config`）。
- 模块包（`skills/sz-dev/references/cql`、`references/claim`）是 ccsrc 域知识；新增模块包 = 新增 `references/<module>/` + ai-flow 里的 `src/adapters/<module>.ts`。
- 两个仓库各自独立提交：本仓库提交 harness 改动；产品改动仍走 sz-dev 流程的人工 MR（`sz-workspace mr`）。
