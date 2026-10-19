import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { createSessionZip } from '../js/session-bundle.mjs';
import { createQualtricsCodec, validateReceiverUrl, postQualtricsBundle } from '../js/qualtrics-bundle.mjs';

const codec = createQualtricsCodec();
const files = ['MRT/a.tsv','Image_practice/b.csv','Calibration/c.csv','Final_judgments/d.csv','Diagnostics/e.json']
  .map(filename => ({filename, text:'subject,answer\nSYNTHETIC,"é 中文, quote"\r\n'}));
const zip = createSessionZip(files);
const info = { filename:'FAE_probe.zip',sessionId:'probe-session',subjectId:'SYNTHETIC',runMode:'probe' };
const completed = fields => ({...fields, Finished:'1', fae_receiver_status:'verified'});
const root = new URL('../', import.meta.url).pathname;
const restore = (input, output) => spawnSync('python3', [root+'scripts/restore-qualtrics-bundles.py',input,output],{encoding:'utf8'});
const csv = rows => rows.map(row => row.map(value => '"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');

test('2 MiB ZIP survives browser form encoding and shared verifier exactly', async () => {
  const large = createSessionZip([{filename:'MRT/full-size-synthetic.tsv', text:'x'.repeat(2*1024*1024)}]);
  const fields = await codec.build(large, info);
  assert.ok(Number(fields.fae_chunk_count)>100);
  assert.ok(Object.values(fields).every(value => new TextEncoder().encode(value).length <= 18000));
  const parsed = Object.fromEntries(new URLSearchParams(new URLSearchParams(fields).toString()));
  assert.deepEqual(await codec.verify(parsed),large);
});

test('rejects truncation, corruption, unsafe names, extra chunks and capacity overflow', async () => {
  const fields = await codec.build(zip, info);
  await assert.rejects(codec.verify({...fields,fae_zip_0001:fields.fae_zip_0001.slice(1)}));
  const changed = fields.fae_zip_0001.slice(0,40)+'A'+fields.fae_zip_0001.slice(41);
  await assert.rejects(codec.verify({...fields,fae_zip_0001:changed}), /checksum/);
  await assert.rejects(codec.verify({...fields,fae_zip_0002:'AAAA'}), /extra/);
  await assert.rejects(codec.verify({...fields,fae_filename:'../escape.zip'}), /Unsafe/);
  await assert.rejects(codec.build(new Uint8Array(3456001),info), /capacity/);
  await assert.rejects(codec.verify({...fields,fae_chunk_count:'257'}), /capacity/);
});

test('optional return URL accepts only HTTPS survey or the deployed receipt page and preserves routing parameters', async () => {
  for (const returnUrl of [undefined, '', 'https://usf.az1.qualtrics.com/jfe/form/SV_custom?id=007#resume',
    'https://aaestudy.github.io/Studytasks_2026test/qualtrics/saved.html?session=s&nonce=n']) {
    const fields = await codec.build(zip, { ...info, returnUrl });
    assert.equal(fields.fae_return_url, returnUrl || '');
    assert.deepEqual(await codec.verify(fields), zip);
  }
  for (const returnUrl of ['http://usf.az1.qualtrics.com/jfe/form/SV_custom', 'https://evilqualtrics.com/jfe/form/SV_custom',
    'https://user:password@usf.az1.qualtrics.com/jfe/form/SV_custom', 'https://aaestudy.github.io/other/saved.html',
    'https://aaestudy.github.io:444/Studytasks_2026test/qualtrics/saved.html', 'https://attacker.example/saved.html']) {
    await assert.rejects(codec.build(zip, { ...info, returnUrl }));
  }
});

test('POST uses separate USF survey, hidden body fields, no data in URL', async () => {
  for (const url of ['http://usf.az1.qualtrics.com/jfe/form/SV_test','https://attacker.example/jfe/form/SV_test',
    'https://usf.az1.qualtrics.com/jfe/form/SV_8wijLZLkAmgskVE','https://usf.az1.qualtrics.com/jfe/form/SV_test?x=1']) {
    assert.throws(()=>validateReceiverUrl(url));
  }
  let submitted = 0, appended;
  const document = {createElement:tag=>({tag,children:[],appendChild(child){this.children.push(child);},submit(){submitted++;}}),
    body:{appendChild(form){appended=form;}}};
  const fields = await codec.build(zip,info);
  await postQualtricsBundle(fields,'https://usf.az1.qualtrics.com/jfe/form/SV_test',document);
  assert.equal(submitted,1); assert.equal(appended.method,'POST');
  assert.ok(appended.children.every(child=>child.name.startsWith('__js_fae_')));
  assert.deepEqual(Object.fromEntries(appended.children.map(child=>[child.name.slice(5),child.value])),fields);
  assert.equal(appended.action,'https://usf.az1.qualtrics.com/jfe/form/SV_test');
});

test('generated receiver advances only after integrity check; bad data stays blocked', async () => {
  const generated = spawnSync(process.execPath,[root+'scripts/build-qualtrics-receiver.mjs'],{encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  const qsf = JSON.parse(readFileSync(root+'qualtrics/FAE_ZIP_Receiver_PROTOTYPE.qsf','utf8'));
  const source=qsf.SurveyElements.find(element=>element.Element==='SQ').Payload.QuestionJS;
  const parsed=spawnSync(process.execPath,['--expose-internals','-e',
    "require('internal/deps/acorn/acorn/dist/acorn').parse(require('fs').readFileSync(0,'utf8'),{ecmaVersion:5})"
  ],{input:source,encoding:'utf8'});
  assert.equal(parsed.status,0,'Receiver must parse in an ES5 editor: '+parsed.stderr);
  const declared=qsf.SurveyElements.find(element=>element.Element==='FL').Payload.Flow[0].EmbeddedData.map(field=>field.Field);
  assert.ok(codec.fieldNames.every(name=>declared.includes('__js_'+name)));
  assert.ok(declared.includes('__js_fae_receiver_status') && declared.includes('__js_fae_receiver_error'));
  const good=await codec.build(zip,{...info,returnUrl:'https://aaestudy.github.io/Studytasks_2026test/qualtrics/saved.html?session=s&nonce=n'});
  const cases = [[good,'verified',false,webcrypto],[good,'verified',true,webcrypto],
    [{...good,fae_zip_sha256:'0'.repeat(64)},'invalid',true,webcrypto],
    [{...good,fae_chunk_count:'0'},'invalid',true,webcrypto],
    [good,'invalid',true,undefined], [{...good,fae_schema:undefined},'invalid',true,webcrypto],
    [good,'invalid',true,{subtle:{digest(){return Promise.reject(new Error('hash failed'));}}}]];
  for (const [fields,expected,attributesStripped,cryptoApi] of cases) {
    const state=Object.fromEntries(Object.entries(fields).map(([name,value])=>['__js_'+name,value]));
    state.__js_fae_receiver_status='pending'; state.__js_fae_receiver_error='';
    let advanced=0, load, ready, resolve;
    const done=new Promise(r=>resolve=r);
    const question={hideNextButton(){},hidePreviousButton(){},getQuestionContainer(){return {querySelector(){return attributesStripped?null:{};}};},clickNextButton(){advanced++;resolve();}};
    const engine={addOnload(fn){load=fn;},addOnReady(fn){ready=fn;},
      getEmbeddedData(){throw new Error('Deprecated getter must not be used');},
      setEmbeddedData(){throw new Error('Deprecated setter must not be used');},
      getJSEmbeddedData(name){assert.ok(!name.startsWith('__js_'));return state['__js_'+name];},
      setJSEmbeddedData(name,value){assert.ok(!name.startsWith('__js_'));state['__js_'+name]=value;if(value==='invalid')resolve();}};
    vm.runInNewContext(source,{Qualtrics:{SurveyEngine:engine},crypto:cryptoApi,atob,btoa,URL});
    load.call(question); ready.call(question);
    await done;
    assert.equal(state.__js_fae_receiver_status,expected); assert.equal(advanced,expected==='verified'?1:0);
    if(expected==='verified') assert.equal(state.__js_fae_return_url,good.fae_return_url);
    if(expected==='invalid') assert.ok(state.__js_fae_receiver_error);
  }
});

test('one CSV restores 300 sessions and exact five files; repeated recovery is idempotent', async () => {
  const temporary=mkdtempSync(join(tmpdir(),'fae-q-'));
  try {
    const fields=await codec.build(zip,info);
    const header=[...codec.fieldNames,'Finished','fae_receiver_status'];
    const rows=[header,header,header.map(ImportId=>JSON.stringify({ImportId}))];
    for(let n=0;n<300;n++) {
      const row=completed({...fields,fae_filename:`FAE_probe_${n}.zip`,fae_session_id:`session-${n}`});
      rows.push(header.map(key=>row[key]??''));
    }
    const input=join(temporary,'responses.csv'), output=join(temporary,'restored');
    writeFileSync(input,'\ufeff'+csv(rows));
    const result=restore(input,output);
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),{restored:300,unchanged:0,rejected:0});
    assert.equal(readdirSync(output).length,300);
    for(const n of [0,149,299]) {
      assert.deepEqual(readFileSync(join(output,`FAE_probe_${n}`,`FAE_probe_${n}.zip`)),Buffer.from(zip));
      for(const file of files) assert.equal(readFileSync(join(output,`FAE_probe_${n}`,file.filename),'utf8'),file.text);
    }
    const again=restore(input,output);
    assert.equal(again.status,0,again.stderr);
    assert.deepEqual(JSON.parse(again.stdout),{restored:0,unchanged:300,rejected:0});
  } finally {rmSync(temporary,{recursive:true,force:true});}
});

test('recovery handles JSON exports and rejects incomplete/corrupt/conflicting/unsafe archives', async () => {
  const temporary=mkdtempSync(join(tmpdir(),'fae-q-'));
  try {
    const good=completed(await codec.build(zip,info));
    const unsafe=Buffer.from(zip); unsafe.write('../a.tsv',30,'ascii');
    // Build rejects malformed envelope content only if the hash differs; the
    // independent ZIP reader must additionally reject traversal/CRC corruption.
    const unsafeFields=completed(await codec.build(new Uint8Array(unsafe),{...info,filename:'unsafe.zip',sessionId:'unsafe'}));
    const rows=[good,{...good,Finished:false},{...good,fae_receiver_status:'checking'},
      {...good,fae_zip_sha256:'0'.repeat(64)}, {...good,fae_filename:'another.zip'},unsafeFields];
    const input=join(temporary,'responses.json'),output=join(temporary,'restored');
    writeFileSync(input,JSON.stringify({responses:rows.map(values=>({values}))}));
    const result=restore(input,output);
    assert.equal(result.status,2);
    assert.deepEqual(JSON.parse(result.stdout),{restored:1,unchanged:0,rejected:5});
    assert.deepEqual(readdirSync(output),['FAE_probe']);
  } finally {rmSync(temporary,{recursive:true,force:true});}
});
