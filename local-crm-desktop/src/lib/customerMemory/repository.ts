import { buildCustomerMemoryContext } from './memory';
import type { CustomerMemoryCandidateInput, CustomerMemoryContext, CustomerMemoryEntry, CustomerMemoryEvidenceLink, CustomerMemoryEvidenceType, CustomerMemorySourceType, CustomerMemoryType, CustomerMemoryValidationStatus, MemoryRepository } from './types';

interface DatabaseLike {
  execute(sql: string, bindings?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T>(sql: string, bindings?: unknown[]): Promise<T[]>;
}

interface EvidenceResolver {
  exists(customerId: string, evidenceType: CustomerMemoryEvidenceType, evidenceId: string): Promise<boolean>;
}

type EntryRow = Omit<CustomerMemoryEntry, 'evidence' | 'human_verified'> & { human_verified: number };
type EvidenceRow = CustomerMemoryEvidenceLink;

export class SqliteMemoryRepository implements MemoryRepository {
  private readonly db: DatabaseLike;
  private readonly evidenceResolver: EvidenceResolver;
  private readonly clock: () => string;

  constructor(db: DatabaseLike, evidenceResolver: EvidenceResolver, clock: () => string = () => new Date().toISOString()) {
    this.db = db;
    this.evidenceResolver = evidenceResolver;
    this.clock = clock;
  }

  async createCandidate(input: CustomerMemoryCandidateInput): Promise<CustomerMemoryEntry> {
    validateCandidate(input);
    await this.assertEvidence(input.customer_id, input.evidence);
    const now = timestamp(this.clock());
    await this.db.execute(
      'INSERT INTO ai_memory_entries (id, customer_id, memory_type, content, source_type, source_reference, confidence, validation_status, validation_source, human_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [input.id.trim(), input.customer_id.trim(), input.memory_type, input.content.trim(), input.source_type, input.source_reference.trim(), input.confidence, 'CANDIDATE', null, 0, now, now],
    );
    for (const evidence of input.evidence) {
      await this.db.execute('INSERT INTO ai_memory_evidence_links (id, memory_id, evidence_type, evidence_id) VALUES (?, ?, ?, ?)', [text(evidence.id, 'evidence.id'), input.id.trim(), evidence.evidence_type, text(evidence.evidence_id, 'evidence.evidence_id')]);
    }
    return this.requireEntry(input.id);
  }

  async validateMemory(id: string, input: { validation_source: 'CRM_EVIDENCE' | 'HUMAN_REVIEW'; human_verified?: boolean }): Promise<CustomerMemoryEntry> {
    const entry = await this.requireEntry(id);
    if (entry.validation_status !== 'CANDIDATE') throw new Error('Only candidate memory can be validated.');
    const humanVerified = input.human_verified === true;
    if (entry.source_type === 'AI_REASONING_SUMMARY' && (!humanVerified || input.validation_source !== 'HUMAN_REVIEW')) throw new Error('AI reasoning summaries require human verification.');
    await this.ensureEvidence(entry);
    await this.db.execute('UPDATE ai_memory_entries SET validation_status = ?, validation_source = ?, human_verified = ?, updated_at = ? WHERE id = ?', ['VALIDATED', input.validation_source, humanVerified ? 1 : 0, timestamp(this.clock()), entry.id]);
    return this.requireEntry(entry.id);
  }

  async activateMemory(id: string): Promise<CustomerMemoryEntry> {
    const entry = await this.requireEntry(id);
    if (entry.validation_status !== 'VALIDATED') throw new Error('Only validated memory can be activated.');
    if (entry.source_type === 'AI_REASONING_SUMMARY' && (!entry.human_verified || entry.validation_source !== 'HUMAN_REVIEW')) throw new Error('AI reasoning summaries require human verification.');
    await this.ensureEvidence(entry);
    await this.db.execute('UPDATE ai_memory_entries SET validation_status = ?, updated_at = ? WHERE id = ?', ['ACTIVE', timestamp(this.clock()), entry.id]);
    return this.requireEntry(entry.id);
  }

  async archiveMemory(id: string): Promise<CustomerMemoryEntry> {
    const entry = await this.requireEntry(id);
    if (entry.validation_status === 'ARCHIVED') return entry;
    await this.db.execute('UPDATE ai_memory_entries SET validation_status = ?, updated_at = ? WHERE id = ?', ['ARCHIVED', timestamp(this.clock()), entry.id]);
    return this.requireEntry(entry.id);
  }

  async listCustomerMemory(customerId: string): Promise<readonly CustomerMemoryEntry[]> {
    const rows = await this.db.select<EntryRow>('SELECT id, customer_id, memory_type, content, source_type, source_reference, confidence, validation_status, validation_source, human_verified, created_at, updated_at FROM ai_memory_entries WHERE customer_id = ? ORDER BY updated_at DESC, id ASC', [text(customerId, 'customer_id')]);
    return Promise.all(rows.map(row => this.hydrate(row)));
  }

