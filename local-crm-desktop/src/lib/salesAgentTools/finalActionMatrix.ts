import type { ClosedAgentIntent } from './agentIntentEnvelope';

export type FinalActionMatrixCategory = 'SEARCH' | 'ANALYSIS' | 'WRITE' | 'CAPTURE';
export type FinalActionMatrixAcceptanceLayer = 'parser' | 'controller' | 'session' | 'trusted_host' | 'repository' | 'component' | 'real_tauri_ui';

export interface FinalActionMatrixScenario {
  readonly scenario_id: string;
  readonly category: FinalActionMatrixCategory;
  readonly user_input: string;
  readonly prerequisites: readonly string[];
  readonly expected_intent: ClosedAgentIntent;
  readonly expected_state_sequence: readonly string[];
  readonly expected_model_mode: 'LOCAL_DETERMINISTIC' | 'REAL_MODEL' | 'MODEL_UNAVAILABLE' | 'NO_MODEL';
  readonly expected_db_mutation: 'NONE' | 'PROPOSAL_ONLY' | 'CONFIRMED_ISOLATED_WRITE';
  readonly expected_ui: string;
  readonly forbidden_behavior: readonly string[];
  readonly acceptance_layers: readonly FinalActionMatrixAcceptanceLayer[];
  readonly runner_id: 'real_tauri_e2e';
}

const allLayers = ['parser', 'controller', 'session', 'trusted_host', 'repository', 'component', 'real_tauri_ui'] as const;
const noExecution = ['no_unconfirmed_write', 'no_autonomous_action', 'no_live_provider', 'no_normal_db_write'] as const;
const scenario = (
  id: number,
  category: FinalActionMatrixCategory,
  user_input: string,
  expected_intent: ClosedAgentIntent,
  expected_state_sequence: readonly string[],
  expected_model_mode: FinalActionMatrixScenario['expected_model_mode'],
  expected_db_mutation: FinalActionMatrixScenario['expected_db_mutation'],
  expected_ui: string,
  prerequisites: readonly string[] = [],
): FinalActionMatrixScenario => ({
  scenario_id: `FAM-${String(id).padStart(3, '0')}`,
  category, user_input, prerequisites, expected_intent, expected_state_sequence,
  expected_model_mode, expected_db_mutation, expected_ui,
  forbidden_behavior: noExecution, acceptance_layers: allLayers, runner_id: 'real_tauri_e2e',
});

