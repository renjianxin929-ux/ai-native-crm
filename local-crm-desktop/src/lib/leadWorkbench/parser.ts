import { getActiveVerticalProfile, type VerticalRuleProfile } from '../verticalProfiles';

export interface ParsedLeadContactText {
  mobiles: string[];
  tels: string[];
  urls: string[];
  emails: string[];
  contacts: string[];
  possibleContacts: string[];
}

export type LeadCaptureParserOptions = {
  profile?: VerticalRuleProfile;
};

export function parseLeadContactText(
  rawText: string,
  options: LeadCaptureParserOptions = {},
): ParsedLeadContactText {
  const profile = options.profile ?? getActiveVerticalProfile();

  return {
    mobiles: parseMobiles(rawText, profile),
    tels: parseLandlines(rawText, profile),
    urls: parseUrls(rawText),
    emails: parseEmails(rawText),
    contacts: [],
    possibleContacts: parsePossibleContacts(rawText, profile),
  };
}

function parseMobiles(text: string, profile: VerticalRuleProfile): string[] {
  const mobiles: string[] = [];
  const regex = new RegExp(profile.capture.mobilePattern, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const mobile = match[1].replace(/\D/g, '');
    if (mobile.length === 11) {
      mobiles.push(mobile);
    }
  }

  return unique(mobiles);
}

function parseLandlines(text: string, profile: VerticalRuleProfile): string[] {
  const landlines: string[] = [];
  const areaCodePattern = profile.capture.landlineAreaCodes
    .map(areaCode => areaCode.replace(/^0+/, ''))
    .filter(Boolean)
    .map(escapeRegExp)
    .join('|');
  if (!areaCodePattern) return [];
  const regex = new RegExp(`\\b(0(?:${areaCodePattern}))[-\\s]?(\\d{7,8})(?:-\\d{1,6})?\\b`, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    landlines.push(`${match[1]}-${match[2]}`);
  }

  return unique(landlines);
}

function parseUrls(text: string): string[] {
  const urls = text.match(/(?:https?:\/\/|www\.)[^\s,，;；]+/g) || [];
  return unique(urls.map(value => value.replace(/[。.)）]+$/g, '')));
}

function parseEmails(text: string): string[] {
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return unique(emails);
}

function parsePossibleContacts(text: string, profile: VerticalRuleProfile): string[] {
  const possibleContacts: string[] = [];
  const suffixPattern = profile.capture.possibleContactTitleSuffixes.map(escapeRegExp).join('|');
  if (!suffixPattern) return [];
  const regex = new RegExp(`[\\u4e00-\\u9fa5]{1,3}(?:${suffixPattern})`, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    possibleContacts.push(match[0]);
  }

  return unique(possibleContacts);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
