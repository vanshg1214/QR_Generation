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

// Reads the first sheet into [{ name, details }]. The header row is located rather than
// assumed to be row 1, so a title banner above the real headers (very common in contact
// lists) isn't mistaken for the headers.
export function parsePeopleSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  if (!grid.length) return [];

  const searchable = grid.slice(0, HEADER_SEARCH_ROWS);
  let headerIdx = searchable.findIndex((row) => row.some((c) => NAME_HEADINGS.has(normalizeHeading(c))));
  if (headerIdx === -1) {
    headerIdx = searchable.findIndex((row) => row.filter((c) => cellText(c)).length >= 2);
  }
  if (headerIdx === -1) headerIdx = 0;

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
  if (!columns.length) return [];

  const nameCol =
    columns.find((c) => NAME_HEADINGS.has(normalizeHeading(c.key))) ||
    columns.find((c) => !SERIAL_HEADING.test(normalizeHeading(c.key))) ||
    columns[0];

  const people = [];
  for (const row of grid.slice(headerIdx + 1)) {
    const name = cleanPersonName(row[nameCol.index]);
    if (!name) continue;
    const details = {};
    for (const { index, key } of columns) details[key] = row[index] ?? "";
    people.push({ name, details });
  }
  return people;
}
