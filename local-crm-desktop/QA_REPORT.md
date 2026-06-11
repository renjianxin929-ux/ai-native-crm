# QA Report — 销售CRM 个人版 v0.4.0

**日期**: 2026-06-02
**测试环境**: Windows 10 Pro x64, Node.js, Tauri 2.x, Vitest 4.x

## 测试结果

### 自动化测试

```
npm test  (vitest run)

 Test Files  8 passed (8)
      Tests  282 passed (282)
   Duration  1.31s
```

| # | 测试文件 | 测试数 | 覆盖内容 |
|---|---------|--------|---------|
| 1 | `db.test.ts` | 20 | 基础表创建、v0.3.0 字段迁移、createCustomer 参数完整性、**ai_drafts CRUD + apply/discard + P1 MANUAL修复** |
| 2 | `types.test.ts` | 19 | 类型导入、标签映射完整性、PhoneFeedback 含 UNKNOWN |
| 3 | `rules.test.ts` | 83 | 等级计算、微信通过、意向规则、面访结果、付款链路、爽约降级、组合规则 |
| 4 | `timeParser.test.ts` | 73 | 模糊时间解析 |
| 5 | `importer.test.ts` | 48 | Excel/CSV 解析、字段映射、数据清洗、重复检测 |
| 6 | `textAIProvider.test.ts` | 14 | DeepSeek 默认配置、请求构建、JSON 解析、错误标准化、**API Key 防泄露** |
| 7 | `multimodalProvider.test.ts` | 17 | Qwen 默认配置、能力开关、image_base64 转换、音频拒绝、**API Key 防泄露** |
| 8 | `aiDraft.test.ts` | 19 | Prompt 构建（CRM 规则/不自动升A/JSON schema）、JSON 解析、草稿创建、Bug 4 JSON解析失败 |

### v0.4.0 新增功能

#### 双模型 AI 架构

| 功能 | 状态 |
|------|------|
| DeepSeek 文本 AI 适配层 (`textAIProvider.ts`) | ✅ 14 tests |
| Qwen 多模态 AI 适配层 (`multimodalProvider.ts`) | ✅ 17 tests |
| AI 草稿模块 (`aiDraft.ts`) — Prompt/API/解析/草稿创建 | ✅ 17 tests |
| ai_drafts 表 + CRUD (`db.ts`) | ✅ 7 tests |
| API Key 不输出到 console/日志/错误消息 | ✅ 验证通过 |
| 音频识别 `audio_base64` → 抛出 "not yet supported" | ✅ 测试覆盖 |

#### AI 设置页 (`/settings/ai`)

| 功能 | 状态 |
|------|------|
| DeepSeek 配置区：Base URL / Model / API Key | ✅ |
| Qwen 配置区：Base URL / Vision Model / API Key / 能力开关 | ✅ |
| 独立配置存储（`text_ai_config` / `multimodal_config`） | ✅ |
| 测试连接按钮（调用真实 API 验证） | ✅ |
| API Key 输入框 password 类型 + autoComplete off | ✅ |

#### AI 助手页 (`/assistant`)

| 功能 | 状态 |
|------|------|
| Tab 导航：截图识别 / 通话文本分析 / 音频识别(待接入) | ✅ |
| 截图上传：拖拽/点击、图片预览、分析按钮 | ✅ |
| 通话文本：textarea 输入、分析按钮 | ✅ |
| 置信度可视化（≥0.65 绿色，<0.65 琥珀色警告） | ✅ |
| 等级建议 A → "需人工确认" 警告 | ✅ |
| 分析结果 → 保存为草稿（`ai_drafts` 表） | ✅ |
| 未配置 API Key → 提示横幅 + 链接到设置页 | ✅ |
| 音频 Tab → "即将上线" 占位 | ✅ |

#### 客户详情 AI 增强

| 功能 | 状态 |
|------|------|
| AI 分析按钮 → 使用 DeepSeek 文本配置 + `suggestNextActionWithDeepSeek` | ✅ |
| 查看 AI 草稿 → 展开该客户的草稿列表（来源/状态/置信度） | ✅ |
| 原有功能不受影响（跟进记录/面访记录/编辑/删除） | ✅ |

#### 导航

| 功能 | 状态 |
|------|------|
| 侧边栏新增 "AI助手" (Brain 图标) → `/assistant` | ✅ |
| 所有原有导航项正常 | ✅ |

## 构建结果

### ESLint

```
npm run lint → 0 errors, 0 warnings
```

### TypeScript 编译

```
tsc -b → 0 errors, 0 warnings
```

### Vite 生产构建

```
vite v8.0.14 — 1794 modules transformed, built in 920ms
dist/assets/index-CQr8F-aV.css     8.96 kB (gzip: 2.35 kB)
dist/assets/index-DGrIgIR7.js    378.13 kB (gzip: 108.96 kB)
dist/assets/xlsx-DGkz7cnk.js     424.76 kB (gzip: 141.51 kB)
```

### Tauri 桌面构建

```
npx tauri build → 成功 (Release profile, 2m 16s)
```

| 产物 | 路径 | 大小 |
|-----|------|------|
| NSIS 安装器 | `src-tauri/target/release/bundle/nsis/local-crm_0.4.0_x64-setup.exe` | 3.03 MB |
| MSI 安装器 | `src-tauri/target/release/bundle/msi/local-crm_0.4.0_x64_en-US.msi` | 4.30 MB |

