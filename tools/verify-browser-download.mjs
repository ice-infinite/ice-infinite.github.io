import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { browserApkPath } from './stage-browser-apk.mjs';

export async function verifyBrowserDownload(release, fetchImpl = fetch) {
  if (!/^\d+\.\d+\.\d+$/.test(release.versionName) || !Number.isSafeInteger(release.versionCode) || release.versionCode < 1 ||
      !Number.isSafeInteger(release.sizeBytes) || release.sizeBytes < 1 || release.sizeBytes > 100_000_000 ||
      !/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error('Invalid public APK metadata.');
  const url = `https://ice-infinite.github.io/${browserApkPath(release)}`;
  const response = await fetchImpl(url, {redirect:'error',signal:AbortSignal.timeout(180_000),headers:{
    'User-Agent':'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
    'Cache-Control':'no-cache',
  }});
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (response.status !== 200 || !['application/vnd.android.package-archive','application/octet-stream'].includes(mime)) {
    await response.body?.cancel(); throw new Error('Browser APK response is unavailable or not APK-compatible.');
  }
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > release.sizeBytes) throw new Error('Browser APK exceeds verified size.');
    hash.update(chunk);
  }
  if (bytes !== release.sizeBytes || hash.digest('hex') !== release.sha256) throw new Error('Browser APK integrity mismatch.');
  return {browserDownloadUrl:url,browserMimeType:mime,sizeBytes:bytes,sha256:release.sha256,verified:true};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let text = '';
    for await (const chunk of process.stdin) {text += chunk;if(text.length > 16384) throw new Error('Oversized input.');}
    console.log(JSON.stringify(await verifyBrowserDownload(JSON.parse(text.replace(/^\uFEFF/,'')))));
  } catch {console.error('Browser download verification failed. Check MIME type, published file and release integrity.');process.exitCode=1;}
}
