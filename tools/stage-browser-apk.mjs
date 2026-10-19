import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, readdir, mkdir, lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const browserApkName = release => `anyao-${release.versionName}-${release.versionCode}-arm64-v8a.apk`;
export const browserApkPath = release => `downloads/${browserApkName(release)}`;
const managedName = /^anyao-\d+\.\d+\.\d+-[1-9]\d*-arm64-v8a\.apk$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function stageBrowserApk(root, previous, release, inputPath, check = false) {
  const name = browserApkName(release);
  if (!managedName.test(name)) throw new Error('Invalid browser APK name.');
  const bytes = await readFile(inputPath);
  if (bytes.length !== release.sizeBytes || digest(bytes) !== release.sha256) throw new Error('Browser APK differs from verified release.');
  const directory = join(root, 'downloads');
  const directoryInfo = await lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (directoryInfo && (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())) throw new Error('Unsafe download directory.');
  const files = directoryInfo ? await readdir(directory, { withFileTypes: true }) : [];
  // On retry, previous metadata already describes the current release. Retain
  // the highest earlier site package rather than pruning it in a second commit.
  const earlier = files.filter(file => managedName.test(file.name))
    .map(file => ({ name: file.name, code: Number(file.name.match(/-(\d+)-arm64-v8a\.apk$/)[1]) }))
    .filter(file => file.code < release.versionCode).sort((a,b) => b.code - a.code)[0];
  const previousName = previous.versionCode < release.versionCode ? browserApkName(previous) : earlier?.name;
  const keep = new Set([name, ...(previousName ? [previousName] : [])]);
  const removed = [];
  let exists = false;
  for (const file of files) {
    if (!managedName.test(file.name)) continue;
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Unsafe managed download file.');
    if (file.name === name) {
      const current = await readFile(join(directory, name));
      if (current.length !== release.sizeBytes || digest(current) !== release.sha256) throw new Error('Same-version browser APK differs.');
      exists = true;
    }
    if (!keep.has(file.name)) removed.push(`downloads/${file.name}`);
  }
  if (!check) {
    await mkdir(directory, { recursive: true });
    if (!exists) {
      const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
      try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, join(directory, name)); }
      finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    for (const file of removed) await unlink(join(root, file));
  }
  return { browserDownloadPath: browserApkPath(release), browserFileChanged: !exists || removed.length > 0, removedBrowserPaths: removed };
}
