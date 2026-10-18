// Convert one previously saved wide session without changing the source files.
// Usage: node scripts/split-session-exports.mjs MRT.tsv practice.csv cali.csv metaJ.csv NEW_OUTPUT_DIR
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { splitStudyExports, restoreWideExports } from "../js/analysis-exports.mjs";

const args = process.argv.slice(2);
if (args.length !== 5) {
  throw new Error("Usage: node scripts/split-session-exports.mjs MRT.tsv practice.csv cali.csv metaJ.csv NEW_OUTPUT_DIR");
}
const inputs = args.slice(0, 4).map(file => path.resolve(file));
const outputDirectory = path.resolve(args[4]);
if (inputs.some(file => path.dirname(file) === outputDirectory)) {
  throw new Error("Choose a separate output directory; source exports must remain unchanged.");
}
const keys = ["mrtTsv", "pracCsvText", "caliCsvText", "metaJCsvText"];
const fileKeys = ["mrt", "metaPractice", "metaCalibration", "metaJudgment"];
const texts = await Promise.all(inputs.map(file => readFile(file, "utf8")));
const wide = Object.fromEntries(keys.map((key, index) => [key, texts[index]]));
const filenames = Object.fromEntries(fileKeys.map((key, index) => [key, path.basename(inputs[index])]));
const compact = splitStudyExports(wide, { export_schema_version: "fae-export-v3" }, filenames);
const restored = restoreWideExports(compact, compact.diagnosticsJsonText);
// The source exporters produce the same canonical quoting as this serializer.
// Any byte discrepancy is reported instead of silently distributing a conversion.
for (const key of keys) {
  if (restored[key] !== wide[key]) {
    throw new Error(`Lossless verification did not reproduce ${key}; sources were not changed.`);
  }
}
const diagnostics = JSON.parse(compact.diagnosticsJsonText);
const mrtStem = path.basename(inputs[0], path.extname(inputs[0]));
const diagnosticsName = mrtStem.startsWith("MRT_")
  ? `Diagnostics_${mrtStem.slice(4)}.json` : `${mrtStem}_diagnostics.json`;
const outputs = keys.map((key, index) => ({ name: filenames[fileKeys[index]], text: compact[key] }));
outputs.push({ name: diagnosticsName, text: compact.diagnosticsJsonText });
await mkdir(outputDirectory, { recursive: true });
for (const output of outputs) {
  try {
    await access(path.join(outputDirectory, output.name));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  throw new Error(`Output already exists: ${output.name}`);
}
for (const output of outputs) {
  await writeFile(path.join(outputDirectory, output.name), output.text, { flag: "wx" });
}
console.log(JSON.stringify({
  session_id: diagnostics.session_id,
  lossless_round_trip: true,
  input_bytes: texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0),
  output_bytes: outputs.reduce((sum, output) => sum + Buffer.byteLength(output.text), 0),
  files: outputs.map(output => ({ filename: output.name, bytes: Buffer.byteLength(output.text) }))
}, null, 2));
