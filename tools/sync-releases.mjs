import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, validateSource, stableVersion } from './listing.mjs';
import { importRelease } from './import-release.mjs';

const requireThat = (value, message) => { if (!value) throw Error(message); };
export async function syncReleases(root, packageId, tag, fetcher = fetch) {
  const source = validateSource(readJson(path.join(root, 'source.json')));
  const fullSync = !packageId && !tag;
  requireThat(fullSync || (Object.hasOwn(source.packages, packageId) && typeof tag === 'string' && tag.startsWith('v') && stableVersion.test(tag.slice(1))), 'Unknown package or invalid stable release tag.');
  const pending = new Map(fullSync ? [] : [[`${packageId}/${tag}`, { id: packageId, tag }]]);
  for (const [id, entry] of Object.entries(source.packages).sort()) {
    for (let page = 1; ; page++) {
      requireThat(page <= 100, 'Release inventory exceeds the reviewed pagination limit.');
      const response = await fetcher(`https://api.github.com/repos/${entry.repository}/releases?per_page=100&page=${page}`, {
        redirect: 'error', signal: AbortSignal.timeout(30000), headers: {
          Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
        }
      });
      requireThat(response.ok, `Cannot enumerate releases (${response.status}): ${entry.repository}`);
      const bytes = await response.arrayBuffer();
      requireThat(bytes.byteLength <= 8 * 1024 * 1024, 'Release inventory response is too large.');
      const releases = JSON.parse(Buffer.from(bytes).toString('utf8'));
      requireThat(Array.isArray(releases) && releases.length <= 100, 'Invalid release inventory.');
      for (const release of releases) {
        if (release.draft || release.prerelease || typeof release.tag_name !== 'string' ||
            !release.tag_name.startsWith('v') || !stableVersion.test(release.tag_name.slice(1))) continue;
        const version = release.tag_name.slice(1);
        if (fs.existsSync(path.join(root, 'packages', id, `${version}.json`))) continue;
        const names = (release.assets ?? []).map(asset => asset.name);
        const zip = `${id}-${version}.zip`;
        if (!names.includes('package.json') && !names.includes(zip)) continue; // unitypackage-only release
        requireThat(names.filter(name => name === 'package.json').length === 1 && names.filter(name => name === zip).length === 1,
          `VPM release assets are incomplete or ambiguous: ${entry.repository} ${release.tag_name}`);
        pending.set(`${id}/${release.tag_name}`, { id, tag: release.tag_name });
      }
      if (releases.length < 100) break;
    }
  }
  const created = [];
  try {
    for (const candidate of pending.values()) {
      if (await importRelease(root, candidate.id, candidate.tag, fetcher))
        created.push(path.join(root, 'packages', candidate.id, `${candidate.tag.slice(1)}.json`));
    }
    return created;
  } catch (error) {
    // Only remove files created by this invocation; immutable existing records stay intact.
    for (const file of created.reverse()) fs.unlinkSync(file);
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireThat(args.length === 0 || args.length === 2, 'Usage: node tools/sync-releases.mjs [PACKAGE_ID vVERSION]');
    const changed = await syncReleases(path.dirname(path.dirname(fileURLToPath(import.meta.url))), args[0], args[1]);
    console.log(`Verified ${changed.length} new VPM versions across registered repositories.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
