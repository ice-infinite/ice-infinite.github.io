import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { browserApkName, browserApkPath } from '../tools/sync-release.mjs';

const release=JSON.parse(await readFile(new URL('../assets/release.json',import.meta.url),'utf8'));
const base='https://ice-infinite.github.io/';
const expectedUrl=new URL(browserApkPath(release),base).href;
const output=new URL('../.qa/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const browserErrors=[];
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,javaScriptEnabled:false,
    userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36'});
  const page=await context.newPage();
  page.on('pageerror',error=>browserErrors.push(error.message));
  let mime;
  page.on('response',response=>{if(response.url()===expectedUrl)mime=response.headers()['content-type'];});
  await page.goto(base,{waitUntil:'networkidle',timeout:45000});
  assert.equal(new URL(await page.locator('[data-apk-link]').getAttribute('href'),base).href,expectedUrl);
  assert.equal(await page.locator('[data-apk-link]').getAttribute('download'),browserApkName(release));
  await page.locator('.download-card').screenshot({path:fileURLToPath(new URL('public-apk-download-mobile.png',output))});
  const event=page.waitForEvent('download',{timeout:45000});
  await page.locator('[data-apk-link]').click();
  const download=await event;
  assert.equal(download.suggestedFilename(),browserApkName(release));
  const stream=await download.createReadStream();
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of stream){bytes+=chunk.length;assert.ok(bytes<=release.sizeBytes);digest.update(chunk);}
  assert.equal(bytes,release.sizeBytes);
  const sha256=digest.digest('hex');assert.equal(sha256,release.sha256);
  assert.deepEqual(browserErrors,[]);
  const result={status:'passed-public-mobile-emulated-browser-download',site:base,downloadUrl:expectedUrl,
    versionName:release.versionName,versionCode:release.versionCode,filename:download.suggestedFilename(),
    mimeType:mime??null,sizeBytes:bytes,sha256,javaScriptEnabled:false,browserErrors,
    physicalPhoneTested:false,apkInstalled:false,phoneSettingsChanged:false};
  await writeFile(new URL('public-browser-download.json',output),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await browser.close();}
