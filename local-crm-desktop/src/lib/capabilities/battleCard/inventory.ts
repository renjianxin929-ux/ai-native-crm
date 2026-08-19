/**
 * V0.2A / A7R — Battle Card READ Capability Inventory (audit evidence).
 *
 * 审计结论基于当前产品源码（read-only 审计，file:line 级证据）：
 * 只记录"真实存在的 Battle Card 产品读行为"；repository helper / legacy agent
 * tool 声明 / UI 组件存在本身都不是产品能力证据（§3 FIRST PRINCIPLE）。
 *
 * 生产 manifest（manifest.ts）只允许包含 product_capability_exists=true 且
 * final_status='VERIFIED' 的能力。
 *
 * 审计证据来源（全部为产品现有源码）：
 * - Read Current Battle Card（当前作战卡）:
 *   - 产品 UI：pages/CustomerBattleCardPage.tsx:61 client.getCurrentStageCard(id)
 *     （路由 /customers/:id/battle-card，App.tsx:107；入口 CustomerDetail.tsx:388-389）；
 *     components/aiNative/SalesAgentBattleCardEntry.tsx:33 也消费同一读取。
 *   - 执行路径：lib/battleCardUi/battleCardClient.ts:137-141 → lib/battleCard/agentTools.ts:154-156
 *     → lib/battleCard/stageCardEngine.ts:402-406 getCurrentStageCard
 *     （customers.current_stage_card_id 客户指针 → repos.cards.get(cardId)；
 *     未知客户 loadCustomer 抛 Error，fail closed）。
 *   - 已注册只读 agent 工具 get_current_stage_card（agentTools.ts:54-57，access='read'）。
 * - Read Battle Card Version History（版本历史）:
 *   - 产品 UI：CustomerBattleCardPage.tsx:62 client.listStageCardHistory(id) →
 *     VersionHistoryPanel（components/battleCard/VersionHistoryPanel.tsx，bc-history-panel），
 *     handleViewVersion（CustomerBattleCardPage.tsx:213-219）可查看任意历史版本（只读）。
 *   - 执行路径：battleCardClient.ts:143-147 → agentTools.ts:189-191
 *     → stageCardEngine.ts:408-410 listStageCardHistory → repos.cards.listByCustomer
 *     （customer_stage_cards WHERE customer_id = ? ORDER BY created_at ASC, version ASC, id ASC；
 *     append-only 版本表，schema.ts:71-91 UNIQUE(customer_id, stage_code, version)）。
 *   - 已注册只读 agent 工具 list_stage_card_history（agentTools.ts:66-69）。
 * - Read Customer Battle Context（客户作战上下文聚合）:
 *   - 产品 UI：components/aiNative/SalesAgentBattleCardEntry.tsx:34
 *     client.getCustomerBattleContext(customerId)（展示阶段/版本/待验证假设数）。
 *   - 执行路径：battleCardClient.ts:192-196 → agentTools.ts:233-252
 *     （repos.facts/hypotheses/cards/imports 四源 listByCustomer + engine.getCurrentStageCard，
 *     均为 customer_id 范围 SELECT）。
 *   - 已注册只读 agent 工具 get_customer_battle_context（agentTools.ts:82-85）。
 * - Read Stage Card / Applicability（阶段规则与适用性）:
 *   - stageRules.ts 是生成/复盘引擎的静态规则表（getStageRule 被 stageCardEngine /
 *     dailyReview / CustomerBattleCardPage 提示使用），不是独立读原语。
 *   - applicabilityContract.ts 的 determineApplicabilityByContract 仅被
 *     lib/battleCard/parser.ts:363-366 作为导入解析的内部判定使用。
 *   - 分类：NOT_DISTINCT（内部投影/规则表，不得发明 battle_card.stage.read 或
 *     battle_card.applicability.read，§8）。
 * - Read Daily Review Battle Card Queue（每日复盘队列）:
 *   - dailyReview.ts buildDailyBattleReviewQueue 是跨客户聚合 + 8 条确定性规则的
 *     更高层 workflow 投影（DailyBattleReviewPage.tsx:38 消费），消费 Battle Card
 *     但本身不是 Battle Card 域读取原语。保留现有边界，不注册（§10）。
 * - Read Battle Card Evidence（证据）:
 *   - Battle Card payload 内嵌 evidence_refs（types.ts ActionCard/SolutionReferenceCard），
 *     现有读取路径原样返回（CustomerBattleCardPage EvidenceDrawer 消费）。
 *     A7R 保留这些内嵌引用；evidence.read/search/get 概念上属于 Evidence 域，但
 *     A8R 审计已证明当前不存在独立的 Evidence 产品表面（CURRENT INDEPENDENT
 *     EVIDENCE CAPABILITY SET = EMPTY），A7R 不注册任何 Evidence 域原语（§9）。
 * - Compare Stage Cards（compare_stage_cards）:
 *   - 仅 agent 工具声明 + 测试消费（battleCard.stageCard.focused.test.ts:293 /
 *     battleCardUi.integration.test.ts:209），无生产 UI/运行时消费者。
 *     分类：NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY（agent tool 声明 ≠ 产品能力，§11）。
 */

