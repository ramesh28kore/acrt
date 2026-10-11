import {
  DEFAULT_DAILY_MINUTES,
  DEFAULT_REST_DAYS,
  type PlannerOptions,
  type ScheduleDay,
  type ScheduleItem,
  type SchedulePlan,
} from "./types";

/** Course dates are plain UTC calendar dates, never browser-local timestamps. */
export function parseDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid course date: ${date}`);
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (formatDate(value) !== date) throw new Error(`Invalid course date: ${date}`);
  return value;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const next = parseDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return formatDate(next);
}

export function dayOfWeek(date: string): number {
  return parseDate(date).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

export function buildPlan(
  items: ScheduleItem[],
  startDate: string,
  options?: PlannerOptions,
): SchedulePlan {
  parseDate(startDate);
  const dailyMinutes = options?.dailyMinutes ?? DEFAULT_DAILY_MINUTES;
  if (!Number.isInteger(dailyMinutes) || dailyMinutes <= 0)
    throw new Error("dailyMinutes must be positive");
  const restDays = new Set(options?.restDays ?? DEFAULT_REST_DAYS);
  if (
    [...restDays].some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    restDays.size === 7
  )
    throw new Error("Choose valid rest days and keep at least one study day.");
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (!item.id || !item.topicId || seen.has(key))
      throw new Error("Missing or duplicate curriculum item.");
    seen.add(key);
  }
  const oneTopicPerDay = options?.oneTopicPerDay ?? true;
  const everyDayIsRest = restDays.size >= 7;
  const days: ScheduleDay[] = [];
  let cursor = startDate;
  let dayNumber = 0;

  const openDay = (): ScheduleDay => {
    while (!everyDayIsRest && restDays.has(dayOfWeek(cursor))) cursor = addDays(cursor, 1);
    const day: ScheduleDay = {
      dayNumber: ++dayNumber,
      date: cursor,
      items: [],
      minutes: 0,
      complete: false,
    };
    days.push(day);
    return day;
  };

  let current = items.length ? openDay() : null;
  for (const item of items) {
    if (!Number.isInteger(item.minutes) || item.minutes <= 0)
      throw new Error(`Invalid minutes for ${item.id}`);
    const full = current !== null && current.minutes + item.minutes > dailyMinutes;
    const newTopic =
      oneTopicPerDay && current !== null && current.items[0]?.topicId !== item.topicId;
    if (current && current.items.length > 0 && (full || newTopic)) {
      cursor = addDays(current.date, 1);
      current = openDay();
    }
    if (!current) current = openDay();
    current.items.push(item);
    current.minutes += item.minutes;
  }
  for (const day of days)
    day.complete = day.items.length > 0 && day.items.every((item) => item.completed);
  return {
    startDate,
    days,
    totalItems: items.length,
    completedItems: items.filter((item) => item.completed).length,
  };
}

/** The portal's established course calendar is UTC date-only, independent of device timezone. */
export function todayDate(now = new Date()): string {
  return formatDate(now);
}

export function nextLearningItem(plan: SchedulePlan): ScheduleItem | undefined {
  return plan.days.flatMap((day) => day.items).find((item) => !item.completed);
}

export function dayForDate(plan: SchedulePlan, date: string): ScheduleDay | undefined {
  parseDate(date);
  return plan.days.find((day) => day.date === date);
}

export function currentDay(plan: SchedulePlan, today: string): ScheduleDay | undefined {
  parseDate(today);
  return (
    plan.days.find((day) => day.date === today) ??
    plan.days.find((day) => !day.complete && day.date >= today) ??
    plan.days.find((day) => !day.complete)
  );
}

export function overdueDays(plan: SchedulePlan, today: string): ScheduleDay[] {
  parseDate(today);
  return plan.days.filter((day) => day.date < today && !day.complete);
}

export type ScheduleWeek = {
  weekNumber: number;
  from: string;
  to: string;
  days: ScheduleDay[];
  topics: string[];
  items: number;
  minutes: number;
};

export function weekNumber(startDate: string, date: string): number {
  return Math.floor(daysBetween(startDate, date) / 7) + 1;
}

export function groupByWeek(plan: SchedulePlan): ScheduleWeek[] {
  const weeks = new Map<number, ScheduleWeek>();
  for (const day of plan.days) {
    const number = weekNumber(plan.startDate, day.date);
    const week = weeks.get(number) ?? {
      weekNumber: number,
      from: day.date,
      to: day.date,
      days: [],
      topics: [],
      items: 0,
      minutes: 0,
    };
    weeks.set(number, week);
    week.days.push(day);
    week.to = day.date;
    week.items += day.items.length;
    week.minutes += day.minutes;
    for (const item of day.items)
      if (!week.topics.includes(item.topicName)) week.topics.push(item.topicName);
  }
  return [...weeks.values()].sort((a, b) => a.weekNumber - b.weekNumber);
}

export function startOfMonth(date: string): string {
  parseDate(date);
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, months: number): string {
  const first = parseDate(startOfMonth(date));
  first.setUTCMonth(first.getUTCMonth() + months);
  return formatDate(first);
}

export function monthGrid(date: string): { date: string; inMonth: boolean }[] {
  const first = startOfMonth(date);
  const month = first.slice(0, 7);
  let cursor = addDays(first, -dayOfWeek(first));
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push({ date: cursor, inMonth: cursor.slice(0, 7) === month });
    cursor = addDays(cursor, 1);
  }
  while (cells.length > 7 && cells.slice(-7).every((cell) => !cell.inMonth)) cells.length -= 7;
  return cells;
}
