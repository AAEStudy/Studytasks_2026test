// Analysis tables keep participant outcomes and quality checks near the left.
// The companion JSON retains every omitted source cell without repeating outcomes.
const MRT_CORE = Object.freeze([
  "subject", "trial", "task", "trial_num", "RT_from_metronome", "omission",
  "performance_rating", "probe1_rt", "probe2_rt", "confidence_rating", "pause_time",
  "break_time", "instructed_response", "instructed_response_expected",
  "instructed_response_correct", "instructed_response_rt_ms", "confidence_label",
  "main_basis", "probe3_rt"
]);
const COMPARISON_CORE = Object.freeze(["subject", "systemtime", "pic1", "pic2", "category", "rawchoice", "picchoice", "RT"]);
const JUDGMENT_CORE = Object.freeze(["subject", "systemtime", "pic", "higherlower", "firstRT", "confidence", "secondRT"]);
const CAL_CHECK = Object.freeze(["cal_check_id", "cal_check_after_trial", "cal_check_expected", "cal_check_response", "cal_check_correct", "cal_check_rt_ms"]);
const FINAL_CHECK = Object.freeze(["final_check_id", "final_check_after_trial", "final_check_expected", "final_check_response", "final_check_correct", "final_check_rt_ms"]);
const ROW_CONTEXT = Object.freeze(["row_index", "phase", "chunk", "trial_index"]);
const ANALYSIS_SESSION = Object.freeze(["session_id", "run_mode", "configured_tasks_complete", "full_protocol_complete", "export_schema_version"]);
const SESSION_COLUMNS = new Set([
  ...ANALYSIS_SESSION, "study_version", "session_started_at_utc",
  "practice_trials_planned", "practice_trials_completed", "calibration_trials_planned",
  "calibration_trials_completed", "calibration_trials_full", "meta_trials_planned",
  "meta_trials_completed", "review_images_planned", "review_images_completed",
  "mrt_blocks_planned", "mrt_blocks_completed"
]);
const DATASETS = Object.freeze([
  { key: "mrt", output: "mrtTsv", delimiter: "\t", core: MRT_CORE,
    selected: [...MRT_CORE, "probe_order", "basis_display_order", "basis_layout", "probe1_fast", "probe3_fast", "speed_reminder_shown"] },
  { key: "metaPractice", output: "pracCsvText", delimiter: ",", core: COMPARISON_CORE,
    selected: [...COMPARISON_CORE, "replay_count", "fast_response", "speed_reminder_shown"] },
  { key: "metaCalibration", output: "caliCsvText", delimiter: ",", core: COMPARISON_CORE,
    selected: [...COMPARISON_CORE, ...CAL_CHECK, "replay_count", "fast_response", "speed_reminder_shown"] },
  { key: "metaJudgment", output: "metaJCsvText", delimiter: ",", core: JUDGMENT_CORE,
    selected: [...JUDGMENT_CORE, ...FINAL_CHECK, "confidence_label", "replay_count", "type1_fast", "fast_response", "speed_reminder_shown"] }
]);
const FORBIDDEN_COLUMNS = new Set(["id", "numericid", "numeric_id", "external_id", "return", "returnurl", "return_url"]);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function scalar(value, name) {
  if (value === null || value === undefined) return "";
  if (["string", "boolean", "number"].includes(typeof value)) return String(value);
  throw new TypeError(`Metadata ${name} must be a scalar value`);
}

function parseTable(text, delimiter, name) {
  if (typeof text !== "string" || text.length === 0) throw new Error(`${name}: missing delimited table`);
  const bom = text.startsWith("\uFEFF");
  if (bom) text = text.slice(1);
  const records = [];
  let row = [], cell = "", quoted = false, closed = false, started = false;
  const finishCell = () => { row.push(cell); cell = ""; closed = false; started = false; };
  const finishRow = () => { finishCell(); records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
      continue;
    }
    if (char === delimiter) { finishCell(); continue; }
    if (char === "\r" || char === "\n") {
      finishRow();
      if (char === "\r" && text[i + 1] === "\n") i++;
      continue;
    }
    if (closed) throw new Error(`${name}: unexpected character after a closing quote`);
    if (char === '"') {
      if (started || cell.length) throw new Error(`${name}: quote inside an unquoted cell`);
      quoted = true; started = true;
    } else { cell += char; started = true; }
  }
  if (quoted) throw new Error(`${name}: unterminated quoted cell`);
  if (row.length || cell.length || started || closed) finishRow();
  if (!records.length) throw new Error(`${name}: missing header`);
  const [headers, ...rows] = records;
  if (headers.some(header => header.length === 0)) throw new Error(`${name}: empty column header`);
  if (new Set(headers).size !== headers.length) throw new Error(`${name}: duplicate column headers`);
  if (headers.some(header => FORBIDDEN_COLUMNS.has(header.toLowerCase()))) {
    throw new Error(`${name}: external routing identifiers must not be exported`);
  }
  rows.forEach((values, index) => {
    if (values.length !== headers.length) throw new Error(`${name}: row ${index + 1} has ${values.length} cells; expected ${headers.length}`);
  });
  return { headers, rows, bom };
}

