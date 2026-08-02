# ADR: Customer Battle Card Backend V1

- 状态：**冻结（FROZEN）**
- 日期：2026-08-01
- 基线 HEAD：`364f0836f6c4614bf8be41ad1918f89ad78f0927`（master，工作树干净）
- 测试基线：166 test files / 2133 tests passed
- 本 ADR 冻结前，A/B/C 三个角色不得同时开始实现。本仓库为单 Agent 顺序执行环境，严格按 A → B → C 执行。

## 1. 当前问题

CRM 已具备客户基础信息、跟进/拜访/任务、ACTIVE Memory（ai_memory_entries）、Lead Workbench、Sales Agent（Proposal/Confirm/Replay 写入边界）。缺少：

1. 战前背调材料的结构化导入能力：目前只能把背调内容丢进 `notes`，无法区分公开事实、推导判断、待验证假设、飞书话术、落地场景、同行参照、风险边界。
2. 事实与假设混存：AI 输出与人工确认内容没有隔离边界，模型推测可能进入客户档案。
3. 阶段作战卡缺失：销售进入每个阶段时没有完整的行动指南、话术、同行参照、POC 路径；无版本化历史，旧卡会被覆盖。
4. 复盘无确定性队列：P0/P1 客户是否缺少下一步、跟进是否逾期、阶段是否停滞，没有可解释的确定性信号。

## 2. 本轮范围

**允许**：SQLite Schema/Migration、TS 领域层、Repository、Sales Agent 后端工具契约、解析与作战卡生成服务、测试、后端开发文档。

**禁止**：前端 UI（App.css、index.css、页面布局、客户详情页、Sales Agent 主舞台）、飞书 CLI/OpenAPI、企业微信、MCP Server、对外 SDK、RAG/Embedding/Vector Store、多 Agent 运行时、自动后台同步、自动修改客户阶段、自动调整客户等级、自动覆盖 Reviewed Fact、自动 Commit/Package/Tag/Push。

**目标变更规模**：15–30 个文件。超过 35 必须暂停解释。

## 3. 数据对象

新增 4 个核心表 + customers 最小指针字段。若仓库已有等价对象则复用，禁止重复建设第二套。

### 3.1 intelligence_imports（原始战前材料，永久保留）

```sql
CREATE TABLE IF NOT EXISTS intelligence_imports (
  id TEXT PRIMARY KEY,
  customer_id TEXT,                      -- 预览阶段可为空；确认时绑定
  source_system TEXT NOT NULL,           -- 如 FEISHU_BTABLE / MANUAL_PASTE
  source_label TEXT,                     -- 如表格名称、批次名
  raw_content TEXT NOT NULL,             -- 原始文本，不可覆盖
  content_hash TEXT NOT NULL,            -- SHA-256(content)，幂等键
  parser_version TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING/DRAFTED/CONFIRMED/CANCELLED
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_intelligence_imports_customer ON intelligence_imports(customer_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_imports_hash ON intelligence_imports(customer_id, source_system, content_hash);
```

- 原始文本不可覆盖（无 UPDATE 路径）。
- 幂等去重键：`customer_id + source_system + content_hash`，由 Repository 层 SELECT 判定（customer_id 为空时 SQLite UNIQUE 不生效，故不用约束强制）。
- Preview 零写入；Cancel 零写入（parse_status 不落库，直接丢弃）。

### 3.2 reviewed_facts（人工确认事实）

```sql
CREATE TABLE IF NOT EXISTS reviewed_facts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  source_import_id TEXT NOT NULL,
  fact_category TEXT NOT NULL,           -- COMPANY/PRODUCT/CHANNEL/MARKET/CERTIFICATION/OPERATION/OTHER
  statement TEXT NOT NULL,
  normalized_value_json TEXT,            -- 可空，结构化归一值
  verification_status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING/VERIFIED/CONFLICTED/SUPERSEDED
  confidence REAL NOT NULL DEFAULT 0.5,  -- 0..1
  applicability TEXT NOT NULL DEFAULT 'GLOBAL',  -- GLOBAL/PARTIAL/CONDITIONAL/UNSUPPORTED
  observed_at TEXT,
  valid_until TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (source_import_id) REFERENCES intelligence_imports(id)
);
CREATE INDEX IF NOT EXISTS idx_reviewed_facts_customer ON reviewed_facts(customer_id, verification_status);
```

