import { describe, expect, it, vi } from "vitest";

import { parseBlocks, parseInline } from "@/lib/learning/blocks";
import { rebrand, rebrandBlocks } from "@/lib/learning/branding";
import { computeGate, lockReason, type GateItem } from "@/lib/learning/gating";
import {
  getSheetDetail,
  getTopicDetail,
  listTopics,
  recordProgress,
  resolveViewer,
  setPublished,
  type Viewer,
} from "@/lib/learning/learning.server";

describe("render-time branding", () => {
  it("swaps the imported platform names in prose", () => {
    expect(rebrand("Welcome to NxtWave and Nxt Wave")).toBe("Welcome to Ramesh and Ramesh");
    expect(rebrand("CCBP notes")).toBe("KORE notes");
    expect(rebrand("ccbp")).toBe("kore");
  });

  it("never touches urls, domains or inline code", () => {
    const text = "See https://learning.ccbp.in/x and `import ccbp` or learning.ccbp.in today";
    expect(rebrand(text)).toBe(text);
  });

  it("is idempotent and leaves code blocks alone", () => {
    expect(rebrand(rebrand("NxtWave"))).toBe("Ramesh");
    const blocks = [
      { type: "paragraph", text: "NxtWave" },
      { type: "code", text: "print('NxtWave')" },
      { type: "image", url: "https://cdn.example/ccbp.png", alt: "CCBP chart" },
    ];
    expect(rebrandBlocks(blocks)).toEqual([
      { type: "paragraph", text: "Ramesh" },
      { type: "code", text: "print('NxtWave')" },
      { type: "image", url: "https://cdn.example/ccbp.png", alt: "KORE chart" },
    ]);
  });
});

describe("content blocks", () => {
  it("keeps valid blocks and counts the malformed ones instead of failing the lesson", () => {
    const result = parseBlocks([
      { type: "heading", text: "Intro" },
      { type: "code", text: "print(1)", lang: "python" },
      { type: "table", rows: [] },
      { type: "paragraph" },
      "junk",
    ]);
    expect(result.blocks).toHaveLength(2);
    expect(result.dropped).toBe(3);
    expect(parseBlocks(null)).toEqual({ blocks: [], dropped: 0 });
  });

  it("only accepts safe image addresses", () => {
    const bad = [
      "javascript:alert(1)",
      "http://insecure.example/a.png",
      "//evil.example/a.png",
      "data:image/png;base64,AAAA",
      "/\\evil",
    ];
    for (const url of bad) {
      expect(parseBlocks([{ type: "image", url }]).blocks).toHaveLength(0);
    }
    for (const url of ["https://cdn.example/a.png", "/content/images/a.png"]) {
      expect(parseBlocks([{ type: "image", url }]).blocks).toHaveLength(1);
    }
  });

  it("parses only the inline tag allow-list and keeps other angle brackets literal", () => {
    expect(parseInline("print <strong>Hollow</strong> of <em>M</em> rows")).toEqual([
      { text: "print " },
      { text: "Hollow", strong: true },
      { text: " of " },
      { text: "M", em: true },
      { text: " rows" },
    ]);
    expect(parseInline("<script>alert(1)</script>")[0]?.text).toBe("<script>alert(1)</script>");
    expect(parseInline("type is <class 'list'> &amp; more")[0]?.text).toBe(
      "type is <class 'list'> & more",
    );
    expect(
      parseInline("stray </strong> close")
        .map((s) => s.text)
        .join(""),
    ).toBe("stray  close");
  });
});

const item = (id: string, completed = false, stage: GateItem["stage"] = "sheet"): GateItem => ({
  id,
  stage,
  title: `Item ${id}`,
  completed,
});

