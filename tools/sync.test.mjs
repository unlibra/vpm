import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { crc32 } from 'node:zlib';
import { syncReleases } from './sync-releases.mjs';
import { listing } from './listing.mjs';

const id = 'com.unlibra.mururu-blink-lipsync', repo = 'unlibra/mururu-blink-lipsync';
const source = { name: 'unlibra VPM Repository', id: 'com.unlibra.vpm', url: 'https://docs.unlibra.com/vpm/index.json', author: 'unlibra', packages: { [id]: { repository: repo, displayName: 'Mururu Blink & LipSync' } } };
const json = value => new Response(JSON.stringify(value));
function fixture(t, config = source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unlibra-sync-'));
  fs.writeFileSync(path.join(root, 'source.json'), JSON.stringify(config));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('unlibra-sync-')); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function manifest(packageId, repository, version) {
  return { name: packageId, version, displayName: 'Tool', author: { name: 'unlibra', email: '63234154+unlibra@users.noreply.github.com' }, license: 'SEE LICENSE IN LICENSE.txt', unity: '2022.3', url: `https://github.com/${repository}/releases/download/v${version}/${packageId}-${version}.zip` };
}
function release(packageId, repository, version, changes = {}) {
  return { tag_name: `v${version}`, draft: false, prerelease: false, assets: ['package.json', `${packageId}-${version}.zip`].map(name => ({ name, browser_download_url: `https://github.com/${repository}/releases/download/v${version}/${name}` })), ...changes };
}
function archive(bytes) {
  const files = new Map([['package.json', bytes], ['LICENSE.txt', Buffer.from('license')], ['NOTICE.txt', Buffer.from('notice')]]);
  let offset = 0; const chunks = [], entries = [];
  for (const [name, value] of files) {
    const encoded = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), crc = crc32(value);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(value.length, 18); local.writeUInt32LE(value.length, 22); local.writeUInt16LE(encoded.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(value.length, 20); central.writeUInt32LE(value.length, 24); central.writeUInt16LE(encoded.length, 28); central.writeUInt32LE(offset, 42);
    chunks.push(local, encoded, value); entries.push(central, encoded); offset += 30 + encoded.length + value.length;
  }
  const directory = Buffer.concat(entries), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
function remote(config, pages, { corruptVersion } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.hostname === 'api.github.com') {
      const match = parsed.pathname.match(/^\/repos\/(unlibra\/[^/]+)\/releases(?:\/tags\/(v\d+\.\d+\.\d+))?$/);
      assert.ok(match, `Unexpected API request: ${url}`);
      const [packageId] = Object.entries(config.packages).find(([, entry]) => entry.repository === match[1]);
      if (match[2]) return json(release(packageId, match[1], match[2].slice(1)));
      return json(pages[`${match[1]}:${parsed.searchParams.get('page')}`] ?? []);
    }
    assert.equal(options.headers.Authorization, undefined);
    const match = parsed.pathname.match(/^\/(unlibra\/[^/]+)\/releases\/download\/v(\d+\.\d+\.\d+)\/([^/]+)$/);
    assert.ok(match);
    const [packageId] = Object.entries(config.packages).find(([, entry]) => entry.repository === match[1]);
    const bytes = Buffer.from(JSON.stringify(manifest(packageId, match[1], match[2])));
    return new Response(match[3] === 'package.json' ? bytes : match[2] === corruptVersion ? Buffer.from('not a zip') : archive(bytes));
  };
  return { fetcher, calls };
}
test('a notification imports the entire backlog across registered products', async t => {
  const second = 'com.unlibra.other-tool', secondRepo = 'unlibra/other-tool';
  const config = { ...source, packages: { ...source.packages, [second]: { repository: secondRepo, displayName: 'Other' } } };
  const root = fixture(t, config);
  const { fetcher } = remote(config, { [`${repo}:1`]: [release(id, repo, '1.2.1'), release(id, repo, '1.2.0')], [`${secondRepo}:1`]: [release(second, secondRepo, '1.0.0')] });
  assert.equal((await syncReleases(root, id, 'v1.2.0', fetcher)).length, 3);
  assert.equal(Object.keys(listing(root).packages[id].versions).length, 2);
  assert.equal(listing(root).packages[second].versions['1.0.0'].name, second);
  assert.equal((await syncReleases(root, id, 'v1.2.0', fetcher)).length, 0);
});
test('pagination finds missed older VPM versions and ignores legacy, draft and prerelease releases', async t => {
  const root = fixture(t);
  const legacy = Array.from({ length: 100 }, (_, i) => release(id, repo, `0.0.${i}`, { assets: [] }));
  const { fetcher, calls } = remote(source, { [`${repo}:1`]: legacy, [`${repo}:2`]: [release(id, repo, '1.1.0'), release(id, repo, '2.0.0', { draft: true }), release(id, repo, '3.0.0', { prerelease: true })] });
  await syncReleases(root, id, 'v1.2.0', fetcher);
  assert.ok(calls.some(url => url.endsWith('page=2')));
  assert.deepEqual(Object.keys(listing(root).packages[id].versions), ['1.1.0', '1.2.0']);
});
test('incomplete inventory and HTTP errors never leave a partially imported version', async t => {
  const root = fixture(t);
  const incomplete = release(id, repo, '1.2.1'); incomplete.assets.pop();
  await assert.rejects(syncReleases(root, id, 'v1.2.0', remote(source, { [`${repo}:1`]: [incomplete] }).fetcher), /incomplete/);
  assert.ok(!fs.existsSync(path.join(root, 'packages')));
  await assert.rejects(syncReleases(root, id, 'v1.2.0', async () => new Response('{}', { status: 403 })), /403/);
});
test('a corrupt backlog ZIP rolls back only newly created records', async t => {
  const root = fixture(t), directory = path.join(root, 'packages', id); fs.mkdirSync(directory, { recursive: true });
  const previous = JSON.stringify({ ...manifest(id, repo, '1.1.0'), zipSHA256: 'a'.repeat(64) }) + '\n';
  fs.writeFileSync(path.join(directory, '1.1.0.json'), previous);
  const { fetcher } = remote(source, { [`${repo}:1`]: [release(id, repo, '1.2.1')] }, { corruptVersion: '1.2.1' });
  await assert.rejects(syncReleases(root, id, 'v1.2.0', fetcher), /ZIP/);
  assert.equal(fs.readFileSync(path.join(directory, '1.1.0.json'), 'utf8'), previous);
  assert.ok(!fs.existsSync(path.join(directory, '1.2.0.json')));
});
test('unknown packages and invalid tags stop before contacting GitHub', async t => {
  const root = fixture(t), fetcher = async () => { throw Error('must not fetch'); };
  await assert.rejects(syncReleases(root, 'com.other.tool', 'v1.2.0', fetcher), /Unknown/);
  await assert.rejects(syncReleases(root, id, '../../escape', fetcher), /invalid/);
});