/** Release manifest executed one-for-one by scripts/real_tauri_e2e.py --full. */
export const FINAL_ACTION_MATRIX_SCENARIOS: readonly FinalActionMatrixScenario[] = [
  scenario(1, 'SEARCH', '广州区域客户', 'SEARCH_CUSTOMERS', ['input', 'portfolio'], 'NO_MODEL', 'NONE', 'portfolio_guangzhou'),
  scenario(2, 'SEARCH', '广州地区客户', 'SEARCH_CUSTOMERS', ['input', 'portfolio'], 'NO_MODEL', 'NONE', 'portfolio_guangzhou'),
  scenario(3, 'SEARCH', '广州市客户', 'SEARCH_CUSTOMERS', ['input', 'portfolio'], 'NO_MODEL', 'NONE', 'portfolio_guangzhou'),
  scenario(4, 'SEARCH', '列出广州客户并核对总数', 'SEARCH_CUSTOMERS', ['input', 'portfolio'], 'NO_MODEL', 'NONE', 'count_consistent'),
  scenario(5, 'SEARCH', '列出广州客户并继续加载', 'SEARCH_CUSTOMERS', ['input', 'portfolio', 'portfolio_page_2'], 'NO_MODEL', 'NONE', 'pagination'),
  scenario(6, 'SEARCH', '打开华南生物科技', 'CUSTOMER_SUMMARY', ['input', 'thinking', 'result'], 'LOCAL_DETERMINISTIC', 'NONE', 'exact_entity_bound_then_summary'),
  scenario(7, 'SEARCH', '找一下华南生物', 'SEARCH_CUSTOMERS', ['input', 'candidate'], 'NO_MODEL', 'NONE', 'multiple_candidates'),
  scenario(8, 'SEARCH', '打开不存在的银河量子客户', 'SEARCH_CUSTOMERS', ['input', 'error'], 'NO_MODEL', 'NONE', 'no_match'),
  scenario(9, 'SEARCH', '列出广州的 A 类客户', 'SEARCH_CUSTOMERS', ['input', 'portfolio'], 'NO_MODEL', 'NONE', 'region_grade_filter'),
  scenario(10, 'SEARCH', '查一下广州做机械设备的客户', 'SEARCH_CUSTOMERS', ['input', 'portfolio'], 'NO_MODEL', 'NONE', 'industry_filter'),
  scenario(11, 'ANALYSIS', '总结这个客户', 'CUSTOMER_SUMMARY', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'summary_result', ['customer_scope']),
  scenario(12, 'ANALYSIS', '分析这个客户的风险', 'CUSTOMER_RISK_ANALYSIS', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'risk_result', ['customer_scope']),
  scenario(13, 'ANALYSIS', '下一步怎么推进', 'NEXT_ACTION_PREPARATION', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'next_action_result', ['customer_scope']),
  scenario(14, 'ANALYSIS', '整理最近互动', 'INTERACTION_SUMMARY', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'interaction_result', ['customer_scope']),
  scenario(15, 'ANALYSIS', '帮我判断一下', 'SAFE_FALLBACK', ['input', 'thinking', 'clarification'], 'MODEL_UNAVAILABLE', 'NONE', 'honest_provider_unavailable', ['customer_scope']),
  scenario(16, 'ANALYSIS', '给我把个脉', 'CUSTOMER_SUMMARY', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'semantic_router_fake_host', ['customer_scope']),
  scenario(17, 'ANALYSIS', '分析风险并核验证据', 'CUSTOMER_RISK_ANALYSIS', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'evidence_valid', ['customer_scope']),
  scenario(18, 'ANALYSIS', '分析风险 E2E_INVALID_EVIDENCE', 'CUSTOMER_RISK_ANALYSIS', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'invalid_evidence_blocked', ['customer_scope']),
  scenario(19, 'ANALYSIS', '分析风险 E2E_UNSUPPORTED_INFERENCE', 'CUSTOMER_RISK_ANALYSIS', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'unsupported_inference_no_proposal', ['customer_scope']),
  scenario(20, 'ANALYSIS', '对比广州华南客户01和广州华南客户02', 'COMPLEX_CUSTOMER_COMPARE', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'compare_2'),
  scenario(21, 'ANALYSIS', '对比广州华南客户01、广州华南客户02、广州华南客户03、广州华南客户04、广州华南客户05', 'COMPLEX_CUSTOMER_COMPARE', ['input', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'compare_5'),
  scenario(22, 'ANALYSIS', '对比广州华南客户01、广州华南客户02、广州华南客户03、广州华南客户04、广州华南客户05、广州华南客户06', 'COMPLEX_CUSTOMER_COMPARE', ['input', 'clarification'], 'NO_MODEL', 'NONE', 'compare_6_rejected'),
  scenario(23, 'WRITE', '新增跟进记录：客户确认预算', 'CREATE_FOLLOW_UP_REQUEST', ['input', 'proposal'], 'NO_MODEL', 'PROPOSAL_ONLY', 'follow_up_proposal', ['customer_scope']),
  scenario(24, 'WRITE', '写一条跟进记录：客户确认方案，并约下周一上午10点再联系', 'CREATE_FOLLOW_UP_REQUEST', ['input', 'proposal'], 'NO_MODEL', 'PROPOSAL_ONLY', 'grouped_proposal', ['customer_scope']),
  scenario(25, 'WRITE', '创建任务：2026-07-25 15:00 复核报价', 'CREATE_TASK_REQUEST', ['input', 'proposal', 'success'], 'NO_MODEL', 'CONFIRMED_ISOLATED_WRITE', 'task_proposal_confirmed', ['customer_scope']),
  scenario(26, 'WRITE', '更新下次跟进时间到 2026-07-27 09:00', 'UPDATE_CUSTOMER_REQUEST', ['input', 'proposal'], 'NO_MODEL', 'PROPOSAL_ONLY', 'next_follow_up_proposal', ['customer_scope']),
  scenario(27, 'WRITE', '更新下次跟进时间', 'UPDATE_CUSTOMER_REQUEST', ['input', 'clarification'], 'NO_MODEL', 'NONE', 'missing_time_clarification', ['customer_scope']),
  scenario(28, 'WRITE', '新增跟进记录：E2E 取消零写入', 'CREATE_FOLLOW_UP_REQUEST', ['input', 'proposal', 'input'], 'NO_MODEL', 'NONE', 'cancel_zero_write', ['customer_scope']),
  scenario(29, 'WRITE', '新增跟进记录：E2E 确认精确一次', 'CREATE_FOLLOW_UP_REQUEST', ['input', 'proposal', 'success'], 'NO_MODEL', 'CONFIRMED_ISOLATED_WRITE', 'confirm_one_write', ['customer_scope']),
  scenario(30, 'WRITE', '重放上次确认', 'CREATE_FOLLOW_UP_REQUEST', ['proposal', 'success', 'replay_rejected'], 'NO_MODEL', 'CONFIRMED_ISOLATED_WRITE', 'replay_zero_second_write', ['customer_scope']),
  scenario(31, 'WRITE', '确认后只刷新一次', 'CREATE_FOLLOW_UP_REQUEST', ['proposal', 'success', 'refreshed'], 'NO_MODEL', 'CONFIRMED_ISOLATED_WRITE', 'refresh_once', ['customer_scope']),
  scenario(32, 'WRITE', '确认后不自动重跑模型', 'CREATE_FOLLOW_UP_REQUEST', ['proposal', 'success'], 'NO_MODEL', 'CONFIRMED_ISOLATED_WRITE', 'no_automatic_model_rerun', ['customer_scope']),
  scenario(33, 'WRITE', '切换 Scope 后确认旧 Proposal', 'CREATE_FOLLOW_UP_REQUEST', ['proposal', 'scope_changed', 'rejected'], 'NO_MODEL', 'NONE', 'scope_mismatch_rejected', ['customer_scope']),
  scenario(34, 'WRITE', '取消后确认已失效 Proposal', 'CREATE_FOLLOW_UP_REQUEST', ['proposal', 'cancelled', 'rejected'], 'NO_MODEL', 'NONE', 'proposal_mutation_rejected', ['customer_scope']),
  scenario(35, 'CAPTURE', '粘贴文本并显式 Analyze text', 'CAPTURE_REVIEW', ['capture_open', 'capture_review'], 'LOCAL_DETERMINISTIC', 'NONE', 'text_capture', ['customer_scope']),
  scenario(36, 'CAPTURE', '选择真实图片但不自动 Analyze', 'CAPTURE_REVIEW', ['capture_open', 'image_selected'], 'NO_MODEL', 'NONE', 'image_no_auto_analyze', ['customer_scope']),
  scenario(37, 'CAPTURE', '显式 Analyze image', 'CAPTURE_REVIEW', ['image_selected', 'thinking', 'capture_review'], 'REAL_MODEL', 'NONE', 'explicit_image_analyze', ['customer_scope']),
  scenario(38, 'CAPTURE', 'Accept 提取事实', 'CAPTURE_REVIEW', ['capture_review', 'accepted'], 'NO_MODEL', 'NONE', 'fact_accepted', ['capture_review']),
  scenario(39, 'CAPTURE', 'Reject 提取事实', 'CAPTURE_REVIEW', ['capture_review', 'rejected'], 'NO_MODEL', 'NONE', 'fact_rejected', ['capture_review']),
  scenario(40, 'CAPTURE', 'Edit 并保存提取事实', 'CAPTURE_REVIEW', ['capture_review', 'edited'], 'NO_MODEL', 'NONE', 'fact_edited', ['capture_review']),
  scenario(41, 'CAPTURE', 'Candidate 不得自动成为 ACTIVE', 'CAPTURE_REVIEW', ['capture_review'], 'NO_MODEL', 'NONE', 'candidate_not_active', ['capture_review']),
  scenario(42, 'CAPTURE', '使用 Reviewed Fact 推理', 'CUSTOMER_SUMMARY', ['accepted', 'thinking', 'result'], 'REAL_MODEL', 'NONE', 'reviewed_fact_reasoning', ['capture_review']),
  scenario(43, 'CAPTURE', 'Capture Proposal 取消后再确认', 'CREATE_FOLLOW_UP_REQUEST', ['capture_review', 'proposal', 'cancelled', 'proposal', 'success'], 'NO_MODEL', 'CONFIRMED_ISOLATED_WRITE', 'capture_proposal_cancel_confirm', ['capture_review']),
  scenario(44, 'CAPTURE', 'Capture E2E_DELAYED_RESULT 后取消', 'CAPTURE_REVIEW', ['capture_open', 'thinking', 'cancelled'], 'NO_MODEL', 'NONE', 'late_capture_discarded', ['customer_scope']),
] as const;
