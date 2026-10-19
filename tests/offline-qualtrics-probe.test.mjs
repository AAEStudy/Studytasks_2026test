import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { webcrypto, createHash } from 'node:crypto';
import vm from 'node:vm';
import { createQualtricsCodec } from '../js/qualtrics-bundle.mjs';

test('downloaded test page prepares without network and POSTs verified synthetic ZIP only on click', async () => {
  const root = new URL('../', import.meta.url).pathname;
  const built = spawnSync(process.execPath,[root+'scripts/build-offline-qualtrics-probe.mjs'],{encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  const html=readFileSync(root+'qualtrics/FAE_Receiver_Test.html','utf8');
  assert.doesNotMatch(html,/<script[^>]+src=/i);
  const script=/<script>([\s\S]*)<\/script>/.exec(html)[1];
  const elements=Object.fromEntries(['size','status','summary','send','details','previous','receiver-code','copy-code','code-panel','copy-status'].map(id=>[id,{value:id==='size'?'65536':''}]));
  const memory=new Map(); let submissions=0; const appended=[];
  let clipboard='';
  const document={getElementById:id=>elements[id],
    createElement:tag=>({tag,children:[],appendChild(child){this.children.push(child);},submit(){submissions++;}}),
    body:{appendChild(element){appended.push(element);}}};
  const context=vm.createContext({document,crypto:webcrypto,TextEncoder,Uint8Array,DataView,atob,btoa,
    localStorage:{setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)},URL,Blob,setTimeout,
    navigator:{clipboard:{async writeText(value){clipboard=value;}}}});
  vm.runInContext(script,context);
  await context.preparation;
  assert.equal(submissions,0);
  assert.equal(appended.length,0);
  await elements['copy-code'].onclick();
  assert.equal(clipboard,readFileSync(root+'qualtrics/receiver-question-complete.js','utf8'));
  assert.match(clipboard,/getJSEmbeddedData/);
  assert.doesNotMatch(clipboard,/engine\.(?:get|set)EmbeddedData\(/);
  assert.match(elements['copy-status'].textContent,/Copied/);
  assert.equal(elements.send.disabled,false);
  assert.match(elements.status.textContent,/Ready/);
  const expected=JSON.parse(memory.get('fae_receiver_probe_manifest'));
  assert.ok(expected.zip_bytes>65536 && expected.zip_bytes<68000);
  assert.equal(expected.files.length,5);
  assert.equal(expected.receiver,'https://usf.az1.qualtrics.com/jfe/form/SV_b7rI1T6DVd3u0dw');
  await elements.send.onclick();
  assert.equal(submissions,1);
  assert.equal(appended.length,1);
  const form=appended[0];
  assert.equal(form.action,expected.receiver);
  assert.equal(form.method,'POST');
  assert.equal(form.enctype,'application/x-www-form-urlencoded');
  assert.ok(form.children.every(child=>child.name.startsWith('__js_fae_')));
  const fields=Object.fromEntries(form.children.map(child=>[child.name.slice(5),child.value]));
  assert.equal(fields.fae_run_mode,'probe');
  assert.equal(fields.fae_subject_id,'SYNTHETIC');
  assert.equal(fields.fae_session_id,expected.session_id);
  const bytes=await createQualtricsCodec().verify(fields);
  assert.equal(bytes.length,expected.zip_bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256);
  const archive=spawnSync('python3',['-c',
    'import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:len(z.read(n)) for n in z.namelist()}))'
  ],{input:bytes,encoding:'utf8'});
  assert.equal(archive.status,0,archive.stderr);
  assert.deepEqual(JSON.parse(archive.stdout),Object.fromEntries(expected.files.map(file=>[file.filename,file.utf8_bytes])));
});
