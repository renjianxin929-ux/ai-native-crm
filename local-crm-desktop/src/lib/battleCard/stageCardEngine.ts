/**
 * Battle Card Backend V1 — 阶段作战卡引擎。
 * 生成时读取 Customer/ReviewedFacts/Hypotheses/Interactions/Tasks/ACTIVE Memory/上一张卡/阶段规则。
 * 不自动推进阶段、不调整等级、AI 不能自动确认卡片。
 */

import type { DatabaseLike } from '../db';
import type { Customer, CustomerStage } from '../types';
import { SqliteCrmEvidenceResolver, SqliteMemoryRepository } from '../customerMemory/repository';
import { parseIntelligenceMaterial } from './parser';
import { getStageRule } from './stageRules';
import { BATTLE_CARD_SCHEMA_VERSION } from './schema';
import {
  createBattleCardRepositories,
  parseJsonArray,
  sha256Hex,
  type BattleCardRepositories,
} from './repository';
import type {
  ActionCard,
  ActionCardKeyHypothesis,
  BattleCardPayload,
  CardComparison,
  CustomerStageCardRow,
  FactEvidenceRef,
  FeishuValueStatement,
  HypothesisStatus,
  PeerReference,
  SolutionReferenceCard,
  SolutionScenario,
} from './types';
import { KEY_HYPOTHESIS_INSUFFICIENT_PLACEHOLDER } from './types';

export interface StageCardEngineDeps {
  readonly db: DatabaseLike;
  readonly repos?: BattleCardRepositories;
  readonly clock?: () => string;
  /** 可选模型增强：仅用户明确发起时注入，绝不自动调用。 */
  readonly enhance_with_model?: (payload: BattleCardPayload) => Promise<BattleCardPayload>;
}

