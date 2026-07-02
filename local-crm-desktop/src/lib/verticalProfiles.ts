import type { LeadLookupGoal, LeadWorkStatus } from './leadWorkbench/types';
import type { ContactMethod, CustomerGrade } from './types';

export interface VerticalProfileLeadImportSampleRow {
  company_name?: unknown;
  city?: unknown;
  industry?: unknown;
  website?: unknown;
  contact_name?: unknown;
  mobile?: unknown;
  tel?: unknown;
  email?: unknown;
  score?: unknown;
  grade?: unknown;
  tanji_search_keyword?: unknown;
  matching_reason?: unknown;
  priority_contact_role?: unknown;
  source_evidence?: unknown;
  [key: string]: unknown;
}

export interface VerticalRuleProfile {
  key: string;
  name: string;
  leadImport: {
    scoreThresholds: {
      crmWithLookup: number;
      lookupFirst: number;
    };
    sampleRows: VerticalProfileLeadImportSampleRow[];
  };
  decision: {
    lookupGoal: LeadLookupGoal;
    gradePriority: Record<string, number>;
    scorePriority: {
      min: number;
      max: number;
    };
    defaultPriority: number;
    lookupKeywordFallback: 'company_name';
  };
  customerAdapter: {
    importRowFallbackName: string;
    collectedLeadFallbackName: string;
    collectedLeadDefaultSource: string;
    defaultContactMethod: ContactMethod | null;
    gradeMapping: Record<string, CustomerGrade> & { default: CustomerGrade };
  };
  rules: {
    taskTitles: {
      wechatPassed: string;
    };
    recommendedAction: {
      overduePrefix: string;
      byGrade: Record<string, string> & { default: string };
      neverContactedByGrade: Record<string, string>;
    };
  };
  workItem: {
    statusLabels: Record<LeadWorkStatus, string>;
    actionLabels: {
      copySearchKeyword: string;
      startSearch: string;
      noPhone: string;
      skip: string;
    };
    terminalMessages: Partial<Record<LeadWorkStatus, string>>;
    confirmationMessages: Partial<Record<LeadWorkStatus, string>>;
    statusUpdateSuccessPrefix: string;
  };
  capture: {
    mobilePattern: string;
    landlineAreaCodes: string[];
    possibleContactTitleSuffixes: string[];
  };
  aiDraft: {
    wechatScreenshotPrompt: string;
    callTranscriptPrompt: {
      beforeTranscript: string;
      afterTranscript: string;
    };
    callTranscriptSystemPrompt: string;
    draftSummaries: {
      screenshotPrefix: string;
      screenshotUnknownCustomer: string;
      callPrefix: string;
      callSummaryMaxLength: number;
    };
    nextActionSuggestion: {
      systemPrompt: string;
      emptyValue: string;
      contextLabels: {
        customerName: string;
        customerGrade: string;
        stage: string;
        intentLevel: string;
        phoneFeedback: string;
        wechatAddStatus: string;
        phoneNumber: string;
        wechatId: string;
        contactPerson: string;
        website: string;
        industry: string;
        source: string;
        notes: string;
        recentNotes: string;
      };
      instructionLines: string[];
    };
  };
}

export const VERTICAL_PROFILE_REQUIRED_SECTIONS = [
  'leadImport',
  'decision',
  'customerAdapter',
  'rules',
  'workItem',
  'capture',
  'aiDraft',
] as const satisfies readonly (keyof VerticalRuleProfile)[];

