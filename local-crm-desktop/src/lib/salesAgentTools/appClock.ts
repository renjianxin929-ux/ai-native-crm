export interface ParsedUserSchedule {
  readonly iso: string;
  readonly display: string;
  readonly has_explicit_time: boolean;
  readonly date_only: boolean;
}

export interface AppClock {
  readonly timezone: string;
  now(): string;
  localDate(): string;
  parseRelativeDate(message: string): ParsedUserSchedule | null;
  parseRelativeDateTime(message: string): ParsedUserSchedule | null;
  formatUserTime(value: string): string;
  serializeForDb(value: string | Date): string;
}

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const WEEKDAY: Readonly<Record<string, number>> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export class SystemAppClock implements AppClock {
  readonly timezone: string;

  constructor(timezone = systemTimeZone()) {
    this.timezone = timezone;
  }

  now(): string {
    return serializeInstantForZone(new Date(), this.timezone);
  }

  localDate(): string {
    const p = partsInZone(new Date(), this.timezone);
    return dateText(p.year, p.month, p.day);
  }

  parseRelativeDate(message: string): ParsedUserSchedule | null {
    const parsed = parseRelativeDateTimeInZone(message, this.now(), this.timezone);
    return parsed ? { ...parsed, iso: parsed.iso.slice(0, 10), display: parsed.display.slice(0, 10), has_explicit_time: false, date_only: true } : null;
  }

  parseRelativeDateTime(message: string): ParsedUserSchedule | null {
    return parseRelativeDateTimeInZone(message, this.now(), this.timezone);
  }

  formatUserTime(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: this.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  }

  serializeForDb(value: string | Date): string {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('无法序列化无效时间。');
    return serializeInstantForZone(date, this.timezone);
  }
}

export class FixedAppClock extends SystemAppClock {
  private readonly fixedNow: string;

  constructor(fixedNow: string, timezone: string) {
    super(timezone);
    if (!Number.isFinite(Date.parse(fixedNow))) throw new Error('FixedClock 时间无效。');
    this.fixedNow = serializeInstantForZone(new Date(fixedNow), timezone);
  }

  override now(): string {
    return this.fixedNow;
  }
}

export const SALES_AGENT_APP_CLOCK: AppClock = new SystemAppClock();

export function parseRelativeDateTimeInZone(message: string, nowIso: string, timezone = inferTimeZone(nowIso)): ParsedUserSchedule | null {
  const now = new Date(nowIso);
  if (!Number.isFinite(now.getTime()) || !message.trim()) return null;
  const text = message.trim();
  const base = partsInZone(now, timezone);
  let clock = extractClock(text);
  let year = base.year;
  let month = base.month;
  let day = base.day;
  let matched = false;

  const isoDateTime = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/);
  if (isoDateTime) {
    year = Number(isoDateTime[1]); month = Number(isoDateTime[2]); day = Number(isoDateTime[3]); matched = true;
    if (!clock && isoDateTime[4]) clock = { hours: Number(isoDateTime[4]), minutes: Number(isoDateTime[5]) };
  }

  const cnFull = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (!matched && cnFull) {
    year = Number(cnFull[1]); month = Number(cnFull[2]); day = Number(cnFull[3]); matched = true;
  }

  const nextMonth = text.match(/下个?月\s*(\d{1,2})\s*[日号]?/);
  if (!matched && nextMonth) {
    const next = addCalendarMonths({ year, month, day: 1 }, 1);
    year = next.year; month = next.month; day = Number(nextMonth[1]); matched = true;
  }

  const cnShort = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (!matched && cnShort) {
    month = Number(cnShort[1]); day = Number(cnShort[2]); matched = true;
    if (compareDate({ year, month, day }, base) < 0) year += 1;
  }

  if (!matched && /月末|月底/.test(text)) {
    day = daysInMonth(year, month); matched = true;
  }
  if (!matched && /年末|年底/.test(text)) {
    month = 12; day = 31; matched = true;
  }
  if (!matched && /今天|今日/.test(text)) matched = true;
  if (!matched && /明天/.test(text)) {
    ({ year, month, day } = addCalendarDays(base, 1)); matched = true;
  }
  if (!matched && /后天/.test(text)) {
    ({ year, month, day } = addCalendarDays(base, 2)); matched = true;
  }

  const nextWeek = text.match(/下\s*(?:周|星期)\s*([一二三四五六日天])/);
  if (!matched && nextWeek) {
    const monday = addCalendarDays(base, baseWeekday(base) === 0 ? 1 : 8 - baseWeekday(base));
    ({ year, month, day } = addCalendarDays(monday, WEEKDAY[nextWeek[1]!] === 0 ? 6 : WEEKDAY[nextWeek[1]!]! - 1));
    matched = true;
  }

  const thisWeek = text.match(/(?:本|这)\s*(?:周|星期)\s*([一二三四五六日天])/);
  if (!matched && thisWeek) {
    const currentDow = baseWeekday(base);
    const monday = addCalendarDays(base, -(currentDow === 0 ? 6 : currentDow - 1));
    ({ year, month, day } = addCalendarDays(monday, WEEKDAY[thisWeek[1]!] === 0 ? 6 : WEEKDAY[thisWeek[1]!]! - 1));
    matched = true;
  }

  const bareWeek = text.match(/(?:周|星期)([一二三四五六日天])/);
  if (!matched && bareWeek && (clock || /联系|跟进|改|提醒|任务|待办|找/.test(text))) {
    const target = WEEKDAY[bareWeek[1]!]!;
    let delta = (target - baseWeekday(base) + 7) % 7;
    if (delta === 0) delta = 7;
    ({ year, month, day } = addCalendarDays(base, delta)); matched = true;
  }

  if (!matched && clock && !/月|年|今天|明天|后天|周|星期/.test(text)) matched = true;
  if (!matched || !isValidDate(year, month, day)) return null;

  const hasTime = Boolean(clock);
  const hours = clock?.hours ?? 9;
  const minutes = clock?.minutes ?? 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const date = dateText(year, month, day);
  if (!hasTime) return { iso: date, display: date, has_explicit_time: false, date_only: true };
  const isoOut = zonedWallTimeIso(year, month, day, hours, minutes, 0, timezone);
  return { iso: isoOut, display: `${date} ${pad(hours)}:${pad(minutes)}`, has_explicit_time: true, date_only: false };
}