export function createStageCardEngine(deps: StageCardEngineDeps) {
  const repos = deps.repos ?? createBattleCardRepositories(deps.db, deps.clock);
  const now = () => deps.clock?.() ?? new Date().toISOString();

  async function loadCustomer(customerId: string): Promise<Customer> {
    const rows = await deps.db.select<Customer>('SELECT * FROM customers WHERE id = ?', [customerId]);
    const customer = rows[0];
    if (!customer) throw new Error(`Customer does not exist: ${customerId}`);
    return customer;
  }

  async function loadActiveMemory(customerId: string): Promise<readonly string[]> {
    const memoryRepository = new SqliteMemoryRepository(deps.db, new SqliteCrmEvidenceResolver(deps.db), now);
    const context = await memoryRepository.getMemoryContext(customerId, { max_items: 20, max_characters: 4000 });
    return context.items.map(item => item.summary);
  }

  async function loadLatestImport(customerId: string): Promise<{ raw: string; importId: string } | null> {
    const imports = await repos.imports.listByCustomer(customerId);
    if (imports.length === 0) return null;
    const latest = imports[0];
    return { raw: latest.raw_content, importId: latest.id };
  }

  function buildActionCard(input: {
    customer: Customer;
    facts: readonly { id: string; statement: string; applicability: string; evidence_refs: readonly string[] }[];
    openHypotheses: readonly {
      id: string; statement: string; status: HypothesisStatus; applicability: string; why_it_matters: string | null;
      validation_question: string | null; disconfirm_condition: string | null; evidence_refs: readonly string[];
    }[];
    activeMemory: readonly string[];
    latestInteractionSummary: string;
    previousPayload: BattleCardPayload | null;
    talkStatement: FeishuValueStatement | null;
    evidenceRefs: readonly string[];
  }): ActionCard {
    const { customer, facts, openHypotheses, activeMemory, latestInteractionSummary, previousPayload, talkStatement, evidenceRefs } = input;
    const rule = getStageRule(customer.stage);

    // 关键假设最多展示 3 条；不足时显示占位，禁止编造
    const keyHypotheses: ActionCardKeyHypothesis[] = openHypotheses.slice(0, 3).map(hypothesis => ({
      hypothesis_id: hypothesis.id,
      statement: hypothesis.statement,
      status: hypothesis.status,
      applicability: hypothesis.applicability,
      why_it_matters: hypothesis.why_it_matters,
      validation_question: hypothesis.validation_question,
      disconfirm_condition: hypothesis.disconfirm_condition,
      evidence_refs: hypothesis.evidence_refs,
    }));
    if (keyHypotheses.length < 3) {
      keyHypotheses.push({
        hypothesis_id: 'insufficient',
        statement: KEY_HYPOTHESIS_INSUFFICIENT_PLACEHOLDER,
        status: 'PENDING',
        applicability: 'CONDITIONAL',
        why_it_matters: null,
        validation_question: null,
        disconfirm_condition: null,
        evidence_refs: [],
      });
    }

    const mustAskQuestions = openHypotheses
      .map(hypothesis => hypothesis.validation_question)
      .filter((question): question is string => Boolean(question && question.trim()))
      .slice(0, 5);

    const channel = channelForStage(customer.stage);
    const recommendedTime = customer.next_follow_up_at ?? null;
    const opening = talkStatement && talkStatement.current.trim()
      ? talkStatement.current.split('\n')[0]?.slice(0, 80) ?? ''
      : `您好，${customer.name}，想和您约 ${rule.target_roles[0] ?? '负责人'} 聊一下近期的${customer.industry ?? '业务'}场景。`;

    const risks = [
      ...facts.filter(fact => fact.applicability === 'CONDITIONAL').map(fact => `条件适用项未经确认前不得扩大承诺: ${fact.statement.slice(0, 40)}`),
      ...openHypotheses.filter(hypothesis => hypothesis.disconfirm_condition).map(hypothesis => `假设若被证伪需及时转向: ${hypothesis.statement.slice(0, 40)}`),
    ];
    const doNotSay = facts
      .filter(fact => fact.applicability === 'CONDITIONAL')
      .map(fact => `未经客户确认不得断言“${fact.statement.slice(0, 30)}”`);

    const changesSincePreviousCard = previousPayload
      ? summarizeChanges(previousPayload, {
        facts,
        openHypotheses,
        latestInteractionSummary,
        talkStatement,
      })
      : ['首张作战卡（无上一张可比）'];

    const confidence = facts.length >= 3 && openHypotheses.length >= 1
      ? 'HIGH'
      : facts.length >= 1 ? 'MEDIUM' : 'LOW';

    return {
      current_situation: `客户 ${customer.name}（${customer.region ?? '地区未知'} / ${customer.industry ?? '行业未知'}），等级 ${customer.customer_grade}，当前阶段 ${rule.label}。${latestInteractionSummary}${activeMemory.length > 0 ? ` ACTIVE Memory: ${activeMemory.slice(0, 3).join('；')}` : ''}`,
      stage_goal: rule.stage_goal,
      stage_entry_criteria: [...rule.stage_entry_criteria],
      stage_exit_criteria: [...rule.stage_exit_criteria],
      confirmed_facts: facts.map(fact => ({
        fact_id: fact.id,
        statement: fact.statement,
        applicability: fact.applicability as ActionCard['confirmed_facts'][number]['applicability'],
        evidence_refs: fact.evidence_refs,
      })),
      key_hypotheses: keyHypotheses,
      target_roles: [...rule.target_roles],
      must_ask_questions: mustAskQuestions,
      next_best_action: {
        target_role: rule.target_roles[0] ?? '决策人',
        channel,
        recommended_time: recommendedTime ?? '待定（建议 1-2 个工作日内）',
        objective: `完成「${rule.stage_goal}」的下一步动作`,
        opening,
        questions: mustAskQuestions.length > 0 ? mustAskQuestions : ['当前业务的最大瓶颈是什么？'],
        success_signal: rule.stage_exit_criteria[0] ?? '客户给出明确正面反馈',
        failure_signal: rule.stage_exit_criteria.some(criteria => criteria.includes('拒绝'))
          ? '客户明确拒绝'
          : '客户连续两次无回应',
        fallback_action: '降级为低频维护（LOW_FREQUENCY），两周后再次触达',
      },
      success_signal: rule.stage_exit_criteria[0] ?? '客户给出明确正面反馈',
      failure_signal: '客户明确拒绝或连续两次无回应',
      risks,
      do_not_say: doNotSay,
      changes_since_previous_card: changesSincePreviousCard,
      confidence,
      evidence_refs: evidenceRefs,
    };
  }

  function buildSolutionReferenceCard(input: {
    talkStatement: FeishuValueStatement | null;
    scenarios: readonly SolutionScenario[];
    humanReviewBoundaries: readonly string[];
    peers: readonly PeerReference[];
    counterexamples: readonly string[];
    pocPath: readonly string[];
    evidenceRefs: readonly string[];
  }): SolutionReferenceCard {
    const { talkStatement, scenarios, humanReviewBoundaries, peers, counterexamples, pocPath, evidenceRefs } = input;
    const acceptanceMetrics = [
      ...new Set(scenarios.flatMap(scenario => scenario.acceptance_metrics).filter(Boolean)),
    ];
    return {
      feishu_value_statement: talkStatement ?? {
        original: '',
        current: '',
        short_spoken_version: null,
        full_spoken_version: null,
        wechat_version: null,
        version_history: [],
      },
      solution_scenarios: scenarios,
      human_review_boundaries: humanReviewBoundaries,
      peer_references: peers,
      counterexamples_and_boundaries: counterexamples,
      poc_path: pocPath,
      acceptance_metrics: acceptanceMetrics.length > 0 ? acceptanceMetrics : ['待人工补充验收指标'],
      evidence_refs: evidenceRefs,
    };
  }

  function buildPayload(input: {
    customer: Customer;
    previousPayload: BattleCardPayload | null;
    facts: readonly { id: string; statement: string; applicability: string; evidence_refs: readonly string[] }[];
    openHypotheses: readonly {
      id: string; statement: string; status: HypothesisStatus; applicability: string; why_it_matters: string | null;
      validation_question: string | null; disconfirm_condition: string | null; evidence_refs: readonly string[];
    }[];
    activeMemory: readonly string[];
    latestInteractionSummary: string;
    talkStatement: FeishuValueStatement | null;
    scenarios: readonly SolutionScenario[];
    humanReviewBoundaries: readonly string[];
    peers: readonly PeerReference[];
    counterexamples: readonly string[];
    pocPath: readonly string[];
    evidenceRefs: readonly string[];
  }): BattleCardPayload {
    const evidenceRefs = input.evidenceRefs;
    const actionCard = buildActionCard({ ...input, evidenceRefs });
    const solutionReferenceCard = buildSolutionReferenceCard({ ...input, evidenceRefs });
    return { action_card: actionCard, solution_reference_card: solutionReferenceCard };
  }

  return {
    async generateStageCardDraft(customerId: string, stageCode: CustomerStage): Promise<CustomerStageCardRow> {
      const customer = await loadCustomer(customerId);
      const at = now();

      // 1) Reviewed Facts（VERIFIED）
      const factRows = await repos.facts.listByCustomer(customerId, { verification_status: 'VERIFIED' });
      const facts = factRows.map(fact => ({
        id: fact.id,
        statement: fact.statement,
        applicability: fact.applicability,
        evidence_refs: [
          ...parseJsonArray<FactEvidenceRef>(fact.evidence_refs_json).map(ref => ref.import_ref ?? (ref.evidence_type && ref.evidence_id ? `${ref.evidence_type}:${ref.evidence_id}` : '')),
          `reviewed_fact:${fact.id}`,
        ].filter(Boolean),
      }));

      // 2) Open Hypotheses（完整假设保留在 customer_hypotheses，主卡只展示 3 条）
      const hypothesisRows = await repos.hypotheses.listOpen(customerId);
      const openHypotheses = hypothesisRows.map(hypothesis => ({
        id: hypothesis.id,
        statement: hypothesis.statement,
        status: hypothesis.status,
        applicability: hypothesis.applicability,
        why_it_matters: hypothesis.why_it_matters,
        validation_question: hypothesis.validation_question,
        disconfirm_condition: hypothesis.disconfirm_condition,
        evidence_refs: parseJsonArray<FactEvidenceRef>(hypothesis.evidence_refs_json)
          .map(ref => ref.import_ref ?? (ref.evidence_type && ref.evidence_id ? `${ref.evidence_type}:${ref.evidence_id}` : ''))
          .filter(Boolean),
      }));

      // 3) 最近 Interaction / Timeline（follow_ups + visits）
      const [followUps, visits, tasks] = await Promise.all([
        deps.db.select<{ created_at: string; title: string; feedback_notes: string | null }>(
          'SELECT created_at, title, feedback_notes FROM follow_up_records WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5',
          [customerId],
        ),
        deps.db.select<{ created_at: string; title: string; visit_notes: string | null }>(
          'SELECT created_at, title, visit_notes FROM visit_records WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5',
          [customerId],
        ),
        deps.db.select<{ id: string; created_at: string; title: string; status: string }>(
          'SELECT id, created_at, title, status FROM tasks WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5',
          [customerId],
        ),
      ]);
      const latestInteractionSummary = [
        ...followUps.map(row => `跟进(${row.created_at.slice(0, 10)}): ${row.title}${row.feedback_notes ? ` ${row.feedback_notes.slice(0, 50)}` : ''}`),
        ...visits.map(row => `拜访(${row.created_at.slice(0, 10)}): ${row.title}${row.visit_notes ? ` ${row.visit_notes.slice(0, 50)}` : ''}`),
      ];
      const latestInteractionSummaryText = latestInteractionSummary.length > 0
        ? `最近互动: ${latestInteractionSummary.slice(0, 3).join('；')}`
        : '暂无互动记录';

      // 4) ACTIVE Memory
      const activeMemory = await loadActiveMemory(customerId);

      // 5) 上一张卡（同阶段最新）
      const previousCard = await repos.cards.latestForStage(customerId, stageCode);
      const previousPayload = previousCard ? parsePayload(previousCard.payload_json) : null;

      // 6) 最新导入 → 飞书话术 / 场景 / 同行 / POC / 风险 / 人工门禁
      const latestImport = await loadLatestImport(customerId);
      let talkStatement: FeishuValueStatement | null = null;
      let scenarios: readonly SolutionScenario[] = [];
      let peers: readonly PeerReference[] = [];
      let humanReviewBoundaries: readonly string[] = [];
      let counterexamples: readonly string[] = [];
      let pocPath: readonly string[] = [];
      if (latestImport) {
        const parsed = parseIntelligenceMaterial(latestImport.raw);
        talkStatement = parsed.feishu_talk_track.value_statement;
        scenarios = parsed.solution_scenarios.map(scenario => ({
          scenario_name: scenario.scenario_name,
          applicability: scenario.applicability,
          business_objects: scenario.business_objects,
          problem_hypothesis: scenario.problem_hypothesis,
          feishu_role: scenario.feishu_role,
          ai_role: scenario.ai_role,
          human_gate: scenario.human_gate,
          systems_not_replaced: scenario.systems_not_replaced,
          acceptance_metrics: scenario.acceptance_metrics,
          evidence_refs: scenario.evidence_refs.map(ref => ref.import_ref ?? ''),
        }));
        peers = parsed.peer_references.map(peer => ({
          company_name: peer.company_name,
          comparison_level: peer.comparison_level,
          why_comparable: peer.why_comparable,
          reusable_pattern: peer.reusable_pattern,
          non_transferable_boundary: peer.non_transferable_boundary,
          source_refs: peer.source_refs.map(ref => ref.import_ref ?? ''),
        }));
        humanReviewBoundaries = parsed.human_review_boundaries;
        counterexamples = parsed.risk_boundaries;
        pocPath = parsed.poc_hypothesis ? [parsed.poc_hypothesis] : [];
      }

      const evidenceRefs = [
        ...facts.flatMap(fact => fact.evidence_refs),
        ...openHypotheses.flatMap(hypothesis => hypothesis.evidence_refs),
        `customer:${customerId}`,
        `stage:${stageCode}`,
      ];

      // 7) 组装 payload
      const payload = buildPayload({
        customer,
        previousPayload,
        facts,
        openHypotheses,
        activeMemory,
        latestInteractionSummary: latestInteractionSummaryText,
        talkStatement,
        scenarios,
        humanReviewBoundaries,
        peers,
        counterexamples,
        pocPath,
        evidenceRefs,
      });

      // 可选模型增强（仅显式注入时；增强不改变事实与假设存储）
      let generatedBy: CustomerStageCardRow['generated_by'] = 'DETERMINISTIC';
      let finalPayload = payload;
      if (deps.enhance_with_model) {
        finalPayload = await deps.enhance_with_model(payload);
        generatedBy = 'MODEL_ENHANCED';
      }

      // 8) 版本与证据快照
      const version = await repos.cards.nextVersion(customerId, stageCode);
      const latestCard = await repos.cards.latestForStage(customerId, stageCode);
      const evidenceSnapshotHash = await sha256Hex(JSON.stringify({
        facts: facts.map(fact => fact.id),
        hypotheses: openHypotheses.map(hypothesis => hypothesis.id),
        interactions: [...followUps, ...visits].slice(0, 5).map(row => row.created_at),
        tasks: tasks.map(task => task.id),
        active_memory: activeMemory,
      }));

      const card = await repos.cards.insert({
        id: `card-${customerId}-${stageCode}-v${version}-${at.replace(/\D/g, '').slice(0, 14)}`,
        customer_id: customerId,
        stage_code: stageCode,
        version,
        schema_version: BATTLE_CARD_SCHEMA_VERSION,
        card_status: 'DRAFT',
        source_import_id: latestImport?.importId ?? null,
        supersedes_card_id: latestCard?.id ?? null,
        payload_json: JSON.stringify(finalPayload),
        evidence_snapshot_hash: evidenceSnapshotHash,
        generated_by: generatedBy,
        confirmed_by: null,
        created_at: at,
        confirmed_at: null,
      });

      // 客户战斗卡状态 → DRAFT（不推进阶段、不调整等级）
      await deps.db.execute(
        `UPDATE customers SET battle_card_status = 'DRAFT', updated_at = ? WHERE id = ?`,
        [at, customerId],
      );
      return card;
    },

    async confirmStageCard(cardId: string, by: string): Promise<CustomerStageCardRow> {
      const confirmed = await repos.cards.confirm(cardId, by, now());
      return confirmed;
    },

    async getCurrentStageCard(customerId: string): Promise<CustomerStageCardRow | null> {
      const customer = await loadCustomer(customerId);
      if (!customer.current_stage_card_id) return null;
      return repos.cards.get(customer.current_stage_card_id);
    },

    async listStageCardHistory(customerId: string): Promise<CustomerStageCardRow[]> {
      return repos.cards.listByCustomer(customerId);
    },

    async compareStageCards(previousId: string, currentId: string): Promise<CardComparison> {
      const previous = await repos.cards.get(previousId);
      const current = await repos.cards.get(currentId);
      if (!previous || !current) throw new Error('One of the stage cards does not exist.');
      return comparePayloads(previous, current);
    },
  };
}

