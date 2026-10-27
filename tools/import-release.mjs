import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, validateSource, validatePackage, stableVersion } from './listing.mjs';
import { verifyArchive } from './archive.mjs';

const requireThat = (value, message) => { if (!value) throw Error(message); };
async function download(fetcher, url, limit, headers = {}) {
  const response = await fetcher(url, { headers, signal: AbortSignal.timeout(30000) });
  requireThat(response.ok, `Download failed (${response.status}): ${url}`);
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    requireThat(total <= limit, 'Release asset exceeds size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function importRelease(root, id, tag, fetcher = fetch) {
  const source = validateSource(readJson(path.join(root, 'source.json'))), entry = Object.hasOwn(source.packages, id) ? source.packages[id] : null;
  requireThat(entry && tag.startsWith('v') && stableVersion.test(tag.slice(1)), 'Unknown package or invalid stable release tag.');
  const api = `https://api.github.com/repos/${entry.repository}/releases/tags/${tag}`;
  const release = JSON.parse(await download(fetcher, api, 2 * 1024 * 1024, {
    Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
  }));
  requireThat(release.tag_name === tag && !release.draft && !release.prerelease, 'Release is not a published stable release.');
  const version = tag.slice(1), zipName = `${id}-${version}.zip`;
  function asset(name) {
    const matches = release.assets?.filter(a => a.name === name) ?? [];
    requireThat(matches.length === 1 && matches[0].browser_download_url === `https://github.com/${entry.repository}/releases/download/${tag}/${name}`, 'Release asset missing or ambiguous.');
    return matches[0].browser_download_url;
  }
  const manifestBytes = await download(fetcher, asset('package.json'), 1024 * 1024);
  const manifest = JSON.parse(manifestBytes);
  requireThat(!('zipSHA256' in manifest), 'ZIP hash belongs in the listing, not the package manifest.');
  const zip = await download(fetcher, asset(zipName), 64 * 1024 * 1024);
  verifyArchive(zip, manifestBytes);
  // Each immutable version records the exact ZIP digest, never a moving latest URL.
  manifest.zipSHA256 = createHash('sha256').update(zip).digest('hex');
  validatePackage(manifest, id, version, entry.repository);
  const directory = path.join(root, 'packages', id), target = path.join(directory, `${version}.json`);
  requireThat(!fs.existsSync(directory) || !fs.lstatSync(directory).isSymbolicLink(), 'Linked package directory.');
  const bytes = JSON.stringify(manifest, null, 2) + '\n';
  if (fs.existsSync(target)) {
    requireThat(JSON.stringify(readJson(target)) === JSON.stringify(manifest), 'Published version is immutable; create a new release version.');
    return false;
  }
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireThat(args.length === 2, 'Usage: node tools/import-release.mjs PACKAGE_ID vVERSION');
    const changed = await importRelease(path.dirname(path.dirname(fileURLToPath(import.meta.url))), args[0], args[1]);
    console.log(changed ? 'Imported verified release. Review and commit the new version.' : 'Version already recorded unchanged.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
