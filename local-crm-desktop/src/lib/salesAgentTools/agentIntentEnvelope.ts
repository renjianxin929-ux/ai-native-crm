import { resolveCapabilityRoute, type ModelCapabilityKind } from '../productionAi/capabilityRoutingMatrix';
import { normalizeCustomerSearchFilters, type NormalizedCustomerSearchFilters } from './filterNormalization';
import { classifyClosedWriteIntent, draftWriteFields, type ClosedWriteIntent, type WriteFieldDraft } from './writeIntent';
import { isLastContactQuestion } from '../planner/customerQueryInterpretation';
import { v4 as uuidv4 } from 'uuid';

export type AgentIntentMode =
  | 'entity_resolution'
  | 'portfolio_search'
  | 'customer_analysis'
  | 'write_action'
  | 'capture'
  | 'control';

export type ClosedAgentIntent =
  | 'SEARCH_CUSTOMERS'
  | 'CUSTOMER_PRIORITY_RANKING'
  | 'CUSTOMER_SUMMARY'
  | 'CUSTOMER_RISK_ANALYSIS'
  | 'CUSTOMER_TIMELINE_REVIEW'
  | 'NEXT_ACTION_PREPARATION'
  | 'FOLLOW_UP_DRAFT'
  | 'INTERACTION_SUMMARY'
  | 'COMPLEX_CUSTOMER_COMPARE'
  | 'CREATE_FOLLOW_UP_REQUEST'
  | 'CREATE_TASK_REQUEST'
  | 'UPDATE_CUSTOMER_REQUEST'
  | 'CAPTURE_REVIEW'
  | 'CLEAR_CUSTOMER_SCOPE'
  | 'NEW_CONVERSATION'
  | 'CANCEL_PENDING_WRITE'
  | 'CONFIRM_PENDING_WRITE'
  | 'SAFE_FALLBACK';

export interface AgentIntentEnvelope {
  readonly envelope_id: string;
  readonly original_instruction: string;
  readonly normalized_instruction: string;
  readonly intent: ClosedAgentIntent;
  readonly mode: AgentIntentMode;
  readonly model_capability: ModelCapabilityKind;
  readonly requires_real_model: boolean;
  readonly customer_reference: string | null;
  readonly portfolio_filters: NormalizedCustomerSearchFilters;
  readonly write_intent: ClosedWriteIntent | null;
  readonly write_draft: WriteFieldDraft | null;
  readonly capture_intent: 'image_analysis' | null;
  readonly extracted_fields: Readonly<Record<string, unknown>>;
  readonly missing_fields: readonly string[];
  readonly confidence: number;
  readonly parser_source: 'production_deterministic_v2' | 'trusted_host_semantic_intent_v1' | 'typed_preset_v1';
  readonly clarification_required: boolean;
  readonly unsupported_criteria: readonly string[];
}

export interface AgentIntentParseContext {
  readonly has_selected_image?: boolean;
  readonly semantic_resolution?: SemanticIntentResolution;
}

export type SemanticIntentKind =
  | 'CUSTOMER_SUMMARY'
  | 'CUSTOMER_RISK_ANALYSIS'
  | 'NEXT_ACTION_RECOMMENDATION'
  | 'FOLLOW_UP_DRAFT'
  | 'INTERACTION_SUMMARY'
  | 'COMPLEX_CUSTOMER_COMPARE'
  | 'IMAGE_CAPTURE_ANALYSIS'
  | 'CUSTOMER_PRIORITY_RANKING'
  | 'CUSTOMER_TIMELINE_REVIEW'
  | 'BATTLE_CARD_ANALYSIS'
  | 'ACTION_FROM_PREVIOUS_RESULT'
  | 'CLARIFICATION_REQUIRED'
  | 'UNSUPPORTED';

export interface SemanticIntentResolution {
  readonly intent: SemanticIntentKind;
  readonly filters: Readonly<Record<string, string>>;
  readonly entities: readonly { readonly type: string; readonly value: string }[];
  readonly scope: string | null;
  readonly missing_fields: readonly string[];
  readonly confidence: number;
  readonly clarification_question: string | null;
}