export function withTimeInZone(dateOnly: string, hours: number, minutes: number, nowIso: string, timezone = inferTimeZone(nowIso)): string {
  const match = dateOnly.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match || !isValidDate(Number(match[1]), Number(match[2]), Number(match[3]))) throw new Error('日期无效，无法补充时间。');
  return zonedWallTimeIso(Number(match[1]), Number(match[2]), Number(match[3]), hours, minutes, 0, timezone);
}

function inferTimeZone(nowIso: string): string {
  if (/[+]08:00$/.test(nowIso)) return 'Asia/Shanghai';
  if (/(?:Z|[+]00:00)$/.test(nowIso)) return 'UTC';
  return systemTimeZone();
}

function partsInZone(date: Date, timezone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

function zonedWallTimeIso(year: number, month: number, day: number, hour: number, minute: number, second: number, timezone: string): string {
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = offsetMinutes(new Date(wallUtc), timezone);
  const instant = new Date(wallUtc - offset * 60_000);
  offset = offsetMinutes(instant, timezone);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${dateText(year, month, day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function serializeInstantForZone(date: Date, timezone: string): string {
  const p = partsInZone(date, timezone);
  return zonedWallTimeIso(p.year, p.month, p.day, p.hour, p.minute, p.second, timezone);
}

function offsetMinutes(date: Date, timezone: string): number {
  const p = partsInZone(date, timezone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()) / 60_000);
}

function applyMeridiem(hours: number, meridiem: string | undefined): number {
  if ((meridiem === '下午' || meridiem === '晚上') && hours < 12) return hours + 12;
  if (meridiem === '中午' && hours < 11) return hours + 12;
  if (meridiem === '上午' && hours === 12) return 0;
  return hours;
}

function extractClock(text: string): { hours: number; minutes: number } | null {
  const meridiemHm = text.match(/(上午|下午|中午|晚上)\s*(\d{1,2}):(\d{2})(?!\d)/);
  if (meridiemHm) {
    return { hours: applyMeridiem(Number(meridiemHm[2]), meridiemHm[1]), minutes: Number(meridiemHm[3]) };
  }
  const hm = text.match(/(?:^|\D)(\d{1,2}):(\d{2})(?!\d)/);
  if (hm) return { hours: Number(hm[1]), minutes: Number(hm[2]) };
  const cn = text.match(/(上午|下午|中午|晚上)?\s*([一二三四五六七八九十两\d]{1,3})\s*[点时](?:\s*([一二三四五六七八九十\d]{1,3})\s*分?)?/);
  if (!cn) return null;
  let hours = chineseNumber(cn[2]!);
  const minutes = cn[3] ? chineseNumber(cn[3]) : 0;
  if (hours == null || minutes == null) return null;
  hours = applyMeridiem(hours, cn[1]);
  return { hours, minutes };
}

function chineseNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (token === '十') return 10;
  if (token.length === 1) return digits[token] ?? null;
  if (token.startsWith('十')) return 10 + (digits[token[1]!] ?? 0);
  if (token.endsWith('十')) return (digits[token[0]!] ?? 0) * 10;
  if (token.includes('十')) return (digits[token[0]!] ?? 0) * 10 + (digits[token[2]!] ?? 0);
  return null;
}

function baseWeekday(value: Pick<DateParts, 'year' | 'month' | 'day'>): number {
  return new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();
}

function addCalendarDays(value: Pick<DateParts, 'year' | 'month' | 'day'>, days: number): DateParts {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 0, minute: 0, second: 0 };
}

function addCalendarMonths(value: Pick<DateParts, 'year' | 'month' | 'day'>, months: number): DateParts {
  const date = new Date(Date.UTC(value.year, value.month - 1 + months, value.day));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 0, minute: 0, second: 0 };
}

function compareDate(a: Pick<DateParts, 'year' | 'month' | 'day'>, b: Pick<DateParts, 'year' | 'month' | 'day'>): number {
  return Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateText(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