export type BattleCardReadCandidateId =
  | 'read_current_battle_card'
  | 'read_battle_card_version_history'
  | 'read_customer_battle_context'
  | 'read_stage_card_applicability'
  | 'read_daily_review_queue'
  | 'read_battle_card_evidence'
  | 'compare_stage_cards';

export type BattleCardReadA7rAction = 'REGISTER_EXISTING' | 'NOT_APPLICABLE';

export type BattleCardReadFinalStatus = 'VERIFIED' | 'NOT_DISTINCT' | 'HIGHER_LEVEL_WORKFLOW' | 'OTHER_DOMAIN_OWNERSHIP';

export interface BattleCardReadInventoryEntry {
  readonly candidate: BattleCardReadCandidateId;
  readonly label: string;
  readonly product_capability_exists: boolean;
  /** 现有产品源码位置（只读审计证据）。 */
  readonly existing_source_path: readonly string[];
  /** 现有执行路径（生产行为）。 */
  readonly existing_execution_path: string;
  /** 是否已有注册的 Battle Card agent 工具（仅信息；工具存在 ≠ 产品能力，§11）。 */
  readonly agent_tool_already_exists: boolean;
  readonly a7r_action: BattleCardReadA7rAction;
  readonly final_status: BattleCardReadFinalStatus;
  /** 非 VERIFIED 时必须给出精确理由。 */
  readonly classification_reason: string;
}

