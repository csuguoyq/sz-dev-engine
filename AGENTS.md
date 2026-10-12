# AGENTS.md

本仓库是独立 harness 工程：`ai-flow/`（编排器）+ `skills/sz-dev/`（工作流技能）。修改代码前先读对应指南：

| 目录 | 指南 | 说明 |
|---|---|---|
| `ai-flow/` | `ai-flow/AGENTS.md` | 阶段编排、gate、replay 模式、适配器、硬规则；改 ai-flow 行为须同步更新 `ai-flow/test/` 并跑 `npm test` |
| `skills/sz-dev/` | `skills/sz-dev/AGENTS.md`（工作流入口 `skills/sz-dev/SKILL.md`） | 四阶段工作流、工具契约（`contracts.md`）、模块包（`references/`） |

## 规则

1. `skills/sz-dev` 这一层级路径不可改动——ai-flow 的默认 `szdev.skillDir`、replay 播种探测与 harness 路径前缀均依赖它。
2. 技能副本的唯一真源是本仓库 `skills/sz-dev/`；改完后运行 `skills/sz-dev/tools/sz-workspace sync-skill` 同步安装副本与各工作区播种副本。
3. 文档中引用代码只用 文件路径 + 稳定符号名（组件、函数、`data-testid`、端点），**不写行号**。
4. 不要把 cookies / PAT 提交进仓库或写进 `ai-flow.config.json`、`state.json`、日志。
5. 不在 pipeline 中 git commit / push（ai-flow 硬规则 1）；产品改动经人工 MR 提交。
