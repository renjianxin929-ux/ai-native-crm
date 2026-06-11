import { describe, it, expect } from 'vitest';
import { parseRoughTime } from '../lib/timeParser';

describe('parseRoughTime', () => {
  it('"明天" 解析为明天 09:30', () => {
    const result = parseRoughTime('明天');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 30, 0, 0);
    expect(parsed.getDate()).toBe(tomorrow.getDate());
    expect(parsed.getHours()).toBe(9);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('"后天" 解析为后天 09:30', () => {
    const result = parseRoughTime('后天');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    dayAfter.setHours(9, 30, 0, 0);
    expect(parsed.getDate()).toBe(dayAfter.getDate());
    expect(parsed.getHours()).toBe(9);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('"下周二下午" 解析为下周二 14:00', () => {
    const result = parseRoughTime('下周二下午');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getHours()).toBe(14);
    expect(parsed.getMinutes()).toBe(0);
    // 应该是周二
    expect(parsed.getDay()).toBe(2);
  });

  it('"下周二上午" 解析为下周二 09:30', () => {
    const result = parseRoughTime('下周二上午');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getHours()).toBe(9);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('"下周二晚上" 解析为下周二 19:00', () => {
    const result = parseRoughTime('下周二晚上');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getHours()).toBe(19);
    expect(parsed.getMinutes()).toBe(0);
  });

  it('"下周" 解析为下周一 09:30', () => {
    const result = parseRoughTime('下周');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getDay()).toBe(1); // Monday
    expect(parsed.getHours()).toBe(9);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('"下下周" 解析为下下周一 09:30', () => {
    const result = parseRoughTime('下下周');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getDay()).toBe(1); // Monday
  });

  it('"周五" 解析为本周五 09:30', () => {
    const result = parseRoughTime('周五');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getDay()).toBe(5);
    expect(parsed.getHours()).toBe(9);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('"本周五" 解析为本周五 09:30', () => {
    const result = parseRoughTime('本周五');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getDay()).toBe(5);
  });

  it('无具体时间的表达式默认 09:30', () => {
    const result = parseRoughTime('下周三');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getHours()).toBe(9);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('无法解析的模糊时间返回 NEEDS_CONFIRMATION', () => {
    const result = parseRoughTime('有空的时候');
    expect(result.status).toBe('NEEDS_CONFIRMATION');
    expect(result.note).toBeTruthy();
  });

  it('空字符串返回 NEEDS_CONFIRMATION', () => {
    const result = parseRoughTime('');
    expect(result.status).toBe('NEEDS_CONFIRMATION');
  });

  it('"月初" 解析为当月1号 09:30', () => {
    const result = parseRoughTime('月初');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getDate()).toBe(1);
    expect(parsed.getHours()).toBe(9);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('"月底" 解析为当月25号 09:30', () => {
    const result = parseRoughTime('月底');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    // 月份最后几天通常是25号左右，按文档是25
    expect(parsed.getDate()).toBe(25);
  });

  it('"下个月" 解析为下个月1号 09:30', () => {
    const result = parseRoughTime('下个月');
    expect(result.status).toBe('PARSED');
    const parsed = new Date(result.parsed_at!);
    expect(parsed.getDate()).toBe(1);
    const now = new Date();
    expect(parsed.getMonth()).toBe((now.getMonth() + 1) % 12);
  });
});
