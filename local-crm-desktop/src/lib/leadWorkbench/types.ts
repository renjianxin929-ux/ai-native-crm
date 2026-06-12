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
