# V0_1_FINAL_FIX_REPORT

Generated: 2026-08-13 · Branch: feature/battle-card-macos-v1 · Scope: V0.1 FINAL REAL APP GOLDEN JOURNEY FIX (真人验收 blocker 修复,非新功能)

## ROOT_CAUSE_A — Named customer scope resolution

- `ROOT_CAUSE_A` = scope gate 先于 utterance 客户名解析执行。
- 真实调用链:`submit` (src/lib/salesAgentTools/interactionController.ts) → `createAgentIntentEnvelope` (agentIntentEnvelope.ts:230 条件 `is_customer_lookup && !hasAnalysisMeaning` 被"总结"动词短路) → :253 返回 `CUSTOMER_SUMMARY/mode=customer_analysis` 且不带 `customer_reference` → controller :485/:490 分支不命中 → **FIRST_FAILING_BOUNDARY = interactionController.ts:494 直接 blocked("请先定位客户…")**;`executeSearchCustomersTool` 从未被调用。
- 第二层:`filterNormalization.ts` wholeCompanyName 分支 name_query 保留"总结一下"前缀 → SQL LIKE 即使搜索也 0 命中。
- 修复(3 处最小改动):
  1. `filterNormalization.ts`:新增 `stripLeadingAnalysisPrefix`(动词后必须跟"一下/下/冒号"才剥离,真实公司名"分析测试技术有限公司"不会被误剥),name_query 提取为纯实体名。
  2. `agentIntentEnvelope.ts`:245-255 分析分支携带 `portfolio_filters` + `customer_reference`,命名实体不再丢失。
  3. `interactionController.ts`:scope gate 前新增分支——`customer_analysis` + `name_query` 先走 `resolveAndMaybeContinue`(唯一精确命中自动 bind scope;0/多候选走既有澄清链)。
- 行为:0 或 ambiguous>1 仍 clarification;不误绑;写路径不受影响。

## ROOT_CAUSE_B — Structured model output rejected

- `ROOT_CAUSE_B` = provider contract 与 parser contract 不一致,两个失败点:
  1. **第一失败点** `src-tauri/src/trusted_host.rs:1130`:`extract_output` 用裸 `serde_json::from_str(content)` 解析 DeepSeek content。生产模型返回 markdown fenced JSON 或前后缀散文时直接 `host_provider_invalid_json` → 映射为 invalid_schema 文案(与真人观察一致)。
  2. **第二失败点** `build_provider_request` 的 TEXT_REASONING system prompt 只写"Return only JSON matching the requested closed schema",未携带 closed schema 字段清单;而 TS 端 `validateModelOutputSchema` (modelOutputSchemas.ts) 是 exactKeys 严格校验(9 字段全必填、requires_human_review===true、evidence_refs min 1)。模型无法知道精确字段 → 合法输出也易被拒。
- 修复:
  1. `trusted_host.rs`:新增 `parse_provider_json_payload`——容忍 fenced/前后缀包裹,但非对象 JSON、非法 JSON 仍 fail-closed;`MAX_RESPONSE_BYTES` 校验前置;closed schema 校验不变。
  2. `modelOutputSchemas.ts`:新增 `OUTPUT_SCHEMA_SPECS`(7 个 closed schema 字段规格,与 validator 同文件单一事实源)。
  3. `modelContextEnvelope.ts`:envelope 携带 `output_schema_spec` 随请求下发。
  4. `trusted_host.rs` `build_provider_request`:把 spec 注入 system prompt,并做 host 侧加固(≤800 字符、单行、ASCII 白名单,不合法 fallback 通用提示——spec 不会成为指令注入通道)。
- network=false 未现场调真实 DeepSeek;真人证据(provider healthy + 进入真实输出路径 + 被 parser 拒)与代码审计双向一致,B1/B2 fixture + Rust 单测锁定行为。

## ROOT_CAUSE_C — Incorrect UI status semantics

- `ROOT_CAUSE_C` = `runtimeMode.ts` `resolveRuntimeModeUiLabel` 把 `model_called=true + degraded=true`(schema invalid)归入"模型不可用，未进行 AI 推理"——模型其实被调用了、只是输出校验失败。UI 上该标签与"模型输出未通过结构校验"消息同时出现互相矛盾。
- 修复:`ProductionRuntimeOutcome` 五分类 `PROVIDER_UNAVAILABLE / PROVIDER_REQUEST_FAILED / MODEL_OUTPUT_INVALID / MODEL_OUTPUT_VALID / LOCAL_FALLBACK`;schema invalid → "AI 返回结果未通过结构校验，已使用本地数据回退。";unconfigured 与 timeout/network 区分;`failure_category` 从 reasoning path 传入。

