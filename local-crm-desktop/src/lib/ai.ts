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

export async function saveAIConfig(_config: AIConfig): Promise<void> {
  throw new Error('SQLite credential storage was retired; use Trusted Host secure configuration.');
}

export async function testAIConnection(_config: AIConfig): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: '旧版前端连接测试已移除；请使用 Trusted Host 测试连接。' };
}

export async function analyzeChatText(
  text: string,
  customer: Customer,
): Promise<{ intent: string; summary: string; suggestedAction: string }> {
  // Mock implementation — returns placeholder analysis
  return {
    intent: text.includes('感兴趣') || text.includes('要') ? '高意向' : '待判断',
    summary: `已分析客户 ${customer.name} 的对话内容（${text.length} 字符），暂未检测到明确意向信号。`,
    suggestedAction: '建议人工复核沟通内容，确认客户意向。',
  };
}

export async function generateDailySummary(
  customers: Customer[],
  _followUps: FollowUpRecord[],
  tasks: Task[],
): Promise<string> {
  // Mock implementation — returns placeholder summary
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
  // Mock implementation — returns rule-based suggestion
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
