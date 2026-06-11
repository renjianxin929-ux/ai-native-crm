import type { TimeParseResult } from './types';

const WEEKDAY_NAMES: Record<string, number> = {
  '周日': 0, '星期天': 0,
  '周一': 1, '星期一': 1,
  '周二': 2, '星期二': 2,
  '周三': 3, '星期三': 3,
  '周四': 4, '星期四': 4,
  '周五': 5, '星期五': 5,
  '周六': 6, '星期六': 6,
};

function setTime(date: Date, hours: number, minutes: number): Date {
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function getNextDayOfWeek(targetDay: number, fromDate: Date = new Date()): Date {
  const result = new Date(fromDate);
  const currentDay = result.getDay();
  let diff = targetDay - currentDay;
  if (diff <= 0) diff += 7;
  result.setDate(result.getDate() + diff);
  return result;
}

function parseTimeOfDay(text: string): { hours: number; minutes: number } | null {
  // 精确时间 HH:mm
  const exactMatch = text.match(/(\d{1,2}):(\d{2})/);
  if (exactMatch) {
    return { hours: parseInt(exactMatch[1]), minutes: parseInt(exactMatch[2]) };
  }
  if (text.includes('晚上') || text.includes('傍晚')) {
    return { hours: 19, minutes: 0 };
  }
  if (text.includes('下午') || text.includes('中午')) {
    return { hours: 14, minutes: 0 };
  }
  if (text.includes('上午') || text.includes('早上')) {
    return { hours: 9, minutes: 30 };
  }
  return null; // default will be applied
}

export function parseRoughTime(input: string): TimeParseResult {
  if (!input || !input.trim()) {
    return { parsed_at: null, status: 'NEEDS_CONFIRMATION', note: '无法解析模糊时间，请手动确认约访或跟进时间。' };
  }

  const text = input.trim();
  const timeInfo = parseTimeOfDay(text);
  const defaultTime = { hours: 9, minutes: 30 };
  const time = timeInfo || defaultTime;

  const now = new Date();

  // 明天
  if (text.startsWith('明天')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    setTime(d, time.hours, time.minutes);
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 后天
  if (text.startsWith('后天')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    setTime(d, time.hours, time.minutes);
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 下下周X
  const nextNextWeekMatch = text.match(/下下周(.)/);
  if (nextNextWeekMatch) {
    const dayName = '周' + nextNextWeekMatch[1];
    const targetDay = WEEKDAY_NAMES[dayName];
    if (targetDay !== undefined) {
      const d = getNextDayOfWeek(targetDay, now);
      d.setDate(d.getDate() + 7); // skip one more week
      setTime(d, time.hours, time.minutes);
      return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
    }
  }

  // 下下周（无具体星期）
  if (text === '下下周') {
    const d = getNextDayOfWeek(1, now); // next Monday
    d.setDate(d.getDate() + 7); // one more week
    setTime(d, time.hours, time.minutes);
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 下周二/下周三... 下周X
  const nextWeekMatch = text.match(/下周(.)/);
  if (nextWeekMatch) {
    const dayName = '周' + nextWeekMatch[1];
    const targetDay = WEEKDAY_NAMES[dayName];
    if (targetDay !== undefined) {
      const d = getNextDayOfWeek(targetDay, now);
      setTime(d, time.hours, time.minutes);
      return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
    }
  }

  // 下周（无具体星期）
  if (text === '下周') {
    const d = getNextDayOfWeek(1, now); // next Monday
    setTime(d, time.hours, time.minutes);
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 本周五/本周一...
  const thisWeekMatch = text.match(/本周(.)/);
  if (thisWeekMatch) {
    const dayName = '周' + thisWeekMatch[1];
    const targetDay = WEEKDAY_NAMES[dayName];
    if (targetDay !== undefined) {
      const d = new Date(now);
      const currentDay = d.getDay();
      let diff = targetDay - currentDay;
      if (diff < 0) diff += 7;
      d.setDate(d.getDate() + diff);
      if (diff === 0 && d < now) d.setDate(d.getDate() + 7);
      setTime(d, time.hours, time.minutes);
      return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
    }
  }

  // 周五/周一... (单独星期，没有"本"或"下"前缀，默认为即将到来的)
  for (const [name, dayNum] of Object.entries(WEEKDAY_NAMES)) {
    if (text.startsWith(name)) {
      const d = getNextDayOfWeek(dayNum, now);
      // 如果是今天且还没过，用今天
      if (now.getDay() === dayNum) {
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 0);
        if (now < todayEnd) {
          setTime(d, time.hours, time.minutes);
          // 如果时间已过今天的时间点，则推到下周
          const checkTime = time.hours * 60 + time.minutes;
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          if (nowMinutes >= checkTime) {
            d.setDate(d.getDate() + 7);
          }
        }
      }
      setTime(d, time.hours, time.minutes);
      return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
    }
  }

  // 月初
  if (text === '月初') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    setTime(d, time.hours, time.minutes);
    // If day 1 has already passed, go to next month
    if (d <= now) {
      d.setMonth(d.getMonth() + 1);
    }
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 月底
  if (text === '月底') {
    const d = new Date(now.getFullYear(), now.getMonth(), 25);
    setTime(d, time.hours, time.minutes);
    if (d <= now) {
      d.setMonth(d.getMonth() + 1);
    }
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 下个月初
  if (text === '下个月初') {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    setTime(d, time.hours, time.minutes);
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 下个月中旬
  if (text === '下个月中旬') {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    setTime(d, time.hours, time.minutes);
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 下个月底
  if (text === '下个月底') {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 25);
    setTime(d, time.hours, time.minutes);
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 下个月
  if (text === '下个月') {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    setTime(d, time.hours, time.minutes);
    return { parsed_at: d.toISOString(), status: 'PARSED', note: null };
  }

  // 无法解析
  return {
    parsed_at: null,
    status: 'NEEDS_CONFIRMATION',
    note: '无法解析模糊时间，请手动确认约访或跟进时间。',
  };
}
