// 内部类型定义 - 英文字段名，界面上显示中文标签

export type CustomerGrade = 'A' | 'B' | 'C' | 'D';
export type CustomerStage =
  | 'NEW_LEAD'
  | 'CONTACTED'
  | 'WECHAT_PASSED'
  | 'REPLIED'
  | 'VISIT_READY'
  | 'VISITED'
  | 'CONTRACTING'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'WON'
  | 'LOST';
export type WechatSearchStatus = 'FOUND' | 'NOT_FOUND' | 'ABNORMAL' | 'UNCERTAIN';
export type WechatAddStatus = 'NOT_ADDED' | 'ADDED' | 'PASSED' | 'REJECTED' | 'NO_RESPONSE';
export type IntentLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'UNKNOWN';
export type PhoneFeedback = 'NOT_NEEDED' | 'CAN_LEARN' | 'INTERESTED' | 'CAN_MEET' | 'NO_ANSWER' | 'INVALID_NUMBER' | 'UNKNOWN';
export type FeedbackType = 'POSITIVE' | 'NEGATIVE' | 'NO_RESPONSE' | 'UNKNOWN';
export type NextAction =
  | 'CONTACT_AGAIN'
  | 'SCHEDULE_VISIT'
  | 'VISIT'
  | 'SEND_CONTRACT'
  | 'WAIT_CUSTOMER'
  | 'LOW_FREQUENCY'
  | 'CONFIRM_PAYMENT'
  | 'CLOSE';
export type VisitOutcome =
  | 'READY_TO_SIGN'
  | 'FOLLOW_UP_NEEDED'
  | 'CONSIDERING'
  | 'COMPARING'
  | 'NO_SHOW'
  | 'LOST';
export type PaymentStatus = 'NOT_STARTED' | 'PENDING' | 'PAID';
export type TimeParseStatus = 'NOT_PARSED' | 'PARSED' | 'NEEDS_CONFIRMATION';
export type TaskStatus = 'OPEN' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type TaskSource = 'MANUAL' | 'RULE' | 'AI';
export type ContactMethod = 'WECHAT' | 'PHONE' | 'WECHAT_AND_PHONE';
export type ContactChannel = 'wechat' | 'phone' | 'visit' | 'SMS' | 'other';

export interface Customer {
  id: string;
  name: string;
  customer_grade: CustomerGrade;
  stage: CustomerStage;
  contact_method: ContactMethod | null;
  wechat_id: string | null;
  phone_number: string | null;
  wechat_search_status: WechatSearchStatus | null;
  is_key_decision_maker: number;
  wechat_add_status: WechatAddStatus;
  has_replied: number;
  intent_level: IntentLevel;
  phone_feedback: PhoneFeedback | null;
  can_schedule_visit: number;
  visit_scheduled_at: string | null;
  rough_visit_time_text: string | null;
  parsed_visit_reminder_at: string | null;
  time_parse_status: TimeParseStatus;
  time_parse_note: string | null;
  next_follow_up_at: string | null;
  last_contacted_at: string | null;
  last_feedback_type: FeedbackType;
  next_action: NextAction | null;
  no_show_count: number;
  lost_reason: string | null;
  payment_status: PaymentStatus;
  deal_amount: number | null;
  paid_at: string | null;
  closed_at: string | null;
  website: string | null;
  region: string | null;
  industry: string | null;
  contact_person: string | null;
  email: string | null;
  address: string | null;
  pitch_angle: string | null;
  qualification_reason: string | null;
  source: string | null;
  /** Battle Card V1 最小指针字段（可选，旧客户为 null/'NONE'）。 */
  current_stage_card_id?: string | null;
  battle_card_status?: 'NONE' | 'DRAFT' | 'CONFIRMED' | 'REVIEW_DUE' | null;
  last_battle_review_at?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpRecord {
  id: string;
  customer_id: string;
  title: string;
  contact_channel: ContactChannel | null;
  contact_result: string | null;
  feedback_notes: string | null;
  intent_assessment: IntentLevel | null;
  suggested_grade: CustomerGrade | null;
  next_action: NextAction | null;
  next_follow_up_at: string | null;
  is_completed: number;
  created_at: string;
  updated_at: string;
}

export interface VisitRecord {
  id: string;
  customer_id: string;
  title: string;
  visited_at: string | null;
  visit_notes: string | null;
  customer_concerns: string | null;
  intent_after_visit: IntentLevel | null;
  visit_outcome: VisitOutcome | null;
  next_action: NextAction | null;
  expected_contract_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  customer_id: string | null;
  title: string;
  due_at: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  created_at: string;
  updated_at: string;
}

export interface TimeParseResult {
  parsed_at: string | null;
  status: TimeParseStatus;
  note: string | null;
}

export interface DailySummary {
  date: string;
  overdue_customers: Customer[];
  due_today_customers: Customer[];
  upcoming_visits: Customer[];
  long_time_no_contact: Customer[];
  tasks_due_today: Task[];
}

// 中文标签映射
export const GRADE_LABELS: Record<CustomerGrade, string> = {
  A: 'A类客户',
  B: 'B类客户',
  C: 'C类客户',
  D: 'D类客户',
};

export const STAGE_LABELS: Record<CustomerStage, string> = {
  NEW_LEAD: '新线索',
  CONTACTED: '已添加微信/电话',
  WECHAT_PASSED: '微信已通过',
  REPLIED: '已回复',
  VISIT_READY: '可约访',
  VISITED: '已面访',
  CONTRACTING: '合同中',
  PAYMENT_PENDING: '待打款',
  PAID: '已打款',
  WON: '已成交',
  LOST: '丢单',
};

export const WECHAT_SEARCH_LABELS: Record<WechatSearchStatus, string> = {
  FOUND: '正常搜到',
  NOT_FOUND: '搜不到',
  ABNORMAL: '账号异常',
  UNCERTAIN: '不确定',
};

export const WECHAT_ADD_LABELS: Record<WechatAddStatus, string> = {
  NOT_ADDED: '未添加',
  ADDED: '已添加',
  PASSED: '已通过',
  REJECTED: '被拒绝',
  NO_RESPONSE: '无响应',
};

export const INTENT_LABELS: Record<IntentLevel, string> = {
  HIGH: '高意向',
  MEDIUM: '中意向',
  LOW: '低意向',
  NONE: '无意向',
  UNKNOWN: '未判断',
};

export const PHONE_FEEDBACK_LABELS: Record<PhoneFeedback, string> = {
  NOT_NEEDED: '不需要',
  CAN_LEARN: '可以了解',
  INTERESTED: '有兴趣',
  CAN_MEET: '可以见面',
  NO_ANSWER: '未接',
  INVALID_NUMBER: '空号',
  UNKNOWN: '未判断',
};

export const VISIT_OUTCOME_LABELS: Record<VisitOutcome, string> = {
  READY_TO_SIGN: '签合同',
  FOLLOW_UP_NEEDED: '待跟进',
  CONSIDERING: '再考虑考虑',
  COMPARING: '再对比',
  NO_SHOW: '放鸽子/爽约',
  LOST: '丢单',
};

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  CONTACT_AGAIN: '再触达',
  SCHEDULE_VISIT: '约访',
  VISIT: '面访',
  SEND_CONTRACT: '发合同',
  WAIT_CUSTOMER: '等客户',
  LOW_FREQUENCY: '低频维护',
  CONFIRM_PAYMENT: '确认打款',
  CLOSE: '关闭',
};

