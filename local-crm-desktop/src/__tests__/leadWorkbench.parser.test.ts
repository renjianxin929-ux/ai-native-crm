import { describe, expect, it } from 'vitest';

import { parseLeadContactText } from '../lib/leadWorkbench/parser';

describe('lead workbench parser', () => {
  it('parses and normalizes mainland mobile numbers', () => {
    const parsed = parseLeadContactText(
      '手机: 13800138000 / 138 0013 8000 / 138-0013-8000 / +86 13800138000',
    );

    expect(parsed.mobiles).toEqual(['13800138000']);
  });

  it('parses landlines, urls, and emails', () => {
    const parsed = parseLeadContactText(
      '电话 0757-88889999, 020 12345678; 官网 https://example.com www.acme.cn; 邮箱 sales@example.com',
    );

    expect(parsed.tels).toEqual(['0757-88889999', '020-12345678']);
    expect(parsed.urls).toEqual(['https://example.com', 'www.acme.cn']);
    expect(parsed.emails).toEqual(['sales@example.com']);
  });

  it('does not automatically confirm two or three Chinese characters as contacts', () => {
    const parsed = parseLeadContactText('联系人 张三 李四 王五');

    expect(parsed.contacts).toEqual([]);
    expect(parsed.possibleContacts).toEqual([]);
  });

  it('keeps title-only Chinese names as possible contacts, not confirmed contacts', () => {
    const parsed = parseLeadContactText('张总 李经理 王主任');

    expect(parsed.contacts).toEqual([]);
    expect(parsed.possibleContacts).toEqual(['张总', '李经理', '王主任']);
  });
});