/** Refines a low-confidence envelope without creating a second turn identity. */
export function applySemanticIntentResolution(
  original: AgentIntentEnvelope,
  semantic: SemanticIntentResolution,
): AgentIntentEnvelope {
  const mapped = semanticIntent(semantic.intent);
  const customerReference = semantic.entities.find(entity => entity.type === 'customer')?.value ?? null;
  if (mapped) {
    const filters = semantic.intent === 'BATTLE_CARD_ANALYSIS'
      ? { focus: 'battle_card', ...semantic.filters }
      : semantic.intent === 'CUSTOMER_TIMELINE_REVIEW' && !semantic.filters.fact
        ? { fact: 'timeline', ...semantic.filters }
        : semantic.filters;
    return envelope({
      ...original,
      envelope_id: original.envelope_id,
      intent: mapped,
      mode: mapped === 'CAPTURE_REVIEW' ? 'capture' : mapped === 'CUSTOMER_PRIORITY_RANKING' ? 'portfolio_search' : 'customer_analysis',
      capture_intent: mapped === 'CAPTURE_REVIEW' ? 'image_analysis' : null,
      customer_reference: customerReference,
      extracted_fields: { filters, entities: semantic.entities, scope: semantic.scope, semantic_intent: semantic.intent },
      confidence: semantic.confidence,
      parser_source: 'trusted_host_semantic_intent_v1',
      clarification_required: semantic.intent === 'CLARIFICATION_REQUIRED' || semantic.intent === 'UNSUPPORTED',
      missing_fields: semantic.missing_fields,
    });
  }
  return envelope({
    ...original,
    envelope_id: original.envelope_id,
    intent: 'SAFE_FALLBACK',
    mode: 'customer_analysis',
    confidence: semantic.confidence,
    parser_source: 'trusted_host_semantic_intent_v1',
    customer_reference: customerReference,
    extracted_fields: {
      filters: semantic.filters, entities: semantic.entities, scope: semantic.scope,
      clarification_question: semantic.clarification_question,
    },
    clarification_required: true,
    missing_fields: semantic.missing_fields.length ? semantic.missing_fields : semantic.intent === 'CLARIFICATION_REQUIRED' ? ['intent_clarification'] : ['supported_intent'],
  });
}

