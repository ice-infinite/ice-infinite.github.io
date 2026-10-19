import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateRelease, renderRelease, androidLabel, browserApkPath, browserApkName } from '../tools/sync-release.mjs';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const privacy = await readFile(new URL('privacy.html', root), 'utf8');
const release = JSON.parse(await readFile(new URL('assets/release.json', root), 'utf8'));

test('download exactly matches verified internal-release metadata', () => {
  validateRelease(release);
  assert.equal(release.testRelease, true);
  assert.equal(release.usageStatisticsDefaultEnabled, true);
  assert.ok(Number.isSafeInteger(release.minSdk) && release.minSdk >= 21);
  assert.equal(release.abi, 'arm64-v8a');
  assert.ok(html.includes(`href="${browserApkPath(release)}"`));
  assert.ok(html.includes(`download="${browserApkName(release)}"`));
  assert.ok(html.includes(`data-source-url="${release.downloadUrl}"`));
  assert.ok(html.includes(`href="${release.releaseUrl}"`));
  assert.ok(html.includes(release.sha256));
  assert.ok(html.includes(`<!-- release:code -->${release.versionCode}<!-- /release:code -->`));
});

test('no runtime framework, cloud API, telemetry or external scripts', () => {
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.ok(!html.includes('onclick='));
  assert.ok(!html.includes('nip.io'));
  for (const script of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assert.ok(script[1].startsWith('assets/'));
  assert.ok(!/https?:\/\/[^"\s]+\.(?:js|css)(?:["\s])/i.test(html));
});

test('Baidu is an explicit manual mirror, separate from the primary APK and App update URL', () => {
  const link = html.match(/<a\b[^>]*\bdata-baidu-link\b[^>]*>/)?.[0];
  assert.ok(link);
  assert.ok(link.includes('href="https://pan.baidu.com/s/1VgezqwZ6GRLz_LqW5CxHLg?pwd=1234"'));
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  assert.ok(!link.includes('download='));
  assert.ok(!link.includes('data-apk-link'));
  for (const text of ['GitHub 直接下载 APK', '提取码：<strong>1234</strong>', '版本以文件名为准', 'App 内更新仍通过 Gitee']) assert.ok(html.includes(text), text);
  assert.ok(privacy.includes('不参与一键发布'));
  assert.ok(privacy.includes('不会自动连接百度网盘'));
  assert.ok(!JSON.stringify(release).includes('pan.baidu.com'));
});

test('honest capabilities, explicit internal collection default and no medical promise', () => {
  for (const text of ['测试签名','不是正式版','默认开启基础使用统计','演示数据','不提供诊断或用药建议','尚未完成或销售','暂时隐藏']) assert.ok(html.includes(text), text);
  for (const text of ['90天','7天','不等于精准使用人数','默认开启','允许基础使用统计','本机','云同步']) assert.ok(privacy.includes(text), text);
});

test('every local href, src and symbol exists; IDs are unique', async () => {
  for (const [name, source] of [['index.html',html],['privacy.html',privacy]]) {
    const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
    assert.equal(new Set(ids).size, ids.length, name);
    for (const match of source.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const value = match[1];
      if (value.startsWith('https://')) continue;
      const [file, anchor] = value.split('#');
      if (file && file !== './') await access(new URL(file, root));
      if (file === '' && anchor) assert.ok(ids.includes(anchor), `${name}: ${anchor}`);
      if (file === 'assets/icons.svg' && anchor) {
        assert.ok((await readFile(new URL(file,root),'utf8')).includes(`id="${anchor}"`));
      }
    }
  }
});

test('static images carry alternative text, dimensions and demo attribution', () => {
  for (const source of [html,privacy]) {
    for (const match of source.matchAll(/<img\b[^>]*>/g)) {
      assert.match(match[0], /\balt="[^"]*"/);
      assert.match(match[0], /\bwidth="\d+"/);
      assert.match(match[0], /\bheight="\d+"/);
    }
  }
  assert.match(html, /实际运行截图，使用合成演示数据/);
});

test('existing HTML works as a complete download page with JavaScript disabled', () => {
  assert.match(html, /<a[^>]+data-apk-link[^>]+href="downloads\/[^"/]+\.apk"[^>]+download="[^"/]+\.apk"/);
  assert.match(html, /<a[^>]+href="privacy\.html"/);
  assert.match(html, /<details/);
  assert.ok(html.includes(androidLabel(release.minSdk)));
});

test('QR is a local static SVG, not a remote QR-generation tracker', async () => {
  const qr = await readFile(new URL('assets/download-qr.svg', root),'utf8');
  assert.match(qr, /<svg/);
  assert.ok(!qr.includes('<script'));
  const generator = await readFile(new URL('tools/generate-qr.mjs',root),'utf8');
  assert.ok(generator.includes("'https://ice-infinite.github.io/'"));
});

test('future release stamping updates all version fields and preserves disclosure', () => {
  const parts=release.versionName.split('.').map(Number);
  parts[2]++;
  const versionName=parts.join('.'), versionCode=release.versionCode+1;
  const next = {...release,versionName,versionCode,sizeBytes:46_000_000,
    sha256:'a'.repeat(64),publishedAt:'2026-10-20T10:00:00Z',
    downloadUrl:`https://gitee.com/ice_infinite/anyao-releases/releases/download/v${versionName}-arm64-test.1/anyao-${versionName}-${versionCode}-arm64-v8a.apk`,
    releaseUrl:`https://gitee.com/ice_infinite/anyao-releases/releases/tag/v${versionName}-arm64-test.1`};
  const updated = renderRelease(html, release, next);
  assert.ok(updated.includes(next.downloadUrl));
  assert.ok(updated.includes(next.sha256));
  assert.ok(updated.includes('<!-- release:size -->46.00 MB<!-- /release:size -->'));
  assert.ok(!updated.includes(release.downloadUrl));
  assert.ok(!updated.includes(`<!-- release:version -->${release.versionName}<!--`));
  assert.ok(updated.includes('默认开启基础使用统计'));
  assert.ok(updated.includes('https://pan.baidu.com/s/1VgezqwZ6GRLz_LqW5CxHLg?pwd=1234'));
  assert.ok(updated.includes('提取码：<strong>1234</strong>'));
  assert.ok(updated.includes('网盘内容由作者手动维护，版本以文件名为准'));
});

test('version renderer fails closed for absent markers', () => assert.throws(()=>renderRelease('no markers',release,release)));

for (const [label, patch] of [
  ['external APK', {downloadUrl:'https://example.com/anyao.apk'}],
  ['credential in URL', {downloadUrl:release.downloadUrl.replace('https://','https://token@')}],
  ['HTTP', {downloadUrl:release.downloadUrl.replace('https://','http://')}],
  ['fragment', {downloadUrl:release.downloadUrl+'#hash'}],
  ['oversized', {sizeBytes:100_000_001}],
  ['invalid hash', {sha256:'invalid'}],
  ['wrong version', {versionName:'../../invalid'}],
]) test(`release validation rejects ${label}`,()=>assert.throws(()=>validateRelease({...release,...patch})));

test('only reviewed synthetic screenshot files are shipped', async () => {
  assert.deepEqual((await readdir(new URL('assets/screens/',root))).sort(), ['cabinet-picker.png','entry.png','home.png']);
});

test('same-origin browser APK exactly matches the verified Gitee package', async () => {
  const bytes = await readFile(new URL(browserApkPath(release), root));
  assert.equal(bytes.length, release.sizeBytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), release.sha256);
});
