const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');const crypto=require('node:crypto');const {releaseFeed}=require('../release.cjs');
test('release appcast references only installation assets and hashes their exact bytes',()=>{const root=path.join(__dirname,'..'), feed=releaseFeed(root,'example/task2do');assert.equal(feed.pluginId,'task2do');assert.deepEqual(Object.keys(feed.files),['main.js','manifest.json','styles.css']);assert.ok(feed.files['main.js'].url.includes('/releases/download/'+feed.version+'/main.js'));assert.equal(feed.files['main.js'].sha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'main.js'))).digest('hex'));assert.throws(()=>releaseFeed(root,'https://evil.invalid'),/owner\/name/);});

const { verifyRelease } = require('../scripts/verify-release.cjs');
test('publication rejects version mismatches before remote writes', () => {
  const os = require('node:os'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'task2do-release-'));
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  try {
    write('manifest.json', { id: 'task2do', version: '0.9.0-alpha.2', minAppVersion: '1.7.2' });
    write('package.json', { name: 'task2do', version: '0.9.0-alpha.2' });
    write('versions.json', { '0.9.0-alpha.2': '1.7.2' });
    assert.equal(verifyRelease(root, '0.9.0-alpha.2'), '0.9.0-alpha.2');
    assert.equal(verifyRelease(root, ''), '0.9.0-alpha.2');
    assert.equal(verifyRelease(root), '0.9.0-alpha.2');
    assert.equal(verifyRelease(root, '  0.9.0-alpha.2  '), '0.9.0-alpha.2');
    assert.throws(() => verifyRelease(root, '  9.0-alpha.2'), /9.0-alpha.2.*0.9.0-alpha.2/);
    assert.throws(() => verifyRelease(root, 'v0.9.0-alpha.2'), /exactly match/);
    write('package.json', { name: 'task2do', version: '0.8.0' });
    assert.throws(() => verifyRelease(root, '0.9.0-alpha.2'), /package.json/);
    write('package.json', { name: 'task2do', version: '0.9.0-alpha.2' });
    write('versions.json', {});
    assert.throws(() => verifyRelease(root, '0.9.0-alpha.2'), /versions.json/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
