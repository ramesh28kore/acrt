import { groupByWeek, weekNumber, todayDate } from "./plan";
import { KIND_LABEL, type SchedulePlan } from "./types";

// Native OOXML keeps exports compatible with the Cloudflare build, with no Node/SheetJS runtime.
// The existing workbook's five sheets and the Word daily schedule are retained.
export const SHEET_NAMES = [
  "Schedule",
  "Day Plan",
  "Week Summary",
  "Topics & Sub-topics",
  "About",
] as const;
type Cell = string | number;
const xml = (value: Cell) =>
  Array.from(String(value))
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return (
        [9, 10, 13].includes(code) ||
        (code >= 32 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      );
    })
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const encode = (value: string) => new TextEncoder().encode(value);
const concat = (chunks: Uint8Array[]) => {
  const result = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Uncompressed ZIP: interoperable Office packages with deterministic bytes and CRC checks. */
export function zipXml(files: Record<string, string>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, value] of Object.entries(files)) {
    const name = encode(path),
      data = encode(value),
      crc = crc32(data);
    const header = new Uint8Array(30),
      view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(12, 33, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    local.push(header, name, data);
    const directory = new Uint8Array(46),
      d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x800, true);
    d.setUint16(14, 33, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const directory = concat(central),
    end = new Uint8Array(22),
    e = new DataView(end.buffer),
    count = Object.keys(files).length;
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, count, true);
  e.setUint16(10, count, true);
  e.setUint32(12, directory.length, true);
  e.setUint32(16, offset, true);
  return concat([...local, directory, end]);
}
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const relNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const contentTypeNs = "http://schemas.openxmlformats.org/package/2006/content-types";
const worksheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const weekday = (date: string) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });

