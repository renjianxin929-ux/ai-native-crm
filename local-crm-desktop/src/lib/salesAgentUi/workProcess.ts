import type { AgentSessionResult } from '../salesAgentTools/agentSession';
import type { AgentWriteProposal } from '../salesAgentTools/confirmedWrite';
import type { CustomerCaptureReview } from '../customerCapture/review';
import { reviewedFacts } from '../customerCapture/review';

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
  return '等待指令';
}

/** Auditable visible work process from real session/trace/evidence — never a fake 4-step complete ladder. */
export function buildAgentWorkProcess(input: BuildAgentWorkProcessInput): readonly WorkProcessStep[] {
  const steps: WorkProcessStep[] = [];

  if (input.locatingCustomer) {
    steps.push({
      id: 'locate',
      label: '正在定位客户',
      detail: '通过受限只读 search_customers 匹配客户，不会写入 CRM。',
      status: 'active',
    });
    return steps;
  }

  if (!input.customerSelected) {
    steps.push({
      id: 'await-customer',
      label: '可通过自然语言定位客户',
      detail: '直接提问或说「帮我找一下某某客户」；也可从客户详情进入。',
      status: 'pending',
    });
    return steps;
  }

  steps.push({
    id: 'context',
    label: input.contextLoaded ? '已读取客户上下文' : '正在读取客户上下文',
    detail: input.contextLoaded
      ? '只读 CRM 快照已加载，未自动调用模型或写入 CRM。'
      : '正在读取当前客户的只读上下文…',
    status: input.contextLoaded ? 'done' : 'active',
  });

  if (input.contextLoaded) {
    steps.push({
      id: 'memory',
      label: `已加载 ${input.memoryCount} 条有效记忆`,
      detail: '来自 ACTIVE Memory 仓库的已激活条目。',
      status: 'done',
    });
    steps.push({
      id: 'timeline',
      label: `已检查最近 ${input.timelineCount} 条互动`,
      detail: '来自当前 ContextSnapshot 的近期互动记录。',
      status: 'done',
    });
  }

  if (input.blockedReason) {
    steps.push({
      id: 'blocked',
      label: '执行已阻断',
      detail: input.blockedReason,
      status: 'blocked',
    });
    return steps;
  }

  if (input.sessionBusy) {
    steps.push({
      id: 'running',
      label: '正在生成建议',
      detail: 'SalesAgentSession 请求执行中；完成后展示可审计摘要。',
      status: 'active',
    });
    return steps;
  }

  if (input.result) {
    const tools = input.result.tool_trace
      .map(trace => `${trace.tool_id}（${trace.records.length}）`)
      .join(' · ') || '无工具记录';
    steps.push({
      id: 'tools',
      label: '已执行已注册只读工具',
      detail: tools,
      status: 'done',
    });
    steps.push({
      id: 'evidence',
      label: `已关联 ${input.result.evidence_refs.length} 条证据`,
      detail: input.result.evidence_refs.slice(0, 6).join(' · ') || '当前没有额外证据引用',
      status: 'done',
    });
    steps.push({
      id: 'intent',
      label: `意图：${input.result.plan.intent}`,
      detail: input.result.plan.steps.map(step => step.tool_id).join(' → '),
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
      label: '等待人工确认',
      detail: '任何 CRM 写入必须通过精确确认卡片。',
      status: 'active',
    });
  } else if (!input.result && input.contextLoaded) {
    steps.push({
      id: 'await-command',
      label: '等待指令',
      detail: '输入销售问题或使用快捷动作启动 Session。',
      status: 'pending',
    });
  }

  return steps;
}
