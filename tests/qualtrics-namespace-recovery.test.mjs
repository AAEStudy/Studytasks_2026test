import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSessionZip } from '../js/session-bundle.mjs';
import { createQualtricsCodec } from '../js/qualtrics-bundle.mjs';

const codec = createQualtricsCodec();
const root = new URL('../', import.meta.url).pathname;
const files = [
  {filename: 'MRT/a.tsv', text: 'subject\tanswer\r\nSYNTHETIC\té 中文\r\n'},
  {filename: 'Diagnostics/b.json', text: JSON.stringify({test: 'namespaces', details: 'x'.repeat(20000)})}
];
const zip = createSessionZip(files);
const info = {filename: 'FAE_namespace.zip', sessionId: 'namespace-session', subjectId: 'SYNTHETIC', runMode: 'probe'};
const completed = fields => ({...fields, fae_receiver_status: 'verified', Finished: '1'});
const modern = row => Object.fromEntries(Object.entries(row).map(([name, value]) =>
  [name.startsWith('fae_') ? '__js_' + name : name, value]));
const csv = rows => rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
const restore = (input, output) => spawnSync('python3', [root + 'scripts/restore-qualtrics-bundles.py', input, output], {encoding: 'utf8'});

function writeExport(temporary, format, rows) {
  const input = join(temporary, 'responses.' + format);
  if (format === 'json') {
    writeFileSync(input, JSON.stringify({responses: rows.map(values => ({values}))}));
  } else {
    const header = [...new Set(rows.flatMap(row => Object.keys(row)))];
    // Both metadata rows are present in normal Qualtrics CSV exports. Labels
    // may be either raw prefixed names or logical names in the first row.
    const labels = header.map(name => name.replace(/^__js_/, ''));
    const importIds = header.map(ImportId => JSON.stringify({ImportId}));
    writeFileSync(input, '\ufeff' + csv([header, labels, importIds,
      ...rows.map(row => header.map(name => row[name] ?? ''))]));
  }
  return input;
}

for (const format of ['csv', 'json']) {
  for (const namespace of ['legacy', 'modern']) {
    test(`${format} ${namespace} export restores exact ZIP and CRC-checked files`, async () => {
      const temporary = mkdtempSync(join(tmpdir(), 'fae-namespace-'));
      try {
        const logical = completed(await codec.build(zip, info));
        const row = namespace === 'modern' ? modern(logical) : logical;
        const input = writeExport(temporary, format, [row]);
        const output = join(temporary, 'restored');
        const result = restore(input, output);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), {restored: 1, unchanged: 0, rejected: 0});
        assert.deepEqual(readFileSync(join(output, 'FAE_namespace', 'FAE_namespace.zip')), Buffer.from(zip));
        for (const file of files) {
          assert.equal(readFileSync(join(output, 'FAE_namespace', file.filename), 'utf8'), file.text);
        }
      } finally { rmSync(temporary, {recursive: true, force: true}); }
    });
  }

  test(`${format} uses modern namespace atomically and rejects incomplete payload/status despite valid legacy`, async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'fae-namespace-'));
    try {
      const logical = completed(await codec.build(zip, info));
      const prefixed = modern(logical);
      const missingChunk = {...logical, ...prefixed};
      delete missingChunk.__js_fae_zip_0002;
      const missingStatus = {...logical, ...prefixed};
      delete missingStatus.__js_fae_receiver_status;
      const onlyStatus = {...logical, __js_fae_receiver_status: 'verified'};
      const input = writeExport(temporary, format, [missingChunk, missingStatus, onlyStatus]);
      const output = join(temporary, 'restored');
      const result = restore(input, output);
      assert.equal(result.status, 2, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {restored: 0, unchanged: 0, rejected: 3});
      assert.deepEqual(readdirSync(output), []);
      assert.match(result.stderr, /Missing or truncated chunk 2/);
      assert.match(result.stderr, /Receiver did not verify/);
      assert.match(result.stderr, /Missing or unsupported receiver schema/);
    } finally { rmSync(temporary, {recursive: true, force: true}); }
  });

  test(`${format} complete modern payload wins over conflicting stale legacy fields`, async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'fae-namespace-'));
    try {
      const logical = completed(await codec.build(zip, info));
      const row = {...logical, fae_filename: 'stale.zip', fae_receiver_status: 'invalid',
        fae_zip_sha256: '0'.repeat(64), ...modern(logical)};
      const input = writeExport(temporary, format, [row]);
      const output = join(temporary, 'restored');
      const result = restore(input, output);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {restored: 1, unchanged: 0, rejected: 0});
      assert.deepEqual(readdirSync(output), ['FAE_namespace']);
    } finally { rmSync(temporary, {recursive: true, force: true}); }
  });

  test(`${format} rejects archive CRC corruption even when modern envelope SHA-256 matches`, async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'fae-namespace-'));
    try {
      const corrupted = new Uint8Array(zip);
      // A local ZIP header is 30 bytes followed by its UTF-8 filename. Change
      // stored file content while leaving ZIP CRC fields unchanged.
      corrupted[30 + new TextEncoder().encode(files[0].filename).length] ^= 1;
      const fields = await codec.build(corrupted, info);
      const input = writeExport(temporary, format, [modern(completed(fields))]);
      const output = join(temporary, 'restored');
      const result = restore(input, output);
      assert.equal(result.status, 2, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {restored: 0, unchanged: 0, rejected: 1});
      assert.match(result.stderr, /CRC/);
      assert.deepEqual(readdirSync(output), []);
    } finally { rmSync(temporary, {recursive: true, force: true}); }
  });
}