/** The only production natural-language classifier. Controller, Session and UI consume this result. */
export function createAgentIntentEnvelope(
  message: string,
  nowIso: string,
  context: AgentIntentParseContext = {},
): AgentIntentEnvelope {
  const text = normalizeWhitespace(message);
  const intentText = removeNegatedIntentScopes(text);
  const search = normalizeCustomerSearchFilters(intentText, nowIso);
  const make = (input: Partial<AgentIntentEnvelope> & Pick<AgentIntentEnvelope, 'intent' | 'mode' | 'confidence'>) => envelope({
    original_instruction: message,
    normalized_instruction: text,
    ...input,
  });

  if (context.semantic_resolution) {
    const base = make({ intent: 'SAFE_FALLBACK', mode: 'customer_analysis', confidence: 0.35 });
    return applySemanticIntentResolution(base, context.semantic_resolution);
  }

  // 1. Control intent.
  if (search.is_clear_scope) return make({ intent: 'CLEAR_CUSTOMER_SCOPE', mode: 'control', confidence: 0.99 });
  if (/^(?:请)?(?:新对话|重新开始|开启新会话)[。！!]?$/.test(text)) return make({ intent: 'NEW_CONVERSATION', mode: 'control', confidence: 0.99 });
  if (/^(?:请)?取消(?:这项|本次|当前)?(?:操作|建议|写入|确认)?[。！!]?$/.test(text)) return make({ intent: 'CANCEL_PENDING_WRITE', mode: 'control', confidence: 0.99 });
  if (/^(?:请)?确认(?:执行|写入|操作)?[。！!]?$/.test(text)) return make({ intent: 'CONFIRM_PENDING_WRITE', mode: 'control', confidence: 0.99 });

  // Explicitly unsupported execution language must fail closed before words such
  // as "邮件" or "写" can be mistaken for a harmless draft request.
  if (isUnsupportedAutonomousRequest(intentText)) {
    return make({
      intent: 'SAFE_FALLBACK', mode: 'control', confidence: 0.99,
      clarification_required: true, missing_fields: ['supported_intent'],
      unsupported_criteria: ['autonomous_external_action'],
    });
  }

  // Ambiguous multi-action turns never inherit execution authority from one phrase.
  // Named bind ("打开/切换到 X 然后总结") is one instruction: resolve, then continue.
  const directEntityLookup = /^(?:帮我|给我|请)?\s*(?:打开客户?|打开|定位客户?|定位|搜索客户名|切到客户?|切到|切换到|切换至)/.test(intentText);
  const boundedNamedBindContinuation = (search.is_explicit_switch || directEntityLookup)
    && Boolean(search.filters.name_query)
    && !/(?:另一家|别家|其他客户)/.test(intentText)
    && (/(?:后|然后|再|之后).*(?:总结|概括|风险|分析|比较|排序|下一步)/.test(intentText) || hasAnalysisMeaning(intentText));
  if (hasCompetingActions(intentText) && !boundedNamedBindContinuation) {
    return make({
      intent: 'SAFE_FALLBACK', mode: 'customer_analysis', confidence: 0.2,
      clarification_required: true, missing_fields: ['single_intent'],
    });
  }

  // 2. Explicit deterministic write intent.
  const write = draftWriteFields(intentText, nowIso);
  if (write) {
    return make({
      intent: write.intent,
      mode: 'write_action',
      customer_reference: search.filters.name_query ?? null,
      portfolio_filters: search.filters,
      write_intent: write.intent,
      write_draft: write,
      extracted_fields: write.parsed_fields,
      missing_fields: write.missing_fields,
      confidence: 0.98,
      clarification_required: write.missing_fields.length > 0,
      unsupported_criteria: search.unsupported,
    });
  }

  // 3. Capture / multimodal intent. A missing attachment is clarification, never text fallback.
  if (hasCaptureMeaning(intentText)) {
    return make({
      intent: 'CAPTURE_REVIEW',
      mode: 'capture',
      capture_intent: 'image_analysis',
      confidence: 0.99,
      clarification_required: context.has_selected_image !== true,
      missing_fields: context.has_selected_image === true ? [] : ['selected_image'],
    });
  }

  if (directEntityLookup && search.is_customer_lookup && search.filters.name_query && !hasAnalysisMeaning(intentText)) {
    return make({
      intent: 'SEARCH_CUSTOMERS', mode: 'entity_resolution',
      customer_reference: search.filters.name_query, portfolio_filters: search.filters,
      confidence: 0.98, unsupported_criteria: search.unsupported,
    });
  }

  if (isLastContactQuestion(intentText)) {
    return make({
      intent: 'CUSTOMER_TIMELINE_REVIEW',
      mode: search.filters.name_query ? 'entity_resolution' : 'customer_analysis',
      customer_reference: search.filters.name_query ?? null,
      portfolio_filters: search.filters,
      extracted_fields: { answer_shape: 'DIRECT_FACT', fact: 'last_contact' },
      confidence: 0.97,
      unsupported_criteria: search.unsupported,
    });
  }

  if (/\b(?:find|search|list)\s+customers?\b/i.test(intentText)) {
    return make({
      intent: 'SEARCH_CUSTOMERS', mode: 'portfolio_search', customer_reference: null,
      portfolio_filters: search.filters, confidence: 0.94,
      unsupported_criteria: search.unsupported, clarification_required: search.unsupported.length > 0,
    });
  }

  // 4. Explicit cross-customer compare owns its customer-name objects. Region/
  // industry words inside those names must not downgrade the turn to portfolio search.
  if (hasCustomerCompareMeaning(intentText)) {
    return make({ intent: 'COMPLEX_CUSTOMER_COMPARE', mode: 'customer_analysis', confidence: 0.97 });
  }

  if (hasCustomerPriorityMeaning(intentText)) {
    return make({ intent: 'CUSTOMER_PRIORITY_RANKING', mode: 'portfolio_search', confidence: 0.98 });
  }

  // 5. Portfolio search.
  if (search.is_portfolio_query && !hasAnalysisMeaning(intentText)) {
    return make({
      intent: 'SEARCH_CUSTOMERS',
      mode: 'portfolio_search',
      customer_reference: null,
      portfolio_filters: search.filters,
      confidence: Object.keys(search.filters).length > 1 ? 0.99 : 0.9,
      unsupported_criteria: search.unsupported,
      clarification_required: search.unsupported.length > 0,
    });
  }

  // 6. Entity resolution / switch.
  if (search.is_explicit_switch || (search.is_customer_lookup && !hasAnalysisMeaning(intentText))) {
    const customerReference = search.filters.name_query ?? null;
    return make({
      intent: 'SEARCH_CUSTOMERS',
      mode: 'entity_resolution',
      customer_reference: customerReference,
      portfolio_filters: search.filters,
      confidence: customerReference ? 0.97 : 0.62,
      clarification_required: !customerReference,
      missing_fields: customerReference ? [] : ['customer_reference'],
      unsupported_criteria: search.unsupported,
    });
  }

  // 7-9. Customer analysis and draft. Specific phrases precede broad words.
  // Each branch carries the normalized portfolio filters so a named customer
  // entity embedded in the utterance ("总结一下广州ABC科技有限公司") can be
  // resolved by the controller BEFORE the scope gate.
  if (hasFollowUpDraftMeaning(intentText)) {
    return make({ intent: 'FOLLOW_UP_DRAFT', mode: 'customer_analysis', confidence: 0.98, portfolio_filters: search.filters, customer_reference: search.filters.name_query ?? null });
  }
  if (hasInteractionSummaryMeaning(intentText)) {
    return make({ intent: 'INTERACTION_SUMMARY', mode: 'customer_analysis', confidence: 0.98, portfolio_filters: search.filters, customer_reference: search.filters.name_query ?? null });
  }
  if (hasNextActionMeaning(intentText)) return make({ intent: 'NEXT_ACTION_PREPARATION', mode: 'customer_analysis', confidence: 0.97, portfolio_filters: search.filters, customer_reference: search.filters.name_query ?? null });
  if (hasRiskMeaning(intentText)) return make({ intent: 'CUSTOMER_RISK_ANALYSIS', mode: 'customer_analysis', confidence: 0.97, portfolio_filters: search.filters, customer_reference: search.filters.name_query ?? null });
  if (hasCustomerSummaryMeaning(intentText) || search.is_scoped_analysis) {
    return make({ intent: 'CUSTOMER_SUMMARY', mode: 'customer_analysis', confidence: 0.96, portfolio_filters: search.filters, customer_reference: search.filters.name_query ?? null });
  }
  if (/最近互动|沟通记录|时间线/.test(intentText)) return make({ intent: 'CUSTOMER_TIMELINE_REVIEW', mode: 'customer_analysis', confidence: 0.93, portfolio_filters: search.filters, customer_reference: search.filters.name_query ?? null });

  return make({
    intent: 'SAFE_FALLBACK',
    mode: 'customer_analysis',
    confidence: 0.35,
    clarification_required: true,
    missing_fields: ['intent'],
  });
}

