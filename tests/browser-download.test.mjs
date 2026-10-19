import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageBrowserApk, browserApkPath } from '../tools/stage-browser-apk.mjs';
import { verifyBrowserDownload } from '../tools/verify-browser-download.mjs';

const payload = Buffer.from('synthetic APK integrity fixture, never installed');
const metadata = code => ({versionName:`0.1.${code}`,versionCode:code,sizeBytes:payload.length,
  sha256:createHash('sha256').update(payload).digest('hex')});
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(),'anyao-browser-apk-'));
  try {const input=join(root,'input.bin');await writeFile(input,payload);await run(root,input);}
  finally {await rm(root,{recursive:true,force:true});}
}

test('verified bytes are staged once, repeat does not replace the same APK',()=>fixture(async(root,input)=>{
  const release=metadata(24);
  assert.equal((await stageBrowserApk(root,release,release,input)).browserFileChanged,true);
  assert.deepEqual(await readFile(join(root,browserApkPath(release))),payload);
  assert.equal((await stageBrowserApk(root,release,release,input)).browserFileChanged,false);
}));
test('check-only validates and plans without creating download files',()=>fixture(async(root,input)=>{
  assert.equal((await stageBrowserApk(root,metadata(23),metadata(24),input,true)).browserFileChanged,true);
  await assert.rejects(access(join(root,'downloads')));
}));
test('wrong checksum or size is rejected before any staging',()=>fixture(async(root,input)=>{
  for(const patch of [{sha256:'0'.repeat(64)},{sizeBytes:payload.length+1}])
    await assert.rejects(stageBrowserApk(root,metadata(23),{...metadata(24),...patch},input));
  await assert.rejects(access(join(root,'downloads')));
}));
test('current and previous versions remain available without accumulating old site packages',()=>fixture(async(root,input)=>{
  await stageBrowserApk(root,metadata(22),metadata(22),input);
  await stageBrowserApk(root,metadata(22),metadata(23),input);
  const result=await stageBrowserApk(root,metadata(23),metadata(24),input);
  assert.deepEqual(result.removedBrowserPaths,[browserApkPath(metadata(22))]);
  assert.deepEqual((await readdir(join(root,'downloads'))).sort(),[browserApkPath(metadata(23)).split('/')[1],browserApkPath(metadata(24)).split('/')[1]]);
  assert.equal((await stageBrowserApk(root,metadata(24),metadata(24),input)).browserFileChanged,false);
  assert.equal((await readdir(join(root,'downloads'))).length,2);
}));
test('same-version corrupt file is never silently overwritten',()=>fixture(async(root,input)=>{
  await mkdir(join(root,'downloads'));
  await writeFile(join(root,browserApkPath(metadata(24))),'corrupt');
  await assert.rejects(stageBrowserApk(root,metadata(23),metadata(24),input));
  assert.equal(await readFile(join(root,browserApkPath(metadata(24))),'utf8'),'corrupt');
}));
test('unmanaged files are retained and traversal versions are rejected',()=>fixture(async(root,input)=>{
  await mkdir(join(root,'downloads'));await writeFile(join(root,'downloads','notes.txt'),'keep');
  await stageBrowserApk(root,metadata(23),metadata(24),input);
  assert.equal(await readFile(join(root,'downloads','notes.txt'),'utf8'),'keep');
  await assert.rejects(stageBrowserApk(root,metadata(23),{...metadata(24),versionName:'../../escape'},input));
}));

for(const mime of ['application/vnd.android.package-archive','application/octet-stream'])
  test(`public Android request accepts intact APK-compatible MIME: ${mime}`,async()=>{
    const result=await verifyBrowserDownload(metadata(24),async(url,options)=>{
      assert.equal(url,'https://ice-infinite.github.io/downloads/anyao-0.1.24-24-arm64-v8a.apk');
      assert.equal(options.redirect,'error');assert.match(options.headers['User-Agent'],/Android/);
      return new Response(payload,{headers:{'content-type':mime}});
    });
    assert.equal(result.verified,true);
  });
test('ZIP, HTML, missing packages and altered contents fail public verification',async()=>{
  for(const response of [
    ()=>new Response(payload,{headers:{'content-type':'application/zip'}}),
    ()=>new Response('error',{headers:{'content-type':'text/html'}}),
    ()=>new Response('missing',{status:404}),
    ()=>new Response('wrong',{headers:{'content-type':'application/vnd.android.package-archive'}}),
  ])await assert.rejects(verifyBrowserDownload(metadata(24),async()=>response()));
});
