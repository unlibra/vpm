import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requireThat = (value, message) => { if (!value) throw Error(message); };
export const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function readJson(file) {
  const stat = fs.lstatSync(file);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024, 'Invalid JSON source file.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function validateSource(source) {
  requireThat(source.name === 'unlibra VPM Repository' && source.id === 'com.unlibra.vpm' &&
    source.url === 'https://docs.unlibra.com/vpm/index.json' && source.author === 'unlibra', 'Invalid repository metadata.');
  requireThat(source.packages && typeof source.packages === 'object', 'Missing package sources.');
  for (const [id, entry] of Object.entries(source.packages)) {
    requireThat(/^com\.unlibra\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id) &&
      /^unlibra\/[a-zA-Z0-9_.-]+$/.test(entry.repository) && typeof entry.displayName === 'string' && entry.displayName.length > 0,
    'Invalid package source.');
  }
  return source;
}
export function validatePackage(manifest, id, version, repository) {
  requireThat(stableVersion.test(version) && manifest.name === id && manifest.version === version,
    'Package identity/version mismatch.');
  requireThat(manifest.url === `https://github.com/${repository}/releases/download/v${version}/${id}-${version}.zip`,
    'Package URL must identify its immutable GitHub Release asset.');
  requireThat(/^[0-9a-f]{64}$/.test(manifest.zipSHA256), 'Missing valid ZIP SHA-256.');
  requireThat(typeof manifest.displayName === 'string' && manifest.displayName.length > 0 &&
    typeof manifest.author?.name === 'string' && typeof manifest.author?.email === 'string' &&
    typeof manifest.license === 'string' && typeof manifest.unity === 'string', 'Incomplete package manifest.');
  requireThat(!['legacyFolders', 'legacyFiles', 'legacyPackages'].some(k => Object.keys(manifest[k] ?? {}).length),
    'Automatic legacy deletion has not been verified for these packages.');
  return manifest;
}
export function listing(root) {
  const source = validateSource(readJson(path.join(root, 'source.json')));
  const packages = {};
  for (const [id, entry] of Object.entries(source.packages).sort()) {
    const versions = {}, directory = path.join(root, 'packages', id);
    if (fs.existsSync(directory)) {
      requireThat(!fs.lstatSync(directory).isSymbolicLink(), 'Linked package directory.');
      for (const filename of fs.readdirSync(directory).sort()) {
        requireThat(filename.endsWith('.json') && stableVersion.test(filename.slice(0, -5)), 'Invalid version filename.');
        const version = filename.slice(0, -5);
        versions[version] = validatePackage(readJson(path.join(directory, filename)), id, version, entry.repository);
      }
    }
    if (Object.keys(versions).length) packages[id] = { versions };
  }
  return { name: source.name, id: source.id, url: source.url, author: source.author, packages };
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function build(root) {
  const result = listing(root), source = readJson(path.join(root, 'source.json'));
  const destination = path.join(root, 'site');
  requireThat(!fs.existsSync(destination) || !fs.lstatSync(destination).isSymbolicLink(), 'Linked output directory.');
  fs.mkdirSync(destination, { recursive: true });
  const versions = Object.keys(result.packages).map(id => `<li>${escape(source.packages[id].displayName)}</li>`).join('');
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>unlibra VPM Repository</title><style>body{font-family:system-ui,sans-serif;max-width:48rem;margin:4rem auto;padding:0 1.5rem;line-height:1.8}a{color:#3651b5}.button{display:inline-block;padding:.7rem 1.2rem;background:#3651b5;color:white;border-radius:.5rem;text-decoration:none}code{overflow-wrap:anywhere}</style><main><h1>unlibra VPM Repository</h1><p>unlibraのUnityツールをVCCから導入・更新できます。</p><p><a class="button" href="vcc://vpm/addRepo?url=${encodeURIComponent(result.url)}">VCCに追加</a></p><p>登録後、使用するプロジェクトのManage Packagesからパッケージを追加してください。</p><h2>配布パッケージ</h2>${versions ? `<ul>${versions}</ul>` : '<p>配布の準備中です。</p>'}<p>手動登録URL：<a href="./index.json"><code>${escape(result.url)}</code></a></p><p><a href="https://github.com/unlibra/vpm">GitHub</a> · <a href="https://unlibra.booth.pm">BOOTH</a></p></main></html>\n`;
  for (const [name, data] of [['index.json', JSON.stringify(result, null, 2) + '\n'], ['index.html', html]]) {
    const file = path.join(destination, name), stat = fs.lstatSync(file, { throwIfNoEntry: false });
    requireThat(!stat || stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Linked output file.');
    fs.writeFileSync(file, data);
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = build(path.dirname(path.dirname(fileURLToPath(import.meta.url)))); console.log(`Built ${Object.keys(result.packages).length} packages.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