/** Compatibility alias for non-production tests; production callers use createAgentIntentEnvelope. */
export const buildAgentIntentEnvelope = createAgentIntentEnvelope;

export function createAgentIntentEnvelopeFromPreset(input: {
  readonly instruction: string;
  readonly now_iso: string;
  readonly intent: ClosedAgentIntent;
  readonly mode: AgentIntentMode;
  readonly has_selected_image?: boolean;
}): AgentIntentEnvelope {
  const writeDraft = input.mode === 'write_action'
    ? draftWriteFields(input.instruction, input.now_iso) ?? presetWriteDraft(input)
    : null;
  return envelope({
    original_instruction: input.instruction,
    normalized_instruction: normalizeWhitespace(input.instruction),
    intent: writeDraft?.intent ?? input.intent,
    mode: input.mode,
    write_intent: writeDraft?.intent ?? null,
    write_draft: writeDraft,
    extracted_fields: writeDraft?.parsed_fields ?? {},
    missing_fields: writeDraft?.missing_fields ?? (input.intent === 'CAPTURE_REVIEW' && input.has_selected_image !== true ? ['selected_image'] : []),
    capture_intent: input.intent === 'CAPTURE_REVIEW' ? 'image_analysis' : null,
    confidence: 1,
    parser_source: 'typed_preset_v1',
    clarification_required: input.intent === 'CAPTURE_REVIEW' && input.has_selected_image !== true,
  });
}

