// Sequential gate for a topic's content. Each stage is its own ladder, so sheets, quizzes and
// problems never block one another; only sheets are wired up so far (quizzes/problems: M04, M05).
export type GateStage = "sheet" | "quiz" | "problem";

export const STAGE_LABEL: Record<GateStage, string> = {
  sheet: "cheat sheet",
  quiz: "quiz",
  problem: "coding problem",
};

export type GateItem = { id: string; stage: GateStage; title: string; completed: boolean };

export type GateState = {
  locked: boolean;
  blockedBy: { id: string; stage: GateStage; title: string } | null;
};

export type TopicGate = {
  states: Map<string, GateState>;
  next: GateItem | null;
  complete: boolean;
  bypassed: boolean;
};

// Items must arrive in the order the student works through them within each stage.
// A completed item never re-locks, so earlier content added or reordered later cannot trap a student.
export function computeGate(items: readonly GateItem[], options?: { bypass?: boolean }): TopicGate {
  const bypass = options?.bypass ?? false;
  const states = new Map<string, GateState>();
  const blockers = new Map<GateStage, GateItem>();

  for (const item of items) {
    const blocker = blockers.get(item.stage) ?? null;
    const locked = !bypass && blocker !== null && !item.completed;
    states.set(item.id, {
      locked,
      blockedBy:
        locked && blocker ? { id: blocker.id, stage: blocker.stage, title: blocker.title } : null,
    });
    if (blocker === null && !item.completed) blockers.set(item.stage, item);
  }

  const next = items.find((item) => blockers.get(item.stage)?.id === item.id) ?? null;
  return {
    states,
    next,
    complete: items.length > 0 && blockers.size === 0,
    bypassed: bypass,
  };
}

export function lockReason(gate: TopicGate, itemId: string): string | null {
  const state = gate.states.get(itemId);
  if (!state?.locked || !state.blockedBy) return null;
  return `Finish the ${STAGE_LABEL[state.blockedBy.stage]} “${state.blockedBy.title}” first.`;
}