export const defaultGeoExportProfile = {
  key: 'default_geo_export',
  name: 'Default GEO / Export Growth',
  leadImport: {
    scoreThresholds: {
      crmWithLookup: 80,
      lookupFirst: 70,
    },
    sampleRows: [
      {
        company_name: '佛山有电话样例',
        city: '佛山',
        industry: '装备制造',
        mobile: '13800138000',
        score: 62,
        grade: 'A',
        matching_reason: '有手机号，默认 DIRECT_TO_CRM',
      },
      {
        company_name: '广州高分待查样例',
        city: '广州',
        industry: '照明工程',
        score: 86,
        grade: 'S',
        tanji_search_keyword: '广州高分待查样例',
        matching_reason: '高分无电话，默认 CRM_WITH_LOOKUP',
      },
      {
        company_name: '中山优先查询样例',
        city: '中山',
        industry: '五金',
        score: 75,
        grade: 'B',
        matching_reason: '70-79 分无电话，默认 LOOKUP_FIRST',
      },
    ],
  },
  decision: {
    lookupGoal: 'FIND_PHONE',
    gradePriority: {
      A: 100,
      B: 80,
      C: 60,
    },
    scorePriority: {
      min: 0,
      max: 100,
    },
    defaultPriority: 50,
    lookupKeywordFallback: 'company_name',
  },
  customerAdapter: {
    importRowFallbackName: 'Unnamed lead',
    collectedLeadFallbackName: 'Unnamed collected lead',
    collectedLeadDefaultSource: '获客作业台/采集线索',
    defaultContactMethod: 'PHONE',
    gradeMapping: {
      S: 'B',
      A: 'C',
      B: 'C',
      C: 'D',
      default: 'C',
    },
  },
  rules: {
    taskTitles: {
      wechatPassed: '首次微信沟通',
    },
    recommendedAction: {
      overduePrefix: '【逾期】',
      byGrade: {
        A: '优先电话/微信二次触达，尝试约访',
        B: '补充客户痛点，推动明确下一步动作',
        C: '低频触达，观察反馈后再决定是否升级',
        D: '降低跟进频率或归档观察',
        default: '待评估，建议人工判断',
      },
      neverContactedByGrade: {
        A: '首次触达：优先电话/微信联系，尝试约访',
      },
    },
  },
  workItem: {
    statusLabels: {
      TODO: '待查询',
      SEARCHING: '查询中',
      STAGED: '待整理',
      COLLECTED: '已采集',
      NO_PHONE: '无电话',
      SKIPPED: '已跳过',
      DONE: '已完成',
    },
    actionLabels: {
      copySearchKeyword: '复制搜索词',
      startSearch: '开始查询',
      noPhone: '标记无电话',
      skip: '跳过',
    },
    terminalMessages: {
      NO_PHONE: '该任务已标记为无电话，不能继续流转。',
      SKIPPED: '该任务已跳过，不能继续流转。',
      DONE: '该任务已完成，不能继续流转。',
    },
    confirmationMessages: {
      NO_PHONE: '确认将「{{companyName}}」标记为无电话吗？',
      SKIPPED: '确认跳过「{{companyName}}」吗？',
    },
    statusUpdateSuccessPrefix: '任务状态已更新为',
  },
  capture: {
    mobilePattern: String.raw`(?:\+?86[\s-]*)?(1[3-9]\d[\s-]*\d{4}[\s-]*\d{4})`,
    landlineAreaCodes: ['20', '750', '755', '757', '760', '769'],
    possibleContactTitleSuffixes: ['总', '经理', '主任'],
  },
  aiDraft: {
    wechatScreenshotPrompt: `你是一个销售 CRM 助手。请分析微信聊天截图，提取以下结构化信息。

业务规则（请严格遵守）：
1. 微信通过不能自动将客户等级升级为 A，只有基于明确的购买意向证据才能建议升级。
2. AI 只能建议客户等级，不能自动修改。如果建议 A，必须在 evidence 中给出充分证据。
3. confidence 低于 0.65 表示低置信度，应谨慎处理。
4. grade_suggestion 只能是 A/B/C/D/UNKNOWN。

请以 JSON 格式返回以下字段：
{
  "customer_name": "客户名称/昵称",
  "wechat_id": "微信号",
  "phone_number": "手机号（如果有）",
  "reply_status": "REPLIED | NO_REPLY | UNKNOWN",
  "intent_level": "HIGH | MEDIUM | LOW | NONE | UNKNOWN",
  "grade_suggestion": "A | B | C | D | UNKNOWN",
  "follow_up_result": "POSITIVE | NEGATIVE | NO_RESPONSE | UNKNOWN",
  "next_action": "下一步动作建议（中文描述）",
  "next_follow_up_text": "建议下次跟进时间描述（如：明天下午、下周二上午）",
  "summary": "对话摘要",
  "evidence": "支撑 grade_suggestion 的证据",
  "confidence": 0.0
}

只返回 JSON，不要其他文字。`,
    callTranscriptPrompt: {
      beforeTranscript: `你是一个销售 CRM 助手。请分析以下通话/语音转文字记录，提取结构化信息。

通话内容：
---
`,
      afterTranscript: `
---

业务规则：
1. phone_feedback 只能取值：NOT_NEEDED（不需要）、CAN_LEARN（可以了解）、INTERESTED（有兴趣）、CAN_MEET（可以见面）、NO_ANSWER（未接）、INVALID_NUMBER（空号）、UNKNOWN（不确定）。
2. intent_level 只能取值：HIGH（高意向）、MEDIUM（中意向）、LOW（低意向）、NONE（无意向）、UNKNOWN（未判断）。
3. grade_suggestion 只能取值：A/B/C/D/UNKNOWN。AI 只能建议，不应自动修改客户数据。
4. 如果涉及时间（明天、下周、下周二下午等），在 next_follow_up_text 中保留原始中文描述。
5. confidence 低于 0.65 表示低置信度。

请以 JSON 格式返回：
{
  "summary": "通话摘要",
  "phone_feedback": "NOT_NEEDED | CAN_LEARN | INTERESTED | CAN_MEET | NO_ANSWER | INVALID_NUMBER | UNKNOWN",
  "intent_level": "HIGH | MEDIUM | LOW | NONE | UNKNOWN",
  "grade_suggestion": "A | B | C | D | UNKNOWN",
  "next_action": "下一步动作建议（中文）",
  "next_follow_up_text": "建议下次跟进时间（中文描述，如：下周三上午）",
  "risk": "风险提示（如有）",
  "confidence": 0.0
}

只返回 JSON，不要其他文字。`,
    },
    callTranscriptSystemPrompt: '你是一个销售 CRM 助手',
    draftSummaries: {
      screenshotPrefix: '截图识别',
      screenshotUnknownCustomer: '未识别客户名',
      callPrefix: '通话文本分析',
      callSummaryMaxLength: 100,
    },
    nextActionSuggestion: {
      systemPrompt: '你是 CRM 日常使用助手。输出必须短、保守、可执行，不要使用 Markdown，不要把推测写成事实。',
      emptyValue: '无',
      contextLabels: {
        customerName: '客户名称',
        customerGrade: '客户等级',
        stage: '当前阶段',
        intentLevel: '意向度',
        phoneFeedback: '电话反馈',
        wechatAddStatus: '微信添加状态',
        phoneNumber: '手机号',
        wechatId: '微信号',
        contactPerson: '联系人',
        website: '官网',
        industry: '行业',
        source: '来源',
        notes: '备注',
        recentNotes: '最近备注',
      },
      instructionLines: [
        '请基于以上 CRM 字段给出短行动建议。',
        '要求：',
        '1. 如果客户联系方式、联系人、官网、行业信息不足，先提示“信息不足”，只建议补全信息和低投入验证。',
        '2. C 类客户不要给复杂销售打法，不要承诺 48 小时、一周内等确定性结果。',
        '3. CRM 字段没有的内容只能写“可能/可检查/基于公司名推测”，不能写成事实。',
        '4. 不要输出 ###、**、Markdown 列表符号或长篇销售培训文。',
        '5. 只输出 2-4 条短建议。',
      ],
    },
  },
} satisfies VerticalRuleProfile;

export const DEFAULT_VERTICAL_PROFILE_ID = 'default_geo_export';

export const VERTICAL_PROFILE_REGISTRY: Record<string, VerticalRuleProfile> = {
  [DEFAULT_VERTICAL_PROFILE_ID]: defaultGeoExportProfile,
};

export function getVerticalProfile(profileId: string): VerticalRuleProfile {
  const profile = VERTICAL_PROFILE_REGISTRY[profileId];
  if (!profile) {
    throw new Error(`Unknown vertical profile: ${profileId}`);
  }
  return profile;
}

export function getActiveVerticalProfile(): VerticalRuleProfile {
  return getVerticalProfile(DEFAULT_VERTICAL_PROFILE_ID);
}
