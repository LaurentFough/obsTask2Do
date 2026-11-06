'use strict';
/**= Version 0.8.0-alpha.2. Moovila's published PublicAPI Report endpoints are read-only. */
function moovilaConfig(config) {
  const base = new URL(config.baseUrl || 'https://api.moovila.com');
  if (base.origin !== 'https://api.moovila.com' || !['/', '/PublicAPI', '/PublicAPI/'].includes(base.pathname) || base.username || base.password || base.search || base.hash) throw new Error('Use https://api.moovila.com for Moovila.');
  if (typeof config.token !== 'string' || !config.token.trim() || /\s/.test(config.token)) throw new Error('Enter a Moovila bearer access token.');
  return { baseUrl: base.origin, token: config.token.trim() };
}
class MoovilaProvider {
  constructor(config, transport, log = () => {}) { this.id = 'moovila'; this.config = moovilaConfig(config); this.transport = transport; this.log = log; this.disposed = false; this.capabilities = Object.freeze({ read: true, create: false, update: false, complete: false, reopen: false, comment: false }); }
  dispose() { this.disposed = true; this.config.token = ''; }
  async report(entity) {
    if (!['Task', 'Project', 'User'].includes(entity)) throw new Error('Unsupported Moovila report.');
    const result = [], seen = new Set();
    for (let page = 0; page < 1000; page++) {
      if (this.disposed) throw new Error('Moovila disconnected.');
      let response; try { response = await this.transport({ url: `${this.config.baseUrl}/PublicAPI/Report/${entity}?offset=${page*100}&limit=100`, method: 'GET', headers: { Authorization: `Bearer ${this.config.token}`, Accept: 'application/json' }, throw: false }); } catch { throw new Error('Moovila request failed. Check connection.'); }
      this.log({ event: 'moovila.report', entity, status: response.status, page: page+1 });
      if (response.status < 200 || response.status >= 300) throw new Error(response.status === 401 ? 'Moovila token expired or rejected. Connect with a new vendor-issued token.' : `Moovila returned HTTP ${response.status}. Check API access.`);
      if (!Array.isArray(response.json)) throw new Error('Moovila returned an unexpected report format.');
      for (const item of response.json) { if (typeof item.id !== 'string' || !item.id || seen.has(item.id)) throw new Error('Invalid or repeated Moovila record.'); seen.add(item.id); result.push(item); }
      if (response.json.length < 100) return result;
    }
    throw new Error('Moovila pagination limit reached.');
  }
  async list() {
    const projects = await this.report('Project'), tasks = await this.report('Task');
    const names = new Map(projects.map(p => [p.id, p.name]));
    return tasks.filter(t => !t.isDeleted).map(t => ({ provider: this.id, remoteId: t.id, title: t.name || '', description: t.descr || '', listId: t.projectID, listName: names.get(t.projectID) || `Project #${t.projectID}`, assigneeName: t.ownerUser?.name || 'Unassigned', start: t.startDate, due: t.dueDate, completed: !!t.completionDate || Number(t.percentageComplete) >= 100, statusName: t.customStatus?.name || t.status?.name || '', modified: t.updatedDate }));
  }
}
module.exports = { MoovilaProvider, moovilaConfig };
