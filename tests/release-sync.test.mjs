import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planRelease, androidLabel } from '../tools/sync-release.mjs';

const root=new URL('../',import.meta.url);
const previous=JSON.parse(readFileSync(new URL('assets/release.json',root),'utf8'));
const html=readFileSync(new URL('index.html',root),'utf8');
function future() {
  const parts=previous.versionName.split('.').map(Number);parts[2]++;
  const versionName=parts.join('.'),versionCode=previous.versionCode+1;
  return {...previous,versionName,versionCode,sizeBytes:46_001_234,sha256:'b'.repeat(64),
    publishedAt:'2026-10-20T18:00:00Z',minSdk:26,
    downloadUrl:`https://gitee.com/ice_infinite/anyao-releases/releases/download/v${versionName}-arm64-test.1/anyao-${versionName}-${versionCode}-arm64-v8a.apk`};
}
test('same verified release is idempotent, including reordered input',()=>{
  const reordered=Object.fromEntries(Object.entries(previous).reverse());
  assert.equal(planRelease(previous,html,reordered).changed,false);
});
test('equivalent publication timestamp round-trip remains a no-op',()=>{
  const result=planRelease(previous,html,{...previous,publishedAt:new Date(previous.publishedAt).toISOString()});
  assert.equal(result.changed,false);
  assert.equal(result.next.publishedAt,previous.publishedAt);
});
test('new release updates all fields, Shanghai date and APK compatibility',()=>{
  const result=planRelease(previous,html,future());
  assert.equal(result.changed,true);
  assert.ok(result.html.includes('<!-- release:date -->2026-10-21<!-- /release:date -->'));
  assert.equal((result.html.match(/<!-- release:android -->Android 8.0\+/g)||[]).length,3);
  assert.ok(result.html.includes('46.00 MB'));
  assert.ok(result.html.includes('默认开启基础使用统计'));
});
test('unknown fields, paths and synthetic secrets never reach public metadata',()=>{
  const result=planRelease(previous,html,{...future(),token:'synthetic-test-secret',localArtifactPath:'C:/private/file.apk'});
  assert.ok(!JSON.stringify(result.next).includes('synthetic-test-secret'));
  assert.ok(!JSON.stringify(result.next).includes('private'));
});
test('unknown future API level is not guessed to be an Android version',()=>assert.equal(androidLabel(39),'Android API 39+'));
test('lower code cannot overwrite a newer site',()=>assert.throws(()=>planRelease(previous,html,{...previous,versionCode:previous.versionCode-1})));
test('a higher build code cannot disguise an older version name',()=>{
  const next=future();next.versionName='0.0.1';
  next.downloadUrl=`https://gitee.com/ice_infinite/anyao-releases/releases/download/v0.0.1-arm64-test.1/anyao-0.0.1-${next.versionCode}-arm64-v8a.apk`;
  assert.throws(()=>planRelease(previous,html,next));
});
for (const [label,patch] of [
  ['changed checksum',{sha256:'c'.repeat(64)}],['changed size',{sizeBytes:previous.sizeBytes+1}],
  ['changed date',{publishedAt:'2026-10-22T10:00:00Z'}],['changed SDK',{minSdk:29}],
  ['production policy',{testRelease:false}],['changed collection policy',{usageStatisticsDefaultEnabled:false}],
]) test(`same-code or unreviewed policy rejected: ${label}`,()=>assert.throws(()=>planRelease(previous,html,{...previous,...patch})));

function fixture(run) {
  const directory=mkdtempSync(join(tmpdir(),'anyao-release-cli-'));
  try {
    mkdirSync(join(directory,'assets'));mkdirSync(join(directory,'tools'));
    writeFileSync(join(directory,'package.json'),'{"type":"module"}');
    writeFileSync(join(directory,'index.html'),html);
    const json=JSON.stringify(previous,null,2)+'\n';
    writeFileSync(join(directory,'assets/release.json'),json);
    copyFileSync(new URL('tools/sync-release.mjs',root),join(directory,'tools/sync-release.mjs'));
    copyFileSync(new URL('tools/stage-browser-apk.mjs',root),join(directory,'tools/stage-browser-apk.mjs'));
    const invoke=(value,args=[])=>spawnSync(process.execPath,[join(directory,'tools/sync-release.mjs'),'--release-stdin',...args],{input:JSON.stringify(value),encoding:'utf8'});
    run({directory,json,invoke});
  } finally {rmSync(directory,{recursive:true,force:true});}
}
test('CLI check mode validates a new release without changing either file',()=>fixture(({directory,json,invoke})=>{
  const result=invoke(future(),['--check']);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).status,'would-update');
  assert.equal(readFileSync(join(directory,'index.html'),'utf8'),html);
  assert.equal(readFileSync(join(directory,'assets/release.json'),'utf8'),json);
}));
test('CLI applies new release once, repeat is a no-op, no secret is written',()=>fixture(({directory,invoke})=>{
  const next={...future(),token:'synthetic-test-secret'};
  assert.equal(JSON.parse(invoke(next).stdout).status,'updated');
  const before=readFileSync(join(directory,'assets/release.json'),'utf8');
  assert.equal(JSON.parse(invoke(next).stdout).status,'current');
  assert.equal(readFileSync(join(directory,'assets/release.json'),'utf8'),before);
  assert.ok(!before.includes('synthetic-test-secret'));
}));
test('CLI failure leaves both files intact and does not echo input',()=>fixture(({directory,json,invoke})=>{
  const result=invoke({...future(),testRelease:false,token:'synthetic-test-secret'});
  assert.notEqual(result.status,0);
  assert.ok(!result.stderr.includes('synthetic-test-secret'));
  assert.equal(readFileSync(join(directory,'index.html'),'utf8'),html);
  assert.equal(readFileSync(join(directory,'assets/release.json'),'utf8'),json);
}));