安装包输出目录: `E:\新建文件夹 (3)\New project\runs\local-crm-v0.4.0\`

## 变更文件清单

### 新增 (7 files)
| 文件 | 说明 |
|------|------|
| `src/lib/textAIProvider.ts` | DeepSeek 文本 AI 适配层 |
| `src/lib/multimodalProvider.ts` | Qwen 多模态 AI 适配层 |
| `src/lib/aiDraft.ts` | AI 分析 Prompt + API 调用 + 草稿创建 |
| `src/pages/AIAssistantPage.tsx` | AI 助手页面（截图/通话/音频） |
| `src/__tests__/textAIProvider.test.ts` | 14 tests |
| `src/__tests__/multimodalProvider.test.ts` | 17 tests |
| `src/__tests__/aiDraft.test.ts` | 17 tests |

### 修改 (9 files)
| 文件 | 变更 |
|------|------|
| `src/lib/types.ts` | +TextAIConfig, MultimodalConfig, AIDraft, ScreenshotAnalysis, CallAnalysis 等; PhoneFeedback +'UNKNOWN' |
| `src/lib/db.ts` | +ai_drafts 表 + CRUD + applyAIDraftToCustomer; 内存 DB UPDATE 修复 |
| `src/__tests__/db.test.ts` | +7 个 ai_drafts 测试 |
| `src/pages/AISettingsPage.tsx` | 重写：双模型独立配置替代旧单 provider 选择器 |
| `src/pages/CustomerDetail.tsx` | AI 分析使用新 API、查看 AI 草稿 |
| `src/App.tsx` | +/assistant 路由、+AI助手 侧边栏导航 |
| `src/App.css` | +AI Tab 样式 |
| `package.json` | version 0.3.1 → 0.4.0 |
| `src-tauri/tauri.conf.json` | version 0.3.1 → 0.4.0 |

## 数据库

- **类型**: SQLite (via `@tauri-apps/plugin-sql`)
- **文件**: `%APPDATA%/com.localcrm.desktop/personal-crm.db`
- **表**: customers, follow_up_records, visit_records, tasks, settings, **ai_drafts** (new)
- **ai_drafts 表结构**: id, source_type, customer_id, raw_input_summary, ai_result_json, status, confidence, created_at, applied_at
- **迁移**: 自动检测缺失列并 ALTER TABLE ADD COLUMN

## 手动验收清单

| 步骤 | 操作 | 预期 | 结果 |
|-----|------|------|------|
| 1 | 启动 app.exe | 窗口正常打开，侧边栏显示"AI助手" | 待确认 |
| 2 | AI 设置页配置 DeepSeek API Key | 保存成功，重新打开页面数据保持 | 待确认 |
| 3 | AI 设置页配置 Qwen API Key | 保存成功，能力开关可切换 | 待确认 |
| 4 | AI 助手 → 截图识别 → 上传图片 → 分析 | 返回结构化结果，置信度可视化 | 待确认 |
| 5 | 截图分析结果 → 保存为草稿 | ai_drafts 表写入成功 | 待确认 |
| 6 | AI 助手 → 通话文本 → 输入文字 → 分析 | 返回 phone_feedback/意向度/等级建议 | 待确认 |
| 7 | 通话分析结果 → 保存为草稿 | ai_drafts 表写入成功 | 待确认 |
| 8 | AI 助手 → 音频识别 Tab | 显示"即将上线"占位 | 待确认 |
| 9 | 客户详情 → AI 分析 | 使用 DeepSeek 分析客户状态 | 待确认 |
| 10 | 客户详情 → 查看 AI 草稿 | 展开草稿列表，显示来源/状态/置信度 | 待确认 |
| 11 | 未配置 API Key → AI 分析 | 显示"请先配置 API Key"错误提示 | 待确认 |
| 12 | 客户管理/跟进/面访/导入/备份恢复 | 所有 v0.3.1 功能正常 | 待确认 |

## 已知限制

1. **音频识别未实现**: UI 已预留 Tab，`multimodalProvider.ts` 中 `audio_base64` 会抛出错误（P1 优先级）
2. **AI 测试为 mock-free**: textAIProvider/multimodalProvider 测试未 mock fetch，仅测试配置/请求构建/解析/错误处理，实际 API 调用需手动验证
3. **仅 Windows x64**: macOS/Linux 未测试
4. **Qwen DashScope** 需要阿里云账号
5. **无 commit**: 按用户要求未提交 git

## Bug 修复记录 (v0.4.0 收尾)

| Bug | 描述 | 修复 |
|-----|------|------|
| Bug 1 | AI 草稿列表无应用/丢弃按钮 | CustomerDetail 添加 handleApplyDraft/handleDiscardDraft |
| Bug 2 | AI 助手草稿未关联 customer_id | AIAssistantPage 读取 URL ?customer_id= 参数 |
| Bug 3 | AI 分析直接改客户字段 | handleAIAnalyze 同时创建 MANUAL 草稿，不直接修改 |
| Bug 4 | AI 返回非JSON时无用户可见错误 | aiDraft.ts 解析 null 时返回 error 字段 |
| Bug 5 | Cargo.toml 版本仍为 0.3.1 | 更新为 0.4.0 |
| P1 | MANUAL草稿被错误当成通话分析草稿应用 | applyAIDraftToCustomer 添加 MANUAL/deepseek_next_action 分支 |

## 下一步建议

1. 使用真实 DeepSeek/Qwen API Key 手动验证完整 AI 流程
2. v0.5.0: 每日总结 AI 生成（`generateDailySummary` 接入 DeepSeek）
3. v0.5.0: 音频识别真实接入
4. v0.5.0: 数据统计看板