- 证据引用复用现有 `ai_memory_evidence_links` 的引用风格：`evidence_refs_json` 元素为 `{ evidence_type, evidence_id }`（CUSTOMER/FOLLOW_UP_RECORD/VISIT_RECORD/TASK）或 `{ import_ref }`。写入前用现有 `SqliteCrmEvidenceResolver` 校验 ownership。
- 无来源内容不能自动成为 VERIFIED；模型推测不得进入 Reviewed Fact。VERIFIED 只能来自人工确认动作。
- 同一事实冲突时生成 CONFLICTED 状态并记录，不得静默覆盖。

### 3.3 customer_hypotheses（待验证假设）

```sql
CREATE TABLE IF NOT EXISTS customer_hypotheses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  source_import_id TEXT,
  category TEXT NOT NULL,                -- 如 PROBLEM/PAIN/ROLE/PROCESS/COMPETITION
  statement TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING/PARTIALLY_CONFIRMED/CONFIRMED/REJECTED/EXPIRED
  applicability TEXT NOT NULL DEFAULT 'CONDITIONAL',
  why_it_matters TEXT,
  validation_question TEXT,
  disconfirm_condition TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  status_audit_json TEXT NOT NULL DEFAULT '[]',   -- 状态变化审计，append-only
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (source_import_id) REFERENCES intelligence_imports(id)
);
CREATE INDEX IF NOT EXISTS idx_customer_hypotheses_customer ON customer_hypotheses(customer_id, status);
```

- 假设与事实严格隔离；状态每次变化追加审计（old_status/new_status/by/reason/at）。
- 假设转事实必须经过明确的人工确认（写入 reviewed_facts），不自动转换。
- REJECTED/EXPIRED 不删除，保留历史。

### 3.4 customer_stage_cards（阶段作战卡版本）

```sql
CREATE TABLE IF NOT EXISTS customer_stage_cards (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  stage_code TEXT NOT NULL,              -- 必须来自现有 CustomerStage 枚举
  version INTEGER NOT NULL,              -- 同一客户同一阶段内单调递增
  schema_version TEXT NOT NULL,          -- 'battle-card-payload-v1'
  card_status TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT/CONFIRMED
  source_import_id TEXT,
  supersedes_card_id TEXT,               -- 被替代的上一张卡 id（DRAFT 不替代）
  payload_json TEXT NOT NULL,            -- 闭合 Schema，见 §6
  evidence_snapshot_hash TEXT NOT NULL,  -- SHA-256(证据/事实/假设快照)
  generated_by TEXT NOT NULL,            -- DETERMINISTIC / MODEL_ENHANCED / MANUAL
  confirmed_by TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (supersedes_card_id) REFERENCES customer_stage_cards(id),
  UNIQUE (customer_id, stage_code, version)
);
CREATE INDEX IF NOT EXISTS idx_customer_stage_cards_customer ON customer_stage_cards(customer_id, stage_code, version DESC);
```

- Append-only：新卡永远 INSERT，旧卡不 UPDATE 不 DELETE。
- 同一客户同一阶段 version 唯一（UNIQUE 约束 + 应用层计算 next version）。
- 客户当前卡只保存指针（customers.current_stage_card_id），不复制内容。
- DRAFT 可被同阶段新 DRAFT 替代（supersedes 不指向 DRAFT 链）；CONFIRMED 卡被确认后才替换 customers 指针。
- 生成卡片不改变客户阶段、不改变等级。

### 3.5 customers 最小指针字段

仅当缺失时由 `ensureCustomerSchema` 增加：