describe("sequential gate", () => {
  it("opens the first item and unlocks the next only when the previous is done", () => {
    const start = computeGate([item("a"), item("b"), item("c")]);
    expect(start.states.get("a")?.locked).toBe(false);
    expect(start.states.get("b")?.locked).toBe(true);
    expect(start.next?.id).toBe("a");

    const afterOne = computeGate([item("a", true), item("b"), item("c")]);
    expect(afterOne.states.get("b")?.locked).toBe(false);
    expect(afterOne.states.get("c")?.locked).toBe(true);
    expect(afterOne.next?.id).toBe("b");
    expect(lockReason(afterOne, "c")).toMatch(/Finish the cheat sheet “Item b” first/);
  });

  it("never re-locks a completed item, even if earlier content is added or skipped", () => {
    const gate = computeGate([item("new"), item("a", true), item("b", true), item("c")]);
    expect(gate.states.get("a")?.locked).toBe(false);
    expect(gate.states.get("b")?.locked).toBe(false);
    expect(gate.states.get("c")?.locked).toBe(true);
    expect(gate.states.get("new")?.locked).toBe(false);
  });

  it("keeps sheets, quizzes and problems as independent ladders", () => {
    const gate = computeGate([
      item("s1"),
      item("s2"),
      item("q1", false, "quiz"),
      item("q2", false, "quiz"),
      item("p1", false, "problem"),
    ]);
    expect(gate.states.get("q1")?.locked).toBe(false);
    expect(gate.states.get("p1")?.locked).toBe(false);
    expect(gate.states.get("s2")?.locked).toBe(true);
    expect(gate.states.get("q2")?.locked).toBe(true);
  });

  it("reports completion and supports the staff bypass", () => {
    expect(computeGate([item("a", true), item("b", true)]).complete).toBe(true);
    expect(computeGate([]).complete).toBe(false);
    const bypass = computeGate([item("a"), item("b")], { bypass: true });
    expect(bypass.states.get("b")?.locked).toBe(false);
    expect(bypass.bypassed).toBe(true);
  });
});

// In-memory stand-in for the database. It deliberately returns unpublished rows to show the
// service filters them out even if a row-level policy were loosened.
type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, options?: { signedUrl?: string | null }) {
  const calls = {
    rpc: [] as { name: string; args: unknown }[],
    signed: [] as { path: string; seconds: number }[],
    upserts: [] as Row[],
  };
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const orders: string[] = [];
    const sorted = () =>
      orders.length === 0
        ? rows
        : [...rows].sort((a, b) => {
            for (const key of orders) {
              const x = a[key] as number | string;
              const y = b[key] as number | string;
              if (x < y) return -1;
              if (x > y) return 1;
            }
            return 0;
          });
    const api = {
      select: () => api,
      eq: (key: string, value: unknown) => {
        rows = rows.filter((row) => row[key] === value);
        return api;
      },
      in: (key: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[key]));
        return api;
      },
      order: (key: string) => {
        orders.push(key);
        return api;
      },
      maybeSingle: async () => ({ data: sorted()[0] ?? null, error: null }),
      upsert: async (row: Row) => {
        calls.upserts.push(row);
        const store = (tables[table] ??= []);
        const at = store.findIndex(
          (existing) =>
            existing["student_id"] === row["student_id"] &&
            existing["sheet_id"] === row["sheet_id"],
        );
        if (at >= 0) store[at] = { ...store[at], ...row };
        else store.push(row);
        return { error: null };
      },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: sorted(), error: null }),
    };
    return api;
  };
  const client = {
    from: builder,
    rpc: async (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      return { error: null };
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, seconds: number) => {
          calls.signed.push({ path, seconds });
          return {
            data:
              options?.signedUrl === null
                ? null
                : { signedUrl: options?.signedUrl ?? "https://signed.example/x" },
          };
        },
      }),
    },
  };
  return { client: client as never, calls, tables };
}

const T1 = "00000000-0000-0000-0000-0000000000a1";
const T2 = "00000000-0000-0000-0000-0000000000a2";
const S1 = "00000000-0000-0000-0000-0000000000b1";
const S2 = "00000000-0000-0000-0000-0000000000b2";
const S3 = "00000000-0000-0000-0000-0000000000b3";
const S4 = "00000000-0000-0000-0000-0000000000b4";
const STUDENT = "00000000-0000-0000-0000-0000000000c1";
const FACULTY = "00000000-0000-0000-0000-0000000000c2";