function presetWriteDraft(input: {
  readonly instruction: string;
  readonly intent: ClosedAgentIntent;
}): WriteFieldDraft | null {
  const original = input.instruction.trim();
  if (!original) return null;
  if (input.intent === 'CREATE_FOLLOW_UP_REQUEST') return {
    intent: input.intent,
    tool_id: 'create_follow_up_record',
    original_instruction: original,
    parsed_fields: { title: '跟进记录', feedback_notes: original },
    missing_fields: [],
    question: null,
    quick_replies: [],
  };
  if (input.intent === 'CREATE_TASK_REQUEST') return {
    intent: input.intent,
    tool_id: 'create_task',
    original_instruction: original,
    parsed_fields: { title: original, status: 'OPEN' },
    missing_fields: [],
    question: null,
    quick_replies: [],
  };
  return null;
}

/** Continuation may fill missing fields but can never change the original intent identity. */
export function mergeAgentIntentClarificationAnswer(
  original: AgentIntentEnvelope,
  answer: string,
): AgentIntentEnvelope {
  const value = normalizeWhitespace(answer);
  if (!value || original.missing_fields.length === 0) return original;
  const [field, ...remaining] = original.missing_fields;
  return Object.freeze({
    ...original,
    extracted_fields: Object.freeze({ ...original.extracted_fields, [field]: value, clarification_answer: value }),
    missing_fields: Object.freeze(remaining),
    clarification_required: remaining.length > 0,
  });
}

function normalizeWhitespace(message: string): string {
  return message.normalize('NFKC').replace(/[\u3000\s]+/g, ' ').replace(/怎摸/g, '怎么').trim();
}

function hasAnalysisMeaning(text: string): boolean {
  return hasRiskMeaning(text) || hasNextActionMeaning(text) || hasCustomerSummaryMeaning(text)
    || hasInteractionSummaryMeaning(text) || hasCustomerCompareMeaning(text) || hasFollowUpDraftMeaning(text)
    || hasCaptureMeaning(text);
}

function hasCompetingActions(text: string): boolean {
  if (/(?:总结|概括).*(?:完|后|再|然后).*(?:写|起草|拟)|(?:写|起草|拟).*(?:再|然后|之后).*(?:总结|概括)/.test(text)) return true;
  if (/(?:切换|切到|换到|打开|定位)(?:客户|到|至)?.{0,24}(?:后|然后|再|之后).*(?:总结|概括|风险|分析|比较|排序|下一步)/.test(text)) return true;
  if (/(?:切到|切换到)(?:另一家|别家|其他客户).*(?:然后|再|之后).*(?:总结|概括|风险|分析|比较|排序)/.test(text)
    || /(?:先找|查找|定位)(?:一个|一家|客户|公司).*(?:然后|再|之后).*(?:总结|概括|风险|分析|比较|排序)/.test(text)) return true;
  if (/(?:发送|入库|替我确认|自动更新|直接更新|直接创建)/.test(text)
    && /(?:写|话术|文案|分析|看|识图|比较|概括|风险)/.test(text)) return true;
  if (/(?:总结|概括).*(?:和|并|再).*(?:排序|比较)|(?:排序|比较).*(?:和|并|再).*(?:总结|概括)/.test(text)) return true;
  if (/(?:对比|比较|对照).*(?:再|然后|之后).*(?:分析|风险|机会|总结)|(?:分析|风险|机会|总结).*(?:再|然后|之后).*(?:对比|比较|对照)/.test(text)) return true;
  const write = /(?:创建|新增|写入|更新|修改|改成|改(?:下次|客户|等级|状态|时间)|建|记录|入库|发送|替我确认).*(?:任务|待办|跟进|等级|状态|时间|数据库)?|(?:任务|待办|跟进记录).*(?:创建|新增|建)/.test(text);
  const capture = /截图|图片|照片|附件|识图|看图/i.test(text);
  const compare = /比较|对比|横向|并排|排序|优先级|PK|A\s*(?:跟|和|与|\/|or)\s*B/i.test(text);
  const draft = hasFollowUpDraftMeaning(text)
    && !/(?:别|不要|无需|不用|不必).{0,6}(?:写|起草|拟|生成)/.test(text);
  const analysis = /风险|机会|总结|概括|现状|全貌|下一步|互动|沟通|交流|对话|分析/i.test(text)
    || (!compare && /推进/.test(text));
  if (compare && !write && !capture && !draft) return false;
  const categories = [write, capture, compare, draft, analysis].filter(Boolean).length;
  return categories >= 2 && /(?:再|然后|顺便|并且|同时|之后|后(?!的)|以及|并|\+|and|完)/i.test(text);
}