- `current_stage_card_id TEXT`
- `battle_card_status TEXT NOT NULL DEFAULT 'NONE'`（NONE/DRAFT/CONFIRMED/REVIEW_DUE）
- `last_battle_review_at TEXT`

不新增任何战卡业务大字段。`Customer` TS 接口同步增加三个可选字段；`CUSTOMER_UPDATE_FIELDS` 同步放行。

## 4. 事实与假设边界

| 来源 | 去向 | 校验 |
|---|---|---|
| 战前材料正文（主体、公开数据、官方案例披露） | Draft 候选事实 | 无来源不得 VERIFIED |
| 战前材料中的 H1/H2/H3/H4 等假设表述 | Draft 假设 | 永不自动进事实 |
| 模型推导 | 仅 Draft 假设/建议 | 需人工确认才能落 Reviewed Fact |
| 人工确认动作 | Reviewed Fact（VERIFIED） | 单一事务，含 evidence ownership 校验 |
| 销售内部判断（Interaction 记录） | 不得直接作为客户事实 | 卡片引用时标注"内部判断，待验证" |

适用性（Applicability）判定规则（个人护理小家电等复合业务）：

- **GLOBAL**：普遍适用（如"品牌出海、覆盖多国家多平台"）
- **PARTIAL**：部分产品线适用（如"某认证仅部分国家版本"）
- **CONDITIONAL**：需要客户确认适用条件（如"配方/成分"在缺少具体产品线依据时）
- **UNSUPPORTED**：与主体业务缺少依据

禁止粗暴判定：功效表达、内容营销、电气认证、国家版本、电压插头、包装说明书、售后 VOC 在同一业务中共存是合理复合，不构成行业冲突；"配方/成分"缺依据时标 CONDITIONAL，不自动删除、不自动成为全公司已确认事实。

## 5. 战前材料解析（两阶段）

**Stage 1 确定性章节解析**（必走，无 Provider 依赖）：标题/章节结构映射到 14 个标准章节（主体与公开事实、五维战前画像、当前问题假设、FDE/FDA 推荐落地点、为什么值得验证、飞书话术、具体实现路径、同行校准、首轮挖需问题、人工确认门禁、POC 路径、对抗式审查、建议推进、来源）。输出 Import Draft（candidate_customer、extracted_facts、extracted_hypotheses、solution_scenarios、feishu_talk_track、peer_references、validation_questions、human_review_boundaries、poc_hypothesis、risk_boundaries、conditional_applicability_items、parse_warnings、source_mapping）。

**Stage 2 模型辅助分类**（可选）：仅当 Production AI Provider 已配置且用户明确发起解析时允许。使用现有 Trusted Host、封闭输出 Schema、Evidence ownership 验证、不直接写 CRM。Provider 未配置时确定性 Draft 仍完整可用。不得返回 Mock 冒充 AI；不得自动发起 Live Provider 请求。

服务函数：`previewIntelligenceImport(rawContent)` 只读；`confirmIntelligenceImport(draft, humanDecisions)` 单一事务；`cancelIntelligenceImport(draft)` 零写入。

## 6. 阶段作战卡闭合 Schema（payload_json，schema_version='battle-card-payload-v1'）

