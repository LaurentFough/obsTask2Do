'use strict';
/**= Version 0.8.0-alpha.2. Prepare standard Obsidian assets and a portable JSON appcast. */
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
function releaseFeed(root, repository = '') {
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Repository must be owner/name.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.id !== 'task2do' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version)) throw new Error('Invalid Task2Do release manifest.');
  const base = repository ? `https://github.com/${repository}/releases/download/${manifest.version}/` : '';
  const files = Object.fromEntries(['main.js', 'manifest.json', 'styles.css'].map(name => { const bytes = fs.readFileSync(path.join(root, name)); return [name, { url: base + name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }]; }));
  return { schemaVersion: 1, pluginId: manifest.id, version: manifest.version, minAppVersion: manifest.minAppVersion, channel: manifest.version.includes('-') ? 'prerelease' : 'stable', files };
}
if (require.main === module) {
  try {
    const root = __dirname, out = path.join(root, 'release-assets'); fs.mkdirSync(out, { recursive: true });
    const feed = releaseFeed(root, process.env.GITHUB_REPOSITORY || 'LaurentFough/obsTask2Do');
    for (const name of Object.keys(feed.files)) fs.copyFileSync(path.join(root, name), path.join(out, name));
    fs.writeFileSync(path.join(out, 'appcast.json'), JSON.stringify(feed, null, 2) + '\n');
    console.info(JSON.stringify({ event: 'task2do.release-prepared', version: feed.version, channel: feed.channel }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { releaseFeed };