test('prefixed CSV metadata labels can retain raw __js_ field names', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'fae-namespace-'));
  try {
    const row = modern(completed(await codec.build(zip, info)));
    const header = Object.keys(row);
    const input = join(temporary, 'responses.csv');
    writeFileSync(input, csv([header, header,
      header.map(ImportId => JSON.stringify({ImportId})), header.map(name => row[name])]));
    const result = restore(input, join(temporary, 'restored'));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {restored: 1, unchanged: 0, rejected: 0});
  } finally { rmSync(temporary, {recursive: true, force: true}); }
});

function plusChunkFixture() {
  const filename = 'MRT/plus.bin';
  const payload = Buffer.alloc(22000, 0x41);
  // A base64 chunk is 18000 characters = 13500 bytes. A byte 0xf8 at
  // that boundary makes the second chunk begin '+'. Python creates the
  // independent ZIP CRC and headers for this valid binary fixture.
  payload[13500 - (30 + Buffer.byteLength(filename))] = 0xf8;
  const generated = spawnSync('python3', ['-c', [
    'import io, sys, zipfile',
    'output = io.BytesIO()',
    'with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:',
    '    archive.writestr("MRT/plus.bin", sys.stdin.buffer.read())',
    'sys.stdout.buffer.write(output.getvalue())'
  ].join('\n')], {input: payload});
  assert.equal(generated.status, 0, String(generated.stderr));
  assert.equal(generated.stdout[13500], 0xf8);
  return {filename, payload, binary: generated.stdout};
}

for (const namespace of ['legacy', 'modern']) {
  test(`CSV ${namespace} ZIP chunk strips only Qualtrics apostrophe before '+' and restores exact bytes`, async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'fae-plus-'));
    try {
      const fixture = plusChunkFixture();
      const fields = await codec.build(new Uint8Array(fixture.binary), info);
      assert.ok(fields.fae_zip_0002.startsWith('+'));
      const escaped = completed({...fields, fae_zip_0002: "'" + fields.fae_zip_0002});
      const row = namespace === 'modern' ? modern(escaped) : escaped;
      const input = writeExport(temporary, 'csv', [row]);
      const output = join(temporary, 'restored');
      const result = restore(input, output);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {restored: 1, unchanged: 0, rejected: 0});
      assert.deepEqual(readFileSync(join(output, 'FAE_namespace', 'FAE_namespace.zip')), fixture.binary);
      assert.deepEqual(readFileSync(join(output, 'FAE_namespace', fixture.filename)), fixture.payload);
    } finally { rmSync(temporary, {recursive: true, force: true}); }
  });
}

test('CSV quote normalization keeps strict base64 and SHA checks; JSON never strips quote', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'fae-plus-'));
  try {
    const fixture = plusChunkFixture();
    const fields = await codec.build(new Uint8Array(fixture.binary), info);
    assert.ok(fields.fae_zip_0002.startsWith('+'));
    const original = fields.fae_zip_0002;
    const invalidBase64 = modern(completed({...fields,
      fae_zip_0002: "'" + original.slice(0, 5) + '!' + original.slice(6)}));
    const invalidHash = modern(completed({...fields,
      fae_zip_0002: "'" + original, fae_zip_sha256: '0'.repeat(64)}));
    const csvInput = writeExport(temporary, 'csv', [invalidBase64, invalidHash]);
    const output = join(temporary, 'restored');
    const result = restore(csvInput, output);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {restored: 0, unchanged: 0, rejected: 2});
    assert.match(result.stderr, /Only base64 data is allowed/);
    assert.match(result.stderr, /SHA-256 mismatch/);
    assert.deepEqual(readdirSync(output), []);

    const jsonInput = writeExport(temporary, 'json', [modern(completed({...fields,
      fae_zip_0002: "'" + original}))]);
    const jsonResult = restore(jsonInput, output);
    assert.equal(jsonResult.status, 2, jsonResult.stderr);
    assert.deepEqual(JSON.parse(jsonResult.stdout), {restored: 0, unchanged: 0, rejected: 1});
    assert.match(jsonResult.stderr, /Encoded size mismatch/);
    assert.deepEqual(readdirSync(output), []);
  } finally { rmSync(temporary, {recursive: true, force: true}); }
});