/** Remove only locally scoped exclusions; never treats ordinary "不确定" as negation. */
function removeNegatedIntentScopes(input: string): string {
  let text = input
    .replace(/不是不(?:想|要|需要)?/g, '要')
    .replace(/别光说好的/g, ' ');
  const boundary = '(?=(?:[，,；;。.!！?？]|而是|只是|只要|就是|先分析|先总结|直接下一步|直接分析|$))';
  const exclusion = new RegExp(`(^|[，,；;。.!！?？\\s])(?:不要|不是要|别|不用|先别|不是让你|不需要|无需|不必|不要求)\\s*.{0,28}?${boundary}`, 'gi');
  text = text.replace(exclusion, '$1 ');
  return text
    .replace(/^(?:[，,；;。.!！?？]|而是|只是|只要|就是)+/g, ' ')
    .replace(/[\u3000\s]+/g, ' ')
    .trim();
}

function isUnsupportedAutonomousRequest(text: string): boolean {
  return /不支持的\s*[:：]|删除(?:这个|当前|全部)?客户|执行(?:任意)?\s*SQL|绕过确认|直接写入数据库|(?:帮我|替我|直接|自动)(?:去)?(?:发送|发)(?:邮件|短信|微信)|自动(?:执行|联系|外呼|发邮件|发消息|群发|跟进)|后台持续|直接群发/i.test(text);
}

function hasCaptureMeaning(text: string): boolean {
  const object = /截图|图片|照片|图|附件|image|picture|screenshot/i.test(text);
  const operation = /分析|识别|提取|找出|解析|结构化|读(?:一下)?|看(?:一下)?|核对|信息|内容|需求|异议|fact|analy[sz]e|extract|read|vision/i.test(text);
  return object && operation;
}

function hasCustomerCompareMeaning(text: string): boolean {
  const operation = /对比|比较|对照|横向|并排|排序|排出|选出|比一比|比一下|优先级|哪(?:家|两家|个).*(?:优先|更好|值得)|谁(?:更|先|应当|的机会)|更成熟|\bcompare\b|\bvs\b/i.test(text);
  const pluralCustomerObject = /这几家|几家|几个客户|(?:哪|这)?[两二三四五]家(?:客户|企业|公司)?|多客户|哪家客户|客户.*(?:对比|比较)|客户.{0,30}(?:vs|对|和|与|跟|\/|、).{0,30}客户|(?:公司|企业|集团|科技|贸易|软件|有限公司).{0,30}(?:和|与|跟|\/|、).{0,30}(?:公司|企业|集团|科技|贸易|软件|有限公司)|客户(?:集合|组|群)|候选客户|这些账户|这批客户|这些客户|accounts?|customer set|A\s*(?:和|与|跟|\/|or)\s*B/i.test(text);
  return operation && pluralCustomerObject;
}

function hasFollowUpDraftMeaning(text: string): boolean {
  // “写一条跟进记录 … 并约下周一再联系” is one bounded CRM write
  // proposal (record + next-follow-up update), not a prose-drafting request.
  if (classifyClosedWriteIntent(text)) return false;
  const drafting = /写|起草|拟|生成|润色|草稿|模板|来一版|一版|组织|准备|回一句|draft|write/i.test(text);
  const communication = /跟进|微信|短信|邮件|消息|信息|文字|回话|话术|文案|回复|回一句|回访|提醒|催|询问反馈|约见面|客户发啥|follow.?up|followup|reply|message|note/i.test(text);
  return drafting && communication;
}

