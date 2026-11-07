'use strict';
/**= Version 1.1.0. Validate the publication version before creating any remote objects. */
const fs = require('node:fs');
const path = require('node:path');
function verifyRelease(root, requestedVersion) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const manifest = read('manifest.json'), pkg = read('package.json'), versions = read('versions.json');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:[0-9a-zA-Z-]*[a-zA-Z-][0-9a-zA-Z-]*|0|[1-9]\d*)(?:\.(?:[0-9a-zA-Z-]*[a-zA-Z-][0-9a-zA-Z-]*|0|[1-9]\d*))*)?$/.test(manifest.version)) throw new Error('Invalid release version.');
  if (manifest.id !== 'task2do' || pkg.name !== 'task2do') throw new Error('Unexpected plugin identity.');
  const requested = requestedVersion == null ? '' : String(requestedVersion).trim();
  if (requested && requested !== manifest.version) throw new Error(`Release version ${JSON.stringify(requested)} must exactly match manifest.json version ${manifest.version}, without a v prefix.`);
  if (pkg.version !== manifest.version) throw new Error('package.json version must match manifest.json.');
  if (versions[manifest.version] !== manifest.minAppVersion) throw new Error('versions.json must map this version to minAppVersion.');
  return manifest.version;
}
if (require.main === module) {
  try {
    const version = verifyRelease(path.join(__dirname, '..'), process.env.RELEASE_VERSION);
    if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `RELEASE_VERSION=${version}\n`);
    console.info(JSON.stringify({ event: 'task2do.release-validated', version }));
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyRelease };
