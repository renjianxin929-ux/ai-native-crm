/**
 * customer.create business-argument integrity.
 *
 * Capability selection may be deterministic. Filling name/contact is a separate
 * grammar: create-action words prove capability, not the company name.
 * Role titles (老板/联系人/对接人/负责人) prove contact_person, not name.
 *
 * Name extraction preserves the entity span. It may strip structural command
 * markers ("新增客户 ", "创建一个客户 ") but must never globally delete
 * 客户/企业/公司 from a legal name (客户成功科技 / 企业微信 / 有限公司).
 */

import { KNOWN_REGION_TOKENS } from './customerQueryInterpretation';

const CREATE_ACTION = /(?:新建|新增|创建|登记|录入)(?:一个|一名|一家)?/g;
const BARE_CREATE_CUSTOMER_OBJECT = /(?:新建|新增|创建|登记|录入)客户/g;
const CONTACT_ROLE = /(?:联系人|对接人|负责人|老板)\s*(?:是|为)?\s*([^\s，,。！？]{1,20})/;
const CONTACT_ROLE_GLOBAL = /(?:联系人|对接人|负责人|老板)\s*(?:是|为)?\s*[^\s，,。！？]{1,20}/g;
const LEADING_STRUCTURAL_ENTITY_MARKER = /^(?:客户|企业|公司)(?=\s)/;
const TRAILING_CUSTOMER_OBJECT_MARKER = /客户$/;
const BARE_STRUCTURAL_ENTITY = /^(?:客户|企业|公司)$/;

export function extractCreateContactPerson(utterance: string): string | null {
  const match = utterance.match(CONTACT_ROLE);
  const contact = match?.[1]?.trim() ?? '';
  return contact.length > 0 ? contact : null;
}

export function isCreateActionName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return /^(?:请)?(?:帮我)?(?:新建|新增|创建|登记|录入)(?:一个|一名|一家)?(?:客户|企业|公司)?$/.test(trimmed);
}

function looksLikeUnparsedCreateUtterance(name: string): boolean {
  return /(?:新建|新增|创建|登记|录入)/.test(name) && /(?:客户|企业|公司)/.test(name);
}

const REGION_ONLY = new Set<string>(KNOWN_REGION_TOKENS);

export function extractCreateCustomerName(utterance: string): string | null {
  let rest = utterance.trim();
  rest = rest.replace(CONTACT_ROLE_GLOBAL, ' ');
  rest = rest.replace(BARE_CREATE_CUSTOMER_OBJECT, ' ');
  rest = rest.replace(CREATE_ACTION, ' ');
  rest = rest.replace(/名称/g, ' ');
  rest = rest.replace(/[，,：:。！？]/g, ' ');
  rest = rest.replace(/\s+/g, ' ').trim();
  rest = rest.replace(LEADING_STRUCTURAL_ENTITY_MARKER, '').trim();
  rest = rest.replace(TRAILING_CUSTOMER_OBJECT_MARKER, '').trim();
  if (rest.length < 2 || BARE_STRUCTURAL_ENTITY.test(rest) || isCreateActionName(rest) || REGION_ONLY.has(rest)) {
    return null;
  }
  return rest;
}

/**
 * Keep known contact. Drop action-word / whole-utterance names.
 * Never inherit a selected customer's identity; this only reads the utterance.
 */
export function sanitizeCustomerCreateArguments(
  utterance: string,
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args };
  const extractedContact = extractCreateContactPerson(utterance);
  const extractedName = extractCreateCustomerName(utterance);
  const currentName = typeof next.name === 'string' ? next.name.trim() : '';

  if (!currentName || isCreateActionName(currentName) || currentName === utterance.trim() || looksLikeUnparsedCreateUtterance(currentName)) {
    if (extractedName) next.name = extractedName;
    else delete next.name;
  }

  const currentContact = typeof next.contact_person === 'string' ? next.contact_person.trim() : '';
  if (!currentContact && extractedContact) {
    next.contact_person = extractedContact;
  }

  return next;
}
