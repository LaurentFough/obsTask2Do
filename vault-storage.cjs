'use strict';
/**= Vault writes use process for conflict checking when files are indexed by Obsidian. */
function vaultStorage(vault, path) {
  return {
    async read() { return await vault.adapter.exists(path) ? vault.adapter.read(path) : ''; },
    async write(content, expected = '') {
      const file = vault.getAbstractFileByPath(path);
      if (file && typeof vault.process === 'function') {
        await vault.process(file, current => { if (current !== expected) throw new Error('File changed. Refresh before trying again.'); return content; });
        return;
      }
      const exists = await vault.adapter.exists(path);
      if ((exists ? await vault.adapter.read(path) : '') !== expected) throw new Error('File changed. Refresh before trying again.');
      const parts = path.split('/'); parts.pop(); let folder = '';
      for (const part of parts) { folder = folder ? folder + '/' + part : part; if (!await vault.adapter.exists(folder)) await vault.createFolder(folder); }
      if (!exists) await vault.create(path, content); else await vault.adapter.write(path, content);
    }
  };
}
module.exports = { vaultStorage };
