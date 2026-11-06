const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('release loads with only the Obsidian host module available', async () => {
  const imports = [], commands = [];
  class Plugin {
    async loadData() { return null; }
    registerView() {}
    addSettingTab() {}
    addCommand(command) { commands.push(command); }
  }
  class PluginSettingTab {}
  class Modal {}
  class ItemView {}
  const context = {
    module: { exports: {} },
    require(name) {
      imports.push(name);
      if (name !== 'obsidian') throw new Error(`Cannot find module '${name}'`);
      return { Plugin, PluginSettingTab, Setting: class {}, Modal, ItemView };
    },
    console, URL, setTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  assert.deepEqual(imports, ['obsidian']);
  const plugin = new context.module.exports();
  await plugin.onload();
  assert.equal(commands.length, 23);
  assert.equal(plugin.provider, null);
  plugin.onunload();
});
