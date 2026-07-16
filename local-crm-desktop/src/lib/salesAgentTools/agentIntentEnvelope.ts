import { normalizeCustomerSearchFilters, type NormalizedCustomerSearchFilters } from './filterNormalization';
import { draftWriteFields, type ClosedWriteIntent } from './writeIntent';

export type AgentIntentMode =
  | 'entity_resolution'
  | 'portfolio_search'
  | 'customer_analysis'
  | 'write_action'
  | 'capture'
  | 'control';

export type ClosedAgentIntent =
  | 'SEARCH_CUSTOMERS'
  | 'CUSTOMER_SUMMARY'
  | 'CUSTOMER_RISK_ANALYSIS'
  | 'CUSTOMER_TIMELINE_REVIEW'
  | 'NEXT_ACTION_PREPARATION'
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
  readonly intent: ClosedAgentIntent;
  readonly mode: AgentIntentMode;
  readonly customer_reference: string | null;
  readonly portfolio_filters: NormalizedCustomerSearchFilters;
  readonly write_intent: ClosedWriteIntent | null;
  readonly extracted_fields: Readonly<Record<string, unknown>>;
  readonly missing_fields: readonly string[];
  readonly confidence: number;
  readonly parser_source: 'deterministic_v1';
  readonly clarification_required: boolean;
  readonly unsupported_criteria: readonly string[];
}

export function buildAgentIntentEnvelope(message: string, nowIso: string): AgentIntentEnvelope {
  const text = normalizeWhitespace(message);
  const search = normalizeCustomerSearchFilters(text, nowIso);
  const write = draftWriteFields(text, nowIso);

  if (write) {
    return envelope({
      intent: write.intent,
      mode: 'write_action',
      customer_reference: search.filters.name_query ?? null,
      portfolio_filters: search.filters,
      write_intent: write.intent,
      extracted_fields: write.parsed_fields,
      missing_fields: write.missing_fields,
      confidence: 0.98,
      clarification_required: write.missing_fields.length > 0,
      unsupported_criteria: search.unsupported,
    });
  }

  if (search.is_clear_scope) return controlEnvelope('CLEAR_CUSTOMER_SCOPE');
  if (/新对话|重新开始|开启新会话/.test(text)) return controlEnvelope('NEW_CONVERSATION');
  if (/取消(?:这项|本次|当前)?(?:操作|建议|写入|确认)?/.test(text)) return controlEnvelope('CANCEL_PENDING_WRITE');
  if (/确认(?:执行|写入|操作)?/.test(text)) return controlEnvelope('CONFIRM_PENDING_WRITE');
  if (/上传|图片|截图|粘贴|捕获|capture/i.test(text)) {
    return envelope({ intent: 'CAPTURE_REVIEW', mode: 'capture', confidence: 0.92 });
  }
  if (search.is_portfolio_query) {
    return envelope({
      intent: 'SEARCH_CUSTOMERS', mode: 'portfolio_search',
      customer_reference: null, portfolio_filters: search.filters,
      confidence: Object.keys(search.filters).length > 1 ? 0.99 : 0.9,
      unsupported_criteria: search.unsupported,
      clarification_required: search.unsupported.length > 0,
    });
  }
  if (search.is_customer_lookup || search.is_explicit_switch) {
    const customerReference = search.filters.name_query ?? null;
    return envelope({
      intent: 'SEARCH_CUSTOMERS', mode: 'entity_resolution',
      customer_reference: customerReference, portfolio_filters: search.filters,
      confidence: customerReference ? 0.97 : 0.62,
      clarification_required: !customerReference,
      missing_fields: customerReference ? [] : ['customer_reference'],
      unsupported_criteria: search.unsupported,
    });
  }
  if (/风险|机会|分析现状/.test(text)) return analysisEnvelope('CUSTOMER_RISK_ANALYSIS');
  if (/最近互动|沟通记录|时间线/.test(text)) return analysisEnvelope('CUSTOMER_TIMELINE_REVIEW');
  if (/下一步|准备跟进|建议/.test(text)) return analysisEnvelope('NEXT_ACTION_PREPARATION');
  if (/总结|概括|最近怎么样|客户现状|这个客户/.test(text) || search.is_scoped_analysis) return analysisEnvelope('CUSTOMER_SUMMARY');
  return envelope({ intent: 'SAFE_FALLBACK', mode: 'customer_analysis', confidence: 0.35, clarification_required: true, missing_fields: ['intent'] });
}

function normalizeWhitespace(message: string): string {
  return message.normalize('NFKC').replace(/[\u3000\s]+/g, ' ').trim();
}

function analysisEnvelope(intent: ClosedAgentIntent): AgentIntentEnvelope {
  return envelope({ intent, mode: 'customer_analysis', confidence: 0.94 });
}

function controlEnvelope(intent: ClosedAgentIntent): AgentIntentEnvelope {
  return envelope({ intent, mode: 'control', confidence: 0.99 });
}

function envelope(input: Partial<AgentIntentEnvelope> & Pick<AgentIntentEnvelope, 'intent' | 'mode' | 'confidence'>): AgentIntentEnvelope {
  return {
    intent: input.intent,
    mode: input.mode,
    customer_reference: input.customer_reference ?? null,
    portfolio_filters: input.portfolio_filters ?? {},
    write_intent: input.write_intent ?? null,
    extracted_fields: input.extracted_fields ?? {},
    missing_fields: input.missing_fields ?? [],
    confidence: input.confidence,
    parser_source: 'deterministic_v1',
    clarification_required: input.clarification_required ?? false,
    unsupported_criteria: input.unsupported_criteria ?? [],
  };
}
