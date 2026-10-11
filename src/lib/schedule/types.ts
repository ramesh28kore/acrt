export type ScheduleItemKind = "sheet" | "quiz" | "problem";

export const KIND_LABEL: Record<ScheduleItemKind, string> = {
  sheet: "Cheat Sheet",
  quiz: "MCQ Practice",
  problem: "Coding Practice",
};

export type ScheduleItem = {
  id: string;
  kind: ScheduleItemKind;
  title: string;
  topicId: string;
  topicName: string;
  subTopic: string;
  href: string;
  minutes: number;
  completed: boolean;
  questions?: number;
};

export type ScheduleDay = {
  dayNumber: number;
  date: string;
  items: ScheduleItem[];
  minutes: number;
  complete: boolean;
};

export type SchedulePlan = {
  startDate: string;
  days: ScheduleDay[];
  totalItems: number;
  completedItems: number;
};

export type PlannerOptions = {
  dailyMinutes?: number;
  restDays?: number[];
  oneTopicPerDay?: boolean;
};

export const DEFAULT_DAILY_MINUTES = 120;
export const DEFAULT_REST_DAYS = [0];
export const MINUTES = {
  sheet: 15,
  quizPerQuestion: 2,
  quizMinimum: 10,
  problem: 15,
} as const;