```jsonc
{
  "action_card": {
    "current_situation": "string",
    "stage_goal": "string",
    "stage_entry_criteria": ["string"],
    "stage_exit_criteria": ["string"],
    "confirmed_facts": [{ "fact_id": "string", "statement": "string", "applicability": "GLOBAL|PARTIAL|CONDITIONAL|UNSUPPORTED", "evidence_refs": ["string"] }],
    "key_hypotheses": [ /* 最多 3 条；不足时显示占位"关键假设不足，仍需补充信息"，禁止编造 */ {
      "hypothesis_id": "string", "statement": "string", "status": "string",
      "applicability": "string", "why_it_matters": "string",
      "validation_question": "string", "disconfirm_condition": "string", "evidence_refs": ["string"]
    }],
    "target_roles": ["string"],
    "must_ask_questions": ["string"],
    "next_best_action": {
      "target_role": "string", "channel": "string", "recommended_time": "string",
      "objective": "string", "opening": "string", "questions": ["string"],
      "success_signal": "string", "failure_signal": "string", "fallback_action": "string"
    },
    "success_signal": "string",
    "failure_signal": "string",
    "risks": ["string"],
    "do_not_say": ["string"],
    "changes_since_previous_card": ["string"],
    "confidence": "string",            // 如 HIGH/MEDIUM/LOW 或 "待验证"
    "evidence_refs": ["string"]
  },
  "solution_reference_card": {
    "feishu_value_statement": {
      "original": "string",            // 来自导入原文，永不被覆盖
      "current": "string",             // 默认=original；后续可人工替换，original 保留
      "short_spoken_version": "string | null",
      "full_spoken_version": "string | null",
      "wechat_version": "string | null",
      "version_history": [{ "at": "string", "from": "string", "to": "string" }]
    },
    "solution_scenarios": [ /* 每条： */ {
      "scenario_name": "string", "applicability": "string",
      "business_objects": ["string"], "problem_hypothesis": "string",
      "feishu_role": "string", "ai_role": "string", "human_gate": "string",
      "systems_not_replaced": ["string"], "acceptance_metrics": ["string"], "evidence_refs": ["string"]
    }],
    "human_review_boundaries": ["string"],
    "peer_references": [ /* 每条： */ {
      "company_name": "string", "comparison_level": "string",
      "why_comparable": "string", "reusable_pattern": "string",
      "non_transferable_boundary": "string", "source_refs": ["string"]
    }],
    "counterexamples_and_boundaries": ["string"],
    "poc_path": ["string"],
    "acceptance_metrics": ["string"],
    "evidence_refs": ["string"]
  }
}
```

规则：
- 两块内容都完整保留，不得压缩阉割。
- 同行参照必须解释为什么可比、借鉴什么、不能照搬什么；不能被当作客户已有相同痛点的证据。
- 缺失证据时明确写"待验证"。
- 生成结果缺证据不编造。

## 7. 写入流程

```
粘贴原始材料
  → previewIntelligenceImport(raw)          // 纯函数，零写入，返回 Import Draft
  → 人工审阅 Draft
  → confirmIntelligenceImport(draft, decisions)  // 单一事务：
  │    1. 校验 customer（或候选客户列表，不猜 customer_id）
  │    2. 幂等检查（customer_id+source_system+content_hash）
  │    3. 写 intelligence_imports（CONFIRMED）
  │    4. 写 reviewed_facts（人工选中的事实）
  │    5. 写 customer_hypotheses（人工保留的假设）
  │    6. 任何一步失败 → 整体回滚，零残留
  → cancelIntelligenceImport(draft)          // 零写入
```

Sales Agent 写工具统一契约：`customer_id` + `expected_version` + `idempotency_key`，输出 `before / proposed / evidence / effect`，经现有 Proposal/Confirm/Replay 边界；Scope 切换后旧 Proposal 失效；Replay 不得二次写入。

## 8. 版本机制（Stage Card）

- 每张卡有 `version`；新 DRAFT 的 version = 同客户同阶段 max(version)+1。
- `supersedes_card_id` 指向被替代的上一张卡；CONFIRMED 替代 CONFIRMED，DRAFT 替代 DRAFT（同阶段内最新一张可被替代）。
- `card_status`：DRAFT（生成后）→ CONFIRMED（人工确认后）。AI 不能自动确认。
- customers.current_stage_card_id 只在 CONFIRMED 时更新。
- `listStageCardHistory` 返回全部版本；`compareStageCards(prev, cur)` 输出字段级差异。
- 阶段码一律来自 `CustomerStage` 枚举（types.ts），禁止发明或重命名阶段；生成卡片不推进阶段。

## 9. 删除及级联规则