export const CHANNEL_LABELS: Record<ContactChannel, string> = {
  wechat: '微信',
  phone: '电话',
  visit: '面访',
  SMS: '短信',
  other: '其他',
};

export const CONTACT_RESULT_LABELS: Record<string, string> = {
  positive: '正反馈',
  negative: '负反馈',
  no_response: '无响应',
  replied: '已回复',
};

// ── v0.4.0: 双模型分工类型 ──

export type TextAIProvider = 'deepseek' | 'custom';
export type MultimodalProvider = 'qwen' | 'custom';

export type ModalityCapability = {
  text: boolean;
  image: boolean;
  audio: boolean;
};

export type TextAIConfig = {
  provider: TextAIProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type MultimodalConfig = {
  provider: MultimodalProvider;
  apiKey: string;
  visionModel: string;
  baseUrl: string;
  capabilities: ModalityCapability;
};

export type MultimodalMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image_base64'; imageBase64: string; mimeType: string }
  | { type: 'audio_base64'; audioBase64: string; mimeType: string };

export type MultimodalMessage = {
  role: 'system' | 'user' | 'assistant';
  content: MultimodalMessageContent[];
};

export interface ScreenshotAnalysis {
  customer_name: string;
  wechat_id: string;
  phone_number: string;
  reply_status: 'REPLIED' | 'NO_REPLY' | 'UNKNOWN';
  intent_level: IntentLevel;
  grade_suggestion: 'A' | 'B' | 'C' | 'D' | 'UNKNOWN';
  follow_up_result: 'POSITIVE' | 'NEGATIVE' | 'NO_RESPONSE' | 'UNKNOWN';
  next_action: string;
  next_follow_up_text: string;
  summary: string;
  evidence: string;
  confidence: number;
}

export interface CallAnalysis {
  summary: string;
  phone_feedback: PhoneFeedback;
  intent_level: IntentLevel;
  grade_suggestion: 'A' | 'B' | 'C' | 'D' | 'UNKNOWN';
  next_action: string;
  next_follow_up_text: string;
  risk: string;
  confidence: number;
}

export type AIDraftSource = 'SCREENSHOT' | 'CALL_TEXT' | 'AUDIO' | 'MANUAL';
export type AIDraftStatus = 'DRAFT' | 'APPLIED' | 'DISCARDED';

export interface AIDraft {
  id: string;
  source_type: AIDraftSource;
  customer_id: string | null;
  raw_input_summary: string;
  ai_result_json: string;
  status: AIDraftStatus;
  confidence: number;
  created_at: string;
  applied_at: string | null;
}

export interface AIDraftInput {
  source_type: AIDraftSource;
  customer_id: string | null;
  raw_input_summary: string;
  ai_result_json: string;
  confidence: number;
}
