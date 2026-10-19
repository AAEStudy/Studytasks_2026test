import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createSessionZip, zipToBase64 } from '../js/session-bundle.mjs';

test('independent ZIP reader verifies CRCs, paths and exact UTF-8 file bytes', () => {
  const files = ['MRT/a.tsv', 'Image_practice/b.csv', 'Calibration/c.csv', 'Final_judgments/d.csv', 'Diagnostics/e.json']
    .map((filename, i) => ({ filename, text: `subject\tvalue\r\nSID123\t${i}\r\n"é,中文\nquoted"\n` }));
  const zip = createSessionZip(files);
  assert.deepEqual(Buffer.from(zipToBase64(zip), 'base64'), Buffer.from(zip));
  const result = spawnSync('python3', ['-c',
    'import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode("utf-8") for n in z.namelist()}))'
  ], { input: zip, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), Object.fromEntries(files.map(file => [file.filename, file.text])));
});

test('bundle rejects unsafe and duplicate paths', () => {
  for (const filename of ['../a.csv', '/a.csv', 'a/../b.csv', 'a\\b.csv']) {
    assert.throws(() => createSessionZip([{ filename, text: 'test' }]));
  }
  assert.throws(() => createSessionZip([{ filename: 'a.csv', text: '' }, { filename: 'a.csv', text: '' }]));
});
