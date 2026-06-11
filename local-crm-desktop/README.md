# 销售CRM 个人版 v0.4.0

本地桌面CRM系统，基于 Tauri 2.x + React + TypeScript + SQLite，数据完全存储在本机。

## v0.4.0 新特性

- **双模型 AI 架构**: DeepSeek 负责所有纯文本分析（通话/微信文本/跟进建议/每日总结），Qwen (DashScope) 负责多模态识别（截图/图片结构化提取）
- **AI 草稿系统**: 所有 AI 结果首先生成草稿（`ai_drafts` 表），用户确认后才写入客户/跟进记录，AI 不能直接修改客户数据
- **AI 助手页面**: `/assistant` 路由，Tab 式界面——截图识别、通话文本分析、音频识别（待接入）
- **AI 设置独立配置**: DeepSeek 文本配置和 Qwen 多模态配置分别存储（`text_ai_config` / `multimodal_config`）
- **置信度可视化**: confidence < 0.65 低置信度警告，AI 不能自动升级为 A 级客户（需人工确认）
- **安全**: API Key 不输出到 console/日志/错误信息

## 功能

- **客户管理**: 新增/编辑/删除客户，40+ 字段（含官网/行业/地区/联系人/邮箱等）
- **客户列表**: 多条件筛选（等级/手机/官网/微信状态/意向度/约访/跟进时间）、排序、全文搜索
- **今日跟进**: 逾期/今日/7天内/长期未触达分组，规则引擎推荐动作
- **跟进记录**: 微信/电话/面访记录，自动更新客户等级和阶段
- **数据导入**: Excel (.xlsx) / CSV 导入，自动字段映射，重复检测，失败导出 CSV
- **AI 分析**: DeepSeek 文本分析 + Qwen 多模态识别，AI 草稿→人工确认→写入客户数据
- **数据安全**: JSON 备份/恢复（含版本号和校验），二次确认防误操作

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Tauri 2.x (Rust) |
| 前端 | React 19 + TypeScript + Vite 8 |
| 数据库 | SQLite (@tauri-apps/plugin-sql) |
| 测试 | Vitest 4.x (282 tests) |
| Excel | SheetJS (xlsx) |
| AI 文本 | DeepSeek API (OpenAI-compatible chat/completions) |
| AI 多模态 | Qwen / DashScope (compatible-mode/v1) |

## 快速开始

```bash
npm install
npm test          # 运行 277 个测试
npm run dev       # 启动开发服务器 + Tauri 窗口
npm run build     # 前端构建
npx tauri build   # 桌面安装包（NSIS + MSI）
```

## 构建产物

- `src-tauri/target/release/app.exe` — 可执行文件
- `src-tauri/target/release/bundle/nsis/local-crm_0.4.0_x64-setup.exe` — NSIS 安装器
- `src-tauri/target/release/bundle/msi/local-crm_0.4.0_x64_en-US.msi` — MSI 安装器

交付目录: `E:\新建文件夹 (3)\New project\runs\local-crm-v0.4.0\`

## 数据库

- **位置**: `%APPDATA%/com.localcrm.desktop/personal-crm.db`（设置页可查看实际路径）
- **类型**: SQLite 单文件
- **表**: customers, follow_up_records, visit_records, tasks, settings, ai_drafts
- **迁移**: 自动检测缺失列并 ALTER TABLE ADD COLUMN

## 备份与恢复

1. 打开设置页
2. 导出备份：点击"导出备份"，下载 JSON 文件（含版本号、时间戳、所有数据）
3. 恢复备份：点击"恢复备份"，选择 JSON 文件，确认警告后执行恢复

## 项目结构

```
src/
  lib/
    types.ts               # 类型定义 + 中文标签映射 (v0.4.0: +双模型类型)
    rules.ts               # 纯函数规则引擎
    timeParser.ts           # 中文模糊时间解析
    db.ts                  # SQLite 数据库抽象层 (v0.4.0: +ai_drafts CRUD)
    importer.ts            # Excel/CSV 导入引擎
    ai.ts                  # [deprecated] 旧 AI mock (v0.3.x 兼容)
    textAIProvider.ts      # DeepSeek 文本 AI 适配层
    multimodalProvider.ts  # Qwen 多模态 AI 适配层
    aiDraft.ts             # AI 分析 Prompt + API 调用 + 草稿创建
  pages/
    TodayView.tsx           # 今日跟进首页
    CustomerList.tsx        # 客户列表
    CustomerDetail.tsx      # 客户详情 (v0.4.0: +AI草稿查看)
    DataImportPage.tsx      # 数据导入
    SettingsPage.tsx        # 设置 + 备份恢复
    AISettingsPage.tsx      # AI 设置 (v0.4.0: 双模型独立配置)
    AIAssistantPage.tsx     # AI 助手 (v0.4.0: 截图/通话/音频)
  components/
    CustomerForm.tsx        # 新增/编辑客户表单
    FollowUpForm.tsx        # 新增跟进记录
    VisitForm.tsx           # 新增面访记录
src-tauri/
  src/lib.rs               # Tauri 入口 + SQL 插件注册
```

## 版本历史

- **v0.4.0** — 双模型 AI 架构 (DeepSeek 文本 + Qwen 多模态)、AI 草稿系统、AI 助手页面、置信度可视化
- **v0.3.1** — 导入增强、客户列表筛选排序、今日跟进分组、跟进自动更新、备份恢复
- **v0.3.0** — 9 个新客户字段、Excel 导入框架、AI 底座
- **v0.2.0** — Excel/CSV 导入框架
- **v0.1.2** — SQL ACL 权限修复
- **v0.1.1** — 数据库持久化、规则引擎、备份

## 当前限制

- 仅 Windows x64（macOS/Linux 未测试）
- 音频识别功能待接入（UI 已预留，P1 优先级）
- 无云同步/多用户/登录
- 无自动备份（需手动导出 JSON）
- AI 截图识别依赖 Qwen DashScope API（需阿里云账号）

## License

MIT
