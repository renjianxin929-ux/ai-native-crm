export interface ParsedLeadContactText {
  mobiles: string[];
  tels: string[];
  urls: string[];
  emails: string[];
  contacts: string[];
  possibleContacts: string[];
}

export function parseLeadContactText(rawText: string): ParsedLeadContactText {
  return {
    mobiles: parseMobiles(rawText),
    tels: parseLandlines(rawText),
    urls: parseUrls(rawText),
    emails: parseEmails(rawText),
    contacts: [],
    possibleContacts: parsePossibleContacts(rawText),
  };
}

function parseMobiles(text: string): string[] {
  const mobiles: string[] = [];
  const regex = /(?:\+?86[\s-]*)?(1[3-9]\d[\s-]*\d{4}[\s-]*\d{4})/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const mobile = match[1].replace(/\D/g, '');
    if (mobile.length === 11) {
      mobiles.push(mobile);
    }
  }

  return unique(mobiles);
}

function parseLandlines(text: string): string[] {
  const landlines: string[] = [];
  const regex = /\b(0(?:20|750|755|757|760|769))[-\s]?(\d{7,8})(?:-\d{1,6})?\b/g;
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

function parsePossibleContacts(text: string): string[] {
  const possibleContacts: string[] = [];
  const regex = /[\u4e00-\u9fa5]{1,3}(?:总|经理|主任)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    possibleContacts.push(match[0]);
  }

  return unique(possibleContacts);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