const student: Viewer = { userId: STUDENT, staff: false };
const staff: Viewer = { userId: FACULTY, staff: true };

function catalogue() {
  return fakeDb({
    topics: [
      { id: T1, name: "Python NxtWave Basics", position: 1, is_published: true },
      { id: T2, name: "Hidden topic", position: 2, is_published: false },
    ],
    sheets: [
      {
        id: S1,
        topic_id: T1,
        title: "Variables",
        position: 1,
        is_published: true,
        content: [{ type: "paragraph", text: "CCBP intro" }],
        pdf_storage_path: "t1/s1.pdf",
      },
      {
        id: S2,
        topic_id: T1,
        title: "Loops",
        position: 2,
        is_published: true,
        content: [{ type: "heading", text: "Loops" }],
        pdf_storage_path: null,
      },
      {
        id: S3,
        topic_id: T1,
        title: "Draft sheet",
        position: 3,
        is_published: false,
        content: [],
        pdf_storage_path: null,
      },
      {
        id: S4,
        topic_id: T2,
        title: "In hidden topic",
        position: 1,
        is_published: true,
        content: [],
        pdf_storage_path: null,
      },
    ],
    lesson_progress: [],
  });
}

describe("learning data service", () => {
  it("shows students only published topics and sheets, with branding applied", async () => {
    const { client } = catalogue();
    const topics = await listTopics(client, student);
    expect(topics.map((t) => t.id)).toEqual([T1]);
    expect(topics[0]).toMatchObject({ name: "Python Ramesh Basics", sheetCount: 2, completed: 0 });

    const detail = await getTopicDetail(client, student, T1);
    expect(detail.sheets.map((s) => s.id)).toEqual([S1, S2]);
  });

  it("hides unpublished lessons and topics behind a URL change", async () => {
    const { client } = catalogue();
    await expect(getSheetDetail(client, student, T1, S3)).rejects.toMatchObject({
      kind: "not_found",
    });
    await expect(getSheetDetail(client, student, T2, S4)).rejects.toMatchObject({
      kind: "not_found",
    });
    await expect(getTopicDetail(client, student, T2)).rejects.toMatchObject({ kind: "not_found" });
    const missing = await getSheetDetail(
      client,
      student,
      T1,
      "00000000-0000-0000-0000-00000000ffff",
    ).catch((e) => e);
    const hidden = await getSheetDetail(client, student, T1, S3).catch((e) => e);
    expect(hidden.message).toBe(missing.message);
  });

  it("serves a published, unlocked lesson with signed pdf link and neighbours", async () => {
    const { client, calls } = catalogue();
    const detail = await getSheetDetail(client, student, T1, S1);
    expect(detail.sheet.blocks).toEqual([{ type: "paragraph", text: "KORE intro" }]);
    expect(detail.sheet.pdfUrl).toBe("https://signed.example/x");
    expect(calls.signed).toEqual([{ path: "t1/s1.pdf", seconds: 600 }]);
    expect(detail.previous).toBeNull();
    expect(detail.next).toMatchObject({ id: S2, locked: true });
  });

  it("denies a locked lesson and never signs its pdf", async () => {
    const { client, calls } = catalogue();
    await expect(getSheetDetail(client, student, T1, S2)).rejects.toMatchObject({ kind: "locked" });
    expect(calls.signed).toHaveLength(0);
  });

  it("unlocks the next lesson after completion, and progress survives a fresh request", async () => {
    const { client } = catalogue();
    await expect(recordProgress(client, student, T1, S1, "in_progress")).resolves.toEqual({
      status: "in_progress",
    });
    await expect(recordProgress(client, student, T1, S1, "completed")).resolves.toEqual({
      status: "completed",
    });

    const refreshed = await getTopicDetail(client, student, T1);
    expect(refreshed.sheets.map((s) => [s.id, s.status, s.locked])).toEqual([
      [S1, "completed", false],
      [S2, "not_started", false],
    ]);
    expect(refreshed.nextSheetId).toBe(S2);
    expect((await getSheetDetail(client, student, T1, S2)).sheet.id).toBe(S2);
  });

  it("refuses progress on locked or unavailable lessons", async () => {
    const { client, calls } = catalogue();
    await expect(recordProgress(client, student, T1, S2, "completed")).rejects.toMatchObject({
      kind: "locked",
    });
    await expect(recordProgress(client, student, T1, S3, "completed")).rejects.toMatchObject({
      kind: "not_found",
    });
    expect(calls.upserts).toHaveLength(0);
  });

  it("does not move a completed lesson backwards or repeat a write", async () => {
    const { client, calls } = catalogue();
    await recordProgress(client, student, T1, S1, "completed");
    calls.upserts.length = 0;
    await expect(recordProgress(client, student, T1, S1, "in_progress")).resolves.toEqual({
      status: "completed",
    });
    await expect(recordProgress(client, student, T1, S1, "completed")).resolves.toEqual({
      status: "completed",
    });
    expect(calls.upserts).toHaveLength(0);
  });

  it("lets staff review drafts and bypass the gate, without recording progress", async () => {
    const { client } = catalogue();
    const topic = await getTopicDetail(client, staff, T1);
    expect(topic.sheets.map((s) => [s.id, s.locked])).toEqual([
      [S1, false],
      [S2, false],
      [S3, false],
    ]);
    expect((await getSheetDetail(client, staff, T1, S3)).sheet.isPublished).toBe(false);
    await expect(recordProgress(client, staff, T1, S1, "completed")).rejects.toMatchObject({
      kind: "forbidden",
    });
  });

  it("restricts publishing to staff and validates through the database function", async () => {
    const { client, calls } = catalogue();
    await expect(
      setPublished(client, student, { kind: "sheet", id: S3, published: true }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(calls.rpc).toHaveLength(0);

    await setPublished(client, staff, { kind: "sheet", id: S3, published: true });
    await setPublished(client, staff, { kind: "topic", id: T2, published: false });
    expect(calls.rpc).toEqual([
      { name: "set_sheet_published", args: { target_id: S3, published: true } },
      { name: "set_topic_published", args: { target_id: T2, published: false } },
    ]);
  });

  it("degrades gracefully when the pdf link cannot be issued", async () => {
    const { client } = fakeDb(
      {
        topics: [{ id: T1, name: "T", position: 1, is_published: true }],
        sheets: [
          {
            id: S1,
            topic_id: T1,
            title: "A",
            position: 1,
            is_published: true,
            content: [],
            pdf_storage_path: "x.pdf",
          },
        ],
        lesson_progress: [],
      },
      { signedUrl: null },
    );
    expect((await getSheetDetail(client, student, T1, S1)).sheet.pdfUrl).toBeNull();
  });

  it("only treats active accounts as learners", async () => {
    const profile = (overrides: Row) => ({
      id: STUDENT,
      role: "student",
      is_super_admin: false,
      is_disabled: false,
      institute_id: null,
      ...overrides,
    });
    const ok = fakeDb({ profiles: [profile({})] });
    await expect(resolveViewer(ok.client, STUDENT)).resolves.toEqual({
      userId: STUDENT,
      staff: false,
    });
    const faculty = fakeDb({ profiles: [profile({ role: "faculty" })] });
    await expect(resolveViewer(faculty.client, STUDENT)).resolves.toMatchObject({ staff: true });
    const disabled = fakeDb({ profiles: [profile({ is_disabled: true, role: "faculty" })] });
    await expect(resolveViewer(disabled.client, STUDENT)).rejects.toMatchObject({
      kind: "forbidden",
    });
    await expect(resolveViewer(fakeDb({ profiles: [] }).client, STUDENT)).rejects.toMatchObject({
      kind: "forbidden",
    });
  });
});

vi.spyOn(console, "error").mockImplementation(() => {});
