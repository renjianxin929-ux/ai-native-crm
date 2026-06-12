export type LeadBatchType = 'AI_DAILY' | 'MANUAL' | 'EXPO' | 'WECHAT' | 'OTHER';

export type LeadImportDecision =
  | 'DIRECT_TO_CRM'
  | 'CRM_WITH_LOOKUP'
  | 'LOOKUP_FIRST'
  | 'RESERVE'
  | 'IGNORE';

export type LeadDecisionStatus = 'PENDING' | 'EXECUTING' | 'DONE' | 'FAILED';

export type LeadWorkType = 'NEW_CUSTOMER_LOOKUP' | 'CRM_CUSTOMER_ENRICHMENT' | 'MANUAL_LOOKUP';

export type LeadLookupGoal =
  | 'FIND_PHONE'
  | 'FIND_CONTACT'
  | 'FIND_DECISION_MAKER'
  | 'VERIFY_COMPANY'
  | 'COMPLETE_PROFILE';

export type LeadWorkStatus =
  | 'TODO'
  | 'SEARCHING'
  | 'STAGED'
  | 'COLLECTED'
  | 'NO_PHONE'
  | 'SKIPPED'
  | 'DONE';

export type LeadCaptureAction = 'PASTED' | 'PARSED' | 'IGNORED' | 'SAVED_TO_COLLECTED';

export type CollectedLeadSyncStatus = 'UNSYNCED' | 'SYNCED' | 'FAILED' | 'IGNORED';

export type LeadSyncAction = 'CREATE_CUSTOMER' | 'ENRICH_CUSTOMER' | 'SKIP_DUPLICATE' | 'FAILED';

export type LeadSyncStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface LeadImportBatch {
  id: string;
  batch_name: string;
  batch_type: LeadBatchType;
  source_label: string | null;
  total_rows: number;
  created_at: string;
  updated_at: string;
}

export interface LeadImportRow {
  id: string;
  batch_id: string;
  row_index: number;
  raw_data_json: string;
  company_name: string | null;
  city: string | null;
  industry: string | null;
  website: string | null;
  contact_name: string | null;
  mobile: string | null;
  tel: string | null;
  email: string | null;
  score: number | null;
  grade: string | null;
  tanji_search_keyword: string | null;
  matching_reason: string | null;
  priority_contact_role: string | null;
  source_evidence: string | null;
  decision: LeadImportDecision;
  decision_status: LeadDecisionStatus;
  created_customer_id: string | null;
  created_work_item_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadWorkItem {
  id: string;
  import_row_id: string | null;
  customer_id: string | null;
  work_type: LeadWorkType;
  company_name: string | null;
  city: string | null;
  industry: string | null;
  priority: number;
  lookup_goal: LeadLookupGoal;
  tanji_search_keyword: string | null;
  status: LeadWorkStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}