export function workbookRows(
  plan: SchedulePlan,
  meta: { drafts: boolean; version: number },
): Cell[][][] {
  const itemRows: Cell[][] = [
    ["Week", "Day", "Date", "Weekday", "Topic", "Sub-topic", "Type", "Title", "Minutes"],
  ];
  const dayRows: Cell[][] = [
    [
      "Week",
      "Day",
      "Date",
      "Weekday",
      "Topic",
      "Sub-topics covered",
      "Cheat sheets",
      "MCQ practice",
      "Coding practice",
      "Items",
      "Minutes",
      "Hours",
    ],
  ];
  const outline = new Map<
    string,
    {
      topic: string;
      sub: string;
      kind: string;
      count: number;
      minutes: number;
      day: number;
      date: string;
      week: number;
    }
  >();
  for (const day of plan.days) {
    const week = weekNumber(plan.startDate, day.date);
    dayRows.push([
      week,
      day.dayNumber,
      day.date,
      weekday(day.date),
      [...new Set(day.items.map((i) => i.topicName))].join("; "),
      [...new Set(day.items.map((i) => i.subTopic))].join("; "),
      ...(["sheet", "quiz", "problem"] as const).map(
        (kind) => day.items.filter((i) => i.kind === kind).length,
      ),
      day.items.length,
      day.minutes,
      Math.round(day.minutes / 6) / 10,
    ]);
    for (const item of day.items) {
      itemRows.push([
        week,
        day.dayNumber,
        day.date,
        weekday(day.date),
        item.topicName,
        item.subTopic,
        KIND_LABEL[item.kind],
        item.title,
        item.minutes,
      ]);
      const key = JSON.stringify([item.topicId, item.kind, item.subTopic]);
      const row = outline.get(key) ?? {
        topic: item.topicName,
        sub: item.subTopic,
        kind: KIND_LABEL[item.kind],
        count: 0,
        minutes: 0,
        day: day.dayNumber,
        date: day.date,
        week,
      };
      row.count++;
      row.minutes += item.minutes;
      outline.set(key, row);
    }
  }
  return [
    itemRows,
    dayRows,
    [
      ["Week", "From", "To", "Study days", "Topics covered", "Items", "Minutes", "Hours"],
      ...groupByWeek(plan).map((w) => [
        w.weekNumber,
        w.from,
        w.to,
        w.days.length,
        w.topics.join("; "),
        w.items,
        w.minutes,
        Math.round(w.minutes / 6) / 10,
      ]),
    ],
    [
      [
        "S.No",
        "Topic",
        "Sub-topic",
        "Type",
        "Items",
        "Minutes",
        "Hours",
        "Starts week",
        "Starts day",
        "Starts on",
      ],
      ...[...outline.values()].map((o, i) => [
        i + 1,
        o.topic,
        o.sub,
        o.kind,
        o.count,
        o.minutes,
        Math.round(o.minutes / 6) / 10,
        o.week,
        o.day,
        o.date,
      ]),
    ],
    [
      ["Course schedule"],
      ["Generated on", todayDate()],
      ["Course starts", plan.startDate],
      ["Schedule version", meta.version],
      ["Content included", meta.drafts ? "Published + drafts — preview only" : "Published only"],
      ["Study days", plan.days.length],
      ["Total items", plan.totalItems],
      ["Calendar timezone", "UTC"],
      ["Progress", "Schedule changes do not alter student activity"],
    ],
  ];
}
export function workbookBytes(
  plan: SchedulePlan,
  meta: { drafts: boolean; version: number },
): Uint8Array {
  const sheets = workbookRows(plan, meta);
  const files: Record<string, string> = {
    "[Content_Types].xml":
      declaration +
      `<Types xmlns="${contentTypeNs}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels":
      declaration +
      `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":
      declaration +
      `<workbook xmlns="${worksheetNs}" xmlns:r="${officeRel}"><sheets>${SHEET_NAMES.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      declaration +
      `<Relationships xmlns="${relNs}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${officeRel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  };
  sheets.forEach((rows, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] =
      declaration +
      `<worksheet xmlns="${worksheetNs}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="12" width="22" customWidth="1"/></cols><sheetData>${rows
        .map(
          (row, r) =>
            `<row r="${r + 1}">${row
              .map((value, c) => {
                const ref = String.fromCharCode(65 + c) + (r + 1);
                return typeof value === "number"
                  ? `<c r="${ref}"><v>${value}</v></c>`
                  : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
              })
              .join("")}</row>`,
        )
        .join("")}</sheetData></worksheet>`;
  });
  return zipXml(files);
}
export function documentBytes(
  plan: SchedulePlan,
  meta: { drafts: boolean; version: number },
): Uint8Array {
  const paragraph = (value: string, bold = false) =>
    `<w:p><w:pPr><w:spacing w:after="100"/></w:pPr><w:r>${bold ? '<w:rPr><w:b/><w:color w:val="171F46"/></w:rPr>' : ""}<w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
  const row = (values: Cell[], header = false) =>
    `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${values.map((value) => `<w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr>${paragraph(String(value), header)}</w:tc>`).join("")}</w:tr>`;
  const body =
    paragraph("Avanthi CRT — Course Schedule", true) +
    paragraph(
      `Starts ${plan.startDate} · ${plan.days.length} study days · version ${meta.version}`,
    ) +
    paragraph(
      meta.drafts ? "DRAFT PREVIEW — includes unpublished content" : "Published curriculum",
    ) +
    plan.days
      .map(
        (day) =>
          paragraph(
            `Day ${day.dayNumber} — ${weekday(day.date)}, ${day.date} — ${day.minutes} minutes`,
            true,
          ) +
          `<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((edge) => `<w:${edge} w:val="single" w:sz="4" w:color="D8DFE9"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3200"/><w:gridCol w:w="3200"/><w:gridCol w:w="3200"/></w:tblGrid>${row(["Learning item", "Topic / activity", "Minutes"], true)}${day.items.map((item) => row([item.title, item.topicName + " / " + KIND_LABEL[item.kind], item.minutes])).join("")}</w:tbl>`,
      )
      .join("");
  return zipXml({
    "[Content_Types].xml":
      declaration +
      `<Types xmlns="${contentTypeNs}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels":
      declaration +
      `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml":
      declaration +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`,
  });
}
export function exportSchedule(
  plan: SchedulePlan,
  format: "xlsx" | "docx",
  meta: { drafts: boolean; version: number },
) {
  const bytes = format === "xlsx" ? workbookBytes(plan, meta) : documentBytes(plan, meta);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    fileName: `Avanthi-Course-Schedule-${plan.startDate}.${format}`,
    mime:
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    base64: btoa(binary),
  };
}
