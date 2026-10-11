import type { ScheduleItem, ScheduleItemKind } from "./types";

export type CurriculumOrder = "stage-first" | "topic-first" | "topic-interleaved";
export type OrderableItem = { kind: ScheduleItemKind; topicPosition: number; sequence: number };
const STAGE_RANK: Record<ScheduleItemKind, number> = { sheet: 0, quiz: 1, problem: 2 };

export function orderCurriculum<T extends OrderableItem>(items: T[], order: CurriculumOrder): T[] {
  if (order === "topic-interleaved") return interleaveWithinTopic(items);
  return [...items].sort((a, b) => {
    const stage = STAGE_RANK[a.kind] - STAGE_RANK[b.kind];
    const topic = a.topicPosition - b.topicPosition;
    const primary = order === "stage-first" ? stage || topic : topic || stage;
    return primary || a.sequence - b.sequence;
  });
}

function interleaveWithinTopic<T extends OrderableItem>(items: T[]): T[] {
  const counts = new Map<string, number>();
  const key = (item: OrderableItem) => `${item.topicPosition}:${item.kind}`;
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  const fraction = (item: OrderableItem) => item.sequence / (counts.get(key(item)) ?? 1);
  return [...items].sort(
    (a, b) =>
      a.topicPosition - b.topicPosition ||
      fraction(a) - fraction(b) ||
      STAGE_RANK[a.kind] - STAGE_RANK[b.kind] ||
      a.sequence - b.sequence,
  );
}

export type CurriculumSource = {
  topics: Array<{ id: string; name: string; position: number; isPublished: boolean }>;
  sheets: Array<{
    id: string;
    topicId: string;
    title: string;
    position: number;
    isPublished: boolean;
  }>;
  quizzes: Array<{
    id: string;
    topicId: string;
    name: string;
    position: number;
    questionCount: number;
    isPublished: boolean;
  }>;
  problems: Array<{ id: string; topicId: string; setId: string; title: string; position: number }>;
  sets: Array<{
    id: string;
    topicId: string;
    name: string;
    position: number;
    isPublished: boolean;
  }>;
};

export type CurriculumBuild = { items: ScheduleItem[]; warnings: string[] };

export function buildCurriculum(
  source: CurriculumSource,
  order: CurriculumOrder = "topic-interleaved",
  staff = false,
): CurriculumBuild {
  const warnings: string[] = [];
  for (const [kind, rows] of Object.entries(source)) {
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row.id || ids.has(row.id)) throw new Error(`Missing or duplicate ${kind} ID.`);
      ids.add(row.id);
    }
  }
  // Rank topics by position plus ID: equal positions must not merge their interleaving streams.
  const ranks = new Map(
    [...source.topics]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((topic, index) => [topic.id, index]),
  );
  const topics = new Map(
    source.topics.filter((topic) => staff || topic.isPublished).map((topic) => [topic.id, topic]),
  );
  const sets = new Map(
    source.sets.filter((set) => staff || set.isPublished).map((set) => [set.id, set]),
  );
  const items: Array<ScheduleItem & OrderableItem> = [];
  const sequence = new Map<string, number>();
  const next = (topicId: string, kind: ScheduleItemKind) => {
    const key = `${topicId}:${kind}`;
    const value = sequence.get(key) ?? 0;
    sequence.set(key, value + 1);
    return value;
  };

  for (const sheet of [...source.sheets].sort((a, b) => a.position - b.position)) {
    if (!staff && !sheet.isPublished) continue;
    const topic = topics.get(sheet.topicId);
    if (!topic) {
      warnings.push(
        `sheet ${sheet.id} references a ${source.topics.some((t) => t.id === sheet.topicId) ? "unpublished" : "missing"} topic`,
      );
      continue;
    }
    items.push({
      id: sheet.id,
      kind: "sheet",
      title: sheet.title,
      topicId: topic.id,
      topicName: topic.name,
      subTopic: sheet.title,
      href: `/learn/${topic.id}/${sheet.id}`,
      minutes: 15,
      completed: false,
      topicPosition: ranks.get(topic.id)!,
      sequence: next(topic.id, "sheet"),
    });
  }
  for (const quiz of [...source.quizzes].sort((a, b) => a.position - b.position)) {
    if (!Number.isInteger(quiz.questionCount) || quiz.questionCount < 0)
      throw new Error(`Invalid question count for ${quiz.id}.`);
    const topic = topics.get(quiz.topicId);
    if (!topic || (!staff && !quiz.isPublished)) {
      warnings.push(
        `quiz ${quiz.id} references a ${source.topics.some((t) => t.id === quiz.topicId) ? "unpublished" : "missing"} topic/set`,
      );
      continue;
    }
    if (quiz.questionCount === 0) {
      warnings.push(`quiz ${quiz.id} has no questions`);
      continue;
    }
    items.push({
      id: quiz.id,
      kind: "quiz",
      title: quiz.name,
      topicId: topic.id,
      topicName: topic.name,
      subTopic: quiz.name,
      href: `/quizzes/${quiz.id}`,
      minutes: Math.max(10, quiz.questionCount * 2),
      completed: false,
      questions: quiz.questionCount,
      topicPosition: ranks.get(topic.id)!,
      sequence: next(topic.id, "quiz"),
    });
  }
  for (const problem of [...source.problems].sort(
    (a, b) =>
      (sets.get(a.setId)?.position ?? 0) - (sets.get(b.setId)?.position ?? 0) ||
      a.position - b.position ||
      a.id.localeCompare(b.id),
  )) {
    const topic = topics.get(problem.topicId);
    const set = sets.get(problem.setId);
    if (!topic || !set || set.topicId !== problem.topicId) {
      const unpublished =
        (!topic && source.topics.some((t) => t.id === problem.topicId)) ||
        (!set && source.sets.some((s) => s.id === problem.setId));
      warnings.push(
        `problem ${problem.id} references a ${unpublished ? "unpublished" : "missing or mismatched"} topic/set`,
      );
      continue;
    }
    items.push({
      id: problem.id,
      kind: "problem",
      title: problem.title,
      topicId: topic.id,
      topicName: topic.name,
      subTopic: set.name,
      href: `/practice/${problem.id}`,
      minutes: 15,
      completed: false,
      topicPosition: ranks.get(topic.id)!,
      sequence: next(topic.id, "problem"),
    });
  }
  return { items: orderCurriculum(items, order), warnings };
}