function hasInteractionSummaryMeaning(text: string): boolean {
  if (/复盘/.test(text) && !classifyClosedWriteIntent(text)) return true;
  if (/新增事实|交流中的新事实/.test(text)) return true;
  if (/最近发生了哪些重要变化/.test(text)) return true;
  const interactionObject = /互动|沟通|交流|对话|聊天|chat|聊过|谈过|往来|联络|接触|通话|触达|反馈|交换.*信息|联系(?:内容|记录)|跟进交流|conversation|interaction|touchpoint/i.test(text);
  const summarizing = /整理|总结|概括|回顾|复盘|列出|找出|串|重点|要点|纪要|摘要|新增事实|新信息|哪些信息|历史|时间线|脉络|归纳|提炼|汇总|压缩|变化|情况|咋样|说了|谈过|recap|summary|summarize/i.test(text);
  return interactionObject && summarizing;
}

function hasNextActionMeaning(text: string): boolean {
  return /下一步|下一项行动|哪一步|下一拍|接下来(?:先|怎么|该怎么|应该怎么|咋)|该怎么办|接着(?:呢|怎么|咋)|然后怎么走|咋整|后续动作|近期动作|最重要的动作|最该先(?:做|办|干)|第一件事|先(?:做|干|动|办|处理)(?:什么|啥)|先干(?:哪一步|啥)|先联系谁|推进(?:建议|方向)|行动(?:建议|清单)|跟进动作|应该怎么推进|继续推进|怎样继续|怎么往前|怎么破局|马上该做什么|马上采取|该打电话还是发消息|推进(?:节奏|顺序)|规划(?:下一步|近期动作)|沟通前.*准备|盯啥关键动作|可执行下一步|可落地的下一步|next\s*(?:step|move|action)|what (?:is |should i do )?(?:the best )?next/i.test(text);
}

function hasRiskMeaning(text: string): boolean {
  return /风险|机会|隐患|出问题|掉链子|有啥雷|雷点|排雷|有(?:什么|没有|没)?坑|坑(?:在哪|没)|稳(?:吗|不稳)|黄单|翻车|丢单|失速|停住|薄弱环节|危险的环节|警惕的信号|不确定因素|阻力|阻碍|风险收益|推进价值|值不值得|值得(?:推进|推)|最大的问题|突破口|成交窗口|可利用的窗口|risk(?:\s*(?:check|review))?|what could go wrong/i.test(text);
}

function hasCustomerSummaryMeaning(text: string): boolean {
  return /总结|概括|概述|汇总|摘要|简介|归拢.*资料|压缩.*信息|全貌|全景|速览|总览|概况|概览|画像|简述|分析一下|分析下|brief|overview|customer\s*summary|analy[sz]e|整体(?:怎么样|情况|面)|目前(?:的)?情况|最近的情况|基本情况|基本盘|底子|来龙去脉|当前(?:局面|进展)|现阶段的信息|是什么情形|现况|合作进展|客户现状|客户状态|客户背景|客户信息|这个客户|这位客户|这客户|这家公司|这家企业|这家合作方|这个账户|这单客户|刚接手|新接手|客户侧现状|客户咋样|客户怎么样|客怎么样|现在啥(?:情况|进度)|瞅瞅.*客户/i.test(text);
}

