// Manual: npm run sync-release -- --manifest C:/path/to/public-stable.json
// Verified publishing bridge: node tools/sync-release.mjs --release-stdin [--check]
// This tool only updates this checkout. Git pushes belong to the publishing bridge.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function androidLabel(minSdk) {
  const versions = {21:'5.0',22:'5.1',23:'6.0',24:'7.0',25:'7.1',26:'8.0',27:'8.1',
    28:'9',29:'10',30:'11',31:'12',32:'12L',33:'13',34:'14',35:'15',36:'16'};
  return versions[minSdk] ? `Android ${versions[minSdk]}+` : `Android API ${minSdk}+`;
}

export function validateRelease(value) {
  if (!value || typeof value.versionName !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.versionName) ||
      !Number.isSafeInteger(value.versionCode) || value.versionCode < 1 ||
      !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 100_000_000 ||
      !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.publishedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.publishedAt)) ||
      !Number.isSafeInteger(value.minSdk) || value.minSdk < 21 || value.minSdk > 99 ||
      value.abi !== 'arm64-v8a' || value.testRelease !== true ||
      value.usageStatisticsDefaultEnabled !== true) {
    throw new Error('Release metadata or internal privacy policy requires review.');
  }
  const expected = `https://gitee.com/ice_infinite/anyao-releases/releases/download/v${value.versionName}-arm64-test.1/anyao-${value.versionName}-${value.versionCode}-arm64-v8a.apk`;
  if (value.downloadUrl !== expected ||
      value.releaseUrl !== `https://gitee.com/ice_infinite/anyao-releases/releases/tag/v${value.versionName}-arm64-test.1` ||
      value.downloadPage !== 'https://ice-infinite.github.io/') {
    throw new Error('Only the configured website and exact ARM64 internal-release URLs are permitted.');
  }
  return value;
}

export function renderRelease(html, previous, next) {
  validateRelease(next);
  const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai'}).format(new Date(next.publishedAt));
  const values = {version:next.versionName, code:String(next.versionCode),
    size:`${(next.sizeBytes / 1e6).toFixed(2)} MB`, date, sha256:next.sha256,
    android:androidLabel(next.minSdk)};
  for (const [key, value] of Object.entries(values)) {
    const expression = new RegExp(`(<!-- release:${key} -->).*?(<!-- /release:${key} -->)`, 'g');
    if (!expression.test(html)) throw new Error(`Missing HTML release marker: ${key}`);
    html = html.replace(expression, (_, open, close) => open + value + close);
  }
  return html.replaceAll(previous.downloadUrl, next.downloadUrl).replaceAll(previous.releaseUrl, next.releaseUrl);
}

const versionParts = value => value.split('.').map(Number);
function isOlderName(next, previous) {
  const a = versionParts(next), b = versionParts(previous);
  for (let i=0; i<3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

export function planRelease(previous, html, input) {
  validateRelease(previous);
  // Explicit allowlist: receipt paths, credentials and unknown properties never reach the site.
  const next = {
    versionName:input.versionName, versionCode:input.versionCode, sizeBytes:input.sizeBytes,
    sha256:input.sha256, downloadUrl:input.downloadUrl,
    releaseUrl:`https://gitee.com/ice_infinite/anyao-releases/releases/tag/v${input.versionName}-arm64-test.1`,
    publishedAt:input.publishedAt, minSdk:input.minSdk, abi:input.abi,
    testRelease:input.testRelease, usageStatisticsDefaultEnabled:input.usageStatisticsDefaultEnabled,
    downloadPage:'https://ice-infinite.github.io/',
  };
  validateRelease(next);
  // PowerShell and Node may serialize the same instant differently. Preserve the
  // original representation so a harmless date round-trip never creates a commit.
  if (Date.parse(next.publishedAt) === Date.parse(previous.publishedAt)) next.publishedAt = previous.publishedAt;
  if (next.versionCode < previous.versionCode || isOlderName(next.versionName, previous.versionName)) {
    throw new Error('Website downgrade rejected.');
  }
  const same = Object.keys(next).every(key => next[key] === previous[key]);
  if (next.versionCode === previous.versionCode && !same) {
    throw new Error('The same version code cannot refer to different release metadata.');
  }
  const rendered = renderRelease(html, previous, next);
  if (!rendered.includes(`href="${next.downloadUrl}"`) || !rendered.includes(`href="${next.releaseUrl}"`)) {
    throw new Error('Missing actual download or release-page link.');
  }
  return {next, html:rendered, changed:rendered !== html || !same};
}

function parseJson(text) { return JSON.parse(text.replace(/^\uFEFF/,'')); }

async function main() {
  const args = process.argv.slice(2);
  const root = new URL('../',import.meta.url);
  const previous = parseJson(await readFile(new URL('assets/release.json', root),'utf8'));
  let input, check = false;
  if (args.length === 2 && args[0] === '--manifest') {
    const manifest = parseJson(await readFile(resolve(args[1]),'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.mandatory !== false) throw new Error('Optional schema-v1 manifest required.');
    // Manual manifest mode keeps the reviewed compatibility/privacy policy.
    input = {...previous, versionName:manifest.versionName, versionCode:manifest.versionCode,
      sizeBytes:manifest.sizeBytes, sha256:manifest.sha256,
      publishedAt:manifest.publishedAt, downloadUrl:manifest.downloadUrl};
  } else if (args[0] === '--release-stdin' && (args.length === 1 || (args.length === 2 && args[1] === '--check'))) {
    check = args.length === 2;
    let text = '';
    for await (const chunk of process.stdin) { text += chunk; if (text.length > 16384) throw new Error('Oversized metadata.'); }
    input = parseJson(text);
  } else throw new Error('Use --manifest <public stable.json path> or --release-stdin [--check].');

  const plan = planRelease(previous, await readFile(new URL('index.html',root),'utf8'), input);
  if (plan.changed && !check) {
    await writeFile(new URL('index.html',root),plan.html);
    await writeFile(new URL('assets/release.json',root),JSON.stringify(plan.next,null,2)+'\n');
  }
  console.log(JSON.stringify({status:plan.changed ? (check ? 'would-update':'updated'):'current',
    changed:plan.changed, versionName:plan.next.versionName, versionCode:plan.next.versionCode,
    sizeBytes:plan.next.sizeBytes, sha256:plan.next.sha256, downloadUrl:plan.next.downloadUrl,
    minSdk:plan.next.minSdk, android:androidLabel(plan.next.minSdk)}));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(()=>{console.error('Release sync stopped: check metadata, version order, privacy policy and HTML markers. No credentials were read.');process.exitCode=1;});
}
