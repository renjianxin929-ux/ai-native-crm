export type QuickActionKind = 'read_session' | 'write_proposal' | 'open_capture';

export interface SalesAgentQuickAction {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly kind: QuickActionKind;
  readonly tone: 'blue' | 'green' | 'purple' | 'orange' | 'teal';
}

export const SALES_AGENT_QUICK_ACTIONS: readonly SalesAgentQuickAction[] = [
  {
    id: 'summary',
    label: '总结客户现状',
    prompt: '总结客户现状',
    kind: 'read_session',
    tone: 'blue',
  },
  {
    id: 'risk',
    label: '分析风险与机会',
    prompt: '分析风险与机会',
    kind: 'read_session',
    tone: 'green',
  },
  {
    id: 'interactions',
    label: '整理最新互动',
    prompt: '整理最新互动',
    kind: 'read_session',
    tone: 'teal',
  },
  {
    id: 'follow-up',
    label: '准备下一次跟进',
    prompt: '准备下一次跟进并更新下次跟进时间',
    kind: 'write_proposal',
    tone: 'purple',
  },
  {
    id: 'capture',
    label: '分析上传内容',
    prompt: '分析上传内容',
    kind: 'open_capture',
    tone: 'orange',
  },
] as const;

/** Agent home shows three supporting actions. Capture remains on the paperclip. */
export const AGENT_HOME_QUICK_ACTION_IDS = ['summary', 'follow-up', 'interactions'] as const;

export const AGENT_HOME_QUICK_ACTIONS: readonly SalesAgentQuickAction[] = SALES_AGENT_QUICK_ACTIONS.filter(
  action => (AGENT_HOME_QUICK_ACTION_IDS as readonly string[]).includes(action.id),
);