/** 深度冻结（条目对象含只读字符串字段，冻结对象本身即可防篡改）。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export const BATTLE_CARD_READ_INVENTORY: readonly BattleCardReadInventoryEntry[] = deepFreeze([
  {
    candidate: 'read_current_battle_card',
    label: 'Read Current Battle Card',
    product_capability_exists: true,
    existing_source_path: [
      'src/pages/CustomerBattleCardPage.tsx',
      'src/components/aiNative/SalesAgentBattleCardEntry.tsx',
      'src/lib/battleCardUi/battleCardClient.ts',
      'src/lib/battleCard/agentTools.ts',
      'src/lib/battleCard/stageCardEngine.ts',
      'src/lib/battleCard/repository.ts',
    ],
    existing_execution_path:
      "getBattleCardUiClient().getCurrentStageCard(customerId) → createBattleCardAgentTools → engine.getCurrentStageCard → customers.current_stage_card_id pointer → repos.cards.get(cardId); unknown customer fails closed (loadCustomer throws)",
    agent_tool_already_exists: true,
    a7r_action: 'REGISTER_EXISTING',
    final_status: 'VERIFIED',
    classification_reason:
      'Real product UI surface (CustomerBattleCardPage.tsx:61 / SalesAgentBattleCardEntry.tsx:33) with a real existing execution path (stageCardEngine.getCurrentStageCard via customer pointer). Distinct stable read capability.',
  },
  {
    candidate: 'read_battle_card_version_history',
    label: 'Read Battle Card Version History',
    product_capability_exists: true,
    existing_source_path: [
      'src/pages/CustomerBattleCardPage.tsx',
      'src/components/battleCard/VersionHistoryPanel.tsx',
      'src/lib/battleCardUi/battleCardClient.ts',
      'src/lib/battleCard/agentTools.ts',
      'src/lib/battleCard/stageCardEngine.ts',
      'src/lib/battleCard/repository.ts',
    ],
    existing_execution_path:
      "getBattleCardUiClient().listStageCardHistory(customerId) → engine.listStageCardHistory → repos.cards.listByCustomer (customer_stage_cards WHERE customer_id = ? ORDER BY created_at ASC, version ASC, id ASC; append-only versions)",
    agent_tool_already_exists: true,
    a7r_action: 'REGISTER_EXISTING',
    final_status: 'VERIFIED',
    classification_reason:
      'Distinct stable product behavior: VersionHistoryPanel (bc-history-panel) is reachable from CustomerBattleCardPage.tsx:62 + 373-385 and lets the user open any historical version read-only (handleViewVersion, CustomerBattleCardPage.tsx:213-219). Not merely historical rows in storage.',
  },
  {
    candidate: 'read_customer_battle_context',
    label: 'Read Customer Battle Context',
    product_capability_exists: true,
    existing_source_path: [
      'src/components/aiNative/SalesAgentBattleCardEntry.tsx',
      'src/lib/battleCardUi/battleCardClient.ts',
      'src/lib/battleCard/agentTools.ts',
    ],
    existing_execution_path:
      "getBattleCardUiClient().getCustomerBattleContext(customerId) → createBattleCardAgentTools → 4× repos.*.listByCustomer (facts/hypotheses/cards/imports) + engine.getCurrentStageCard, all customer_id-scoped SELECTs",
    agent_tool_already_exists: true,
    a7r_action: 'REGISTER_EXISTING',
    final_status: 'VERIFIED',
    classification_reason:
      'Real product UI consumer (SalesAgentBattleCardEntry.tsx:34 shows stage/version/pending-hypothesis count). Returns battle-card-domain entities only (facts/hypotheses/imports/cards summaries + current card); embedded evidence refs preserved as-is. Evidence primitives (evidence.read/search/get) conceptually belong to the Evidence domain, but A8R audit proved the current independent Evidence capability set is EMPTY — no standalone Evidence product surface exists — so A7R registers none.',
  },
  {
    candidate: 'read_stage_card_applicability',
    label: 'Read Stage Card / Applicability',
    product_capability_exists: false,
    existing_source_path: ['src/lib/battleCard/stageRules.ts', 'src/lib/battleCard/applicabilityContract.ts', 'src/lib/battleCard/parser.ts'],
    existing_execution_path: 'N/A — stage rules are static rule tables consumed by card generation/review; applicability is an internal derivation inside import parsing (parser.ts:363-366)',
    agent_tool_already_exists: false,
    a7r_action: 'NOT_APPLICABLE',
    final_status: 'NOT_DISTINCT',
    classification_reason:
      'Stage rules (stageRules.ts) and applicability (applicabilityContract.ts) are internal derived projections used to generate/render Battle Card, not independent user-visible stable read capabilities. Per §8 do not invent battle_card.stage.read / battle_card.applicability.read.',
  },
  {
    candidate: 'read_daily_review_queue',
    label: 'Read Daily Review Battle Card Queue',
    product_capability_exists: true,
    existing_source_path: ['src/pages/DailyBattleReviewPage.tsx', 'src/lib/battleCard/dailyReview.ts', 'src/lib/battleCard/agentTools.ts'],
    existing_execution_path:
      "getBattleCardUiClient().buildDailyReviewQueue() → createBattleCardAgentTools → dailyReview.buildDailyBattleReviewQueue (cross-customer aggregation + 8 deterministic scoring rules + sorting; consumes battle cards)",
    agent_tool_already_exists: true,
    a7r_action: 'NOT_APPLICABLE',
    final_status: 'HIGHER_LEVEL_WORKFLOW',
    classification_reason:
      'Daily Review is a higher-level cross-customer workflow/projection (8 deterministic rules + urgency scoring + sorting), not a Battle Card domain read primitive. Per §10 the existing boundary is preserved; A7R does not absorb daily_review.read.',
  },
  {
    candidate: 'read_battle_card_evidence',
    label: 'Read Battle Card Evidence',
    product_capability_exists: false,
    existing_source_path: ['src/lib/battleCard/types.ts', 'src/lib/battleCardUi/battleCardViewModels.ts'],
    existing_execution_path: 'N/A — Battle Card payload embeds evidence_refs that the existing read path returns verbatim; no evidence.* read primitive exists in the battle card domain',
    agent_tool_already_exists: false,
    a7r_action: 'NOT_APPLICABLE',
    final_status: 'OTHER_DOMAIN_OWNERSHIP',
    classification_reason:
      'Battle Card containing evidence references ≠ Battle Card domain owning an Evidence capability. evidence.read / evidence.search / evidence.get conceptually belong to the Evidence domain, but A8R audit proved the current independent Evidence capability set is EMPTY (no standalone Evidence product surface currently exists) — A7R must not imply they exist today; A7R preserves embedded evidence refs only and registers no Evidence primitives (§9).',
  },
  {
    candidate: 'compare_stage_cards',
    label: 'Compare Stage Cards',
    product_capability_exists: false,
    existing_source_path: ['src/lib/battleCard/agentTools.ts', 'src/lib/battleCard/stageCardEngine.ts'],
    existing_execution_path: 'N/A — no production UI/runtime consumer; only agent tool declaration and tests (battleCard.stageCard.focused.test.ts:293, battleCardUi.integration.test.ts:209)',
    agent_tool_already_exists: true,
    a7r_action: 'NOT_APPLICABLE',
    final_status: 'NOT_DISTINCT',
    classification_reason:
      'Agent tool declaration alone is not product-capability proof (§11). compare_stage_cards has no production consumer, so it is intentionally absent from the production manifest.',
  },
]);

/** 仅真实存在且验证通过的能力才进入生产 manifest 的候选集合（供测试断言 manifest 与清单一致）。 */
export const VERIFIED_BATTLE_CARD_READ_CANDIDATES: readonly BattleCardReadCandidateId[] = deepFreeze(
  BATTLE_CARD_READ_INVENTORY
    .filter((entry) => entry.product_capability_exists && entry.final_status === 'VERIFIED')
    .map((entry) => entry.candidate),
);
