const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const config = { baseUrl: 'https://webservices4.autotask.net/atservicesrest/v1.0/', resourceId: '123', enableWrites: true };
const credentials = { username: 'fixture@example.invalid', secret: 'fixture-secret', integrationCode: 'fixture-key' };
async function harness(saved) {
  const writes = []; let requests = 0;
  class Plugin {
    async loadData() { return saved; }
    async saveData(value) { writes.push(JSON.parse(JSON.stringify(value))); }
    registerView() {} addSettingTab() {} addCommand() {}
  }
  const context = { module: { exports: {} }, URL, console, setTimeout, require: () => ({ Plugin, PluginSettingTab: class {}, Setting: class {}, Modal: class {}, ItemView: class {}, Notice: class {}, requestUrl: async () => { requests++; } }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  const plugin = new context.module.exports(); await plugin.onload();
  return { plugin, writes, requestCount: () => requests };
}
test('remembered credentials restore session without network requests', async () => {
  const { plugin, requestCount } = await harness({ ...config, rememberCredentials: true, savedCredentials: credentials });
  assert.equal(plugin.provider.credentials.secret, credentials.secret);
  assert.equal(plugin.provider.enableWrites, true); assert.equal(requestCount(), 0);
});
test('session-only connection does not persist credential fields', async () => {
  const { plugin, writes } = await harness(config);
  await plugin.connect(credentials, false);
  assert.equal(writes[0].rememberCredentials, false);
  assert.equal(writes[0].savedCredentials, undefined);
  assert.ok(!JSON.stringify(writes).includes(credentials.secret));
});
test('remember then forget removes saved credentials', async () => {
  const { plugin, writes } = await harness(config);
  await plugin.connect(credentials, true); assert.equal(writes[0].savedCredentials.secret, credentials.secret);
  await plugin.connect(credentials, false); assert.equal(writes[1].savedCredentials, undefined);
  assert.equal(plugin.settings.savedCredentials, undefined);
});
test('unremembered or malformed saved credentials do not restore a session', async () => {
  for (const saved of [{ ...config, rememberCredentials: false, savedCredentials: credentials }, { ...config, rememberCredentials: true, savedCredentials: { secret: 42 } }]) {
    const { plugin } = await harness(saved); assert.equal(plugin.provider, null);
  }
});
test('failed persistence preserves active session', async () => {
  const { plugin } = await harness(config); await plugin.connect(credentials, false);
  const old = plugin.provider; plugin.saveData = async () => { throw new Error('disk'); };
  await assert.rejects(plugin.connect({ ...credentials, secret: 'replacement' }, true), /Unable to save/);
  assert.equal(plugin.provider, old); assert.equal(old.credentials.secret, credentials.secret);
});
