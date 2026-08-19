import type { AgentSessionResult } from '../salesAgentTools/agentSession';
import type { AgentWriteProposal } from '../salesAgentTools/confirmedWrite';
import type { CustomerCaptureReview } from '../customerCapture/review';
import { reviewedFacts } from '../customerCapture/review';
import { t, tFormat } from '../i18n/appLocale';

export type WorkProcessStepStatus = 'pending' | 'active' | 'done' | 'blocked';

export interface WorkProcessStep {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly status: WorkProcessStepStatus;
}

export interface BuildAgentWorkProcessInput {
  readonly customerSelected: boolean;
  readonly locatingCustomer?: boolean;
  readonly contextLoaded: boolean;
  readonly memoryCount: number;
  readonly timelineCount: number;
  readonly sessionBusy: boolean;
  readonly result: AgentSessionResult | null;
  readonly proposal: AgentWriteProposal | null;
  readonly confirmationPending: boolean;
  readonly blockedReason?: string;
  readonly captureReview?: CustomerCaptureReview | null;
}

/** Compact one-line status for the main surface. */
export function summarizeWorkProcess(steps: readonly WorkProcessStep[]): string {
  const active = steps.find(step => step.status === 'active');
  if (active) return active.label;
  const evidence = steps.find(step => step.id === 'evidence');
  if (evidence) return evidence.label;
  const tools = steps.find(step => step.id === 'tools');
  if (tools) return tools.label;
  const done = [...steps].reverse().find(step => step.status === 'done');
  if (done) return done.label;
  return t('work.await');
}

/** Auditable visible work process from real session/trace/evidence — never a fake 4-step complete ladder. */
export function buildAgentWorkProcess(input: BuildAgentWorkProcessInput): readonly WorkProcessStep[] {
  const steps: WorkProcessStep[] = [];

  if (input.locatingCustomer) {
    steps.push({
      id: 'locate',
      label: t('work.locate'),
      detail: t('work.locateDetail'),
      status: 'active',
    });
    return steps;
  }

  if (!input.customerSelected) {
    steps.push({
      id: 'await-customer',
      label: t('work.awaitCustomer'),
      detail: t('work.awaitCustomerDetail'),
      status: 'pending',
    });
    return steps;
  }

  steps.push({
    id: 'context',
    label: input.contextLoaded ? t('work.contextDone') : t('work.contextActive'),
    detail: input.contextLoaded
      ? '只读 CRM 快照已加载，未自动调用模型或写入 CRM。'
      : '正在读取当前客户的只读上下文…',
    status: input.contextLoaded ? 'done' : 'active',
  });

  if (input.contextLoaded) {
    steps.push({
      id: 'memory',
      label: tFormat('work.memoryCount', { n: input.memoryCount }),
      detail: '来自 ACTIVE Memory 仓库的已激活条目。',
      status: 'done',
    });
    steps.push({
      id: 'timeline',
      label: tFormat('work.timelineCount', { n: input.timelineCount }),
      detail: '来自当前 ContextSnapshot 的近期互动记录。',
      status: 'done',
    });
  }

  if (input.blockedReason) {
    steps.push({
      id: 'blocked',
      label: t('work.blocked'),
      detail: input.blockedReason,
      status: 'blocked',
    });
    return steps;
  }

  if (input.sessionBusy) {
    steps.push({
      id: 'running',
      label: t('work.running'),
      detail: '正在读取当前客户事实并生成建议。',
      status: 'active',
    });
    return steps;
  }

  if (input.result) {
    const tools = describeReadWork(input.result.tool_trace.map(trace => trace.tool_id));
    steps.push({
      id: 'tools',
      label: tools || t('work.tools'),
      detail: '只读查询，未写入 CRM。',
      status: 'done',
    });
    steps.push({
      id: 'evidence',
      label: tFormat('work.evidenceCount', { n: input.result.evidence_refs.length }),
      detail: '来自当前客户已核实记录。',
      status: 'done',
    });
    steps.push({
      id: 'intent',
      label: describeReasoningWork(input.result.plan.intent),
      detail: '结果需人工复核，不会自动写入。',
      status: 'done',
    });
  }

  if (input.captureReview) {
    const reviewed = reviewedFacts(input.captureReview).length;
    steps.push({
      id: 'capture',
      label: `Capture 已复核 ${reviewed} 项事实`,
      detail: `来源 ${input.captureReview.source_type} · ${input.captureReview.facts.length} 条提取事实`,
      status: reviewed > 0 ? 'done' : 'active',
    });
  }

  if (input.proposal || input.confirmationPending) {
    steps.push({
      id: 'confirm',
      label: t('work.confirm'),
      detail: '任何 CRM 写入必须通过精确确认卡片。',
      status: 'active',
    });
  } else if (!input.result && input.contextLoaded) {
    steps.push({
      id: 'await-command',
      label: t('work.await'),
      detail: '输入销售问题或使用快捷动作启动 Session。',
      status: 'pending',
    });
  }

  return steps;
}

export function describeReadWork(toolIds: readonly string[]): string {
  const labels = new Set<string>();
  for (const id of toolIds) {
    if (id.includes('timeline') || id.includes('followup') || id.includes('visit')) labels.add(t('work.timeline'));
    else if (id.includes('task')) labels.add(t('work.tasks'));
    else if (id.includes('memory')) labels.add(t('work.memory'));
    else if (id.includes('customer')) labels.add(t('work.profile'));
    else labels.add(t('work.tools'));
  }
  return [...labels].join('；');
}

export function describeReasoningWork(intent: string): string {
  if (intent === 'INTERACTION_SUMMARY') return t('work.review');
  if (intent === 'NEXT_ACTION_PREPARATION' || intent === 'NEXT_ACTION_RECOMMENDATION') return t('work.next');
  if (intent === 'FOLLOW_UP_DRAFT') return t('work.followUp');
  return t('work.analysis');
}