## FILES_CHANGED

1. `src-tauri/src/trusted_host.rs` — fenced JSON 容忍解析 + prompt schema spec 注入(host 加固)
2. `src/lib/productionAi/modelOutputSchemas.ts` — OUTPUT_SCHEMA_SPECS 单一事实源
3. `src/lib/productionAi/modelContextEnvelope.ts` — envelope 携带 output_schema_spec
4. `src/lib/productionAi/runtimeMode.ts` — 五分类 outcome + 标签
5. `src/lib/productionAi/productionReasoningPath.ts` — failure_category 透传
6. `src/lib/salesAgentTools/filterNormalization.ts` — 分析动词前缀剥离
7. `src/lib/salesAgentTools/agentIntentEnvelope.ts` — 分析分支携带 filters/reference
8. `src/lib/salesAgentTools/interactionController.ts` — scope gate 前实体解析
9. `src/__tests__/goldenJourneyFix.focused.test.ts` — 新增 A0/A0b/A1/A2/A3 + B1/B2/B3/B4 + C1/C2/C3/C1b 回归
10. `src/__tests__/finalUsabilityChangedFileCohort.ts` — 登记 V0_1_GOLDEN_JOURNEY_FIX 双口径 cohort
11. `src/__tests__/battleCard.dataFidelity.focused.test.ts` — P1-B 守卫注册新 cohort
12. `src/__tests__/transportEquivalenceE2ETruth.focused.test.ts` — 场景数 44→46 静态断言
13. `scripts/real_tauri_e2e.py` — 新增 FAM-045/046 场景
14. `V0_1_FINAL_FIX_REPORT.md` — 本报告

## TESTS

- `npm test`(vitest):**2481/2481 全绿**(192 文件;上轮基线 2468 + 新增 13)
- `cargo test`(production):**55/55**(含新增 fenced/malformed/prompt-spec/hostile-spec 4 个)
- `cargo test --features e2e`:**59/59**

## BUILD

- `npm run build`(tsc -b + vite build):成功,dist 为 production 构建
- `cargo check`(production):通过(仅既有 naming warnings)

## REAL_E2E

真实 GUI E2E(真实 Tauri app + WKWebView + 内嵌 WebDriver + 真实 SQLite + DeterministicFakeNetworkTransport,每场景独立 app 进程 + 独立 DB 备份):

- **FAM-045(新)**:新会话"总结一下广州ABC科技有限公司" → 真实 SQLite 唯一客户(region=NULL 生产形态)→ intent 序列 `SEARCH_CUSTOMERS → CUSTOMER_SUMMARY`(实体解析先于 scope gate 的直接证据)→ 自动建 scope → REAL_MODEL 结果 → **PASS**,DB 零写入,production DB protection 全 pass。
- **FAM-046(新)**:绑定广州ABC科技有限公司后"总结客户现状" → 真实 production parser 路径 → valid structured response → **PASS**,零写入。
- FAM-006 / FAM-011(受影响链回归):**PASS**。

Evidence root:/tmp/e2e-evidence-gj45、/tmp/e2e-evidence-gj46(E2E DB 已加入唯一"广州ABC科技有限公司")。

## READY_FOR_HUMAN_SMOKE

**true** — 请真人在最终 RC .app 上验证:
1. 新会话输入"总结一下广州ABC科技有限公司" → 必须直接找到客户并完成真实 AI 总结;
2. 紧接着输入"这个客户下一步应该怎么推进?" → 必须保持同一 customer scope 并产生真实 AI reasoning。

两条真人 PASS 后才允许 READY_FOR_OSS_RELEASE=true / tag v0.1.0 / GitHub Release。

## STOP_DEVELOPMENT

**true** — 本修复收敛,不进入 Reviewer Loop,不做 V0.2。禁止项(Firecrawl/Agent Reach/Web Search/Agent First/Capability Registry 重构/Dynamic Schema/Dashboard/Opportunity/Voice/Batch Battle Card/UI redesign/RAG/新 schema)一律 BACKLOG ONLY。