  async getMemoryContext(customerId: string, options: { max_items?: number; max_characters?: number } = {}): Promise<CustomerMemoryContext> {
    const active = (await this.listCustomerMemory(customerId)).filter(entry => entry.validation_status === 'ACTIVE');
    return buildCustomerMemoryContext({
      customer_id: customerId,
      max_items: options.max_items,
      max_characters: options.max_characters,
      items: active.map(entry => ({ memory_id: entry.id, customer_id: entry.customer_id, kind: legacyKind(entry.memory_type), summary: entry.content, source_kind: legacySource(entry.source_type), validation_source: entry.human_verified ? 'validated_reasoning_summary' : 'crm_record', human_verified: entry.human_verified ? true : undefined, source_reference: entry.source_reference, evidence_reference: entry.evidence.map(link => `${link.evidence_type}:${link.evidence_id}`).join('|'), source_timestamp: entry.updated_at, recorded_at: entry.created_at })),
    });
  }

  private async requireEntry(id: string): Promise<CustomerMemoryEntry> {
    const rows = await this.db.select<EntryRow>('SELECT id, customer_id, memory_type, content, source_type, source_reference, confidence, validation_status, validation_source, human_verified, created_at, updated_at FROM ai_memory_entries WHERE id = ?', [text(id, 'id')]);
    if (rows.length !== 1) throw new Error('Customer memory entry does not exist.');
    return this.hydrate(rows[0]);
  }

  private async hydrate(row: EntryRow): Promise<CustomerMemoryEntry> {
    const evidence = await this.db.select<EvidenceRow>('SELECT id, memory_id, evidence_type, evidence_id FROM ai_memory_evidence_links WHERE memory_id = ? ORDER BY id ASC', [row.id]);
    return { ...row, memory_type: row.memory_type as CustomerMemoryType, source_type: row.source_type as CustomerMemorySourceType, validation_status: row.validation_status as CustomerMemoryValidationStatus, validation_source: row.validation_source as CustomerMemoryEntry['validation_source'], human_verified: row.human_verified === 1, evidence };
  }

  private async ensureEvidence(entry: CustomerMemoryEntry): Promise<void> {
    if (entry.evidence.length === 0) throw new Error('Active memory requires evidence.');
    await this.assertEvidence(entry.customer_id, entry.evidence);
  }

  private async assertEvidence(customerId: string, evidence: readonly Pick<CustomerMemoryEvidenceLink, 'evidence_type' | 'evidence_id'>[]): Promise<void> {
    if (evidence.length === 0) throw new Error('Customer memory evidence is required.');
    for (const link of evidence) if (!await this.evidenceResolver.exists(customerId, link.evidence_type, link.evidence_id)) throw new Error(`Customer memory evidence is unknown: ${link.evidence_type}:${link.evidence_id}.`);
  }
}

export class SqliteCrmEvidenceResolver implements EvidenceResolver {
  private readonly db: DatabaseLike;
  constructor(db: DatabaseLike) { this.db = db; }
  async exists(customerId: string, type: CustomerMemoryEvidenceType, evidenceId: string): Promise<boolean> {
    const source = { CUSTOMER: ['customers', 'id'], FOLLOW_UP_RECORD: ['follow_up_records', 'id'], VISIT_RECORD: ['visit_records', 'id'], TASK: ['tasks', 'id'] } as const;
    const [table, idColumn] = source[type];
    const customerColumn = type === 'CUSTOMER' ? 'id' : 'customer_id';
    const rows = await this.db.select<{ id: string }>(`SELECT ${idColumn} AS id FROM ${table} WHERE ${idColumn} = ? AND ${customerColumn} = ?`, [text(evidenceId, 'evidence_id'), text(customerId, 'customer_id')]);
    return rows.length === 1;
  }
}

function validateCandidate(input: CustomerMemoryCandidateInput): void {
  text(input.id, 'id'); text(input.customer_id, 'customer_id'); text(input.content, 'content'); text(input.source_reference, 'source_reference');
  if (!['FACT', 'EVENT', 'PREFERENCE', 'INTERACTION_PATTERN', 'HUMAN_CONFIRMED_INSIGHT'].includes(input.memory_type)) throw new Error('Customer memory type is unsupported.');
  if (!['CRM_FACT', 'CRM_INTERACTION', 'AI_REASONING_SUMMARY', 'HUMAN_INPUT'].includes(input.source_type)) throw new Error('Customer memory source type is unsupported.');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error('Customer memory confidence must be between 0 and 1.');
}
function text(value: string, field: string): string { const result = value.trim(); if (!result) throw new Error(`Customer memory ${field} is required.`); return result; }
function timestamp(value: string): string { if (!Number.isFinite(Date.parse(value))) throw new Error('Customer memory clock must return a timestamp.'); return new Date(value).toISOString(); }
function legacyKind(type: CustomerMemoryType): 'fact' | 'event' | 'interaction' | 'decision' | 'reasoning_summary' { return ({ FACT: 'fact', EVENT: 'event', PREFERENCE: 'decision', INTERACTION_PATTERN: 'interaction', HUMAN_CONFIRMED_INSIGHT: 'reasoning_summary' } as const)[type]; }
function legacySource(source: CustomerMemorySourceType): 'crm_record' | 'human_decision' | 'validated_reasoning_summary' { return source === 'AI_REASONING_SUMMARY' ? 'validated_reasoning_summary' : source === 'HUMAN_INPUT' ? 'human_decision' : 'crm_record'; }
