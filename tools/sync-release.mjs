// After publishing an approved internal APK, use a PUBLIC stable.json file:
// npm run sync-release -- --manifest C:/path/to/stable.json
// This only updates local static files. It never reads credentials or pushes Git.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
export function validateRelease(value) {
  if (!value || !/^\d+\.\d+\.\d+$/.test(value.versionName) ||
      !Number.isSafeInteger(value.versionCode) || value.versionCode < 1 ||
      !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 100_000_000 ||
      !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isFinite(Date.parse(value.publishedAt))) {
    throw new Error('Invalid release version, date, size or SHA-256.');
  }
  const url = new URL(value.downloadUrl);
  const expected = `https://gitee.com/ice_infinite/anyao-releases/releases/download/v${value.versionName}-arm64-test.1/anyao-${value.versionName}-${value.versionCode}-arm64-v8a.apk`;
  if (url.href !== expected || value.downloadUrl !== expected) {
    throw new Error('Only the exact configured ARM64 internal-release URL is permitted.');
  }
  return value;
}

export function renderRelease(html, previous, next) {
  validateRelease(next);
  const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai'}).format(new Date(next.publishedAt));
  const values = {version:next.versionName, code:String(next.versionCode), size:`${(next.sizeBytes / 1e6).toFixed(2)} MB`, date, sha256:next.sha256};
  for (const [key, value] of Object.entries(values)) {
    const expression = new RegExp(`(<!-- release:${key} -->).*?(<!-- /release:${key} -->)`, 'g');
    if (!expression.test(html)) throw new Error(`Missing HTML release marker: ${key}`);
    html = html.replace(expression, (_, open, close) => open + value + close);
  }
  return html.replaceAll(previous.downloadUrl, next.downloadUrl).replaceAll(previous.releaseUrl, next.releaseUrl);
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--manifest') {
    throw new Error('Usage: npm run sync-release -- --manifest <public stable.json path>');
  }
  const previous = JSON.parse(await readFile(new URL('assets/release.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(process.argv[3]), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.mandatory !== false || manifest.versionCode <= previous.versionCode) {
    throw new Error('Requires a newer optional schema-v1 internal update; no downgrade or forced update.');
  }
  const next = validateRelease({...previous,
    versionName:manifest.versionName, versionCode:manifest.versionCode,
    sizeBytes:manifest.sizeBytes, sha256:manifest.sha256, publishedAt:manifest.publishedAt,
    downloadUrl:manifest.downloadUrl,
    releaseUrl:`https://gitee.com/ice_infinite/anyao-releases/releases/tag/v${manifest.versionName}-arm64-test.1`,
  });
  const html = renderRelease(await readFile(new URL('index.html', root), 'utf8'), previous, next);
  await writeFile(new URL('index.html', root), html);
  await writeFile(new URL('assets/release.json', root), JSON.stringify(next, null, 2) + '\n');
  console.log(`Local static page updated to ${next.versionName}+${next.versionCode}. Verify APK compatibility/privacy, run npm test and npm run qa before committing. Nothing was uploaded.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {console.error('Release sync stopped. Check the public manifest and command arguments; no credentials were read.'); process.exitCode=1;});
}
