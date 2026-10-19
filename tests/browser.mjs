import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { previewServer } from '../tools/preview.mjs';
import { browserApkPath, browserApkName } from '../tools/sync-release.mjs';
import { createHash } from 'node:crypto';

const output = new URL('../.qa/',import.meta.url);
const release = JSON.parse(await readFile(new URL('../assets/release.json',import.meta.url),'utf8'));
await mkdir(output,{recursive:true});
const server = await previewServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel:'msedge',headless:true});
const checks=[], errors=[], failures=[], external=[];
try {
  const context = await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  await context.route('**/*',route=>{
    if (new URL(route.request().url()).origin !== base) {external.push(route.request().url());return route.abort();}
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failures.push(response.url());});
  for (const [width,height] of [[320,760],[390,844],[430,932],[768,1024],[1440,1000]]) {
    await page.setViewportSize({width,height});
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>{
      image.loading='eager'; return image.decode();
    })));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow ${width}`);
    assert.equal(await page.locator('h1').count(),1);
    assert.equal(await page.locator('[data-apk-link]').getAttribute('href'),browserApkPath(release));
    assert.equal(await page.locator('[data-apk-link]').getAttribute('download'),browserApkName(release));
    await page.screenshot({path:fileURLToPath(new URL(`hero-${width}.png`,output))});
    await page.screenshot({path:fileURLToPath(new URL(`home-${width}.png`,output)),fullPage:true});
    await page.locator('.header-inner a[href="#download"]').click();
    await page.waitForTimeout(650);
    assert.ok(await page.locator('[data-apk-link]').isVisible());
    await page.locator('.download-card').screenshot({path:fileURLToPath(new URL(`download-${width}.png`,output))});
    await page.locator('.checksum summary').click();
    await page.locator('[data-copy-hash]').click();
    await page.waitForFunction(()=>document.querySelector('[data-hash-status]').textContent==='已复制');
    assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).length,64);
    await page.locator('[data-copy-page]').click();
    await page.waitForFunction(()=>document.querySelector('[data-copy-status]').textContent==='已复制');
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'https://ice-infinite.github.io/');
    await page.locator('.faq-list summary').first().click();
    assert.equal(await page.locator('.faq-list details').first().getAttribute('open'),'');
    await page.goto(`${base}/privacy.html`,{waitUntil:'networkidle'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Privacy overflow ${width}`);
    assert.equal(await page.locator('h1').textContent(),'隐私与内测说明');
    await page.locator('.back-link').click();
    assert.equal(new URL(page.url()).hash,'#download');
    checks.push({width,height,home:true,download:true,copy:true,faq:true,privacy:true,returnToDownload:true});
  }
  const noJs = await browser.newContext({javaScriptEnabled:false});
  const fallback = await noJs.newPage();
  await fallback.goto(base,{waitUntil:'networkidle'});
  assert.equal(await fallback.locator('[data-apk-link]').getAttribute('href'),browserApkPath(release));
  assert.ok(await fallback.locator('[data-apk-link]').isEnabled());
  await noJs.close();
  const mobile = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
    userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',javaScriptEnabled:false});
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(base,{waitUntil:'networkidle'});
  const downloadEvent = mobilePage.waitForEvent('download');
  await mobilePage.locator('[data-apk-link]').click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(),browserApkName(release));
  const stream = await download.createReadStream();
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of stream) {hash.update(chunk);bytes += chunk.length;}
  assert.equal(bytes,release.sizeBytes);assert.equal(hash.digest('hex'),release.sha256);
  await mobile.close();
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
  assert.deepEqual(errors,[]); assert.deepEqual(failures,[]); assert.deepEqual(external,[]);
  const result={status:'passed-local-browser',checks,noJavaScriptDownload:true,androidEmulatedApkDownload:true,downloadFilename:browserApkName(release),downloadBytes:release.sizeBytes,reducedMotion:true,browserErrors:errors,failedResources:failures,externalRequests:external,realUserData:false,apkInstalled:false,physicalPhoneTested:false};
  await writeFile(new URL('browser-verification.json',output),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await browser.close();await new Promise(done=>server.close(done));}