function envelope(input: Partial<AgentIntentEnvelope> & Pick<AgentIntentEnvelope, 'intent' | 'mode' | 'confidence'>): AgentIntentEnvelope {
  const route = resolveCapabilityRoute(input.intent);
  const result: AgentIntentEnvelope = {
    envelope_id: input.envelope_id ?? uuidv4(),
    original_instruction: input.original_instruction ?? '',
    normalized_instruction: input.normalized_instruction ?? normalizeWhitespace(input.original_instruction ?? ''),
    intent: input.intent,
    mode: input.mode,
    model_capability: route.model_capability,
    requires_real_model: route.requires_real_model,
    customer_reference: input.customer_reference ?? null,
    portfolio_filters: input.portfolio_filters ?? {},
    write_intent: input.write_intent ?? null,
    write_draft: input.write_draft ?? null,
    capture_intent: input.capture_intent ?? null,
    extracted_fields: input.extracted_fields ?? {},
    missing_fields: input.missing_fields ?? [],
    confidence: input.confidence,
    parser_source: input.parser_source ?? 'production_deterministic_v2',
    clarification_required: input.clarification_required ?? false,
    unsupported_criteria: input.unsupported_criteria ?? [],
  };
  return Object.freeze({
    ...result,
    portfolio_filters: Object.freeze({ ...result.portfolio_filters }),
    extracted_fields: Object.freeze({ ...result.extracted_fields }),
    write_draft: result.write_draft ? Object.freeze({
      ...result.write_draft,
      parsed_fields: Object.freeze({ ...result.write_draft.parsed_fields }),
      missing_fields: Object.freeze([...result.write_draft.missing_fields]),
      quick_replies: Object.freeze(result.write_draft.quick_replies.map(item => Object.freeze({ ...item }))),
    }) : null,
    missing_fields: Object.freeze([...result.missing_fields]),
    unsupported_criteria: Object.freeze([...result.unsupported_criteria]),
  });
}

function semanticIntent(intent: SemanticIntentResolution['intent']): ClosedAgentIntent | null {
  switch (intent) {
    case 'CUSTOMER_SUMMARY': return 'CUSTOMER_SUMMARY';
    case 'CUSTOMER_RISK_ANALYSIS': return 'CUSTOMER_RISK_ANALYSIS';
    case 'NEXT_ACTION_RECOMMENDATION': return 'NEXT_ACTION_PREPARATION';
    case 'FOLLOW_UP_DRAFT': return 'FOLLOW_UP_DRAFT';
    case 'INTERACTION_SUMMARY': return 'INTERACTION_SUMMARY';
    case 'COMPLEX_CUSTOMER_COMPARE': return 'COMPLEX_CUSTOMER_COMPARE';
    case 'IMAGE_CAPTURE_ANALYSIS': return 'CAPTURE_REVIEW';
    case 'CUSTOMER_PRIORITY_RANKING': return 'CUSTOMER_PRIORITY_RANKING';
    case 'CUSTOMER_TIMELINE_REVIEW': return 'CUSTOMER_TIMELINE_REVIEW';
    case 'BATTLE_CARD_ANALYSIS': return 'CUSTOMER_SUMMARY';
    default: return null;
  }
}

function hasCustomerPriorityMeaning(message: string): boolean {
  return /(?:高质量客户|最值得(?:跟|联系)|优先联系|优先跟进|最有机会成交|最可能成交|这周我优先联系谁|这周最值得联系谁|最近最值得跟的客户)/.test(message);
}

const READ_ONLY_REASONING_INTENTS: ReadonlySet<ClosedAgentIntent> = new Set([
  'CUSTOMER_SUMMARY',
  'CUSTOMER_RISK_ANALYSIS',
  'NEXT_ACTION_PREPARATION',
  'FOLLOW_UP_DRAFT',
  'INTERACTION_SUMMARY',
]);

/**
 * Safely non-mutating analysis/review/recommendation.
 * Used so the capability planner does not intercept reasoning as a CRM tool pick.
 * Explicit writes still win via write_draft / deterministic selector first.
 */
export function isReadOnlyReasoningIntent(envelope: AgentIntentEnvelope): boolean {
  if (envelope.mode !== 'customer_analysis') return false;
  if (envelope.write_intent != null || envelope.write_draft != null) return false;
  if (/删了|删掉|删除/.test(envelope.normalized_instruction) && /客户|账户/.test(envelope.normalized_instruction)) {
    return false;
  }
  if (!READ_ONLY_REASONING_INTENTS.has(envelope.intent)) return false;
  if (envelope.intent === 'CUSTOMER_SUMMARY' && /改成|改为|改到|改一下|更新|修改|设为|删除|删掉|删了|新建|创建|记录跟进|写入/.test(envelope.normalized_instruction)) {
    return false;
  }
  // “记录今天拜访 … 下一步发方案” is a visit write, not next-step reasoning.
  if (envelope.intent === 'NEXT_ACTION_PREPARATION' && /拜访|面访/.test(envelope.normalized_instruction)) {
    return false;
  }
  return true;
}