function writeTable(headers, rows, delimiter, bom = false) {
  const encode = value => {
    const text = String(value);
    return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return (bom ? "\uFEFF" : "") + [headers, ...rows].map(row => row.map(encode).join(delimiter)).join("\n") + "\n";
}

function constantValue(rows, index) {
  if (rows.length === 0) return undefined;
  const value = rows[0][index];
  return rows.every(row => row[index] === value) ? value : undefined;
}

function sessionReference(session, column, value) {
  if (!own(session, column)) session[column] = value;
  if (scalar(session[column], column) === value) return column;
  const originals = session.original_values || (session.original_values = {});
  let key = column, suffix = 2;
  while (own(originals, key) && originals[key] !== value) key = `${column}_${suffix++}`;
  originals[key] = value;
  return `original_values.${key}`;
}

function readSessionReference(session, reference) {
  if (typeof reference !== "string") throw new Error("Invalid diagnostics session reference");
  if (reference.startsWith("original_values.")) {
    const key = reference.slice("original_values.".length);
    if (!session.original_values || !own(session.original_values, key)) throw new Error(`Missing diagnostics session value ${reference}`);
    return scalar(session.original_values[key], reference);
  }
  if (!own(session, reference)) throw new Error(`Missing diagnostics session value ${reference}`);
  return scalar(session[reference], reference);
}

/** Split the four legacy wide tables into analysis tables and one lossless JSON. */
export function splitStudyExports(wideExports, metadata = {}, filenames = {}) {
  const session = {};
  for (const [column, value] of Object.entries(metadata)) {
    if (FORBIDDEN_COLUMNS.has(column.toLowerCase())) throw new Error(`External routing identifier ${column} must not be exported`);
    if (SESSION_COLUMNS.has(column)) session[column] = scalar(value, column);
  }
  const parsed = DATASETS.map(definition => {
    const table = parseTable(wideExports[definition.output], definition.delimiter, definition.key);
    for (const column of definition.core) {
      if (!table.headers.includes(column)) throw new Error(`${definition.key}: missing required core column ${column}`);
    }
    return { definition, ...table };
  });
  for (const column of ["subject", "session_id"]) {
    const values = new Set();
    for (const table of parsed) {
      const index = table.headers.indexOf(column);
      if (index !== -1) for (const row of table.rows) if (row[index] !== "") values.add(row[index]);
    }
    if (values.size > 1) throw new Error(`Source tables contain mixed ${column} values`);
    if (column === "session_id" && values.size && own(session, column)
      && session[column] !== "" && !values.has(session[column])) throw new Error("Metadata session_id does not match the source tables");
  }
  // Infer session provenance for conversions of earlier exports. Explicit metadata wins.
  for (const table of parsed) {
    table.headers.forEach((column, index) => {
      if (!SESSION_COLUMNS.has(column) || own(session, column)) return;
      const value = constantValue(table.rows, index);
      if (value !== undefined) session[column] = value;
    });
  }
  const subject = parsed.flatMap(table => table.rows.map(row => row[table.headers.indexOf("subject")])).find(value => value !== "") || "";
  const diagnostics = {
    subject,
    session_id: own(session, "session_id") ? session.session_id : "",
    export_schema_version: own(session, "export_schema_version") ? session.export_schema_version : "fae-export-v3",
    session,
    datasets: {}
  };
  const outputs = {};
  for (const table of parsed) {
    const { definition, headers, rows, bom } = table;
    const sourceIndex = new Map(headers.map((column, index) => [column, index]));
    const analysisColumns = [
      ...definition.selected.filter(column => sourceIndex.has(column)),
      ...ROW_CONTEXT.filter(column => column === "row_index" || sourceIndex.has(column)),
      ...ANALYSIS_SESSION.filter(column => sourceIndex.has(column) || own(session, column))
    ];
    const rowIndices = rows.map((row, index) => sourceIndex.has("row_index") ? row[sourceIndex.get("row_index")] : String(index + 1));
    if (rowIndices.some(value => value === "") || new Set(rowIndices).size !== rowIndices.length) throw new Error(`${definition.key}: row_index must be nonempty and unique`);
    const analysisRows = rows.map((row, index) => analysisColumns.map(column => {
      if (column === "row_index") return rowIndices[index];
      if (ANALYSIS_SESSION.includes(column) && own(metadata, column)) return scalar(metadata[column], column);
      if (sourceIndex.has(column)) {
        const value = row[sourceIndex.get(column)];
        return column === "session_id" && value === "" && own(session, column) ? scalar(session[column], column) : value;
      }
      return scalar(session[column], column);
    }));
    const selected = new Set(analysisColumns);
    const analysisIndex = new Map(analysisColumns.map((column, index) => [column, index]));
    const constants = Object.create(null), sessionColumns = Object.create(null), omittedColumns = [], omittedIndices = [];
    headers.forEach((column, index) => {
      // Metadata replacements retain their original source values for exact recovery.
      const replaced = selected.has(column)
        && rows.some((row, rowNumber) => row[index] !== analysisRows[rowNumber][analysisIndex.get(column)]);
      if (selected.has(column) && !replaced) return;
      const value = constantValue(rows, index);
      if (value !== undefined && SESSION_COLUMNS.has(column)) {
        sessionColumns[column] = sessionReference(session, column, value);
      } else if (value !== undefined) constants[column] = value;
      else if (rows.length) { omittedColumns.push(column); omittedIndices.push(index); }
    });
    const entry = {
      original_columns: headers,
      analysis_columns: analysisColumns,
      constants,
      session_columns: sessionColumns,
      columns: ["row_index", ...omittedColumns],
      rows: rows.map((row, index) => [rowIndices[index], ...omittedIndices.map(source => row[source])])
    };
    if (own(filenames, definition.key)) entry.filename = scalar(filenames[definition.key], definition.key);
    if (bom) entry.bom = true;
    diagnostics.datasets[definition.key] = entry;
    outputs[definition.output] = writeTable(analysisColumns, analysisRows, definition.delimiter);
  }
  outputs.diagnosticsJsonText = JSON.stringify(diagnostics);
  return outputs;
}

/** Recover every original header and source cell using the paired primary files. */
export function restoreWideExports(analysisOutputs, diagnosticsJsonText) {
  const diagnostics = JSON.parse(diagnosticsJsonText);
  if (!diagnostics || !diagnostics.session || !diagnostics.datasets) throw new Error("Invalid study diagnostics");
  const restored = {};
  for (const definition of DATASETS) {
    const saved = diagnostics.datasets[definition.key];
    if (!saved || !Array.isArray(saved.original_columns) || !Array.isArray(saved.columns) || !Array.isArray(saved.rows)) throw new Error(`Missing diagnostics for ${definition.key}`);
    const analysis = parseTable(analysisOutputs[definition.output], definition.delimiter, definition.key);
    if (JSON.stringify(analysis.headers) !== JSON.stringify(saved.analysis_columns)) throw new Error(`${definition.key}: analysis schema does not match diagnostics`);
    const primaryIndex = new Map(analysis.headers.map((column, index) => [column, index]));
    const diagnosticIndex = new Map(saved.columns.map((column, index) => [column, index]));
    if (!primaryIndex.has("row_index") || saved.columns[0] !== "row_index") throw new Error(`${definition.key}: missing row links`);
    const byRow = new Map(saved.rows.map(row => {
      if (!Array.isArray(row) || row.length !== saved.columns.length) throw new Error(`${definition.key}: malformed diagnostics row`);
      return [row[0], row];
    }));
    if (byRow.size !== saved.rows.length || saved.rows.length !== analysis.rows.length) throw new Error(`${definition.key}: row count mismatch`);
    const used = new Set();
    const rows = analysis.rows.map(primary => {
      const rowIndex = primary[primaryIndex.get("row_index")];
      const detail = byRow.get(rowIndex);
      if (!detail || used.has(rowIndex)) throw new Error(`${definition.key}: unmatched or repeated row_index ${rowIndex}`);
      used.add(rowIndex);
      if (primaryIndex.has("session_id") && own(diagnostics.session, "session_id")
        && primary[primaryIndex.get("session_id")] !== scalar(diagnostics.session.session_id, "session_id")) throw new Error(`${definition.key}: session_id does not match diagnostics`);
      return saved.original_columns.map(column => {
        if (own(saved.session_columns || {}, column)) return readSessionReference(diagnostics.session, saved.session_columns[column]);
        if (own(saved.constants || {}, column)) return saved.constants[column];
        if (diagnosticIndex.has(column)) return detail[diagnosticIndex.get(column)];
        if (primaryIndex.has(column)) return primary[primaryIndex.get(column)];
        throw new Error(`${definition.key}: missing original column ${column}`);
      });
    });
    restored[definition.output] = writeTable(saved.original_columns, rows, definition.delimiter, saved.bom === true);
  }
  return restored;
}
