import type { Customer, FollowUpRecord, Task } from './types';

export interface AIConfig {
  provider: 'openai' | 'claude' | 'deepseek' | 'custom';
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export async function getAIConfig(): Promise<AIConfig | null> {
  return null;
}

export async function saveAIConfig(config: AIConfig): Promise<void> {
  void config;
  throw new Error('旧版前端配置路径已移除；请使用 Rust Trusted Host 的 DPAPI 加密 SQLite 配置。');
}

export async function testAIConnection(config: AIConfig): Promise<{ ok: boolean; message: string }> {
  void config;
  return { ok: false, message: '旧版前端连接测试已移除；请使用 Trusted Host 测试连接。' };
}

export async function analyzeChatText(
  text: string,
  customer: Customer,
): Promise<{ intent: string; summary: string; suggestedAction: string }> {
  void text; void customer;
  throw new Error('真实文本模型未通过 Trusted Host 配置时，不生成或伪造 AI 分析。');
}

export async function generateDailySummary(
  customers: Customer[],
  _followUps: FollowUpRecord[],
  tasks: Task[],
): Promise<string> {
  // Honest deterministic CRM projection; this function never claims a model call.
  const aCount = customers.filter(c => c.customer_grade === 'A').length;
  const overdueCount = customers.filter(c => {
    if (!c.next_follow_up_at) return false;
    return new Date(c.next_follow_up_at) < new Date();
  }).length;
  const openTasks = tasks.filter(t => t.status === 'OPEN').length;

  return `今日概要：${customers.length} 位客户中，A类客户 ${aCount} 位，${overdueCount} 位逾期未跟进，${openTasks} 个待完成任务。`;
}

export async function suggestNextAction(
  customer: Customer,
  recentNotes: string[],
): Promise<{ action: string; reason: string }> {
  // Honest deterministic CRM rule suggestion; this function never claims a model call.
  const grade = customer.customer_grade;

  if (recentNotes.length === 0) {
    return {
      action: '触达客户',
      reason: `该客户为${grade}类，最近无跟进记录，建议主动联系。`,
    };
  }

  const lastNote = recentNotes[recentNotes.length - 1];
  if (lastNote.includes('意向') || lastNote.includes('有兴趣')) {
    return {
      action: '安排约访',
      reason: `最近沟通记录显示客户有兴趣，建议尽快安排面访。`,
    };
  }

  return {
    action: '继续跟进',
    reason: `该客户为${grade}类，最近有${recentNotes.length}条跟进记录，建议保持节奏继续跟进。`,
  };
}