- Customer 软删除策略沿用现状（无软删除标志，硬删 + 关联删除 follow_up/visit/task；新对象级联）：
  - `deleteCustomer` 扩展：删除该客户的 intelligence_imports、reviewed_facts、customer_hypotheses、customer_stage_cards（与现有 follow_up/visit/task 删除同级）。原始材料随客户删除而删除，属于客户数据生命周期。
  - DB 层 FOREIGN KEY 只声明不启用级联删除（与现有表一致，避免意外批量删除），删除动作由应用层显式执行。
- 不删除任何历史卡片/假设/导入行（Append-only / 审计保留）。

## 10. 兼容旧客户策略

- 新表全部 `CREATE TABLE IF NOT EXISTS`，不影响 269 个存量客户。
- customers 三个新字段全部可空/默认值；旧客户 battle_card_status='NONE'，不生成任何卡片数据。
- `initializeDatabaseSchema` 顺序：base → customer → leadWorkbench → memory → battleCard。幂等可重复执行。
- Migration 文件对齐惯例新增 `src-tauri/migrations/005_customer_battle_card.sql`（与现有 001–004 同目录；运行时迁移仍由 ensure* 函数驱动，与现状一致）。

## 11. 复用对象清单（禁止重复建设）

| 现有对象 | 复用方式 |
|---|---|
| Customer / customers 表 | 卡片、事实、假设的 customer_id 外键；指针字段 |
| Interaction（follow_up_records/visit_records） | 卡片生成读取；证据引用 |
| Timeline（派生视图） | 卡片生成读取最近互动 |
| Task / tasks 表 | 卡片生成读取；复盘队列逾期信号 |
| Evidence（ai_memory_evidence_links + SqliteCrmEvidenceResolver） | evidence ownership 校验与引用格式 |
| ACTIVE Memory（ai_memory_entries） | 卡片生成读取 |
| Proposal/Confirm/Replay（confirmedWrite + sessionWriteStateStore + agentSession.confirmWriteByRef） | 所有写工具必经边界；扩展 AGENT_WRITE_TOOL_IDS + allowedFields + approvedCrmWriteBoundary.executeOne |
| SalesAgentInteractionController | 不动，工具经 registry/契约扩展 |
| Repository 写入边界（createCrmRepository） | 新 Repository 同风格（DatabaseLike + now 注入） |
| CustomerStage 枚举（types.ts） | 阶段作战卡 stage_code 唯一来源 |

## 12. 不做事项

- 不改前端 UI/页面/样式；不接飞书 CLI；不引入 MCP/RAG/Embedding；不加自动后台同步；不自动改阶段/等级；不自动确认事实/卡片；不自动 Commit/Package/Tag/Push。
- 不新增多 Agent 运行时；不伪造并行结果。
- 不实现卡片 UI 渲染（Workbody 后续负责）。

## 13. 风险与回滚策略

- **测试污染生产 DB**：所有测试仅用 better-sqlite3 `:memory:` 或隔离 E2E identifier；生产 DB（%APPDATA%\com.localcrm.desktop\personal-crm.db）前后记录 SHA-256/size/mtime/quick_check/表 count；检测到误写立即 HOLD。
- **迁移失败**：ensure* 幂等 + 逐条执行；失败时事务语义由调用方保证（单条 DDL 失败不影响其他表；生产路径与现状一致）。
- **文件超限**：超 35 文件暂停解释。
- **回滚**：仓库外 backup bundle（E:\小花专用\_backups\bc-v1\bc-v1-head.bundle）+ source manifest 已生成；实施后如 HOLD，可 `git checkout` 新文件目录并恢复 4 个修改文件的基线版本。
- **阶段码漂移**：stageRules.ts 只从 CustomerStage 枚举映射，测试断言枚举一致性。

## 14. 验收顺序

focused tests → 相邻 readiness tests → 全量 pnpm test → npm run build → cargo check → cargo test → git diff --check → exact cohort guard → 隔离 DB acceptance → 生产 DB 前后指纹比较。最多 5 个完整修复循环；超限 HOLD。
