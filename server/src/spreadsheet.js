import * as XLSX from "xlsx";

// Headings that mean "this column holds the person's name", compared after lowercasing
// and collapsing punctuation/spacing (so "Contact  Name" and "contact_name" both match).
const NAME_HEADINGS = new Set([
  "name",
  "contact name",
  "full name",
  "person name",
  "person",
  "recipient",
  "recipient name",
  "contact person",
  "contact",
  "customer name",
  "client name",
  "doctor name",
]);

const SERIAL_HEADING = /^(s ?no|sr ?no|sl ?no|serial( ?no| number)?|no|id|index)$/;

// Honorifics are dropped so letters/folders use just the name; repeated ones ("Dr. Dr.") too.
const TITLE_PREFIX = /^(?:(?:mr|mrs|ms|miss|mx|dr|prof|shri|smt|sri)\.?\s+)+/i;

const HEADER_SEARCH_ROWS = 15;

const normalizeHeading = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cellText = (v) => String(v ?? "").trim();

export function cleanPersonName(raw) {
  return cellText(raw).replace(TITLE_PREFIX, "").replace(/\s+/g, " ").trim();
}

// Reads the first sheet and reports exactly what happens to every row, so the dashboard
// can show it before anything is generated:
//   people   [{ row, name, details }]  one letter each, in sheet order (row = Excel row number)
//   skipped  [{ row, reason, values }] rows with content but no usable name
//   dataRows  rows with any content below the header (= people.length + skipped.length)
// The header row is located rather than assumed to be row 1, so a title banner above the
// real headers (very common in contact lists) isn't mistaken for the headers.
export function analyzePeopleSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const empty = { sheetName, headerRow: null, nameColumn: null, columns: [], dataRows: 0, people: [], skipped: [] };
  if (!sheet || !sheet["!ref"]) return empty;
  // blankrows: true keeps grid index -> Excel row number exact (first row of the used range + i).
  const firstRow = XLSX.utils.decode_range(sheet["!ref"]).s.r + 1;
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true });
  const hasContent = (row) => (row || []).some((c) => cellText(c));

  // The header is looked for among the first HEADER_SEARCH_ROWS rows that have content.
  const searchable = grid.map((row, i) => ({ row: row || [], i })).filter(({ row }) => hasContent(row)).slice(0, HEADER_SEARCH_ROWS);
  if (!searchable.length) return empty;
  const header =
    searchable.find(({ row }) => row.some((c) => NAME_HEADINGS.has(normalizeHeading(c)))) ||
    searchable.find(({ row }) => row.filter((c) => cellText(c)).length >= 2) ||
    searchable[0];
  const headerIdx = header.i;

  const headerRow = grid[headerIdx];
  const seen = new Map();
  const columns = []; // { index, key }
  headerRow.forEach((cell, index) => {
    const base = cellText(cell);
    if (!base) return; // a column with no heading carries nothing we can label
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    columns.push({ index, key: count === 0 ? base : `${base}_${count + 1}` });
  });
  if (!columns.length) return { ...empty, headerRow: firstRow + headerIdx };

  const nameCol =
    columns.find((c) => NAME_HEADINGS.has(normalizeHeading(c.key))) ||
    columns.find((c) => !SERIAL_HEADING.test(normalizeHeading(c.key))) ||
    columns[0];

  const people = [];
  const skipped = [];
  let dataRows = 0;
  grid.forEach((row, i) => {
    if (i <= headerIdx || !hasContent(row)) return;
    dataRows++;
    const excelRow = firstRow + i;
    const rawName = cellText(row[nameCol.index]);
    const name = cleanPersonName(rawName);
    const details = {};
    for (const { index, key } of columns) details[key] = row[index] ?? "";
    if (name) {
      people.push({ row: excelRow, name, details });
    } else {
      const values = columns.map(({ index }) => cellText(row[index])).filter(Boolean).slice(0, 4);
      skipped.push({
        row: excelRow,
        reason: rawName ? `"${rawName}" is only a title, not a name` : `No name in the "${nameCol.key}" column`,
        values,
      });
    }
  });

  return {
    sheetName,
    headerRow: firstRow + headerIdx,
    nameColumn: nameCol.key,
    columns: columns.map((c) => c.key),
    dataRows,
    people,
    skipped,
  };
}

// Names that appear more than once (each still gets its own letter), with their rows.
export function repeatedNames(people) {
  const byName = new Map();
  for (const p of people) {
    const key = p.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name: p.name, rows: [] });
    byName.get(key).rows.push(p.row);
  }
  return [...byName.values()].filter((g) => g.rows.length > 1);
}

// [{ name, details }] -- one entry per letter, in sheet order.
export function parsePeopleSheet(buffer) {
  return analyzePeopleSheet(buffer).people.map(({ name, details }) => ({ name, details }));
}