export function parsePayload(raw: string): BattleCardPayload {
  try {
    const value = JSON.parse(raw) as BattleCardPayload;
    if (!value.action_card || !value.solution_reference_card) {
      throw new Error('Stage card payload is not a closed battle card schema.');
    }
    return value;
  } catch (error) {
    throw new Error(`Stage card payload is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function channelForStage(stage: CustomerStage): string {
  switch (stage) {
    case 'NEW_LEAD':
    case 'CONTACTED':
      return 'wechat + phone';
    case 'VISIT_READY':
      return 'visit';
    case 'CONTRACTING':
    case 'PAYMENT_PENDING':
      return 'wechat + phone';
    default:
      return 'wechat';
  }
}

function summarizeChanges(
  previous: BattleCardPayload,
  current: {
    facts: readonly { id: string; statement: string }[];
    openHypotheses: readonly { id: string; statement: string; status: string }[];
    latestInteractionSummary: string;
    talkStatement: FeishuValueStatement | null;
  },
): string[] {
  const changes: string[] = [];
  const previousFactIds = new Set(previous.action_card.confirmed_facts.map(fact => fact.fact_id));
  for (const fact of current.facts) {
    if (!previousFactIds.has(fact.id)) changes.push(`新增已确认事实: ${fact.statement.slice(0, 40)}`);
  }
  for (const fact of previous.action_card.confirmed_facts) {
    if (!current.facts.some(candidate => candidate.id === fact.fact_id)) {
      changes.push(`事实状态变化（不再计入 VERIFIED）: ${fact.statement.slice(0, 40)}`);
    }
  }
  const previousHypothesisIds = new Set(previous.action_card.key_hypotheses.map(hypothesis => hypothesis.hypothesis_id));
  for (const hypothesis of current.openHypotheses) {
    if (!previousHypothesisIds.has(hypothesis.id)) changes.push(`新增待验证假设: ${hypothesis.statement.slice(0, 40)}`);
  }
  changes.push(`当前互动状态: ${current.latestInteractionSummary.slice(0, 60)}`);
  return changes;
}

/** 比较以两张卡的行级 stage/version 为准；payload 不含 stage_code。 */

export function comparePayloads(previous: CustomerStageCardRow, current: CustomerStageCardRow): CardComparison {
  const previousPayload = parsePayload(previous.payload_json);
  const currentPayload = parsePayload(current.payload_json);
  const changes: { section: string; path: string; from: unknown; to: unknown }[] = [];
  const changedSections = new Set<string>();

  const diffSection = (section: string, fromValue: unknown, toValue: unknown, path = section) => {
    if (JSON.stringify(fromValue) === JSON.stringify(toValue)) return;
    changedSections.add(section);
    if (fromValue !== null && toValue !== null && typeof fromValue === 'object' && typeof toValue === 'object'
      && !Array.isArray(fromValue) && !Array.isArray(toValue)) {
      const keys = new Set([...Object.keys(fromValue as Record<string, unknown>), ...Object.keys(toValue as Record<string, unknown>)]);
      for (const key of keys) {
        diffSection(section, (fromValue as Record<string, unknown>)[key], (toValue as Record<string, unknown>)[key], `${path}.${key}`);
      }
      return;
    }
    changes.push({ section, path, from: fromValue, to: toValue });
  };

  diffSection('action_card', previousPayload.action_card, currentPayload.action_card);
  diffSection('solution_reference_card', previousPayload.solution_reference_card, currentPayload.solution_reference_card);

  return {
    previous_card_id: previous.id,
    current_card_id: current.id,
    stage_code: current.stage_code,
    previous_version: previous.version,
    current_version: current.version,
    changed_sections: [...changedSections],
    changes,
  } as CardComparison;
}