test('a surviving main publication recovers releases whose pending notifications were cancelled', async t => {
  const root = fixture(t);
  const { fetcher } = remote(source, { [`${repo}:1`]: [release(id, repo, '1.2.0'), release(id, repo, '1.2.1')] });
  assert.equal((await syncReleases(root, '', '', fetcher)).length, 2);
  assert.equal((await syncReleases(root, undefined, undefined, fetcher)).length, 0);
  const workflowRoot = path.resolve(import.meta.dirname, '..', '.github', 'workflows');
  const sync = fs.readFileSync(path.join(workflowRoot, 'sync.yml'), 'utf8');
  const validation = fs.readFileSync(path.join(workflowRoot, 'listing.yml'), 'utf8');
  assert.match(sync, /push:\s+branches: \[main\]/);
  assert.match(sync, /workflow_dispatch:/);
  assert.match(sync, /node tools\/sync-releases\.mjs "\$PACKAGE_ID" "\$RELEASE_TAG"/);
  assert.doesNotMatch(validation, /actions\/deploy-pages/);
  assert.doesNotMatch(validation, /group: vpm-listing-/);
});

test('an empty initial catalog can be published and partial notification inputs are rejected', async t => {
  const root = fixture(t);
  assert.deepEqual(await syncReleases(root, '', '', remote(source, {}).fetcher), []);
  assert.ok(!fs.existsSync(path.join(root, 'packages')));
  const fetcher = async () => { throw Error('must not fetch'); };
  await assert.rejects(syncReleases(root, id, '', fetcher), /invalid/);
  await assert.rejects(syncReleases(root, '', 'v1.2.0', fetcher), /Unknown/);
});
