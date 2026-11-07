'use strict';
/**= Version 0.9.0-alpha.2. Provider bundled locally; no runtime dependency installation required. */
const { Plugin, PluginSettingTab, Setting: HostSetting, setTooltip, Modal, ItemView, Notice, requestUrl } = require('obsidian');
//= BEGIN BUNDLED CORE
const { AutotaskToDoProvider } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.8.0-alpha.2. Provider core has no dependency on Obsidian. */
function positiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Enter a positive integer Resource ID.');
  return Number(value);
}
/**= Autotask's own organization can use company ID zero. */
function companyIdValue(value) {
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Enter a valid company ID.');
  return Number(value);
}
/**= Restrict credentials and continuation requests to an official REST origin. */
function apiBase(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !/^webservices\d*\.autotask\.net$/.test(u.hostname) || u.port || u.username || u.password || u.search || u.hash || !/^\/atservicesrest\/v1\.0\/?$/i.test(u.pathname)) throw new Error('Use your official Autotask Zone REST URL ending /atservicesrest/v1.0/.');
  return u.origin + '/atservicesrest/v1.0/';
}
class AutotaskToDoProvider {
  /**= Transport and logger are injected for future providers and deterministic tests. */
  constructor(config, credentials, transport, log = () => {}, pause = ms => new Promise(r => setTimeout(r, ms))) {
    this.base = apiBase(config.baseUrl);
    this.resourceId = positiveId(config.resourceId);
    this.creatorResourceId = config.creatorResourceId ? positiveId(config.creatorResourceId) : this.resourceId;
    this.apiResourceId = config.apiResourceId ? positiveId(config.apiResourceId) : null;
    this.creatorResourceIds = [this.creatorResourceId]; this.apiUserLookup = null;
    for (const key of ['username', 'secret', 'integrationCode']) if (typeof credentials[key] !== 'string' || !credentials[key].trim() || /[\r\n]/.test(credentials[key])) throw new Error('All three credential fields are required.');
    this.credentials = { ...credentials }; this.transport = transport; this.log = log; this.pause = pause;
    this.id = 'autotask-todo';
    this.enableWrites = config.enableWrites === true;
    this.pending = new Set();
    this.nameCache = new Map();
    this.capabilities = Object.freeze({ read: true, create: this.enableWrites, update: this.enableWrites, complete: this.enableWrites, reopen: this.enableWrites, changeCompany: this.enableWrites, comment: false });
  }
  dispose() { this.credentials = null; }
  async request(url, method, body, readOnly = true) {
    if (!this.credentials) throw new Error('Connect again; the session has ended.');
    const target = new URL(url, this.base);
    if (target.origin !== new URL(this.base).origin || target.username || target.password || !target.pathname.toLowerCase().startsWith('/atservicesrest/v1.0/')) throw new Error('Rejected an unexpected pagination URL.');
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await this.transport({ url: target.href, method, headers: { Username: this.credentials.username, Secret: this.credentials.secret, APIIntegrationCode: this.credentials.integrationCode, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), throw: false });
      } catch { throw new Error(readOnly ? 'Network request failed. Check connectivity and refresh; credentials were not logged.' : 'Write outcome unknown. Check Autotask and refresh before attempting again.'); }
      this.log({ event: 'autotask.request', status: response.status, attempt: attempt + 1 });
      if (readOnly && (response.status === 429 || response.status >= 500) && attempt < 2) {
        const seconds = Number(response.headers?.['retry-after']);
        await this.pause(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30000) : 1000 * 2 ** attempt); continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`Autotask returned HTTP ${response.status}. ${readOnly ? 'Check API credentials, permissions or rate limits.' : 'Write was not retried. Check Autotask and refresh before attempting again.'}`);
      if (!response.json || typeof response.json !== 'object') throw new Error('Unexpected API response.');
      return response.json;
    }
  }
  /**= Write only specified fields; never PUT a complete record or retry a write. */
  async update(snapshot, changes, reopening = false) {
    if (!this.enableWrites) throw new Error('Enable writes in settings, then reconnect.');
    const id = positiveId(snapshot.remoteId), companyId = companyIdValue(snapshot.companyId);
    if (this.pending.has(id)) throw new Error('An update for this To-Do is already in progress.');
    const fields = Object.keys(changes);
    if (!fields.length || fields.some(k => !['assignedToResourceID', 'startDateTime', 'endDateTime', 'completedDate', 'companyID', 'activityDescription'].includes(k))) throw new Error('Unsupported or empty update.');
    const patch = { id };
    for (const field of fields) {
      const value = changes[field];
      if (field === 'assignedToResourceID') patch[field] = positiveId(value);
      else if (field === 'companyID') patch[field] = companyIdValue(value);
      else if (field === 'activityDescription') {
        if (typeof value !== 'string' || !value.trim() || value.length > 32000) throw new Error('Enter task text of 1–32,000 characters.');
        patch[field] = value;
      }
      else if (field === 'completedDate' && value === null && reopening && fields.length === 1) patch[field] = null;
      else {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Use an ISO date/time with seconds and a timezone, such as 2026-10-14T09:00:00-07:00.');
        patch[field] = new Date(value).toISOString();
      }
    }
    this.pending.add(id);
    try {
      const result = await this.request(this.base + `CompanyToDos/${id}`, 'GET');
      const raw = result.item;
      if (!raw || raw.id !== id || raw.companyID !== companyId) throw new Error('Remote record could not be verified. Refresh first.');
      const current = this.normalize(raw);
      for (const field of ['description', 'assigneeId', 'companyId', 'start', 'due', 'completed', 'modified']) {
        if ((current[field] ?? null) !== (snapshot[field] ?? null)) throw new Error('This To-Do changed remotely. Refresh before editing.');
      }
      if (reopening) {
        if (!current.completed || fields.length !== 1 || patch.completedDate !== null) throw new Error('Only a completed To-Do can be reopened.');
        const metadata = await this.request(this.base + 'CompanyToDos/entityInformation/fields', 'GET');
        const field = metadata.fields?.find(f => f.name === 'completedDate');
        if (!field || field.isReadOnly !== false || field.isRequired !== false) throw new Error('Autotask does not expose a writable optional completion date. Reopening unavailable.');
      } else if (current.completed) throw new Error('This To-Do is already completed.');
      if (patch.activityDescription !== undefined) {
        const metadata = await this.request(this.base + 'CompanyToDos/entityInformation/fields', 'GET');
        const field = metadata.fields?.find(field => field.name === 'activityDescription');
        if (!field || field.isReadOnly !== false) throw new Error('Autotask does not expose writable task text. Rename unavailable.');
      }
      const moving = patch.companyID !== undefined && patch.companyID !== companyId;
      if (moving) {
        if (fields.length !== 1) throw new Error('Change the company separately from other edits.');
        await this.validateCompanyChange(raw, patch.companyID);
      }
      const start = patch.startDateTime ?? raw.startDateTime, end = patch.endDateTime ?? raw.endDateTime;
      if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) < Date.parse(start)) throw new Error('End time must be at or after start time.');
      const response = await this.request(this.base + `Companies/${companyId}/ToDos`, 'PATCH', patch, false);
      if (String(response.itemId) !== String(id)) throw new Error('Write response was not verified. Check Autotask and refresh before attempting again.');
      if (moving) {
        let verification;
        try { verification = await this.request(this.base + `CompanyToDos/${id}`, 'GET'); }
        catch { throw new Error('Company change outcome unknown. Check Autotask and refresh before trying again.'); }
        if (verification.item?.id !== id || verification.item.companyID !== patch.companyID || ['contactID', 'ticketID', 'contractID', 'opportunityID'].some(field => (verification.item[field] ?? null) !== (raw[field] ?? null))) throw new Error('Autotask did not confirm the new company and preserved links. Check Autotask and refresh before trying again.');
        this.log({ event: 'autotask.company-change-verified' });
        return { remoteId: String(id), accepted: true, verified: true, companyId: patch.companyID };
      }
      if (reopening) {
        let verification;
        try { verification = await this.request(this.base + `CompanyToDos/${id}`, 'GET'); }
        catch { throw new Error('Reopen outcome unknown. Check Autotask and refresh; do not retry yet.'); }
        if (verification.item?.id !== id || verification.item?.companyID !== companyId || verification.item?.completedDate !== null) throw new Error('Autotask did not confirm reopening. Check Autotask and refresh before trying again.');
        return { remoteId: String(id), accepted: true, verified: true };
      }
      if (patch.activityDescription !== undefined) {
        let verification;
        try { verification = await this.request(this.base + `CompanyToDos/${id}`, 'GET'); }
        catch { throw new Error('Task text update outcome unknown. Check Autotask and refresh before retrying.'); }
        const confirmed = verification.item;
        if (!confirmed || confirmed.id !== id || confirmed.companyID !== companyId || Object.keys(patch).filter(field => field !== 'id').some(field => ['startDateTime','endDateTime','completedDate'].includes(field) ? Date.parse(confirmed[field]) !== Date.parse(patch[field]) : confirmed[field] !== patch[field])) throw new Error('Autotask did not confirm the requested task text/update. Check Autotask and refresh before retrying.');
        this.log({ event: 'autotask.task-text-verified' });
        return { remoteId: String(id), accepted: true, verified: true };
      }
      return { remoteId: String(id), accepted: true };
    } finally { this.pending.delete(id); }
  }
  complete(snapshot) { return this.update(snapshot, { completedDate: new Date().toISOString() }); }
  async actionTypes() {
    const metadata = await this.request(this.base + 'CompanyToDos/entityInformation/fields', 'GET');
    const values = metadata.fields?.find(field => field.name === 'actionType')?.picklistValues;
    if (!Array.isArray(values)) throw new Error('Autotask did not expose action type choices.');
    return values.filter(value => value.isActive !== false && /^\d+$/.test(String(value.value))).map(value => ({ id: String(value.value), label: value.label || `Action #${value.value}`, isDefault: value.isDefaultValue === true }));
  }
  /**= Creation is never retried; readback must confirm the new task's destination. */
  async create(values) {
    if (!this.enableWrites) throw new Error('Enable To-Do updates to create a task.');
    const companyID = companyIdValue(values.companyID), assignedToResourceID = positiveId(values.assignedToResourceID);
    if (typeof values.activityDescription !== 'string' || !values.activityDescription.trim() || values.activityDescription.length > 32000) throw new Error('Enter a description of 1–32,000 characters.');
    const dates = {};
    for (const field of ['startDateTime', 'endDateTime']) {
      const value = values[field];
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Choose a valid start and end date/time.');
      dates[field] = new Date(value).toISOString();
    }
    if (Date.parse(dates.endDateTime) < Date.parse(dates.startDateTime)) throw new Error('End time must be at or after start time.');
    const choices = await this.actionTypes();
    if (!choices.some(choice => choice.id === String(values.actionType))) throw new Error('Choose a valid action type.');
    const company = (await this.request(this.base + `Companies/${companyID}`, 'GET')).item;
    const assignee = (await this.request(this.base + `Resources/${assignedToResourceID}`, 'GET')).item;
    if (!company || company.id !== companyID || company.isActive !== true) throw new Error('Company unavailable or inactive.');
    if (!assignee || assignee.id !== assignedToResourceID || assignee.isActive !== true) throw new Error('Assigned user unavailable or inactive.');
    const payload = { companyID, assignedToResourceID, actionType: Number(values.actionType), activityDescription: values.activityDescription, ...dates };
    const response = await this.request(this.base + `Companies/${companyID}/ToDos`, 'POST', payload, false);
    let id; try { id = positiveId(response.itemId); } catch { throw new Error('Creation outcome unknown. Refresh and check Autotask before trying again.'); }
    let item;
    try { item = (await this.request(this.base + `CompanyToDos/${id}`, 'GET')).item; }
    catch { throw new Error(`To-Do #${id} was accepted but could not be read back. Check Autotask before creating another.`); }
    if (!item || item.id !== id || item.companyID !== companyID || item.assignedToResourceID !== assignedToResourceID || item.actionType !== payload.actionType || Date.parse(item.startDateTime) !== Date.parse(dates.startDateTime) || Date.parse(item.endDateTime) !== Date.parse(dates.endDateTime)) throw new Error(`To-Do #${id} creation could not be fully verified. Check Autotask before trying again.`);
    return this.normalize(item);
  }
  /**= Notes append to native activity text; they are not a separate threaded-comment entity. */
  async addTextNote(snapshot,text) {
    if(typeof text!=='string'||!text.trim()||text.length>8000)throw new Error('Enter a note of 1–8,000 characters.');
    const timestamp=new Date().toISOString().slice(0,16).replace('T',' ')+' UTC';
    const content=/<[^>]+>/.test(snapshot.description||'')?text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):text;
    return this.update(snapshot,{activityDescription:(snapshot.description||'')+`\n\n[Task2Do note — ${timestamp}]\n`+content});
  }
  /**= Null clearing is confirmed by readback; metadata alone does not prove reopening. */
  reopen(snapshot) { return this.update(snapshot, { completedDate: null }, true); }
  changeCompany(snapshot, destination) { return this.update(snapshot, { companyID: companyIdValue(destination) }); }
  /**= Verify destination and linked entities without changing or clearing any link. */
  async validateCompanyChange(raw, destination) {
    const metadata = await this.request(this.base + 'CompanyToDos/entityInformation/fields', 'GET');
    const field = metadata.fields?.find(f => f.name === 'companyID');
    if (!field || field.isReadOnly !== false) throw new Error('Autotask does not expose a writable company field. Company change unavailable.');
    const company = (await this.request(this.base + `Companies/${destination}`, 'GET')).item;
    if (!company || company.id !== destination || company.isActive !== true) throw new Error('The destination company is unavailable or inactive.');
    for (const [fieldName, entity, label] of [['contactID', 'Contacts', 'contact'], ['ticketID', 'Tickets', 'ticket'], ['contractID', 'Contracts', 'contract'], ['opportunityID', 'Opportunities', 'opportunity']]) {
      const value = raw[fieldName];
      if (value === undefined || value === null || value === 0) continue;
      const id = positiveId(value); let linked;
      try { linked = (await this.request(this.base + `${entity}/${id}`, 'GET')).item; }
      catch { throw new Error(`Unable to verify linked ${label} #${id}. Company change blocked.`); }
      if (!linked || linked.id !== id || linked.companyID !== destination || (fieldName === 'contactID' && linked.isActive !== true)) throw new Error(`Linked ${label} #${id} does not belong to the destination company or is unavailable. Update its link in Autotask first; no links were cleared.`);
    }
  }
  async searchCompanies(search) {
    if (typeof search !== 'string' || search.trim().length < 2 || search.length > 100) throw new Error('Enter 2–100 characters of the company name.');
    const response = await this.request(this.base + 'Companies/query', 'POST', { filter: [{ op: 'eq', field: 'isActive', value: true }, { op: 'contains', field: 'companyName', value: search.trim() }], MaxRecords: 50 });
    if (!Array.isArray(response.items)) throw new Error('Autotask did not return a company list.');
    const items = response.items.filter(item => item.isActive === true && typeof item.companyName === 'string').map(item => ({ id: String(companyIdValue(item.id)), name: item.companyName })).sort((a, b) => a.name.localeCompare(b.name));
    return { items, hasMore: !!response.pageDetails?.nextPageUrl };
  }
  async resolveName(entity, id) {
    try { id = entity === 'Companies' ? companyIdValue(id) : positiveId(id); } catch { return '(Unassigned)'; }
    const key = `${entity}/${id}`, cached = this.nameCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    let value;
    try {
      const response = await this.request(this.base + key, 'GET'), item = response.item;
      if (!item || Number(item.id) !== id) throw new Error('Missing lookup record.');
      value = entity === 'Companies' ? item.companyName : [item.firstName, item.lastName].filter(Boolean).join(' ');
      if (typeof value !== 'string' || !value.trim()) throw new Error('Missing lookup name.');
    } catch {
      value = `${entity === 'Companies' ? 'Organization' : 'Resource'} #${id}`;
      this.log({ event: 'autotask.lookup-unavailable', entity });
    }
    this.nameCache.set(key, { value, expiresAt: Date.now() + 300000 }); return value;
  }
  async enrich(items) {
    const companies = new Map(), resources = new Map();
    for (const id of new Set(items.map(item => item.companyId))) companies.set(id, await this.resolveName('Companies', id));
    for (const id of new Set(items.map(item => item.assigneeId))) resources.set(id, await this.resolveName('Resources', id));
    return items.map(item => ({ ...item, organizationName: companies.get(item.companyId), assigneeName: resources.get(item.assigneeId) }));
  }
  /**= Load active named resources; license labels identify API-only accounts without hard-coded IDs. */
  async listResources() {
    let metadata;
    try { metadata = await this.request(this.base + 'Resources/entityInformation/fields', 'GET'); }
    catch { this.log({ event: 'autotask.resource-metadata-unavailable' }); }
    const apiLicenses = new Set((metadata?.fields?.find(f => f.name === 'licenseType')?.picklistValues || []).filter(v => /\bapi\b/i.test(v.label || '')).map(v => String(v.value)));
    let url = this.base + 'Resources/query', method = 'POST';
    let body = { filter: [{ op: 'eq', field: 'isActive', value: true }], MaxRecords: 500 };
    const result = new Map(), pages = new Set();
    for (let page = 0; page < 100; page++) {
      if (pages.has(url)) throw new Error('Repeated resource pagination URL.'); pages.add(url);
      const response = await this.request(url, method, body);
      if (!Array.isArray(response.items)) throw new Error('Autotask did not return a user list.');
      for (const raw of response.items) {
        if (raw.isActive !== true || apiLicenses.has(String(raw.licenseType))) continue;
        const firstName = typeof raw.firstName === 'string' ? raw.firstName.trim() : '';
        const lastName = typeof raw.lastName === 'string' ? raw.lastName.trim() : '';
        if (!firstName && !lastName) continue;
        const id = positiveId(raw.id);
        result.set(String(id), { id: String(id), firstName, lastName, name: [firstName, lastName].filter(Boolean).join(' ') });
      }
      const next = response.pageDetails?.nextPageUrl;
      if (!next) {
        const users = [...result.values()], counts = new Map();
        for (const user of users) counts.set(user.name, (counts.get(user.name) || 0) + 1);
        return users.map(user => ({ ...user, label: counts.get(user.name) > 1 ? `${user.name} (#${user.id})` : user.name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      }
      if (typeof next !== 'string') throw new Error('Invalid resource pagination URL.');
      url = new URL(next, this.base).href; method = 'GET'; body = undefined;
    }
    throw new Error('Resource pagination limit reached.');
  }
  normalize(raw) {
    return { provider: this.id, remoteId: String(positiveId(raw.id)), description: typeof raw.activityDescription === 'string' ? raw.activityDescription : '', assigneeId: raw.assignedToResourceID, creatorId: raw.creatorResourceID, completedAt: raw.completedDate, companyId: raw.companyID, start: raw.startDateTime, due: raw.endDateTime, completed: !!raw.completedDate, modified: raw.lastModifiedDate };
  }
  async list(scope = 'assigned', creatorId = this.creatorResourceId) {
    if (!['assigned', 'created'].includes(scope)) throw new Error('Invalid Autotask task scope.');
    let url = this.base + 'CompanyToDos/query', method = 'POST';
    let body = { filter: [{ op: 'eq', field: scope === 'assigned' ? 'assignedToResourceID' : 'creatorResourceID', value: scope === 'assigned' ? this.resourceId : positiveId(creatorId) }], MaxRecords: 500 };
    const items = [], seenPages = new Set(), seenIds = new Set();
    for (let page = 0; page < 100; page++) {
      if (seenPages.has(url)) throw new Error('Repeated pagination URL; refresh stopped.');
      seenPages.add(url);
      const result = await this.request(url, method, body);
      if (!Array.isArray(result.items)) throw new Error('API response did not contain a task list.');
      for (const raw of result.items) {
        const id = positiveId(raw.id);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        items.push(this.normalize(raw));
      }
      const next = result.pageDetails?.nextPageUrl;
      if (!next) return items;
      if (typeof next !== 'string') throw new Error('Invalid pagination URL.');
      url = new URL(next, this.base).href; method = 'GET'; body = undefined;
    }
    throw new Error('Pagination limit reached; no partial results displayed.');
  }
  /**= Pull minimum catalog fields; never retain HR/security details or credentials. */
  async catalog(entity, include) {
    let url = this.base + entity + '/query', method = 'POST', body = { filter: [{ op: 'gte', field: 'id', value: entity === 'Companies' ? 0 : 1 }], IncludeFields: include, MaxRecords: 500 };
    const items = [], pages = new Set();
    for (let page = 0; page < 100; page++) { if (pages.has(url)) throw new Error('Repeated catalog page.'); pages.add(url); const data = await this.request(url, method, body); if (!Array.isArray(data.items)) throw new Error('Invalid Autotask catalog.'); items.push(...data.items); if (!data.pageDetails?.nextPageUrl) return items; url = new URL(data.pageDetails.nextPageUrl, this.base).href; method = 'GET'; body = undefined; }
    throw new Error('Autotask catalog limit reached.');
  }
  async catalogs() {
    const [companies, users] = await Promise.all([this.catalog('Companies', ['id','companyName','isActive']), this.catalog('Resources', ['id','firstName','lastName','email','isActive'])]);
    return { companies: companies.map(c => ({ id: String(c.id), name: c.companyName || `Company #${c.id}`, active: c.isActive === true })), users: users.map(u => ({ id: String(u.id), name: [u.firstName,u.lastName].filter(Boolean).join(' ') || `Resource #${u.id}`, email: u.email || '', active: u.isActive === true })) };
  }
  /**= Resolve the authenticated API account by exact userName; never infer from names/email. */
  async resolveCreatorResourceIds() {
    if (!this.apiResourceId) {
      if (!this.apiUserLookup) this.apiUserLookup = (async () => {
        if (!this.credentials) throw new Error('Connect again; the session has ended.');
        const username = this.credentials.username;
        let result;
        try { result = await this.request(this.base + 'Resources/query', 'POST', { filter: [{ op: 'eq', field: 'userName', value: username }], MaxRecords: 2 }); }
        catch { throw new Error('Could not resolve API user Resource ID. Enter API user Resource ID in settings, then refresh.'); }
        if (!Array.isArray(result.items) || result.items.length !== 1 || result.pageDetails?.nextPageUrl || typeof result.items[0].userName !== 'string' || result.items[0].userName.toLowerCase() !== username.toLowerCase()) throw new Error('API username did not resolve to one exact resource. Enter API user Resource ID in settings.');
        return positiveId(result.items[0].id);
      })().catch(error => { this.apiUserLookup = null; throw error; });
      this.apiResourceId = await this.apiUserLookup;
    }
    this.creatorResourceIds = [...new Set([this.creatorResourceId, this.apiResourceId])];
    return this.creatorResourceIds;
  }
  /**= Read a known CRM To-Do independently of query scopes; never log its contents. */
  async inspectTask(value) {
    const id = positiveId(value), response = await this.request(this.base + `CompanyToDos/${id}`, 'GET');
    if (!response.item || response.item.id !== id) throw new Error('Autotask did not return the requested CRM To-Do.');
    const item = this.normalize(response.item);
    const creatorIds = await this.resolveCreatorResourceIds();
    return { ...item, configuredApiResourceId: this.apiResourceId, configuredCreatorIds: creatorIds, creatorName: item.creatorId ? await this.resolveName('Resources', item.creatorId) : 'Not supplied by API', assigneeName: await this.resolveName('Resources', item.assigneeId), configuredAssigneeId: this.resourceId, configuredCreatorId: this.creatorResourceId, impersonatorCreatorId: response.item.impersonatorCreatorResourceID, matchesAssigned: String(item.assigneeId) === String(this.resourceId), matchesCreated: creatorIds.some(id => String(item.creatorId) === String(id)) };
  }
  /**= Fetch both personal scopes; deduplicate self-created assignments for indexing. */
  async listForUser() {
    const creators = await this.resolveCreatorResourceIds();
    const groups = await Promise.all([this.list('assigned'), ...creators.map(id => this.list('created', id))]);
    return [...new Map(groups.flat().map(item => [item.remoteId, item])).values()];
  }
}
module.exports = { positiveId, companyIdValue, apiBase, AutotaskToDoProvider };

return module.exports;
})();
const { MicrosoftAuth, MicrosoftToDoProvider } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.8.0-alpha.2. Microsoft OAuth and To Do provider, independent of Obsidian. */
const SCOPES = 'https://graph.microsoft.com/Tasks.ReadWrite offline_access';
function graphConfig(config) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.clientId || '')) throw new Error('Enter your Microsoft Entra application client ID.');
  if (!/^(common|organizations|consumers|[0-9a-f-]{36}|[a-z0-9][a-z0-9.-]*\.[a-z]{2,})$/i.test(config.tenant || 'common')) throw new Error('Enter a tenant ID/domain or common, organizations or consumers.');
  return { clientId: config.clientId, tenant: config.tenant || 'common' };
}
class MicrosoftAuth {
  constructor(config, transport, onTokens = async () => {}, log = () => {}, pause = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now()) {
    this.config = graphConfig(config); this.scopes = SCOPES + (config.plannerDirectory ? ' https://graph.microsoft.com/GroupMember.Read.All' : ''); this.transport = transport; this.onTokens = onTokens; this.log = log; this.pause = pause; this.now = now;
    this.tokens = null; this.disposed = false; this.refreshing = null;
  }
  restore(tokens) {
    if (!tokens || typeof tokens.accessToken !== 'string' || !tokens.accessToken || /[\r\n]/.test(tokens.accessToken) || !Number.isFinite(tokens.expiresAt) || (tokens.refreshToken !== undefined && (typeof tokens.refreshToken !== 'string' || /[\r\n]/.test(tokens.refreshToken)))) throw new Error('Invalid saved Microsoft tokens. Sign in again.');
    this.tokens = { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}) };
  }
  dispose() { this.disposed = true; this.tokens = null; }
  async form(endpoint, values) {
    if (this.disposed) throw new Error('Microsoft session ended. Sign in again.');
    let response;
    try { response = await this.transport({ url: `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenant)}/oauth2/v2.0/${endpoint}`, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString(), throw: false }); }
    catch { throw new Error('Microsoft authentication request failed. Check connectivity.'); }
    this.log({ event: 'microsoft.auth', status: response.status });
    if (this.disposed) throw new Error('Microsoft session ended.');
    if (!response.json || typeof response.json !== 'object') throw new Error('Unexpected Microsoft authentication response.');
    return { status: response.status, body: response.json };
  }
  async accept(body) {
    if (typeof body.access_token !== 'string' || !body.access_token || /[\r\n]/.test(body.access_token) || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0) throw new Error('Invalid Microsoft token response.');
    const granted = String(body.scope || '').toLowerCase();
    if (granted && !granted.split(' ').some(scope => scope === 'tasks.readwrite' || scope.endsWith('/tasks.readwrite'))) throw new Error('Microsoft did not grant Tasks.ReadWrite.');
    const tokens = { accessToken: body.access_token, expiresAt: this.now() + Number(body.expires_in) * 1000, ...((body.refresh_token || this.tokens?.refreshToken) ? { refreshToken: body.refresh_token || this.tokens.refreshToken } : {}) };
    await this.onTokens(tokens);
    if (this.disposed) throw new Error('Microsoft session ended.');
    this.tokens = tokens; return tokens;
  }
  async begin() {
    const result = await this.form('devicecode', { client_id: this.config.clientId, scope: this.scopes });
    const body = result.body;
    if (result.status !== 200 || !body.device_code || !body.user_code || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0) throw new Error('Unable to start Microsoft sign-in. Check client ID, public client flows and tenant policy.');
    const uri = new URL(body.verification_uri);
    if (uri.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(uri.hostname) || uri.username || uri.password || uri.port) throw new Error('Unexpected Microsoft sign-in URL.');
    return { deviceCode: body.device_code, userCode: body.user_code, verificationUri: uri.href, expiresAt: this.now() + Number(body.expires_in) * 1000, interval: Math.max(5, Number(body.interval) || 5) };
  }
  async poll(device, cancelled = () => false) {
    let interval = device.interval;
    while (this.now() < device.expiresAt && !cancelled() && !this.disposed) {
      await this.pause(interval * 1000);
      if (cancelled() || this.disposed) throw new Error('Microsoft sign-in cancelled.');
      const result = await this.form('token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: this.config.clientId, device_code: device.deviceCode });
      if (cancelled()) throw new Error('Microsoft sign-in cancelled.');
      if (result.status === 200) return this.accept(result.body);
      if (result.body.error === 'authorization_pending') continue;
      if (result.body.error === 'slow_down') { interval += 5; continue; }
      throw new Error(`Microsoft sign-in failed (${String(result.body.error || 'unknown_error').replace(/[^a-z_]/gi, '')}). Check app permissions and tenant policy.`);
    }
    throw new Error(cancelled() || this.disposed ? 'Microsoft sign-in cancelled.' : 'Microsoft sign-in expired. Start again.');
  }
  async accessToken() {
    if (this.disposed || !this.tokens) throw new Error('Sign in to Microsoft To Do first.');
    if (this.tokens.expiresAt > this.now() + 60000) return this.tokens.accessToken;
    if (!this.tokens.refreshToken) throw new Error('Microsoft sign-in expired. Sign in again.');
    if (!this.refreshing) this.refreshing = (async () => {
      const result = await this.form('token', { grant_type: 'refresh_token', client_id: this.config.clientId, refresh_token: this.tokens.refreshToken, scope: this.scopes });
      if (result.status !== 200) throw new Error('Microsoft session could not be refreshed. Sign in again.');
      await this.accept(result.body); return this.tokens.accessToken;
    })().finally(() => this.refreshing = null);
    return this.refreshing;
  }
}
function graphId(value) { if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error('Invalid Microsoft task or list ID.'); return encodeURIComponent(value); }
function dueValue(value) {
  if (!value) return undefined;
  if (typeof value.dateTime !== 'string') return undefined;
  const date = value.dateTime.replace(/(\.\d{3})\d+/, '$1');
  if (/Z$|[+-]\d\d:\d\d$/.test(date)) return date;
  if (['UTC', 'Etc/UTC'].includes(value.timeZone)) return date + 'Z';
  /**= Convert IANA and common Microsoft timezone labels; unknown zones retain display text. */
  const aliases = { 'Pacific Standard Time': 'America/Los_Angeles', 'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin', 'Atlantic Standard Time': 'America/Halifax' };
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: aliases[value.timeZone] || value.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const intended = Date.parse(date + 'Z'); if (!Number.isFinite(intended)) return undefined;
    let instant = intended;
    for (let attempt = 0; attempt < 4; attempt++) {
      const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
      const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      const offset = intended - displayed; if (Math.abs(offset) < 1000) return new Date(instant).toISOString();
      instant += offset;
    }
  } catch {}
  return undefined;
}
class MicrosoftToDoProvider {
  constructor(auth, transport, log = () => {}, pause = ms => new Promise(r => setTimeout(r, ms))) {
    this.id = 'microsoft-todo'; this.auth = auth; this.transport = transport; this.log = log; this.pause = pause; this.pending = new Set(); this.disposed = false;
    this.capabilities = Object.freeze({ read: true, create: true, update: true, complete: true, reopen: true, comment: false });
  }
  dispose() { this.disposed = true; this.auth.dispose(); }
  async request(path, method = 'GET', body, etag) {
    const url = new URL(path, 'https://graph.microsoft.com/v1.0/');
    if (url.origin !== 'https://graph.microsoft.com' || url.username || url.password || !url.pathname.startsWith('/v1.0/me/todo/')) throw new Error('Rejected unexpected Microsoft Graph URL.');
    if (this.disposed) throw new Error('Microsoft provider disconnected.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.auth.accessToken(); let response;
      try { response = await this.transport({ url: url.href, method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), throw: false }); }
      catch { throw new Error(method === 'GET' ? 'Microsoft Graph request failed.' : 'Microsoft write outcome unknown. Refresh and check Microsoft To Do before trying again.'); }
      this.log({ event: 'microsoft.graph', method, status: response.status, attempt: attempt + 1 });
      if (method === 'GET' && (response.status === 429 || response.status >= 500) && attempt < 2) { const seconds = Number(response.headers?.['retry-after']); await this.pause(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30000) : 1000 * 2 ** attempt); continue; }
      if (response.status < 200 || response.status >= 300) throw new Error(response.status === 412 ? 'Microsoft task changed remotely. Refresh first.' : `Microsoft Graph returned HTTP ${response.status}. ${method === 'GET' ? 'Check sign-in and permissions.' : 'Write not retried; refresh before trying again.'}`);
      if (!response.json || typeof response.json !== 'object') throw new Error('Unexpected Microsoft response; refresh before retrying a write.');
      return response.json;
    }
  }
  async collection(path) {
    const items = [], pages = new Set();
    for (let page = 0; page < 100; page++) {
      if (pages.has(path)) throw new Error('Repeated Microsoft pagination URL.'); pages.add(path);
      const result = await this.request(path);
      if (!Array.isArray(result.value)) throw new Error('Microsoft response did not contain a list.');
      items.push(...result.value);
      if (!result['@odata.nextLink']) return items;
      path = result['@odata.nextLink'];
    }
    throw new Error('Microsoft pagination limit reached.');
  }
  destinations() { return this.collection('me/todo/lists'); }
  normalize(raw, list) {
    graphId(raw.id);
    return { provider: this.id, remoteId: raw.id, listId: list.id, listName: list.displayName, title: raw.title || '', description: raw.body?.content || '', due: dueValue(raw.dueDateTime), dueDisplay: raw.dueDateTime ? `${raw.dueDateTime.dateTime} (${raw.dueDateTime.timeZone})` : undefined, completed: raw.status === 'completed', modified: raw.lastModifiedDateTime, etag: raw['@odata.etag'] };
  }
  async list(listId) {
    const lists = await this.destinations(), result = [];
    for (const list of lists.filter(l => !listId || l.id === listId)) {
      const items = await this.collection(`me/todo/lists/${graphId(list.id)}/tasks`);
      result.push(...items.map(item => this.normalize(item, list)));
    }
    return result;
  }
  async get(ref) {
    const raw = await this.request(`me/todo/lists/${graphId(ref.listId)}/tasks/${graphId(ref.remoteId)}`);
    if (raw.id !== ref.remoteId) throw new Error('Microsoft task identity mismatch.');
    return this.normalize(raw, { id: ref.listId, displayName: ref.listName || 'Microsoft To Do' });
  }
  attachments(item) { return this.collection(`me/todo/lists/${graphId(item.listId)}/tasks/${graphId(item.remoteId)}/attachments`); }
  attachment(item, id) { return this.request(`me/todo/lists/${graphId(item.listId)}/tasks/${graphId(item.remoteId)}/attachments/${graphId(id)}`); }
  async addAttachment(item, values) {
    if (typeof values.name !== 'string' || !values.name.trim() || values.name.length > 255 || typeof values.contentBytes !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(values.contentBytes) || Buffer.from(values.contentBytes,'base64').length >= 3000000) throw new Error('Choose a named file smaller than 3 MB.');
    const result = await this.request(`me/todo/lists/${graphId(item.listId)}/tasks/${graphId(item.remoteId)}/attachments`, 'POST', { '@odata.type':'#microsoft.graph.taskFileAttachment',name:values.name,contentBytes:values.contentBytes,contentType:values.contentType || 'application/octet-stream' });
    if(!result.id)throw new Error('Attachment creation identity unknown. Inspect Microsoft To Do before retrying.');const check=await this.attachment(item,result.id);if(check.name!==values.name||check.contentBytes!==values.contentBytes)throw new Error('Attachment creation unverified. Inspect Microsoft To Do before retrying.');return result;
  }
  async create(listId, values) {
    const title = String(values.title || '').trim();
    if (!title || title.length > 255) throw new Error('Enter a task title of 1–255 characters.');
    if (values.description !== undefined && (typeof values.description !== 'string' || values.description.length > 32000)) throw new Error('Task description must be at most 32,000 characters.');
    const body = { title, ...(values.description ? { body: { content: values.description, contentType: 'text' } } : {}) };
    if (values.due) {
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(values.due) || !Number.isFinite(Date.parse(values.due))) throw new Error('Use an ISO due date/time with timezone or leave it blank.');
      body.dueDateTime = { dateTime: new Date(values.due).toISOString().replace(/Z$/, ''), timeZone: 'UTC' };
    }
    const raw = await this.request(`me/todo/lists/${graphId(listId)}/tasks`, 'POST', body);
    if (!raw.id) throw new Error('Task creation outcome unverified. Refresh before trying again.');
    return raw;
  }
  async update(snapshot, changes) {
    const fields = Object.keys(changes);
    if (!fields.length || fields.some(k => !['title', 'status', 'description', 'due'].includes(k)) || (changes.title !== undefined && (typeof changes.title !== 'string' || !changes.title.trim() || changes.title.length > 255)) || (changes.status !== undefined && !['completed', 'notStarted'].includes(changes.status))) throw new Error('Invalid Microsoft task update.');
    const payload = { ...changes };
    if (changes.description !== undefined) { if (typeof changes.description !== 'string' || changes.description.length > 32000) throw new Error('Description must be at most 32,000 characters.'); payload.body = { content: changes.description, contentType: 'text' }; delete payload.description; }
    if (changes.due !== undefined) { if (changes.due !== null && changes.due !== '' && (typeof changes.due !== 'string' || !Number.isFinite(Date.parse(changes.due)) || !/(Z|[+-]\d\d:\d\d)$/.test(changes.due))) throw new Error('Choose a due date with timezone.'); payload.dueDateTime = changes.due ? { dateTime: new Date(changes.due).toISOString().replace(/Z$/, ''), timeZone: 'UTC' } : null; delete payload.due; }
    const path = `me/todo/lists/${graphId(snapshot.listId)}/tasks/${graphId(snapshot.remoteId)}`;
    if (this.pending.has(path)) throw new Error('Microsoft task update already in progress.');
    this.pending.add(path);
    try {
      const raw = await this.request(path);
      const current = this.normalize(raw, { id: snapshot.listId, displayName: snapshot.listName });
      if (raw.id !== snapshot.remoteId || ['title', 'description', 'completed', 'dueDisplay', 'modified', 'etag'].some(field => (current[field] ?? null) !== (snapshot[field] ?? null))) throw new Error('Microsoft task changed remotely. Refresh first.');
      const result = await this.request(path, 'PATCH', payload, raw['@odata.etag']);
      if (result.id !== snapshot.remoteId || (changes.status && result.status !== changes.status) || (changes.title && result.title !== changes.title) || (changes.description !== undefined && result.body?.content !== changes.description) || (changes.due !== undefined && (changes.due ? Date.parse(dueValue(result.dueDateTime)) !== Date.parse(changes.due) : !!result.dueDateTime))) throw new Error('Microsoft update unverified. Refresh before trying again.');
      return result;
    } finally { this.pending.delete(path); }
  }
  complete(snapshot) { return this.update(snapshot, { status: 'completed' }); }
  reopen(snapshot) { return this.update(snapshot, { status: 'notStarted' }); }
}
module.exports = { MicrosoftAuth, MicrosoftToDoProvider, graphConfig, dueValue };

return module.exports;
})();
const { ProviderRegistry, selectTasks, toCalendarValue, fromCalendarValue, calendarZoneLabel, formatTaskDate, taskUrgency, selectAutotaskList } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.9.0-alpha.2. Shared task presentation and provider registration. */
class ProviderRegistry {
  constructor() { this.providers = new Map(); }
  register(provider) {
    if (!provider || typeof provider.id !== 'string' || typeof provider.list !== 'function' || !provider.capabilities) throw new Error('Invalid task provider.');
    this.providers.get(provider.id)?.dispose?.(); this.providers.set(provider.id, provider); return provider;
  }
  get(id) { return this.providers.get(id); }
  remove(id) { this.providers.get(id)?.dispose?.(); this.providers.delete(id); }
  dispose() { for (const provider of this.providers.values()) provider.dispose?.(); this.providers.clear(); }
}
function selectTasks(items, options = {}) {
  const state = ['all', 'open', 'completed'].includes(options.state) ? options.state : 'open';
  const search = String(options.search || '').trim().toLocaleLowerCase();
  const result = items.filter(item => (state === 'all' || item.completed === (state === 'completed')) && (!search || [item.title, item.description, item.organizationName, item.assigneeName, item.listName, item.remoteId, item.ticketNumber, item.statusName, item.priorityName, item.queueName].filter(Boolean).join(' ').toLocaleLowerCase().includes(search)));
  if (options.sort !== 'none') result.sort((a, b) => {
    const left = Date.parse(a.due), right = Date.parse(b.due);
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : String(a.remoteId).localeCompare(String(b.remoteId));
    if (!Number.isFinite(right)) return -1;
    return (options.sort === 'due-desc' ? right - left : left - right) || String(a.remoteId).localeCompare(String(b.remoteId));
  });
  return result;
}
/**= Native calendar fields have no timezone; explicitly convert local or UTC values. */
function toCalendarValue(iso, zone = 'local') {
  if (!iso) return '';
  const date = new Date(iso); if (!Number.isFinite(date.getTime())) throw new Error('Invalid saved date/time.');
  const get = part => date[`${zone === 'utc' ? 'getUTC' : 'get'}${part}`]();
  const pad = value => String(value).padStart(2, '0');
  return `${get('FullYear')}-${pad(get('Month') + 1)}-${pad(get('Date'))}T${pad(get('Hours'))}:${pad(get('Minutes'))}:${pad(get('Seconds'))}`;
}
function fromCalendarValue(value, zone = 'local') {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error('Select a complete date and time.');
  const [year, month, day, hours, minutes, seconds] = match.slice(1).map(v => Number(v || 0));
  if (year < 1000 || year > 9999) throw new Error('Select a year between 1000 and 9999.');
  const date = zone === 'utc' ? new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)) : new Date(year, month - 1, day, hours, minutes, seconds);
  const canonical = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}`;
  if (!Number.isFinite(date.getTime()) || toCalendarValue(date.toISOString(), zone) !== canonical) throw new Error('Invalid date/time, or the selected local time does not exist because of a clock change.');
  return date.toISOString();
}
function calendarZoneLabel(zone, value) {
  if (zone === 'utc') return 'UTC (UTC+00:00)';
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let date; try { date = new Date(fromCalendarValue(value, 'local')); } catch { return name; }
  const offset = -date.getTimezoneOffset(), absolute = Math.abs(offset);
  return `${name} (UTC${offset < 0 ? '-' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')})`;
}
/**= Display task timestamps at minute precision; retain the original API values. */
function formatTaskDate(iso, fallback = '') {
  if (iso) {
    try { return toCalendarValue(iso, 'local').slice(0, 16).replace('T', ' '); } catch {}
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(fallback);
  return match ? `${match[1]} ${match[2]}` : 'unspecified';
}
function taskUrgency(item, now = Date.now()) {
  if (item.completed) return { kind: 'completed', label: 'Completed' };
  const due = Date.parse(item.due); if (!Number.isFinite(due)) return { kind: 'undated', label: '' };
  if (due < now) return { kind: 'overdue', label: 'Overdue' };
  const ordinal = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  const days = ordinal(new Date(due)) - ordinal(new Date(now));
  return days === 0 ? { kind: 'today', label: 'Today' } : days <= 3 ? { kind: 'urgent', label: 'Within 3 days' } : days <= 7 ? { kind: 'upcoming', label: 'This week' } : { kind: 'later', label: 'Later' };
}
/**= Personal/delegated membership is exclusive; All is a deduplicated combined view. */
function selectAutotaskList(items, scope, assigneeId, creatorIds) {
  const assigned = item => String(item.assigneeId) === String(assigneeId) || (item.assigneeId === undefined && item.creatorId === undefined);
  const creators = new Set(creatorIds.map(String));
  const unique = [...new Map(items.map(item => [item.remoteId, item])).values()];
  return unique.filter(item => scope === 'my' ? assigned(item) : scope === 'delegated' ? !assigned(item) && creators.has(String(item.creatorId)) : true);
}
module.exports = { ProviderRegistry, selectTasks, toCalendarValue, fromCalendarValue, calendarZoneLabel, formatTaskDate, taskUrgency, selectAutotaskList };

return module.exports;
})();
const { TodoTxtProvider, parseTodoLine, vaultPath, localDay, todoPresentation, todoFields, structuredTodo, selectTodoView } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.8.0-alpha.2. todo.txt provider with whole-file conflict detection. */
function todoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T00:00:00Z'); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function localDay(date = new Date()) { const pad = value => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function vaultPath(value, extension = '') {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f:]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || (extension && !value.toLowerCase().endsWith(extension))) throw new Error('Use a relative path inside the vault, outside hidden folders.');
  return value;
}
function splitTodo(text) { return { bom: text.startsWith('\ufeff') ? '\ufeff' : '', parts: (text.startsWith('\ufeff') ? text.slice(1) : text).split(/(\r\n|\n|\r)/) }; }
function todoTokenText(line){const i=String(line).indexOf(' titleEnd:1');return i>=0?String(line).slice(i+11):String(line);}
function parseTodoLine(rawLine, lineIndex = 0, source = '') {
  if (!rawLine.trim()) return null;
  let rest = rawLine, completed = false, completedDate, priority, createdDate;
  if (rest.startsWith('x ')) { completed = true; rest = rest.slice(2); const date = /^(\d{4}-\d{2}-\d{2})\s+/.exec(rest); if (date && todoDate(date[1])) { completedDate = date[1]; rest = rest.slice(date[0].length); } }
  const rank = /^\(([A-Z])\)\s+/.exec(rest); if (rank) { priority = rank[1]; rest = rest.slice(rank[0].length); }
  const date = /^(\d{4}-\d{2}-\d{2})\s+/.exec(rest); if (date && todoDate(date[1])) { createdDate = date[1]; rest = rest.slice(date[0].length); }
  const dueToken = /(?:^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/.exec(rest);
  const dueDate = dueToken && todoDate(dueToken[1]) ? dueToken[1] : undefined;
  const tagText=rest.includes(' titleEnd:1')?rest.slice(rest.indexOf(' titleEnd:1')+11):rest;
  const priToken = /(?:^|\s)pri:([A-Z])(?=\s|$)/.exec(rest);
  let due;
  if (dueDate) { const [year, month, day] = dueDate.split('-').map(Number); due = new Date(year, month - 1, day, 23, 59, 59, 999).toISOString(); }
  return { provider: 'todotxt', remoteId: /(?:^|\s)uid:([^\s]+)/.exec(todoTokenText(rawLine))?.[1] || String(lineIndex + 1), lineIndex, rawLine, source, title: rest, description: (()=>{const m=/(?:^|\s)details:([^\s]+)/.exec(rest);try{return m?decodeURIComponent(m[1]):'';}catch{return '[Invalid encoded description]';}})(), completed, completedDate, createdDate, priority: priority || priToken?.[1], due, dueDate, projects: [...tagText.matchAll(/(?:^|\s)\+([^\s]+)/g)].map(match => match[1]), contexts: [...tagText.matchAll(/(?:^|\s)@([^\s]+)/g)].map(match => match[1]) };
}
/**= Separate readable task text from extension tokens without modifying the source line. */
function todoPresentation(item) {
  const fields = [], metadata = Object.create(null), projects = [], contexts = [];
  const boundary=String(item.title||'').indexOf(' titleEnd:1'),literalTitle=boundary>=0?String(item.title).slice(0,boundary):null;
  const title = (literalTitle===null?String(item.title||''):String(item.title).slice(boundary+1)).split(/\s+/).filter(token => {
    if (/^[+@]\S+/.test(token)) { (token[0] === '+' ? projects : contexts).push(token); return false; }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(.+)$/.exec(token);
    if (match && !match[2].startsWith('//')) { fields.push({ key: match[1], value: match[2] }); metadata[match[1]] = match[2]; return false; }
    return true;
  }).join(' ').trim() || '(Untitled task)';
  const name = value => { if (!value) return ''; try { return decodeURIComponent(value).replace(/_/g, ' '); } catch { return value.replace(/_/g, ' '); } };
  return { title:literalTitle===null?title:literalTitle, fields:fields.filter(f=>f.key!=='titleEnd'), projects, contexts, priority: item.priority,
    company: name(metadata.companyName) || (metadata.companyID ? `Company #${metadata.companyID}` : ''),
    assignee: name(metadata.resourceName || metadata.assigneeName) || (metadata.assignedToResourceID ? `Resource #${metadata.assignedToResourceID}` : ''),
    start: metadata.startDateTime, end: metadata.endDateTime };
}
/**= Structured task fields use ordinary todo.txt tokens and optional encoded details. */
function todoFields(item) {
  const shown=todoPresentation(item||{}), meta=Object.fromEntries(shown.fields.map(f=>[f.key,f.value]));
  const decode=v=>{try{return decodeURIComponent(v||'');}catch{throw new Error('Invalid encoded task description. Repair the raw task line.');}};
  return {title:item?shown.title:'',description:decode(meta.details),priority:item?.priority||'',createdDate:item?.createdDate||localDay(),dueDate:item?.dueDate||'',startDate:meta.t||(meta.startDateTime?localDay(new Date(meta.startDateTime)):''),projects:(item?.projects||[]).join(' '),contexts:(item?.contexts||[]).join(' ')};
}
function structuredTodo(values,snapshot=null) {
  const fields=todoFields(snapshot), next={...fields,...values};
  if(typeof next.title!=='string'||!next.title.trim()||/[\r\n\x00]/.test(next.title))throw new Error('Enter a single-line title.');
  if(typeof next.description!=='string'||next.description.length>12000||next.description.includes('\x00'))throw new Error('Description must be text of at most 12,000 characters.');
  if(next.priority&&!/^[A-Z]$/.test(next.priority))throw new Error('Priority must be A–Z or empty.');
  for(const k of ['createdDate','dueDate','startDate'])if(next[k]&&!todoDate(next[k]))throw new Error('Choose a valid '+k+'.');
  if(next.startDate&&next.dueDate&&next.startDate>next.dueDate)throw new Error('Due date cannot precede start date.');
  const tags=(value,prefix)=>{if(typeof value!=='string')throw new Error('Tags must be text.');return [...new Set(value.split(/[\s,]+/).filter(Boolean).map(v=>v.replace(new RegExp('^\\'+prefix),'')))].map(v=>{if(!/^[^\s:+@,\x00]+$/.test(v))throw new Error('Use project/context names without spaces, commas or colons.');return prefix+v;});};
  const project=tags(next.projects,'+'),context=tags(next.contexts,'@');
  const native=!/(?:^|\s)source:autotask-todo(?:\s|$)/.test(snapshot?.rawLine||'');const owned=new Set(['due','t','details','hasDetails','separator','pri','titleEnd','startDateTime','endDateTime']);
  const retained=todoPresentation(snapshot||{}).fields.filter(f=>!owned.has(f.key)).map(f=>f.key+':'+f.value);
  const tokens=['titleEnd:1',...(next.dueDate?['due:'+next.dueDate]:[]),...(next.startDate?['t:'+next.startDate]:[]),...project,...context,...retained];
  if(snapshot){const meta=Object.fromEntries(todoPresentation(snapshot).fields.map(f=>[f.key,f.value]));for(const [field,token]of [['dueDate','endDateTime'],['startDate','startDateTime']]){if(!native&&fields[field]&&!next[field])throw new Error('Imported Autotask schedule dates cannot be cleared.');if(next[field]&&meta[token]){if(next[field]===fields[field])tokens.push(token+':'+meta[token]);else{const old=new Date(meta[token]),[y,m,d]=next[field].split('-').map(Number);const moved=new Date(y,m-1,d,old.getHours(),old.getMinutes(),old.getSeconds(),old.getMilliseconds());if(!Number.isFinite(moved.getTime()))throw new Error('Invalid saved schedule.');tokens.push(token+':'+moved.toISOString());}}}}
  if(next.description)tokens.push('hasDetails:1','separator:%0A','details:'+encodeURIComponent(next.description));
  if(snapshot?.completed&&next.priority)tokens.push('pri:'+next.priority);
  const prefix=(snapshot?.completed?'x '+(snapshot.completedDate||localDay())+' ':next.priority?'('+next.priority+') ':'')+(next.createdDate?next.createdDate+' ':'');
  return validateTodoLine(prefix+next.title.trim()+(tokens.length?' '+tokens.join(' '):''));
}
function selectTodoView(items,view='inbox',today=localDay()) {
  return items.filter(item=>{if(view==='all')return true;const start=todoPresentation(item).fields.find(f=>f.key==='t')?.value;return view==='completed'?item.completed:!item.completed&&(view==='today'?!!item.dueDate&&item.dueDate<=today||start===today:view==='upcoming'?!!item.dueDate&&item.dueDate>today||!!start&&start>today:view==='inbox'?!item.dueDate&&!(start>today):true);});
}
function validateTodoLine(line) { if (typeof line !== 'string' || !line.trim() || line.length > 32000 || /[\r\n\x00]/.test(line)) throw new Error('Enter one non-empty todo.txt task line, without line breaks.'); return line; }
class TodoTxtProvider {
  constructor(path, storage, log = () => {}, uuid = () => require('node:crypto').randomUUID()) {
    this.id = 'todotxt'; this.path = vaultPath(path, '.txt'); this.storage = storage; this.log = log; this.uuid = uuid; this.queue = Promise.resolve(); this.disposed = false;
    this.capabilities = Object.freeze({ read: true, create: true, update: true, complete: true, reopen: true, comment: false });
  }
  dispose() { this.disposed = true; }
  async list() {
    if (this.disposed) throw new Error('todo.txt provider disconnected.');
    await this.ensureIdentities();
    const content = await this.storage.read(), { parts } = splitTodo(content), items = [];
    for (let index = 0; index < parts.length; index += 2) { const item = parseTodoLine(parts[index], index / 2, this.path); if (item) items.push({ ...item, fileSnapshot: content }); }
    return items;
  }
  async ensureIdentities() {
    return this.mutate(null,content=>{const {bom,parts}=splitTodo(content),seen=new Set();for(let i=0;i<parts.length;i+=2){if(!parts[i].trim())continue;const matches=[...todoTokenText(parts[i]).matchAll(/(?:^|\s)uid:([^\s]+)/g)];if(matches.length>1||matches[0]&&(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(matches[0][1])||seen.has(matches[0][1].toLowerCase())))throw new Error('Duplicate or invalid task UID. Repair todo.txt before editing.');if(matches[0])seen.add(matches[0][1].toLowerCase());else{const uid=this.uuid();if(seen.has(uid))throw new Error('Duplicate generated task UID.');seen.add(uid);parts[i]+=' uid:'+uid;}}return bom+parts.join('');});
  }
  async get(ref){const id=typeof ref==='string'?ref:ref.remoteId;const item=(await this.list()).find(t=>t.remoteId===id);if(!item)throw new Error('Local task no longer exists. Refresh.');return item;}
  async mutate(snapshot, transform) {
    const operation = this.queue.catch(() => {}).then(async () => {
      if (this.disposed) throw new Error('todo.txt provider disconnected.');
      const content = await this.storage.read();
      if (snapshot && content !== snapshot.fileSnapshot) throw new Error('todo.txt changed. Refresh before editing.');
      const next = transform(content);
      if (next === content) return;
      await this.storage.write(next, content);
      if (await this.storage.read() !== next) throw new Error('todo.txt write could not be verified. Refresh before trying again.');
      this.log({ event: 'todotxt.write-verified' });
    });
    this.queue = operation; return operation;
  }
  create(values) {
    let line = values.line!==undefined?validateTodoLine(values.line):structuredTodo(values);
    if(/(?:^|\s)uid:/.test(todoTokenText(line)))throw new Error('New tasks receive a unique UID automatically.');line+=' uid:'+this.uuid();
    return this.mutate(null, content => { const eol = content.includes('\r\n') ? '\r\n' : '\n'; return content + (content && !/[\r\n]$/.test(content) ? eol : '') + line + eol; });
  }
  update(snapshot, values) {
    let line = values.line!==undefined?validateTodoLine(values.line):structuredTodo(values,snapshot);
    const oldId=/(?:^|\s)uid:([^\s]+)/.exec(todoTokenText(snapshot.rawLine))?.[1],newIds=[...todoTokenText(line).matchAll(/(?:^|\s)uid:([^\s]+)/g)];if(oldId&&(newIds.length!==1||newIds[0][1]!==oldId))throw new Error('Task UID cannot be changed or removed.');
    return this.mutate(snapshot, content => { const { bom, parts } = splitTodo(content); const index = snapshot.lineIndex * 2; if (!Number.isInteger(snapshot.lineIndex) || snapshot.lineIndex < 0 || parts[index] !== snapshot.rawLine) throw new Error('todo.txt task moved or changed. Refresh first.'); parts[index] = line; return bom + parts.join(''); });
  }
  complete(snapshot) {
    if (snapshot.completed) throw new Error('Task already completed.');
    let line = snapshot.rawLine; const priority = /^\(([A-Z])\)\s+/.exec(line);
    if (priority) { line = line.slice(priority[0].length); if (!/(?:^|\s)pri:[A-Z](?=\s|$)/.test(line)) line += ` pri:${priority[1]}`; }
    return this.update(snapshot, { line: `x ${localDay()} ${line}` });
  }
  reopen(snapshot) {
    if (!snapshot.completed) throw new Error('Task is already open.');
    let line = snapshot.rawLine.slice(2); const date = /^(\d{4}-\d{2}-\d{2})\s+/.exec(line); if (date && todoDate(date[1])) line = line.slice(date[0].length);
    const priority = /(?:^|\s)pri:([A-Z])(?=\s|$)/.exec(line);
    if (priority && !/^\([A-Z]\)\s/.test(line)) line = `(${priority[1]}) ` + line.replace(/(?:^|\s)pri:[A-Z](?=\s|$)/, '').trim();
    return this.update(snapshot, { line });
  }
}
module.exports = { TodoTxtProvider, parseTodoLine, todoDate, vaultPath, localDay, todoPresentation, todoFields, structuredTodo, selectTodoView };

return module.exports;
})();
const { markdownIndex, ownsIndex } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.8.0-alpha.2. Searchable Markdown snapshots; never write remote tasks back. */
function plain(value) { return String(value || '').replace(/[\r\n]+/g, ' ').replace(/[\[\]<>]/g, '').replace(/\s+/g, ' ').trim(); }
function markdownIndex(provider, items, day) {
  const lines = ['---', `title: ${JSON.stringify('Task2Do — ' + provider)}`, 'description: Task2Do generated task index', `slug: task2do-${provider}`, 'author: LaurentFough', 'type: task-index', `date-created: ${day}`, `date-modified: ${day}`, 'date-published: null', `source: ${JSON.stringify(provider)}`, 'domain: tasks', 'url: null', 'draft: false', 'tags: [task2do, tasks]', 'keywords: [task-index]', 'task2do-owned: true', '---', '', '# Task2Do tasks', '', '> Generated snapshot. Edit tasks in Task2Do or their source. Checkbox changes here do not update the source and are overwritten on refresh.', ''];
  for (const item of items) {
    const title = plain(item.title || item.description || 'Task #' + item.remoteId).replace(/(^|\s)#task(?=\s|$)/g, '$1').slice(0, 1000);
    const due = item.dueDate || (item.due && Number.isFinite(Date.parse(item.due)) ? (() => { const date = new Date(item.due), pad = n => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; })() : '');
    lines.push(`- [${item.completed ? 'x' : ' '}] #task ${title}${due ? ' 📅 ' + due : ''} [provider:: ${plain(provider)}] [remote_id:: ${plain(item.remoteId)}]${item.priority?' [priority:: '+plain(item.priority)+']':''}${item.projects?.length?' [projects:: '+item.projects.map(plain).join(', ')+']':''}${item.contexts?.length?' [contexts:: '+item.contexts.map(plain).join(', ')+']':''}${item.listId ? ' [list_id:: ' + plain(item.listId) + ']' : ''}${item.organizationName ? ' [organization:: ' + plain(item.organizationName) + ']' : ''}${item.assigneeName ? ' [assignee:: ' + plain(item.assigneeName) + ']' : ''}${item.source ? ' [source_file:: ' + plain(item.source) + ']' : ''}`);
    if (item.description) lines.push('  > ' + plain(item.description));
  }
  return lines.join('\n') + '\n';
}
function ownsIndex(content) { const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content); return !!frontmatter && /(?:^|\r?\n)task2do-owned: true(?:\r?\n|$)/.test(frontmatter[1]); }
module.exports = { markdownIndex, ownsIndex };

return module.exports;
})();
const { vaultStorage } = (() => {
const module = { exports: {} };
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

return module.exports;
})();
const { MoovilaProvider } = (() => {
const module = { exports: {} };
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

return module.exports;
})();
const { OpenProjectProvider } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.8.0-alpha.2. OpenProject API v3 HAL/forms with optimistic locking. */
function opId(value) { if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Select a valid OpenProject ID.'); return String(value); }
function openProjectConfig(config) {
  const url = new URL(config.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /%|\\/.test(url.pathname)) throw new Error('Use an HTTPS OpenProject instance URL, optionally with its installation subpath.');
  let path = url.pathname.replace(/\/$/, '').replace(/\/api\/v3$/, '');
  const token = config.token;
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('Enter an OpenProject API key.');
  if (config.projectId) opId(config.projectId);
  return { baseUrl: url.origin + path, api: url.origin + path + '/api/v3/', token: token.trim(), projectId: config.projectId ? opId(config.projectId) : '', caPem: typeof config.caPem === 'string' ? config.caPem : '', enableWrites: config.enableWrites === true };
}
function opDay(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('Choose a valid date.'); const d = new Date(value+'T00:00:00Z'); if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==value) throw new Error('Choose a valid date.'); return value; }
function opDue(day) { if (!day) return undefined; opDay(day); const [y,m,d]=day.split('-').map(Number); return new Date(y,m-1,d,23,59,59,999).toISOString(); }
class OpenProjectProvider {
  constructor(config, transport, log = () => {}) { this.id = 'openproject'; this.config = openProjectConfig(config); this.transport = transport; this.log = log; this.pending = new Set(); this.disposed = false; this.capabilities = Object.freeze({ read: true, create: this.config.enableWrites, update: this.config.enableWrites, complete: this.config.enableWrites, reopen: this.config.enableWrites, comment: false }); }
  dispose() { this.disposed = true; this.config.token = ''; }
  url(path) { const url = new URL(path, this.config.api); const api = new URL(this.config.api); if (url.origin !== api.origin || !url.pathname.startsWith(api.pathname) || url.username || url.password || url.hash || /%2f|%5c|%2e/i.test(url.pathname)) throw new Error('Rejected unexpected OpenProject API link.'); return url.href; }
  async request(path, method = 'GET', body) {
    if (this.disposed) throw new Error('OpenProject disconnected.');
    let response;
    try { response = await this.transport({ url: this.url(path), method, headers: { Authorization: 'Basic ' + Buffer.from('apikey:'+this.config.token,'utf8').toString('base64'), Accept: 'application/hal+json', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), throw: false }); }
    catch (e) { const tls = /CERT|certificate|self.signed|issuer|hostname/i.test(e.code || e.message || ''); throw new Error(method === 'GET' ? tls ? 'OpenProject TLS trust failed. Check hostname and configure your CA/self-signed PEM certificate.' : 'OpenProject request failed. Check instance URL and connectivity.' : 'OpenProject request outcome unknown. Refresh and inspect the source before retrying.'); }
    this.log({ event: 'openproject.request', method, status: response.status });
    if (response.status < 200 || response.status >= 300) throw new Error(response.status === 409 ? 'OpenProject task changed remotely. Refresh first.' : response.status >= 300 && response.status < 400 ? 'OpenProject redirected the request. Configure the final HTTPS instance URL.' : `OpenProject returned HTTP ${response.status}. Check API key, permissions and required fields. No write was retried.`);
    if (!response.json || typeof response.json !== 'object') throw new Error('Unexpected OpenProject response. Refresh before retrying a write.');
    return response.json;
  }
  async collection(path) {
    const items = [], pages = new Set();
    for (let page=0;page<1000;page++) { const url = this.url(path); if (pages.has(url)) throw new Error('Repeated OpenProject page.'); pages.add(url); const data = await this.request(url); if (!Array.isArray(data._embedded?.elements)) throw new Error('OpenProject did not return a HAL collection.'); items.push(...data._embedded.elements); const next=data._links?.nextByOffset?.href || data._links?.next?.href; if (!next) { if (Number.isFinite(data.total) && items.length<data.total) throw new Error('OpenProject collection is incomplete.'); return items; } path=next; }
    throw new Error('OpenProject pagination limit reached.');
  }
  destinations() { return this.collection('projects?pageSize=100'); }
  async list() {
    const statuses=await this.collection('statuses'); const closed=new Map(statuses.map(s=>[this.url(s._links?.self?.href || 'statuses/0'),s.isClosed]));
    const path=this.config.projectId ? `projects/${this.config.projectId}/work_packages?pageSize=100` : 'work_packages?pageSize=100';
    return (await this.collection(path)).map(raw=>this.normalize(raw,closed));
  }
  normalize(raw, closed = new Map()) {
    const id=opId(raw.id), status=raw._embedded?.status;
    const statusClosed = status?.isClosed ?? closed.get(this.url(raw._links?.status?.href || 'statuses/0'));
    if (typeof statusClosed !== 'boolean') throw new Error('OpenProject status could not be classified. Refresh or check status access.');
    return { provider:this.id,remoteId:id,title:raw.subject||'',description:raw.description?.raw||'',dueDate:raw.dueDate||undefined,due:opDue(raw.dueDate),start:raw.startDate,completed:statusClosed,lockVersion:raw.lockVersion,modified:raw.updatedAt,listName:raw._links?.project?.title||'Project',assigneeName:raw._links?.assignee?.title||'Unassigned',statusName:raw._links?.status?.title||status?.name||'',raw };
  }
  async form(snapshot = null, projectId = '', payload = {}) {
    const path=snapshot ? `work_packages/${opId(snapshot.remoteId)}/form` : `projects/${opId(projectId)}/work_packages/form`;
    return this.request(path,'POST',snapshot ? { lockVersion:snapshot.lockVersion,...payload } : payload);
  }
  async choices(form, field) {
    const schema=form._embedded?.schema?.[field]; if (!schema || schema.writable===false) return [];
    const link=schema._links?.allowedValues?.href;
    const embedded=schema._embedded?.allowedValues;
    const values=Array.isArray(embedded) ? embedded : Array.isArray(schema.allowedValues) ? schema.allowedValues : Array.isArray(schema._links?.allowedValues) ? schema._links.allowedValues.map(v=>({name:v.title,_links:{self:{href:v.href}}})) : link ? await this.collection(link) : [];
    let mapped=values.map(v=>({href:v._links?.self?.href,name:v.name||v.title||`#${v.id}`,id:v.id,isClosed:v.isClosed})).filter(v=>v.href).map(v=>{this.url(v.href);return v;});
    if(field==='status'&&mapped.some(v=>typeof v.isClosed!=='boolean')){const statuses=await this.collection('statuses');const closed=new Map(statuses.map(s=>[this.url(s._links?.self?.href||'statuses/0'),s.isClosed]));mapped=mapped.map(v=>({...v,isClosed:closed.get(this.url(v.href))}));}
    return mapped;
  }
  payload(values) {
    const result={};
    for (const key of Object.keys(values)) if (!['title','description','startDate','dueDate','type','status','assignee'].includes(key)) throw new Error('Unsupported OpenProject field.');
    if (values.title!==undefined) { if (typeof values.title!=='string'||!values.title.trim()||values.title.length>255) throw new Error('Enter a title of 1–255 characters.'); result.subject=values.title.trim(); }
    if (values.description!==undefined) { if(typeof values.description!=='string'||values.description.length>32000) throw new Error('Description must be at most 32,000 characters.');result.description={format:'markdown',raw:values.description}; }
    for(const key of ['startDate','dueDate']) if(values[key]!==undefined) result[key]=values[key] ? opDay(values[key]) : null;
    if(result.startDate&&result.dueDate&&result.startDate>result.dueDate)throw new Error('Due date cannot precede start date.');
    for(const field of ['type','status','assignee'])if(values[field]!==undefined){if(!result._links)result._links={}; if(values[field]){this.url(values[field]);result._links[field]={href:values[field]};}else if(field==='assignee')result._links[field]={href:null};else throw new Error(`Choose ${field}.`);}
    return result;
  }
  validateForm(form) { const errors=form._embedded?.validationErrors; if (errors && Object.keys(errors).length) throw new Error('OpenProject requires corrections to: '+Object.keys(errors).join(', ')+'. Complete required custom fields in OpenProject if not offered here.'); if(!form._embedded?.payload)throw new Error('OpenProject form did not return a payload.'); }
  async create(projectId, values) {
    if(!this.capabilities.create)throw new Error('Enable OpenProject writes first.');
    const payload=this.payload(values); if(!payload.subject)throw new Error('Enter a title.'); const form=await this.form(null,projectId,payload);this.validateForm(form);
    const response=await this.request(`projects/${opId(projectId)}/work_packages`,'POST',form._embedded.payload);
    const id=opId(response.id), read=await this.request(`work_packages/${id}`);if(String(read.id)!==id||read.subject!==payload.subject||!read._links?.project?.href||this.url(read._links.project.href)!==this.url(`projects/${opId(projectId)}`)||['startDate','dueDate'].some(k=>payload[k]!==undefined&&read[k]!==payload[k])||payload.description&&read.description?.raw!==payload.description.raw||payload._links&&Object.keys(payload._links).some(k=>(read._links?.[k]?.href??null)!==payload._links[k].href))throw new Error('OpenProject creation could not be verified. Inspect the source before creating again.');return read;
  }
  async transition(snapshot, href, closed) {
    const choices=await this.choices(await this.form(snapshot), 'status');
    if (!choices.some(c=>c.href===href&&c.isClosed===closed)) throw new Error('Choose an allowed '+(closed?'closed':'open')+' status.');
    return this.update(snapshot,{status:href});
  }
  complete(snapshot, href) { return this.transition(snapshot,href,true); }
  reopen(snapshot, href) { return this.transition(snapshot,href,false); }
  async update(snapshot, values) {
    if(!this.capabilities.update)throw new Error('Enable OpenProject writes first.'); if(!Number.isInteger(snapshot.lockVersion)||snapshot.lockVersion<0)throw new Error('Invalid OpenProject version. Refresh first.'); const id=opId(snapshot.remoteId);if(this.pending.has(id))throw new Error('OpenProject update already running.');const payload=this.payload(values);if(!Object.keys(payload).length)throw new Error('No changes.');this.pending.add(id);
    try {const raw=await this.request(`work_packages/${id}`);if(String(raw.id)!==id||raw.lockVersion!==snapshot.lockVersion)throw new Error('OpenProject task changed remotely. Refresh first.');const form=await this.form(snapshot,'',payload);this.validateForm(form);await this.request(`work_packages/${id}`,'PATCH',{...payload,lockVersion:raw.lockVersion});const read=await this.request(`work_packages/${id}`);if(String(read.id)!==id||['subject','startDate','dueDate'].some(k=>payload[k]!==undefined&&read[k]!==payload[k])||payload.description&&read.description?.raw!==payload.description.raw||payload._links&&Object.keys(payload._links).some(k=>(read._links?.[k]?.href??null)!==payload._links[k].href))throw new Error('OpenProject update could not be verified. Inspect source before retrying.');return read;} finally {this.pending.delete(id);}
  }
}
module.exports={OpenProjectProvider,openProjectConfig,opDay};

return module.exports;
})();
const { desktopHttps } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.8.0-alpha.2. Per-instance HTTPS trust; no redirect or global TLS overrides. */
function desktopHttps(origin, caPem = '') {
  const base = new URL(origin); if (base.protocol !== 'https:') throw new Error('HTTPS is required.');
  if (caPem && (!/-----BEGIN CERTIFICATE-----/.test(caPem) || /PRIVATE KEY/.test(caPem))) throw new Error('Paste a public certificate/CA bundle in PEM format, never a private key.');
  return async options => {
    const url = new URL(options.url);
    if (url.origin !== base.origin || url.username || url.password) throw new Error('Rejected unexpected OpenProject host.');
    const https = require('node:https');
    if (caPem) { const { X509Certificate } = require('node:crypto'); const blocks = caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g); if (!blocks?.length) throw new Error('Invalid PEM certificate.'); for (const block of blocks) new X509Certificate(block); }
    return new Promise((resolve, reject) => {
      const req = https.request(url, { method: options.method || 'GET', headers: options.headers, agent: false, rejectUnauthorized: true, ...(caPem ? { ca: caPem } : {}) }, res => {
        const chunks = []; let size = 0;
        res.on('data', data => { size += data.length; if (size > 20*1024*1024) { res.destroy(); req.destroy(new Error('Response size limit exceeded.')); } else chunks.push(data); });
        res.on('error', reject);
        res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, json }); });
      });
      req.setTimeout(30000, () => req.destroy(new Error('Request timed out.')));
      req.on('error', reject); req.end(options.body);
    });
  };
}
module.exports = { desktopHttps };

return module.exports;
})();
const { MicrosoftPlannerProvider } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.8.0-alpha.2. Basic group-backed Microsoft Planner plans with ETag guarded writes. */
function plannerId(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error('Enter a valid Planner ID.'); return value; }
function entraId(value) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) throw new Error('Choose a valid Entra user ID.'); return value.toLowerCase(); }
function plannerDate(value) { if (value === null || value === '') return null; if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,7})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Choose an ISO date/time with timezone.'); return new Date(value).toISOString(); }
class MicrosoftPlannerProvider {
  constructor(auth, transport, config, log = () => {}) { this.id='microsoft-planner';this.auth=auth;this.transport=transport;this.log=log;this.planIds=[...new Set(String(config.planIds||'').split(/[\s,;]+/).filter(Boolean).map(plannerId))];this.pending=new Set();this.disposed=false;this.capabilities=Object.freeze({read:true,create:true,update:true,complete:true,reopen:true,comment:false}); }
  dispose(){this.disposed=true;}
  async request(path,method='GET',body,etag){
    if(this.disposed)throw new Error('Planner disconnected.');const url=new URL(path,'https://graph.microsoft.com/v1.0/');
    if(url.origin!=='https://graph.microsoft.com'||url.username||url.password||!/^\/v1\.0\/(planner\/(plans|tasks|buckets)(\/|$)|groups\/[0-9a-f-]+\/members(?:\/|$)|users\/[0-9a-f-]+$)/i.test(url.pathname))throw new Error('Rejected unexpected Planner Graph URL.');
    let response;try{response=await this.transport({url:url.href,method,headers:{Authorization:`Bearer ${await this.auth.accessToken()}`,'Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),throw:false});}catch{throw new Error(method==='GET'?'Planner request failed. Check sign-in.':'Planner write outcome unknown. Inspect Planner before retrying.');}
    this.log({event:'planner.request',method,status:response.status});if(response.status<200||response.status>=300)throw new Error([409,412].includes(response.status)?'Planner changed remotely. Refresh first.':`Planner returned HTTP ${response.status}. Check work/school sign-in, Tasks.ReadWrite and GroupMember.Read.All, plan membership and basic-plan access.`);
    if(response.status===204)return{};if(!response.json||typeof response.json!=='object')throw new Error('Unexpected Planner response. Inspect source before retrying a write.');return response.json;
  }
  async collection(path){const result=[],seen=new Set();for(let page=0;page<100;page++){if(seen.has(path))throw new Error('Repeated Planner pagination URL.');seen.add(path);const raw=await this.request(path);if(!Array.isArray(raw.value))throw new Error('Planner did not return a collection.');result.push(...raw.value);if(!raw['@odata.nextLink'])return result;path=raw['@odata.nextLink'];}throw new Error('Planner pagination limit reached.');}
  async destinations(){if(!this.planIds.length)throw new Error('Configure one or more basic Planner plan IDs, then sign in with a work/school account.');const plans=[];for(const id of this.planIds){const plan=await this.request(`planner/plans/${id}`);if(plan.id!==id)throw new Error('Planner plan identity mismatch.');plans.push(plan);}return plans;}
  buckets(id){plannerId(id);if(!this.planIds.includes(id))throw new Error('Plan is not configured.');return this.collection(`planner/plans/${id}/buckets`);}
  async members(planId){if(!this.planIds.includes(plannerId(planId)))throw new Error('Plan is not configured.');const plan=await this.request(`planner/plans/${planId}`);const group=plan.owner||plan.container?.containerId;entraId(group);return(await this.collection(`groups/${group}/members?$select=id,displayName,mail,userPrincipalName`)).filter(v=>v['@odata.type']==='#microsoft.graph.user').map(v=>({id:entraId(v.id),name:v.displayName||v.userPrincipalName||v.id,email:v.mail||v.userPrincipalName||''}));}
  normalize(task,details,plan,buckets=[],members=[]){plannerId(task.id);return{provider:this.id,remoteId:task.id,listId:task.planId,listName:plan.title||'Planner',bucketId:task.bucketId,title:task.title||'',description:details.description||'',start:task.startDateTime,due:task.dueDateTime,completed:task.percentComplete===100,percentComplete:task.percentComplete||0,assigneeIds:Object.keys(task.assignments||{}),assigneeName:Object.keys(task.assignments||{}).map(id=>members.find(m=>m.id.toLowerCase()===id.toLowerCase())?.name||id).join(', ')||'Unassigned',statusName:buckets.find(b=>b.id===task.bucketId)?.name||'',etag:task['@odata.etag'],detailsEtag:details['@odata.etag'],references:details.references||{},raw:task};}
  async get(id){const task=await this.request(`planner/tasks/${plannerId(id)}`);if(!this.planIds.includes(task.planId))throw new Error('Planner task is outside configured plans.');const details=await this.request(`planner/tasks/${id}/details`);return this.normalize(task,details,{title:task.planId});}
  async list(){const result=[];for(const plan of await this.destinations()){const buckets=await this.buckets(plan.id),members=await this.members(plan.id);for(const task of await this.collection(`planner/plans/${plan.id}/tasks`)){if(task.planId!==plan.id)throw new Error('Planner returned a task from another plan.');result.push(this.normalize(task,await this.request(`planner/tasks/${plannerId(task.id)}/details`),plan,buckets,members));}}return result;}
  async payload(planId,values,original={}){
    if(!this.planIds.includes(plannerId(planId)))throw new Error('Plan is not configured.');const body={};
    for(const key of Object.keys(values))if(!['title','description','start','due','bucketId','assigneeIds','percentComplete'].includes(key))throw new Error('Unsupported Planner field.');
    if(values.title!==undefined){if(typeof values.title!=='string'||!values.title.trim()||values.title.length>255)throw new Error('Enter a title of 1–255 characters.');body.title=values.title.trim();}
    if(values.description!==undefined&&(typeof values.description!=='string'||values.description.length>32000))throw new Error('Description must be at most 32,000 characters.');
    for(const [field,key]of [['start','startDateTime'],['due','dueDateTime']])if(values[field]!==undefined)body[key]=plannerDate(values[field]);
    const start=Object.hasOwn(body,'startDateTime')?body.startDateTime:original.startDateTime,due=Object.hasOwn(body,'dueDateTime')?body.dueDateTime:original.dueDateTime;if(start&&due&&Date.parse(start)>Date.parse(due))throw new Error('Due date cannot precede start.');
    if(values.bucketId!==undefined){if(!(await this.buckets(planId)).some(b=>b.id===values.bucketId))throw new Error('Choose a bucket from the destination plan.');body.bucketId=values.bucketId;}
    if(values.assigneeIds!==undefined){if(!Array.isArray(values.assigneeIds)||values.assigneeIds.length>20)throw new Error('Choose up to 20 assignees.');const ids=[...new Set(values.assigneeIds.map(entraId))],members=await this.members(planId);if(ids.some(id=>!members.some(m=>m.id.toLowerCase()===id.toLowerCase())))throw new Error('Mapped assignee is not a current destination group member.');body.assignments={};for(const id of Object.keys(original.assignments||{}))if(!ids.includes(id))body.assignments[id]=null;for(const id of ids)if(!original.assignments?.[id])body.assignments[id]={'@odata.type':'#microsoft.graph.plannerAssignment',orderHint:' !'};}
    if(values.percentComplete!==undefined){if(!Number.isInteger(values.percentComplete)||values.percentComplete<0||values.percentComplete>100)throw new Error('Invalid Planner progress.');body.percentComplete=values.percentComplete;}return body;
  }
  async writeDescription(id,value,expected){const details=await this.request(`planner/tasks/${id}/details`);if(!details['@odata.etag']||(expected&&details['@odata.etag']!==expected))throw new Error('Planner description changed remotely. Refresh first.');await this.request(`planner/tasks/${id}/details`,'PATCH',{description:value},details['@odata.etag']);const check=await this.request(`planner/tasks/${id}/details`);if(check.description!==value)throw new Error('Planner description update unverified. Inspect source.');}
  async create(planId,values){const body=await this.payload(planId,values);if(!body.title)throw new Error('Enter a title.');const task=await this.request('planner/tasks','POST',{planId,...body});plannerId(task.id);try{if(values.description)await this.writeDescription(task.id,values.description);const checked=await this.get(task.id);if(checked.title!==body.title||checked.listId!==planId)throw new Error('Planner creation readback mismatch.');return checked;}catch(e){e.remoteId=task.id;e.message=`Planner task ${task.id} was created; finishing/verification failed. Inspect it before another creation. ${e.message}`;throw e;}}
  async update(snapshot,values){const id=plannerId(snapshot.remoteId);if(this.pending.has(id))throw new Error('Planner update already running.');this.pending.add(id);try{const raw=await this.request(`planner/tasks/${id}`);if(!raw['@odata.etag']||raw['@odata.etag']!==snapshot.etag||raw.planId!==snapshot.listId)throw new Error('Planner changed remotely. Refresh first.');const body=await this.payload(raw.planId,values,raw);if(Object.keys(body).length)await this.request(`planner/tasks/${id}`,'PATCH',body,raw['@odata.etag']);if(values.description!==undefined)await this.writeDescription(id,values.description,snapshot.detailsEtag);const check=await this.get(id);if(values.start!==undefined&&(check.start?Date.parse(check.start):null)!==(values.start?Date.parse(values.start):null)||values.bucketId!==undefined&&check.bucketId!==values.bucketId||values.assigneeIds!==undefined&&JSON.stringify(check.assigneeIds.map(entraId).sort())!==JSON.stringify([...new Set(values.assigneeIds.map(entraId))].sort())||values.title!==undefined&&check.title!==values.title.trim()||values.description!==undefined&&check.description!==values.description||values.percentComplete!==undefined&&check.percentComplete!==values.percentComplete||values.due!==undefined&&(check.due?Date.parse(check.due):null)!==(values.due?Date.parse(values.due):null))throw new Error('Planner update unverified. Inspect source before retrying.');return check;}finally{this.pending.delete(id);}}
  complete(item){return this.update(item,{percentComplete:100});}reopen(item){return this.update(item,{percentComplete:0});}
}
module.exports={MicrosoftPlannerProvider,plannerId,entraId};

return module.exports;
})();
const { TaskSyncEngine, localCanonical } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.8.0-alpha.2. Local catalogs, stable task identity and durable reviewed-push journal. */
function syncDay(iso) { const d=new Date(iso||Date.now()),pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function canonicalTask(t){return{title:t.title||String(t.description||'').split(/\r\n|\n|\r/)[0],description:typeof t.description==='string'?t.description:t.title||'',due:t.due?new Date(t.due).toISOString():null,start:t.start?new Date(t.start).toISOString():null,completed:!!t.completed,assigneeId:t.assigneeId==null?null:String(t.assigneeId),companyId:t.companyId==null?null:String(t.companyId),...(t.provider==='microsoft-planner'?{bucketId:t.bucketId||null}:{}),assigneeIds:(t.assigneeIds || (t.assigneeId==null?[]:[String(t.assigneeId)])).slice().sort()};}
function syncEqual(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function syncTokens(text){const result={},scoped=String(text).includes(' titleEnd:1')?String(text).slice(String(text).indexOf(' titleEnd:1')+11):String(text);for(const m of scoped.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_-]*):([^\s]+)/g))result[m[1]]=m[2];Object.defineProperty(result,"originalLine",{value:String(text)});return result;}
function syncTitle(item){const boundary=String(item.title||'').indexOf(' titleEnd:1');if(boundary>=0)return String(item.title).slice(0,boundary);const imported=/^(.*?) \+Autotask (?=(?:due:\S+ )?uid:)/.exec(String(item.title||''));if(imported)return imported[1];return String(item.title||'').split(/\s+/).filter(t=>!/^([+@]\S+|[A-Za-z][A-Za-z0-9_-]*:[^\s]+)$/.test(t)||/^https?:\/\//.test(t)).join(' ').trim();}
function localCanonical(item){const meta=syncTokens(item.rawLine);let details='';try{details=meta.details?decodeURIComponent(meta.details):'';}catch{throw new Error('Invalid encoded task details.');}const title=syncTitle(item);let due=meta.endDateTime||item.due||null;if(item.dueDate&&due&&syncDay(due)!==item.dueDate){const old=new Date(due),[y,m,d]=item.dueDate.split('-').map(Number);due=new Date(y,m-1,d,old.getHours(),old.getMinutes(),old.getSeconds(),old.getMilliseconds()).toISOString();}if(due&&!Number.isFinite(Date.parse(due)))throw new Error('Invalid local deadline.');return{title,description:meta.source==='autotask-todo'?title+(meta.hasDetails==='1'?(meta.separator?decodeURIComponent(meta.separator):'\n')+details:details?'\n'+details:''):details,due:due?new Date(due).toISOString():null,start:meta.startDateTime?new Date(meta.startDateTime).toISOString():meta.t?new Date(meta.t+'T00:00:00').toISOString():null,completed:!!item.completed,assigneeId:meta.assignedToResourceID||null,companyId:meta.companyID||null,assigneeIds:meta.assignedToResourceID?[meta.assignedToResourceID]:[]};}
function importedLine(task,uid,namespace,oldMeta={}){const c=canonicalTask(task),title=String(c.title).replace(/[\r\n]+/g,' ').trim();const full=String(c.description),breakMatch=/\r\n|\n|\r/.exec(full),body=breakMatch?full.slice(breakMatch.index+breakMatch[0].length):'';const token=(k,v)=>v==null||v===''?'':` ${k}:${(/Name$|^details$|^separator$/.test(k)?encodeURIComponent(String(v)):String(v))}`;const original=oldMeta.originalLine||'',prefix=/^(?:x (?:\d{4}-\d{2}-\d{2} )?)?(?:\(([A-Z])\) )?(\d{4}-\d{2}-\d{2}) /.exec(original),priority=prefix?.[1],extra=original.split(' +Autotask ')[1]?.match(/(?:^|\s)[+@]\S+/g)||[];return `${c.completed?'x '+syncDay(task.completedAt)+' ':''}${!c.completed&&priority?'('+priority+') ':''}${prefix?.[2]||syncDay()} ${title} +Autotask${c.due?' due:'+syncDay(c.due):''} uid:${uid} source:autotask-todo remoteId:${task.remoteId} sourceInstance:${encodeURIComponent(namespace)}${token('companyID',c.companyId)}${token('companyName',task.organizationName||oldMeta.companyName&&decodeURIComponent(oldMeta.companyName))}${token('assignedToResourceID',c.assigneeId)}${token('resourceName',task.assigneeName||oldMeta.resourceName&&decodeURIComponent(oldMeta.resourceName))}${token('creatorResourceID',task.creatorId)}${token('startDateTime',c.start)}${token('endDateTime',c.due)}${breakMatch?' hasDetails:1'+token('separator',breakMatch[0]):''}${token('details',body)}${Object.entries(oldMeta).filter(([k])=>!['due','uid','source','remoteId','sourceInstance','companyID','companyName','assignedToResourceID','resourceName','creatorResourceID','startDateTime','endDateTime','hasDetails','separator','details','titleEnd'].includes(k)).map(([k,v])=>' '+k+':'+v).join('')}${c.completed&&priority&&!oldMeta.pri?' pri:'+priority:''}${extra.map(t=>' '+t.trim()).join('')}`;}
function syncInstance(source){return source.apiResourceId?source.base+'#api-resource='+source.apiResourceId:source.base;}
function threeWay(base,local,remote){const merged={...local},conflicts=[];for(const field of Object.keys(base)){if(syncEqual(local[field],remote[field]))continue;if(syncEqual(local[field],base[field]))merged[field]=remote[field];else if(!syncEqual(remote[field],base[field]))conflicts.push(field);}return{merged,conflicts};}
class TaskSyncEngine {
  constructor(context,storage,uuid){this.context=context;this.storage=storage;this.uuid=uuid;this.queue=Promise.resolve();}
  run(fn){const operation=this.queue.catch(()=>{}).then(fn);this.queue=operation;return operation;}
  async json(name,fallback){const raw=await this.storage.read(name);if(!raw)return{raw,value:fallback};let value;try{value=JSON.parse(raw);}catch{throw new Error(`${name} is not valid JSON. Repair it before syncing.`);}if(value.schemaVersion!==1)throw new Error('Unsupported sync document version.');return{raw,value};}
  async state(){const loaded=await this.json('sync-state.json',{schemaVersion:1,revision:0,records:{}});if(!loaded.value.records||typeof loaded.value.records!=='object')throw new Error('Invalid sync records.');return loaded;}
  async save(name,loaded){loaded.value.revision=(loaded.value.revision||0)+1;const raw=JSON.stringify(loaded.value,null,2)+'\n';await this.storage.write(name,raw,loaded.raw);loaded.raw=raw;}
  async rows(){if(this.context.todo.ensureIdentities)await this.context.todo.ensureIdentities();const text=await this.context.todo.storage.read(),parts=text.split(/(\r\n|\n|\r)/),items=[],uids=new Set();for(let i=0;i<parts.length;i+=2){const item=this.context.parse(parts[i],i/2,this.context.todo.path);if(item){const uid=syncTokens(item.rawLine).uid;if(uid){if(!/^[0-9a-f-]{36}$/i.test(uid)||uids.has(uid))throw new Error('Duplicate or invalid task UID in todo.txt. Resolve before syncing.');uids.add(uid);}items.push({...item,uid,part:i});}}return{text,parts,items};}
  async pull(){return this.run(async()=>{
    const source=this.context.autotask();if(!source)throw new Error('Connect Autotask first.');const catalogs=await source.catalogs(),tasks=await source.enrich(await source.listForUser());const state=await this.state(),rows=await this.rows(),conflicts=[];let imported=0,updated=0;
    for(const task of tasks){const instance=syncInstance(source),key=instance+'#'+task.remoteId;let entry=Object.entries(state.value.records).find(([,r])=>r.source?.key===key);let uid=entry?.[0];if(!uid){const existing=rows.items.find(t=>{const m=syncTokens(t.rawLine);return m.source==='autotask-todo'&&m.remoteId===task.remoteId&&m.sourceInstance===encodeURIComponent(instance);});uid=existing?.uid||this.uuid();}
      const record=state.value.records[uid],row=rows.items.find(t=>t.uid===uid),canonical=canonicalTask(task),line=importedLine(task,uid,instance,row?syncTokens(row.rawLine):{});
      if(record&&row){if(!syncEqual(canonical,record.baseSource)&&row.rawLine!==record.baseLine){record.conflict={kind:'pull',remote:canonical,local:localCanonical(row),fields:threeWay(record.baseSource,localCanonical(row),canonical).conflicts};conflicts.push(uid);continue;}if(syncEqual(canonical,record.baseSource))continue;if(row.rawLine===record.baseLine){rows.parts[row.part]=line;record.baseSource=canonical;record.baseLine=line;record.conflict=null;updated++;}}
      else if(record&&!row){record.conflict={kind:'local-missing'};conflicts.push(uid);continue;}
      else{if(row){state.value.records[uid]={source:{provider:'autotask-todo',id:task.remoteId,key,namespace:instance},baseSource:canonical,baseLine:row.rawLine,remotes:{},conflict:{kind:'orphaned-state',remote:canonical,local:localCanonical(row)}};conflicts.push(uid);continue;}else{const text=rows.parts.join('');rows.parts.push((text&&!/[\r\n]$/.test(text)?'\n':'')+line+'\n');}state.value.records[uid]={source:{provider:'autotask-todo',id:task.remoteId,key,namespace:instance},baseSource:canonical,baseLine:line,remotes:{},conflict:null};imported++;}
    }
    const next=rows.parts.join('');if(next!==rows.text)await this.context.todo.storage.write(next,rows.text);await this.save('sync-state.json',state);const cat=await this.json('catalogs.json',{schemaVersion:1});cat.value={schemaVersion:1,source:source.base,updatedAt:new Date().toISOString(),...catalogs};await this.save('catalogs.json',cat);return{imported,updated,conflicts:conflicts.length};
  });}
  async mappings(){const m=await this.json('mappings.json',{schemaVersion:1,users:{},companies:{}});if(!m.value.users||!m.value.companies)throw new Error('Invalid mappings.');return m;}
  /**= Adopt a local task and save explicit destination choices before any remote write. */
  async mapLocal(uid,target,mapping){return this.run(async()=>{
    if(!['microsoft-todo','microsoft-planner'].includes(target))throw new Error('Choose Microsoft To Do or Planner.');const rows=await this.rows(),row=rows.items.find(r=>r.uid===uid);if(!row)throw new Error('Local task missing.');const tokens=syncTokens(row.rawLine);if(tokens.source==='autotask-todo')throw new Error('Use company/user mappings for imported Autotask tasks.');const provider=this.context.provider(target);if(!provider)throw new Error('Connect destination first.');const destination=target==='microsoft-planner'?mapping.planId:mapping.listId;if(!(await provider.destinations()).some(d=>d.id===destination))throw new Error('Choose an available destination.');if(target==='microsoft-planner')await provider.payload(destination,{bucketId:mapping.bucketId,assigneeIds:mapping.assigneeIds||[]});
    const state=await this.state();let record=state.value.records[uid];if(record&&record.source.provider!=='todotxt')throw new Error('Task already belongs to another source.');if(record?.remotes[target]&&record.remotes[target].ref.listId!==destination)throw new Error('Existing binding targets another list/plan. Reconcile before remapping.');if(!record)state.value.records[uid]={source:{provider:'todotxt',id:uid,key:this.context.todo.path+'#'+uid,namespace:this.context.todo.path},baseLine:row.rawLine,baseSource:localCanonical(row),remotes:{},conflict:null};
    const maps=await this.mappings();maps.value.local=maps.value.local||{};maps.value.local[uid]=maps.value.local[uid]||{};maps.value.local[uid][target]={...(target==='microsoft-planner'?{planId:destination,bucketId:mapping.bucketId,assigneeIds:mapping.assigneeIds||[]}:{listId:destination}),reviewed:new Date().toISOString()};await this.save('sync-state.json',state);await this.save('mappings.json',maps);
  });}
  async resolveLocalConflict(uid,choice){return this.run(async()=>{const state=await this.state(),record=state.value.records[uid],rows=await this.rows(),row=rows.items.find(t=>t.uid===uid);if(!record||!row)throw new Error('Local row missing.');if(!['local','destination'].includes(choice))throw new Error('Choose local or destination.');let selected=localCanonical(row);if(choice==='destination'){if(record.conflict?.kind!=='destination'||!record.conflict.remote)throw new Error('No single destination version available.');selected=record.conflict.remote;}
    for(const [target,binding]of Object.entries(record.remotes)){const p=this.context.provider(target);if(!p)throw new Error('Connect bound destinations first.');const remote=canonicalTask(await p.get(target==='microsoft-planner'?binding.ref.remoteId:binding.ref));if(choice==='destination'&&target===record.conflict.target&&!syncEqual(remote,record.conflict.snapshot))throw new Error('Destination changed again. Refresh before resolving.');binding.baseRemote=remote;binding.baseLocal=selected;}
    if(choice==='destination'){rows.parts[row.part]=this.localLine(selected,row);await this.context.todo.storage.write(rows.parts.join(''),rows.text);}record.conflict=null;await this.save('sync-state.json',state);
  });}
  localLine(value,row){if(!this.context.serialize)throw new Error('Local serializer unavailable.');const description=value.description;let line=this.context.serialize({title:value.title,description,dueDate:value.due?syncDay(value.due):'',startDate:value.start?syncDay(value.start):''},row);line=line.replace(/(?:^|\s)(?:startDateTime|endDateTime):[^\s]+/g,'').trim();if(value.start)line+=' startDateTime:'+value.start;if(value.due)line+=' endDateTime:'+value.due;if(value.completed!==row.completed){if(value.completed){const priority=/^\(([A-Z])\) /.exec(line);line='x '+syncDay()+' '+line.replace(/^\([A-Z]\) /,'')+(priority?' pri:'+priority[1]:'');}else{line=line.replace(/^x (?:\d{4}-\d{2}-\d{2} )?/,'');const priority=/(?:^|\s)pri:([A-Z])(?:\s|$)/.exec(line);if(priority)line='('+priority[1]+') '+line.replace(/(?:^|\s)pri:[A-Z](?=\s|$)/,'').trim();}}return line;}
  async preview(uid,target,allowPersonal=false){
    if(!['microsoft-todo','microsoft-planner'].includes(target))throw new Error('This sync release supports Microsoft destinations; OpenProject/Moovila are deferred.');
    const rows=await this.rows(),row=rows.items.find(t=>t.uid===uid);if(!row)throw new Error('Choose a task with a stable UID.');const state=await this.state(),record=state.value.records[uid];if(!record||record.conflict)throw new Error('Review the local mapping or resolve the task conflict first.');const native=record.source.provider==='todotxt';let source,fresh;
    if(!native){source=this.context.autotask();if(!source)throw new Error('Connect the source Autotask instance.');if(source.resolveCreatorResourceIds)await source.resolveCreatorResourceIds();if(syncInstance(source)!==record.source.namespace)throw new Error('Connect the original Autotask API account.');fresh=await source.inspectTask(record.source.id);if(!syncEqual(canonicalTask(fresh),record.baseSource))throw new Error('Source changed remotely. Pull before pushing.');}
    else if(record.source.namespace!==this.context.todo.path)throw new Error('Select the original local task file.');
    const maps=await this.mappings(),local=localCanonical(row),company=native?maps.value.local?.[uid]?.[target]:maps.value.companies[local.companyId]?.[target],provider=this.context.provider(target);if(!provider)throw new Error('Connect the destination provider.');if(!company?.reviewed)throw new Error('Review a task-to-destination or company-to-destination mapping first.');let destination,values={title:local.title,description:local.description,due:local.due};
    if(target==='microsoft-planner'){destination=company.planId;const user=native?null:maps.value.users[local.assigneeId];if(!native&&local.assigneeId&&!user?.reviewed)throw new Error('Review this Autotask resource-to-Entra mapping first.');values={...values,start:local.start,bucketId:company.bucketId,assigneeIds:native?(company.assigneeIds||[]):user?[user.entraId]:[],percentComplete:local.completed?100:0};await provider.payload(destination,values);}
    else{destination=company.listId;if(!native&&local.assigneeId!==String(source.resourceId)&&!allowPersonal)throw new Error('Microsoft To Do cannot retain another user assignment. Explicitly choose personal-list ownership or use Planner.');if(!(await provider.destinations()).some(l=>l.id===destination))throw new Error('Mapped To Do list is unavailable.');}
    const binding=record.remotes[target],intent=record.intents?.[target];if(intent&&intent.status!=='verified')throw new Error('An earlier write is unresolved. Reconcile it before another push.');let remote;
    if(binding&&binding.ref.listId!==destination)throw new Error('This task is bound to another destination. Reconcile the existing binding before changing it.');
    if(binding){remote=await provider.get(target==='microsoft-planner'?binding.ref.remoteId:binding.ref);if(!syncEqual(canonicalTask(remote),binding.baseRemote))throw new Error('Destination changed remotely. Refresh/reconcile before pushing.');}
    const noChange = remote && remote.title===values.title && remote.description===values.description && (remote.due?Date.parse(remote.due):null)===(values.due?Date.parse(values.due):null) && remote.completed===local.completed && (target!=='microsoft-planner'||remote.bucketId===values.bucketId&&JSON.stringify((remote.assigneeIds||[]).slice().sort())===JSON.stringify(values.assigneeIds.slice().sort())&&(remote.start?Date.parse(remote.start):null)===(values.start?Date.parse(values.start):null));
    return{uid,target,destination,operation:binding?(noChange?'noop':'update'):'create',values,local,line:row.rawLine,stateRaw:state.raw,mappingsRaw:maps.raw,source:native?local:canonicalTask(fresh),remote,allowPersonal};
  }
  async push(preview){return this.run(async()=>{
    const checked=await this.preview(preview.uid,preview.target,preview.allowPersonal);if(checked.operation!==preview.operation||checked.destination!==preview.destination||checked.line!==preview.line||checked.stateRaw!==preview.stateRaw||checked.mappingsRaw!==preview.mappingsRaw||!syncEqual(checked.values,preview.values))throw new Error('Preview changed. Review it again.');preview=checked;if(checked.operation==='noop')return checked.remote;const state=await this.state(),record=state.value.records[preview.uid],provider=this.context.provider(preview.target);record.intents=record.intents||{};record.intents[preview.target]={status:'submitting',operation:preview.operation,destination:preview.destination,startedAt:new Date().toISOString()};await this.save('sync-state.json',state);
    try{let result;if(preview.operation==='create')result=await provider.create(preview.destination,preview.values);else if(preview.target==='microsoft-planner')result=await provider.update(preview.remote,preview.values);else result=await provider.update(preview.remote,{title:preview.values.title,description:preview.values.description,due:preview.values.due,status:preview.local.completed?'completed':'notStarted'});
      const ref={remoteId:result.remoteId||result.id,listId:preview.destination};if(!ref.remoteId)throw new Error('Creation identity unverified.');record.intents[preview.target].ref=ref;await this.save('sync-state.json',state);
      if(preview.target==='microsoft-todo'&&preview.operation==='create'&&preview.local.completed){const item=await provider.get(ref);await provider.complete(item);}
      const remote=await provider.get(preview.target==='microsoft-planner'?ref.remoteId:ref);if(remote.title!==preview.values.title||remote.description!==preview.values.description||(remote.due?Date.parse(remote.due):null)!==(preview.values.due?Date.parse(preview.values.due):null)||remote.completed!==preview.local.completed||preview.target==='microsoft-planner'&&(remote.bucketId!==preview.values.bucketId||JSON.stringify((remote.assigneeIds||[]).map(v=>v.toLowerCase()).sort())!==JSON.stringify(preview.values.assigneeIds.map(v=>v.toLowerCase()).sort())||(remote.start?Date.parse(remote.start):null)!==(preview.values.start?Date.parse(preview.values.start):null)))throw new Error('Destination readback differs from the reviewed task. Inspect and reconcile before retrying.');record.remotes[preview.target]={ref,baseRemote:canonicalTask(remote),baseLocal:preview.local,allowPersonal:preview.allowPersonal,verifiedAt:new Date().toISOString()};record.intents[preview.target].status='verified';await this.save('sync-state.json',state);return ref;
    }catch(e){record.intents[preview.target].status='needs-review';if(e.remoteId)record.intents[preview.target].ref={remoteId:e.remoteId,listId:preview.destination};await this.save('sync-state.json',state);throw e;}
  });}
  async resolveConflict(uid,choice){if((await this.state()).value.records[uid]?.source.provider==='todotxt')return this.resolveLocalConflict(uid,choice);return this.run(async()=>{
    if(!['remote','local','destination'].includes(choice))throw new Error('Choose local, source or destination values.');const state=await this.state(),record=state.value.records[uid],rows=await this.rows(),row=rows.items.find(t=>t.uid===uid);if(!record||!row)throw new Error('Restore the local task row before resolving.');const source=this.context.autotask();if(!source)throw new Error('Connect source instance.');if(source.resolveCreatorResourceIds)await source.resolveCreatorResourceIds();if(syncInstance(source)!==record.source.namespace)throw new Error('Connect the original API account.');const fresh=await source.inspectTask(record.source.id);
    let selected;if(choice==='remote')selected=fresh;else if(choice==='destination'){if(record.conflict?.kind!=='destination'||!record.conflict.remote)throw new Error('No single destination version to select.');selected={...record.conflict.remote,remoteId:record.source.id,creatorId:syncTokens(row.rawLine).creatorResourceID};}
    const baseline=importedLine(fresh,uid,syncInstance(source),syncTokens(row.rawLine));if(selected){rows.parts[row.part]=importedLine(selected,uid,syncInstance(source),syncTokens(row.rawLine));}record.baseLine=baseline;record.baseSource=canonicalTask(fresh);
    for(const [target,binding]of Object.entries(record.remotes)){const provider=this.context.provider(target);if(!provider)throw new Error('Connect bound destinations before resolving.');binding.baseRemote=canonicalTask(await provider.get(target==='microsoft-planner'?binding.ref.remoteId:binding.ref));}
    if(selected)await this.context.todo.storage.write(rows.parts.join(''),rows.text);record.conflict=null;if(record.intents?.source)record.intents.source.status='verified';await this.save('sync-state.json',state);
  });}
  async refreshDestinations(){return this.run(async()=>{
    const state=await this.state(),rows=await this.rows(),conflicts=[];let updated=0;
    for(const [uid,record]of Object.entries(state.value.records)){const row=rows.items.find(t=>t.uid===uid);if(!row||record.conflict)continue;const local=localCanonical(row);const changes=[];
      for(const [target,binding]of Object.entries(record.remotes)){const provider=this.context.provider(target);if(!provider)continue;const remote=canonicalTask(await provider.get(target==='microsoft-planner'?binding.ref.remoteId:binding.ref));if(syncEqual(remote,binding.baseRemote))continue;if(target==='microsoft-planner'&&remote.bucketId!==binding.baseRemote.bucketId){record.conflict={kind:'destination-mapping',target,remote,local};conflicts.push(uid);continue;}const base={...binding.baseLocal},incoming={...base};for(const key of ['title','description','due','completed',...(target==='microsoft-planner'?['start']:[])])incoming[key]=remote[key];if(target==='microsoft-planner'&&!syncEqual(remote.assigneeIds,binding.baseRemote.assigneeIds)&&record.source.provider==='todotxt'){record.conflict={kind:'assignment-mapping',target,remote,local};conflicts.push(uid);continue;}if(target==='microsoft-planner'&&!syncEqual(remote.assigneeIds,binding.baseRemote.assigneeIds)){const maps=await this.mappings();const matching=Object.entries(maps.value.users).filter(([,m])=>m.reviewed&&remote.assigneeIds.length===1&&m.entraId.toLowerCase()===remote.assigneeIds[0].toLowerCase());if(matching.length!==1){record.conflict={kind:'assignment-mapping',target,remote,local};conflicts.push(uid);continue;}incoming.assigneeId=matching[0][0];incoming.assigneeIds=[matching[0][0]];}const merge=threeWay(base,local,incoming);if(merge.conflicts.length){record.conflict={kind:'destination',target,fields:merge.conflicts,remote:incoming,snapshot:remote,local};conflicts.push(uid);}else changes.push({target,binding,remote,merged:merge.merged});}
      if(record.conflict)continue;if(changes.length>1&&changes.some(c=>!syncEqual(c.merged,changes[0].merged))){record.conflict={kind:'multiple-destinations'};conflicts.push(uid);continue;}
      if(changes.length){const value=changes[0].merged;const synthetic={...value,remoteId:record.source.id,creatorId:syncTokens(row.rawLine).creatorResourceID};const line=record.source.provider==='todotxt'?this.localLine(value,row):importedLine(synthetic,uid,record.source.namespace,syncTokens(row.rawLine));rows.parts[row.part]=line;for(const change of changes){change.binding.baseRemote=change.remote;change.binding.baseLocal=value;}updated++;}
    }
    const next=rows.parts.join('');if(next!==rows.text)await this.context.todo.storage.write(next,rows.text);await this.save('sync-state.json',state);return{updated,conflicts:conflicts.length};
  });}
  async pushSource(uid){return this.run(async()=>{
    const state=await this.state(),record=state.value.records[uid],rows=await this.rows(),row=rows.items.find(t=>t.uid===uid),source=this.context.autotask();if(!record||!row||record.conflict)throw new Error('Resolve the task conflict first.');if(!source||!source.enableWrites)throw new Error('Connect source and enable Autotask writes.');if(source.resolveCreatorResourceIds)await source.resolveCreatorResourceIds();if(syncInstance(source)!==record.source.namespace)throw new Error('Connect original source API account.');record.intents=record.intents||{};if(record.intents.source&&record.intents.source.status!=='verified')throw new Error('An earlier source write needs review.');const fresh=await source.inspectTask(record.source.id),local=localCanonical(row);if(!syncEqual(canonicalTask(fresh),record.baseSource))throw new Error('Autotask changed remotely. Pull first.');if(local.companyId!==String(fresh.companyId))throw new Error('Company reassociation must be reviewed through Autotask Edit.');const changes={};if(local.description!==fresh.description)changes.activityDescription=local.description;if(local.assigneeId!==String(fresh.assigneeId))changes.assignedToResourceID=local.assigneeId;if(local.start&&Date.parse(local.start)!==Date.parse(fresh.start))changes.startDateTime=local.start;if(local.due&&Date.parse(local.due)!==Date.parse(fresh.due))changes.endDateTime=local.due;if(!Object.keys(changes).length&&local.completed===fresh.completed)return;
    record.intents.source={status:'submitting',startedAt:new Date().toISOString()};await this.save('sync-state.json',state);try{if(fresh.completed&&Object.keys(changes).length)throw new Error('Reopen in Autotask before changing completed task text/schedule.');if(Object.keys(changes).length)await source.update(fresh,changes);if(local.completed!==fresh.completed){const next=await source.inspectTask(record.source.id);await source[local.completed?'complete':'reopen'](next);}const checked=await source.inspectTask(record.source.id);if(!syncEqual(canonicalTask(checked),local))throw new Error('Source update verification differs from local task.');record.baseSource=canonicalTask(checked);record.baseLine=row.rawLine;record.intents.source.status='verified';await this.save('sync-state.json',state);}catch(e){record.intents.source.status='needs-review';await this.save('sync-state.json',state);throw e;}
  });}
  async cycle(writeExisting=false){const pulled=this.context.autotask()?await this.pull():{imported:0,updated:0,conflicts:0},refreshed=await this.refreshDestinations();let written=0;if(writeExisting){const state=await this.state();for(const [uid,record]of Object.entries(state.value.records)){if(record.conflict||!Object.keys(record.remotes).length)continue;if(record.source.provider!=='todotxt')await this.pushSource(uid);for(const target of Object.keys(record.remotes)){const preview=await this.preview(uid,target,record.remotes[target].allowPersonal===true);if(preview.operation!=='noop'){await this.push(preview);written++;}}}}return{...pulled,destinationUpdates:refreshed.updated,destinationConflicts:refreshed.conflicts,written};}
  async bindExisting(uid,target,ref){return this.run(async()=>{const provider=this.context.provider(target);if(!provider)throw new Error('Connect destination first.');const remote=await provider.get(target==='microsoft-planner'?ref.remoteId:ref);if(remote.listId!==ref.listId)throw new Error('Destination identity mismatch.');const rows=await this.rows(),row=rows.items.find(t=>t.uid===uid),state=await this.state(),record=state.value.records[uid];if(!record||!row)throw new Error('Task not imported.');record.remotes[target]={ref,baseRemote:canonicalTask(remote),baseLocal:localCanonical(row),verifiedAt:new Date().toISOString()};record.intents=record.intents||{};record.intents[target]={status:'verified',ref,reconciledAt:new Date().toISOString()};await this.save('sync-state.json',state);});}
}
module.exports={TaskSyncEngine,canonicalTask,localCanonical,threeWay,syncTokens,importedLine};

return module.exports;
})();
const { PasswordCredentialVault, credentialSnapshot } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.8.0-alpha.2. Portable password-encrypted credential vault; key never saved. */
class PasswordCredentialVault {
  constructor(key,salt){this.key=key;this.salt=salt;}
  static async open(passphrase,envelope=null){
    if(typeof passphrase!=='string'||passphrase.length<12)throw new Error('Use a master passphrase of at least 12 characters.');const crypto=require('node:crypto');
    if(envelope&&(envelope.schemaVersion!==1||envelope.cipher!=='aes-256-gcm'||envelope.iterations!==310000))throw new Error('Unsupported credential vault format.');
    const salt=envelope?Buffer.from(envelope.salt,'base64'):crypto.randomBytes(32);if(salt.length!==32)throw new Error('Invalid credential vault salt.');
    const key=await new Promise((resolve,reject)=>crypto.pbkdf2(passphrase,salt,310000,32,'sha256',(error,value)=>error?reject(error):resolve(value)));const vault=new PasswordCredentialVault(key,salt);let secrets={};
    if(envelope)try{secrets=vault.decrypt(envelope);}catch{vault.dispose();throw new Error('Wrong master passphrase or damaged credential vault.');}return{vault,secrets};
  }
  encrypt(secrets){if(!this.key)throw new Error('Credential vault locked.');const crypto=require('node:crypto'),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from('Task2Do credentials v1'));const data=Buffer.concat([cipher.update(JSON.stringify(secrets),'utf8'),cipher.final()]);return{schemaVersion:1,cipher:'aes-256-gcm',iterations:310000,salt:this.salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
  decrypt(envelope){if(!this.key)throw new Error('Credential vault locked.');const crypto=require('node:crypto'),iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');if(iv.length!==12||tag.length!==16)throw new Error('Invalid credential envelope.');const decipher=crypto.createDecipheriv('aes-256-gcm',this.key,iv);decipher.setAAD(Buffer.from('Task2Do credentials v1'));decipher.setAuthTag(tag);const value=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));if(!value||typeof value!=='object')throw new Error('Invalid credential payload.');return value;}
  dispose(){this.key?.fill(0);this.key=null;}
}
function credentialSnapshot(settings){const publicSettings=JSON.parse(JSON.stringify(settings)),secrets={};if(publicSettings.savedCredentials){secrets.savedCredentials=publicSettings.savedCredentials;delete publicSettings.savedCredentials;}if(publicSettings.microsoft?.tokens){secrets.microsoftTokens=publicSettings.microsoft.tokens;delete publicSettings.microsoft.tokens;}for(const id of ['openproject','moovila'])if(publicSettings[id]?.token){secrets[id]=publicSettings[id].token;delete publicSettings[id].token;}return{publicSettings,secrets};}
module.exports={PasswordCredentialVault,credentialSnapshot};

return module.exports;
})();
const { hintElement, createHintedSetting, taskHint } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.9.0-alpha.2. Reusable, plain-text help for local UI controls. */
const FIELD_HINTS = Object.freeze({
  'Autotask Zone REST URL':'Use the official REST URL for your Autotask Zone, ending /atservicesrest/v1.0/. The example zone is not auto-discovery.',
  'Assigned Resource ID':'The human resource whose assigned tasks should be listed; this is normally different from the API account.',
  'Creator Resource ID (optional)':'Your human Autotask Resource ID for delegated tasks. Blank uses Assigned Resource ID.',
  'API user Resource ID (optional)':'Include tasks created by the API account. Blank attempts username-based resource lookup.',
  'Remember credentials':'Retain the current connection credentials for restart. General → Encrypted credential vault protects saved secrets.',
  'Enable ticket updates':'Separately allow supported ticket edits, validated reassignment and native ticket notes. The CRM To-Do write switch does not enable ticket writes.',
  'Completed ticket status IDs':'Optional tenant-specific completed statuses. Blank uses the completion timestamp; hover ticket status details to see IDs.',
  'Enable To-Do updates':'Allow Autotask creation and explicit/scheduled updates. Enabling this does not itself modify any task.',
  'todo.txt path':'Vault-relative .txt path, for example Task2Do/todo.txt. Selecting a different path does not move the previous file or its bindings.',
  'Task file':'Choose a visible vault-relative .txt file. Existing tasks are retained and receive stable uid: tokens.',
  'Publish searchable Markdown indexes':'Generate searchable task snapshots on provider refresh. Editing their checkboxes does not update the source.',
  'Index folder':'Visible vault-relative folder for generated Markdown snapshots. User-owned notes are not overwritten.',
  'Sync catalog/state folder':'Stores catalogs, reviewed mappings and the write journal. Changing this path does not migrate existing bindings.',
  'Automatic sync':'Run sync cycles while Obsidian is open. New destination tasks still require a reviewed manual push.',
  'Write updates to already-bound tasks':'Separately allow scheduled updates to existing counterparts. Never creates unbound tasks or propagates deletions.',
  'Sync interval (minutes)':'Whole minutes from 5 to 1440. Cycles stop when Obsidian closes or encrypted credentials are locked.',
  'Entra application client ID':'Application (client) ID of your public-client Entra registration. Use device-code sign-in; no client secret is required.',
  'Tenant ID/domain (or common)':'Use your tenant GUID/domain or an account-audience alias matching the registration. Planner requires a work/school account.',
  'Remember Microsoft sign-in':'Retain access/refresh tokens. Microsoft To Do and Planner share this sign-in.',
  'Basic Planner plan IDs':'Exact basic, group-owned plan IDs separated by commas or whitespace. Re-consent after adding plans for membership access.',
  'Instance URL':'Final HTTPS OpenProject URL, including an installation subpath if used. Redirects are not followed.',
  'API URL':'Supported Moovila origin: https://api.moovila.com. Other API hosts are not accepted by this adapter.',
  'API key':'Your OpenProject account API token. This help never displays the token value.',
  'Bearer access token':'Vendor-approved Moovila access token. Refresh is manual; this help never displays the token.',
  'Trusted CA / self-signed certificate (PEM)':'Public CA chain or self-signed server certificate for this instance only. Hostname/expiry checks remain enabled. Never paste a private key.',
  'Project ID (optional)':'Numeric OpenProject project ID. Blank retrieves all accessible work packages.',
  'Remember connection credentials':'Retain this provider credential for restart. Credential encryption is configured in General.',
  'Enable OpenProject writes':'Allow work-package creation and edits permitted by the server forms and workflow.',
  'Master passphrase':'Unlock remembered credentials; the passphrase is not stored. Use at least 12 characters when enabling encryption.',
  'Title':'Task name. Use the description field for longer notes; saving applies the change to the current task provider.',
  'Description':'Task notes. Native local tasks keep this separate from the title; Autotask uses its description as the task name and text.',
  'Priority':'A is highest; choose None for no priority. Priority is retained locally and is not automatically mapped to Microsoft.',
  'Created date':'Local calendar date recorded on the todo.txt task.',
  'Start date':'Local calendar start date. Future starts appear in Upcoming.',
  'Due date':'Calendar deadline. A date-only local deadline publishes at the end of that local day.',
  'Projects':'Project tags, separated by spaces or commas. Each project name is a single token, stored with +.',
  'Contexts':'Context tags, separated by spaces or commas. Each context name is a single token, stored with @.',
  'Task line':'Advanced todo.txt syntax. Preserve uid: and source metadata to retain task identity and sync bindings.',
  'Save raw line instead':'Save the raw task line rather than the structured fields. Do not remove or replace the existing uid: token.'
});
const ACTION_HINTS = Object.freeze({
  'Create task':'Submit a new task to the chosen provider. Check the destination and required fields before creating.',
  'Save reviewed mappings':'Save the selected company destination and any reviewed user identity mapping; this does not create tasks.',
  'Use or create task file':'Use the chosen file without replacing its contents, assign stable task IDs and open the local task panel.',
  'Change company':'Review reassociation with another Autotask company. Save other pending edits first.',
  'Reload users':'Refresh eligible Autotask resource choices without changing the task assignment.',
  'Search':'Look up matching Autotask companies; select a returned company before submitting.',
  'Check task':'Read this Autotask CRM To-Do by ID without modifying it.',
  'Append note':'Append the entered timestamped note to the Autotask description and verify the update.',
  'Attach file':'Upload the chosen vault file to this Microsoft To Do task. The file must be smaller than 3 MB.',
  'Save to vault':'Download this attachment into the configured Attachments folder. Existing files are not overwritten.',
  'Sign in to Microsoft':'Start shared Microsoft To Do/Planner device-code authentication; no client secret is needed.',
  'Start sign-in':'Request a Microsoft device code, then complete sign-in at the displayed Microsoft URL.',
  'New task':'Open the creation form for this panel’s provider; no task is created until you submit it.',
  'Refresh':'Reload this panel from its provider and rebuild its enabled Markdown snapshot. This does not submit task edits.',
  'Connect':'Open connection settings for this provider.',
  'Sign in':'Start Microsoft device-code sign-in. To Do and Planner share the session.',
  'Edit':'Open this task’s editor. Review and save changes to apply them to its source.',
  'Complete':'Mark this task complete in its source, subject to permissions and verification.',
  'Reopen':'Return this task to an open state in its source; unsupported workflow/API transitions may be refused.',
  'Note':'Append a timestamped text note to the Autotask description. This is not a native threaded comment.',
  'Ticket notes':'Read native ticket notes and their visibility; add a note only with explicit type/visibility and ticket writes enabled.',
  'Ticket title':'Rename the ticket. Unchanged descriptions and schedules are preserved.',
  'Ticket due date / time':'Select a local calendar date and time to the minute. It is converted to UTC; unchanged seconds are retained.',
  'Replace ticket description':'Enable only to replace the description with plain text. Formatting and embedded images will be lost.',
  'Ticket description (plain text)':'Replaces the whole description after explicit acceptance. This is not a native ticket note.',
  'I accept losing description formatting and images':'Required only when saving a changed description.',
  'Change ticket assignment':'Load active resources, service desk roles and queues. Saving revalidates their relationships.',
  'Ticket resource role':'Choose an active service desk role for the selected resource. The role can affect billing rates.',
  'Ticket queue':'Choose an active queue associated with the selected resource.',
  'Assignment filter':'Show primary-assigned tickets for Me, one named user, or a selected set of users. Does not reassign tickets.',
  'Tickets assigned to':'Me uses the configured Assigned Resource ID. User groups here are a selected set, not native Autotask groups.',
  'Ticket assignee':'Choose the user whose primary-assigned tickets should be fetched.',
  'Search ticket assignees':'Filter the user picker by name; already selected users remain selected.',
  'Apply assignment filter':'Save this panel’s selection and fetch tickets from Autotask. Other filters still apply.',
  'Update ticket':'Edit ticket title, due date, status, priority or assignment. Description replacement requires explicit acceptance of formatting and image loss.',
  'Save ticket changes':'PATCH only changed supported fields after fresh validation and verify the result. Tenant workflow rules still apply.',
  'Add ticket note':'Create one native note with the selected type and visibility. An uncertain result blocks duplicate retries.',
  'Reconcile ticket note':'Match an existing note to the recorded fingerprint before permitting another note creation.',
  'Attachments':'List Microsoft To Do attachments; upload a small vault file or save an attachment into the vault.',
  'Publish…':'Review a destination mapping and exact values before creating or updating a Microsoft counterpart.',
  'Task file':'Select an existing task file or create a new one; task files are not moved automatically.',
  'Providers':'Open the provider chooser. Local tasks remain available without connecting an account.',
  'Pull Autotask':'Import the configured assigned/created scope plus company/user catalogs; retain local edits for conflict review.',
  'Mappings':'Review company destinations and resource-to-Entra identities. Matching names alone are not identity verification.',
  'Refresh destinations':'Read bound Microsoft tasks and merge non-conflicting edits locally. Conflicts remain for review.',
  'Build preview':'Recheck task, mappings and destination, then show the exact proposed write. No remote write is submitted.',
  'Preview push':'Inspect proposed destination values before a remote write.',
  'Push reviewed task':'Revalidate the preview and submit once. An uncertain result blocks retries until reconciliation.',
  'Save mapping and preview':'Save the reviewed destination choice, then open the preview. This does not create a remote task.',
  'Map and preview':'Choose and review a destination for this local task before publishing.',
  'Review mapping':'Review the destination choices for this local task; changing a bound destination requires reconciliation.',
  'Push local to Autotask':'Update the existing source To-Do using the local row. Requires enabled Autotask writes and a current source snapshot.',
  'Keep local values':'Acknowledge the conflict and keep local values for a later reviewed push; inspect the competing versions first.',
  'Use destination values':'Resolve this conflict using its recorded destination values after checking the destination has not changed again.',
  'Use Autotask values':'Replace the local representation with the current Autotask source values.',
  'Verify and bind existing task':'Verify an existing remote identity and record it as this task’s counterpart. No new task is created.',
  'Check task by ID':'Read a CRM To-Do directly and explain how its creator/assignee relates to your configured list filters.',
  'Enable encryption':'Create a password-encrypted vault for remembered secrets; retain the passphrase for future unlocks.',
  'Unlock credentials':'Unlock saved secrets for this session. The passphrase is not stored.',
  'Forget Microsoft sign-in':'Remove saved Microsoft tokens and disconnect both To Do and Planner. Remote tasks are retained.',
  'Cancel':'Close this dialog without submitting its pending form changes.',
  'Save task':'Save this task to todo.txt. External changes invalidate the editor snapshot.',
  'Save changes':'Submit the reviewed changes to this task’s provider.',
  'Select or create task file':'Choose an existing vault task file or create a new one without replacing existing contents.'
});
function fieldHint(name,description='',type='input') {
  const label=String(name||'').trim();
  return [label,FIELD_HINTS[label]||(/^Search/i.test(label)?'Filter the displayed tasks immediately without modifying source tasks.':'')||String(description||'').trim()||(type==='dropdown'?'Choose a value from the available options.':type==='toggle'?'Enable or disable this option.':'Enter a value for this field.')].filter(Boolean).join(': ');
}
function actionHint(label,settingName='') {
  const text=String(label||'').trim();if(ACTION_HINTS[text])return ACTION_HINTS[text];
  if(/^Reconcile /.test(text))return 'Inspect the provider first, then bind the existing task identity to avoid a duplicate creation.';
  if(/^Forget /.test(text))return 'Remove this provider’s current saved credential and connection. Remote tasks and historical credential backups are retained.';
  if(/^Connect /.test(text))return 'Configure and validate this provider connection before opening its tasks.';
  if(/^Open /.test(text)||text==='Open')return `Open ${settingName||text.replace(/^Open /,'')||'the selected view'}.`;
  if(['General','todo.txt','Autotask','Autotask Tickets','Microsoft To Do','Microsoft Planner','OpenProject','Moovila'].includes(text))return 'Show the '+text+' settings pane.';
  return String(settingName||'').trim()?fieldHint(settingName):text?text+'. Review the form before submitting.':'Review this action before submitting.';
}
/**= Tooltip text is static help or visible task context; never input values or HTML. */
function hintElement(element,text,nativeTooltip) {
  if(!element||typeof text!=='string'||!text.trim())return element;
  const hint=text.slice(0,1600);element.classList?.add('task2do-has-hint');element.title=hint;element.setAttribute?.('aria-description',hint);
  if(typeof nativeTooltip==='function'){element.removeAttribute?.('title');nativeTooltip(element,hint);}
  return element;
}
/**= Wrap this plugin’s Setting class only; do not modify Obsidian prototypes. */
function dropdownHelp(control){const values=control.selectEl?.options?Array.from(control.selectEl.options).map(o=>o.value):Object.keys(control.options||{});if(values.includes('due-asc'))return 'Due-date sorting: choose earliest, latest or original order; undated tasks stay last.';if(values.includes('inbox'))return 'Local task view: Inbox, Today including overdue, Upcoming, Completed or All tasks.';if(values.includes('delegated'))return 'Autotask scope: assigned tasks, delegated tasks or their deduplicated union.';if(values.includes('completed')&&values.includes('open'))return 'Task state filter: open, completed or all. This changes the view only.';return '';}
function createHintedSetting(Base,nativeTooltip) {
  return class HintedSetting extends Base {
    setName(value){this.hintName=typeof value==='string'?value:'';return super.setName(value);}
    setDesc(value){this.hintDescription=typeof value==='string'?value:'';return super.setDesc(value);}
    addText(callback){return super.addText(control=>{callback(control);hintElement(control.inputEl,fieldHint(this.hintName||control.inputEl?.placeholder,this.hintDescription),nativeTooltip);});}
    addTextArea(callback){return super.addTextArea(control=>{callback(control);hintElement(control.inputEl,fieldHint(this.hintName||control.inputEl?.placeholder,this.hintDescription),nativeTooltip);});}
    addDropdown(callback){return super.addDropdown(control=>{callback(control);hintElement(control.selectEl||control.inputEl,this.hintName?fieldHint(this.hintName,this.hintDescription,'dropdown'):dropdownHelp(control)||fieldHint('',this.hintDescription,'dropdown'),nativeTooltip);});}
    addToggle(callback){return super.addToggle(control=>{callback(control);hintElement(control.toggleEl||control.inputEl,fieldHint(this.hintName,this.hintDescription,'toggle'),nativeTooltip);});}
    addButton(callback){return super.addButton(control=>{callback(control);const el=control.buttonEl;hintElement(el,el?.getAttribute?.('title')||el?.title||actionHint(el?.textContent||control.text,this.hintName),nativeTooltip);});}
  };
}
function hintDate(value){if(!value)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value+' (date only)';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):'Invalid date';}
function taskHint(item,editable=true) {
  if(!item||typeof item!=='object')return '';
  const labels={'todotxt':'Local todo.txt','autotask-todo':'Autotask','autotask-tickets':'Autotask Tickets','microsoft-todo':'Microsoft To Do','microsoft-planner':'Microsoft Planner','openproject':'OpenProject','moovila':'Moovila'};
  const edits={'autotask-tickets':'Edit supported ticket fields and assignment; description replacement requires explicit confirmation. Use Ticket notes for native notes.','todotxt':'Edit title, description, priority, dates, projects and contexts.','autotask-todo':'Edit task text, assignee and schedule. Change company is inside Edit; creator attribution is read-only.','microsoft-todo':'Edit title, description and deadline.','microsoft-planner':'Edit title, description, dates, bucket and assignments.','openproject':'Edit fields allowed by this project’s forms and workflow.'};
  return [labels[item.provider]||'Task',item.remoteId?'ID '+item.remoteId:'',item.listName||item.source||'',item.organizationName||'',item.assigneeName?'Assigned to '+item.assigneeName:'',item.creatorName?'Created by '+item.creatorName:item.creatorId!=null?'Created by resource #'+item.creatorId:'',item.start?'Start: '+hintDate(item.start):'',item.dueDate||item.due?'Due: '+hintDate(item.dueDate||item.due):'',item.description?String(item.description).slice(0,500):'',editable?(edits[item.provider]||'Use Edit to change supported fields.')+(item.provider==='autotask-tickets'?' Use Update ticket; the title is not a direct-edit control.':' Use the Edit button; the title is not a direct-edit control.'):'Read-only source; editing is not available in this panel.'].filter(Boolean).join('\n');
}
module.exports={fieldHint,actionHint,hintElement,createHintedSetting,taskHint};

return module.exports;
})();
const { AutotaskTicketProvider, ticketStatusIds } = (() => {
const module = { exports: {} };
'use strict';
/**= Version 0.9.0-alpha.5. Service Desk tickets share the Autotask session, not CRM To-Do semantics. */
function ticketId(value,allowZero=false){if(!new RegExp(allowZero?'^(0|[1-9]\\d*)$':'^[1-9]\\d*$').test(String(value))||!Number.isSafeInteger(Number(value)))throw new Error('Enter a valid numeric Autotask ID.');return Number(value);}
function ticketStatusIds(value=''){return [...new Set(String(value).split(/[\s,;]+/).filter(Boolean).map(v=>String(ticketId(v,true))))];}
class AutotaskTicketProvider {
  constructor(source,config={},journal=null,digest=null,log=()=>{}){
    if(typeof source!=='function')throw new Error('A shared Autotask connection is required.');
    this.id='autotask-tickets';this.source=source;this.enableWrites=config.enableWrites===true;this.closedStatusIds=ticketStatusIds(config.closedStatusIds);this.journal=journal;this.digest=digest;this.log=log;this.pending=new Set();this.disposed=false;
    this.capabilities=Object.freeze({read:true,create:false,update:this.enableWrites,complete:false,reopen:false,comment:this.enableWrites});
  }
  dispose(){this.disposed=true;}
  connection(){const source=this.source();if(this.disposed||!source?.credentials)throw new Error('Connect Autotask first, then refresh Tickets.');return source;}
  assertConnection(source){if(source!==this.connection())throw new Error('Autotask connection changed. Refresh Tickets before continuing.');}
  async request(path,method='GET',body,readOnly=true,source=this.connection()){
    this.assertConnection(source);const base=new URL(source.base),url=new URL(path,base);const relative=url.pathname.slice(base.pathname.length);
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||url.username||url.password||url.hash||!(/^(Tickets(?:\/(?:query|entityInformation\/fields|\d+(?:\/Notes)?))?|TicketNotes\/(?:query|entityInformation\/fields|\d+)|(?:ResourceServiceDeskRoles|ResourceRoleQueues|TicketSecondaryResources)\/query|Roles\/(?:query|\d+))$/.test(relative)))throw new Error('Rejected unexpected ticket API URL.');
    if(!readOnly&&!((method==='PATCH'&&relative==='Tickets')||(method==='POST'&&/^Tickets\/\d+\/Notes$/.test(relative))))throw new Error('Unsupported ticket write.');
    const result=await source.request(url.href,method,body,readOnly);this.assertConnection(source);return result;
  }
  async fields(entity='Tickets',source=this.connection()){const result=await this.request(entity+'/entityInformation/fields','GET',undefined,true,source);if(!Array.isArray(result.fields))throw new Error('Autotask did not return ticket field metadata.');return result.fields;}
  choices(fields,name){const field=fields.find(f=>f.name===name);if(!field||!Array.isArray(field.picklistValues))return[];return field.picklistValues.filter(v=>v.isActive===true).map(v=>({id:String(ticketId(v.value,true)),label:String(v.label||'#'+v.value),parentValue:v.parentValue==null?'':String(v.parentValue)}));}
  async collection(path,filter,source=this.connection()){
    let url=path,method='POST',body={filter,MaxRecords:500};const rows=[],pages=new Set(),ids=new Set();
    for(let page=0;page<100;page++){const absolute=new URL(url,source.base).href;if(pages.has(absolute))throw new Error('Repeated ticket pagination URL.');pages.add(absolute);const result=await this.request(url,method,body,true,source);if(!Array.isArray(result.items))throw new Error('Autotask did not return a ticket collection.');for(const item of result.items){const id=ticketId(item.id);if(ids.has(id))throw new Error('Repeated ticket/note ID in pagination.');ids.add(id);rows.push(item);}if(!result.pageDetails?.nextPageUrl)return rows;url=result.pageDetails.nextPageUrl;method='GET';body=undefined;}
    throw new Error('Ticket pagination limit reached; incomplete data was not shown.');
  }
  normalize(raw,fields=[]){const id=ticketId(raw.id),status=String(ticketId(raw.status,true)),label=name=>this.choices(fields,name).find(v=>v.id===String(raw[name]))?.label||`${name} #${raw[name]??'unknown'}`;
    return{provider:this.id,remoteId:String(id),ticketNumber:raw.ticketNumber||String(id),title:raw.title||'',description:raw.description||'',companyId:raw.companyID,assigneeId:raw.assignedResourceID,creatorId:raw.creatorResourceID,due:raw.dueDateTime,completed:this.closedStatusIds.length?this.closedStatusIds.includes(status):!!raw.completedDate,statusId:status,statusName:label('status'),priorityId:String(raw.priority??''),priorityName:label('priority'),queueName:label('queueID'),completedAt:raw.completedDate,modified:raw.lastActivityDate,raw};}
  /**= Explicit primary-assignee scopes are fetched remotely; never broaden an empty selection. */
  async list(resourceIDs=null){
    const source=this.connection();let ids;
    if(resourceIDs===null)ids=[ticketId(source.resourceId)];
    else{
      if(!Array.isArray(resourceIDs)||!resourceIDs.length||resourceIDs.length>50)throw new Error('Select between 1 and 50 ticket assignees.');
      ids=[...new Set(resourceIDs.map(v=>ticketId(v)))];
      const users=await this.resources();if(ids.some(id=>!users.some(u=>String(u.id)===String(id))))throw new Error('A selected assignee is no longer available. Edit the assignment filter.');
    }
    const fields=await this.fields('Tickets',source),result=[],seen=new Set();
    for(const resourceID of ids){
      const rows=await this.collection('Tickets/query',[{op:'eq',field:'assignedResourceID',value:resourceID}],source);
      for(const raw of rows){
        if(Number(raw.assignedResourceID)!==resourceID)throw new Error('Returned ticket is outside the selected primary assignment. Refresh first.');
        if(seen.has(ticketId(raw.id)))throw new Error('Ticket assignment changed during retrieval. Refresh before continuing.');seen.add(ticketId(raw.id));
        const item=this.normalize(raw,fields);item.organizationName=await source.resolveName('Companies',raw.companyID);item.assigneeName=await source.resolveName('Resources',raw.assignedResourceID);this.assertConnection(source);result.push(item);
      }
    }
    return result;
  }
  async get(id,fields=null,source=this.connection()){id=ticketId(typeof id==='object'?id.remoteId:id);const result=await this.request('Tickets/'+id,'GET',undefined,true,source);if(!result.item||Number(result.item.id)!==id)throw new Error('Ticket identity could not be verified.');return this.normalize(result.item,fields||await this.fields('Tickets',source));}
  signature(item){const raw=item.raw||{};return JSON.stringify(['id','status','priority','assignedResourceID','assignedResourceRoleID','assignedResourceroleID','queueID','companyID','title','description','dueDateTime','lastActivityDate','lastTrackedModificationDateTime','resolution'].map(k=>[k,raw[k]??null]));}
  /**= Resolve current assignment options; queue membership and service desk roles are separate entities. */
  async resources(){const source=this.connection(),users=await source.listResources();this.assertConnection(source);return users;}
  async assignmentOptions(resourceID,fields=null,source=this.connection()){
    const id=ticketId(resourceID),filter=[{op:'eq',field:'resourceID',value:id}];
    const memberships=await this.collection('ResourceRoleQueues/query',filter,source),associations=await this.collection('ResourceServiceDeskRoles/query',filter,source);
    if([...memberships,...associations].some(v=>Number(v.resourceID)!==id))throw new Error('Assignment catalog returned another resource.');
    const roles=[];for(const roleID of [...new Set(associations.filter(v=>v.isActive===true).map(v=>ticketId(v.roleID)))]){const role=(await this.request('Roles/'+roleID,'GET',undefined,true,source)).item;if(!role||Number(role.id)!==roleID)throw new Error('Role identity could not be verified.');if(role.isActive===true)roles.push({id:String(roleID),label:String(role.name||'#'+roleID)});}
    const queues=this.choices(fields||await this.fields('Tickets',source),'queueID').filter(q=>memberships.some(v=>String(v.queueID)===q.id));
    return{roles,queues};
  }
  async update(snapshot,changes,options={}){
    if(!this.enableWrites)throw new Error('Enable ticket updates in Autotask Tickets settings.');
    const id=ticketId(snapshot.remoteId),keys=Object.keys(changes),allowed=['status','priority','title','description','dueDateTime','assignedResourceID','assignedResourceroleID','queueID'];
    if(!keys.length||keys.some(k=>!allowed.includes(k)))throw new Error('Unsupported ticket edit field.');
    if(this.pending.has(id))throw new Error('A ticket action is already running.');this.pending.add(id);
    try{
      const source=this.connection(),fields=await this.fields('Tickets',source),fresh=await this.get(id,fields,source);
      if(this.signature(fresh)!==this.signature(snapshot))throw new Error('Ticket changed remotely. Refresh before editing.');
      const patch={id};
      for(const key of keys){
        let value=changes[key];const field=fields.find(f=>f.name===key);
        if(field?.isReadOnly!==false)throw new Error('Ticket '+key+' is not writable.');
        if(['status','priority','queueID'].includes(key)){
          value=ticketId(value,true);if(!this.choices(fields,key).some(v=>v.id===String(value)))throw new Error('Choose an active, writable ticket '+key+'.');
        }else if(['assignedResourceID','assignedResourceroleID'].includes(key))value=ticketId(value);
        else if(key==='dueDateTime'){
          if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Enter a valid UTC due date/time.');
          const parsed=new Date(value);if(parsed.toISOString().slice(0,16)!==value.slice(0,16))throw new Error('Enter a valid UTC due date/time.');value=parsed.toISOString();
        }else{
          const limit=key==='title'?255:8000;
          if(typeof value!=='string'||(key==='title'&&!value.trim())||value.length>Math.min(limit,Number(field.length)>0?Number(field.length):limit))throw new Error('Enter a valid ticket '+key+'.');
          if(key==='title')value=value.trim();
        }
        const old=fresh.raw[key];const equal=key==='dueDateTime'?Date.parse(old)===Date.parse(value):['status','priority','queueID','assignedResourceID','assignedResourceroleID'].includes(key)?old!=null&&Number(old)===value:old===value;
        if(!equal)patch[key]=value;
      }
      if(Object.hasOwn(patch,'description')&&options.confirmPlainTextReplacement!==true)throw new Error('Confirm plain-text description replacement: Autotask formatting and embedded images will be lost.');
      if(['assignedResourceID','assignedResourceroleID','queueID'].some(k=>Object.hasOwn(patch,k))){
        const resource=ticketId(patch.assignedResourceID??fresh.raw.assignedResourceID),role=ticketId(patch.assignedResourceroleID??fresh.raw.assignedResourceroleID),queue=ticketId(patch.queueID??fresh.raw.queueID,true);
        const users=await source.listResources();this.assertConnection(source);if(!users.some(u=>String(u.id)===String(resource)))throw new Error('Choose an active named resource.');
        const available=await this.assignmentOptions(resource,fields,source);
        if(!available.roles.some(v=>v.id===String(role))||!available.queues.some(v=>v.id===String(queue)))throw new Error('Choose an active service desk role and a queue belonging to the selected resource.');
        const secondary=await this.collection('TicketSecondaryResources/query',[{op:'eq',field:'ticketID',value:id}],source);
        if(secondary.some(v=>Number(v.ticketID)!==id))throw new Error('Secondary assignment catalog returned another ticket.');
        if(secondary.some(v=>Number(v.resourceID)===resource))throw new Error('Selected resource is already secondary. Resolve that assignment in Autotask first.');
      }
      if(Object.keys(patch).length===1)return fresh;
      //= Recheck after assignment lookups; this is optimistic detection, not an atomic API condition.
      if(this.signature(await this.get(id,fields,source))!==this.signature(fresh))throw new Error('Ticket changed remotely. Refresh before editing.');
      await this.request('Tickets','PATCH',patch,false,source);
      const checked=await this.get(id,fields,source);
      for(const key of Object.keys(patch).filter(k=>k!=='id')){const actual=checked.raw[key],expected=patch[key],same=key==='dueDateTime'?Date.parse(actual)===Date.parse(expected):typeof expected==='number'?actual!=null&&Number(actual)===expected:actual===expected;if(!same)throw new Error('Ticket update readback differs. Inspect Autotask and refresh before retrying.');}
      this.log({event:'autotask.ticket-update-verified'});return checked;
    }finally{this.pending.delete(id);}
  }
  async notes(id){const source=this.connection(),ticketID=ticketId(typeof id==='object'?id.remoteId:id);await this.get(ticketID,null,source);const rows=await this.collection('TicketNotes/query',[{op:'eq',field:'ticketID',value:ticketID}],source);if(rows.some(n=>Number(n.ticketID)!==ticketID))throw new Error('Autotask returned a note from another ticket.');return rows.sort((a,b)=>String(b.createDateTime||'').localeCompare(String(a.createDateTime||''))||b.id-a.id);}
  async loadJournal(){if(!this.journal||typeof this.digest!=='function')throw new Error('Ticket note journal is unavailable.');const raw=await this.journal.read();let value={schemaVersion:1,records:{}};if(raw){try{value=JSON.parse(raw);}catch{throw new Error('Ticket note journal is not valid JSON. Restore it before writing notes.');}}if(value.schemaVersion!==1||!value.records||typeof value.records!=='object'||Array.isArray(value.records))throw new Error('Unsupported ticket note journal.');return{raw,value};}
  async saveJournal(loaded){const next=JSON.stringify(loaded.value,null,2)+'\n';await this.journal.write(next,loaded.raw);loaded.raw=next;}
  noteHash(payload){const hash=this.digest(JSON.stringify([ticketId(payload.ticketID),String(payload.title||'').trim(),String(payload.description||'').replace(/\r\n?/g,'\n'),ticketId(payload.noteType,true),ticketId(payload.publish,true)]));if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid ticket-note fingerprint.');return hash;}
  async noteState(id){const source=this.connection(),loaded=await this.loadJournal();return loaded.value.records[source.base+'#'+ticketId(id)]||null;}
  async addNote(snapshot,values){if(!this.enableWrites)throw new Error('Enable ticket updates before adding notes.');const id=ticketId(snapshot.remoteId);if(this.pending.has(id))throw new Error('A ticket action is already running.');this.pending.add(id);let loaded,key,record,submitted=false;
    try{const source=this.connection(),fields=await this.fields('TicketNotes',source);await this.get(id,null,source);const payload={ticketID:id};for(const [name,max]of [['title',250],['description',32000]]){const field=fields.find(f=>f.name===name);if(field?.isReadOnly!==false||typeof values[name]!=='string'||!values[name].trim()||values[name].length>Math.min(max,Number(field.length)||max))throw new Error('Enter a valid note '+name+'.');payload[name]=values[name];}for(const name of ['noteType','publish']){const field=fields.find(f=>f.name===name);if(field?.isReadOnly!==false||!this.choices(fields,name).some(v=>v.id===String(values[name])))throw new Error('Explicitly choose note type and visibility from current Autotask values.');payload[name]=ticketId(values[name],true);}
      loaded=await this.loadJournal();key=source.base+'#'+id;const old=loaded.value.records[key];if(old&&old.status!=='verified')throw new Error('An earlier ticket note needs reconciliation. Inspect Autotask; no creation retry is allowed.');record={status:'submitting',ticketID:id,fingerprint:this.noteHash(payload),startedAt:new Date().toISOString()};loaded.value.records[key]=record;await this.saveJournal(loaded);submitted=true;
      const response=await this.request('Tickets/'+id+'/Notes','POST',payload,false,source);record.noteID=ticketId(response.itemId);await this.saveJournal(loaded);const note=(await this.request('TicketNotes/'+record.noteID,'GET',undefined,true,source)).item;if(!note||Number(note.id)!==record.noteID||this.noteHash(note)!==record.fingerprint)throw new Error('Ticket note creation readback differs. Reconcile before creating another.');record.status='verified';await this.saveJournal(loaded);this.log({event:'autotask.ticket-note-verified'});return note;
    }catch(e){if(submitted&&record){record.status='needs-review';try{await this.saveJournal(loaded);}catch{}e.message+=' Inspect Autotask before retrying; the note intent remains recorded.';}throw e;}finally{this.pending.delete(id);}
  }
  async reconcileNote(ticketID,noteID){const source=this.connection(),id=ticketId(ticketID);if(this.pending.has(id))throw new Error('A ticket action is already running.');this.pending.add(id);try{const loaded=await this.loadJournal(),record=loaded.value.records[source.base+'#'+id];if(!record||record.status==='verified')throw new Error('No unresolved note exists for this ticket.');const requested=ticketId(noteID),note=(await this.request('TicketNotes/'+requested,'GET',undefined,true,source)).item;if(!note||Number(note.id)!==requested||Number(note.ticketID)!==id||this.noteHash(note)!==record.fingerprint)throw new Error('This note does not match the recorded ticket-note intent.');record.noteID=requested;record.status='verified';record.reconciledAt=new Date().toISOString();await this.saveJournal(loaded);}finally{this.pending.delete(id);}}
}
module.exports={AutotaskTicketProvider,ticketStatusIds};

return module.exports;
})();
//= END BUNDLED CORE
//= Keep hints local to Task2Do controls; native titles remain the fallback.
const Setting = createHintedSetting(HostSetting, setTooltip);

const VIEW = 'autotask-todo-view';
const GRAPH_VIEW = 'autotask-microsoft-todo-view';
const TICKET_VIEW = 'task2do-autotask-tickets-view';
const TXT_VIEW = 'task2do-todotxt-view';
const MOOVILA_VIEW = 'task2do-moovila-view';
const OP_VIEW = 'task2do-openproject-view';
const PLANNER_VIEW = 'task2do-planner-view';
const SYNC_VIEW = 'task2do-sync-view';
class ConnectModal extends Modal {
  constructor(plugin,onConnected=null) { super(plugin.app); this.plugin = plugin;this.onConnected=onConnected; }
  onOpen() {
    this.contentEl.createEl('h2', { text: 'Connect to Autotask' });
    this.contentEl.createEl('p', { text: 'Remembered credentials use data.json unless you enable the password-encrypted credential vault in settings.' });
    const credentials = { username: '', secret: '', integrationCode: '', ...(this.plugin.settings.rememberCredentials ? this.plugin.settings.savedCredentials : {}) };
    for (const [key, label] of [['username', 'API username'], ['secret', 'API secret'], ['integrationCode', 'Integration tracking ID']]) {
      new Setting(this.contentEl).setName(label).addText(t => { t.inputEl.type = key === 'username' ? 'text' : 'password'; t.setValue(credentials[key]); t.onChange(v => credentials[key] = v); });
    }
    let remember = this.plugin.settings.rememberCredentials;
    new Setting(this.contentEl).setName('Remember credentials').addToggle(t => t.setValue(remember).onChange(v => remember = v));
    new Setting(this.contentEl).addButton(b => b.setButtonText('Connect').setCta().onClick(async () => {
      try {
        await this.plugin.connect(credentials, remember);
        this.close(); if(typeof this.onConnected==='function')await this.onConnected();else await this.plugin.openView();
      } catch (e) { new Notice(e.message); }
    }));
  }
  onClose() { this.contentEl.empty(); }
}
class CompanyChangeModal extends Modal {
  constructor(view, item, onChanged = () => {}) { super(view.app); this.view = view; this.item = item; this.onChanged = onChanged; this.provider = view.plugin.provider; this.closed = false; this.busy = false; }
  onOpen() {
    this.contentEl.createEl('h2', { text: `Change company — To-Do #${this.item.remoteId}` });
    this.contentEl.createEl('p', { text: this.item.description || '(No description)' });
    this.contentEl.createEl('p', { text: `Current company: ${this.item.organizationName || '#' + this.item.companyId}` });
    this.contentEl.createEl('p', { text: 'Existing contact, ticket, contract and opportunity links will be checked and retained. Incompatible links block the change.' });
    let search = '', destination = String(this.item.companyId), dropdown;
    const status = this.contentEl.createEl('p');
    new Setting(this.contentEl).setName('Search companies').setDesc('Enter at least two characters. Only active companies are offered.').addText(t => t.setPlaceholder('Company name…').onChange(v => search = v)).addButton(b => b.setButtonText('Search').onClick(async () => {
      if (this.busy) return;
      this.busy = true; b.setDisabled(true);
      try {
        status.setText('Searching…'); const result = await this.provider.searchCompanies(search); if (this.closed) return;
        dropdown.selectEl?.replaceChildren(); dropdown.addOption(String(this.item.companyId), this.item.organizationName || `Current company #${this.item.companyId}`);
        const counts = new Map(); for (const company of result.items) counts.set(company.name, (counts.get(company.name) || 0) + 1);
        for (const company of result.items) if (company.id !== String(this.item.companyId)) dropdown.addOption(company.id, counts.get(company.name) > 1 ? `${company.name} (#${company.id})` : company.name);
        destination = String(this.item.companyId); dropdown.setValue(destination).setDisabled(!result.items.length);
        status.setText(result.hasMore ? 'More matches exist. Refine the company name to narrow the results.' : result.items.length ? 'Choose the destination company.' : 'No active matching companies found.');
      } catch (e) { if (!this.closed) status.setText(e.message); }
      finally { this.busy = false; b.setDisabled(false); }
    }));
    new Setting(this.contentEl).setName('Destination company').addDropdown(d => {
      dropdown = d; d.addOption(destination, this.item.organizationName || `Current company #${this.item.companyId}`).setValue(destination).setDisabled(true).onChange(v => destination = v);
    });
    new Setting(this.contentEl).addButton(b => b.setButtonText('Cancel').onClick(() => { if (!this.busy) this.close(); })).addButton(b => b.setButtonText('Change company').setCta().onClick(async () => {
      if (this.busy) return;
      this.busy = true; b.setDisabled(true);
      try {
        if (this.provider !== this.view.plugin.provider) throw new Error('Connection changed. Close this dialog and refresh.');
        if (destination === String(this.item.companyId)) throw new Error('Choose a different destination company.');
        status.setText('Checking linked records and submitting…');
        await this.provider.changeCompany(this.item, destination);
        new Notice('Autotask confirmed the company change and preserved links.'); this.close(); this.onChanged(); await this.view.refresh();
      } catch (e) { if (!this.closed) status.setText(e.message); }
      finally { this.busy = false; b.setDisabled(false); }
    }));
  }
  onClose() { this.closed = true; this.contentEl.empty(); }
}
class UpdateModal extends Modal {
  constructor(view, item, completing = false, reopening = false) { super(view.app); this.view = view; this.item = item; this.completing = completing; this.reopening = reopening; this.busy = false; this.closed = false; this.provider = view.plugin.provider; }
  onOpen() {
    this.contentEl.createEl('h2', { text: `${this.reopening ? 'Reopen' : this.completing ? 'Complete' : 'Edit'} To-Do #${this.item.remoteId}` });
    this.contentEl.createEl('p', { text: this.item.description || '(No description)' });
    this.contentEl.addClass?.('autotask-todo-edit');
    let zone = 'local';
    const values = { activityDescription: this.item.description || '', assignedToResourceID: String(this.item.assigneeId), startDateTime: toCalendarValue(this.item.start, zone).slice(0, 16), endDateTime: toCalendarValue(this.item.due, zone).slice(0, 16) };
    const status = this.contentEl.createEl('p');
    const collectChanges = () => {
      const changes = {};
      if (values.activityDescription !== (this.item.description || '')) changes.activityDescription = values.activityDescription;
      if (values.assignedToResourceID !== String(this.item.assigneeId)) changes.assignedToResourceID = values.assignedToResourceID;
      const start = fromCalendarValue(values.startDateTime, zone), end = fromCalendarValue(values.endDateTime, zone);
      if (Date.parse(end) < Date.parse(start)) throw new Error('End time must be at or after start time.');
      if (toCalendarValue(start, zone).slice(0, 16) !== toCalendarValue(this.item.start, zone).slice(0, 16)) changes.startDateTime = start;
      if (toCalendarValue(end, zone).slice(0, 16) !== toCalendarValue(this.item.due, zone).slice(0, 16)) changes.endDateTime = end;
      return changes;
    };
    if (this.reopening) this.contentEl.createEl('p', { text: 'Reopening will be reported as successful only if Autotask confirms the completion date was cleared. First validate this on a disposable completed To-Do.' });
    if (!this.completing && !this.reopening) {
      new Setting(this.contentEl).setName('Task text / description').setDesc('Autotask has no separate title. The first line is shown in the task list. Saving replaces this description; retain any existing formatting or image markup you want to keep.').addTextArea(t => {
        t.inputEl.maxLength = 32000; t.inputEl.rows = 5;
        t.setValue(values.activityDescription).onChange(v => values.activityDescription = v);
      });
      if (this.provider.capabilities.changeCompany) new Setting(this.contentEl).setName('Company').setDesc(this.item.organizationName || `Company #${this.item.companyId}`).addButton(b => b.setButtonText('Change company').onClick(() => {
        try {
          if (Object.keys(collectChanges()).length) throw new Error('Save your task text, assignment or date changes before changing the company.');
          new CompanyChangeModal(this.view, this.item, () => this.close()).open();
        } catch (e) { status.setText(e.message); }
      }));
      let dropdown;
      const userStatus = this.contentEl.createEl('p');
      new Setting(this.contentEl).setName('Assigned resource').addDropdown(d => {
        dropdown = d; d.addOption(values.assignedToResourceID, this.item.assigneeName || `Current resource #${values.assignedToResourceID}`).setValue(values.assignedToResourceID).setDisabled(true).onChange(v => values.assignedToResourceID = v);
      });
      const loadUsers = async () => {
        userStatus.setText('Loading Autotask users…'); dropdown.setDisabled(true);
        try {
          const users = await this.provider.listResources(); if (this.closed) return;
          dropdown.selectEl?.replaceChildren();
          if (!users.some(user => user.id === String(this.item.assigneeId))) dropdown.addOption(String(this.item.assigneeId), `${this.item.assigneeName || 'Current resource'} (current assignment)`);
          for (const user of users) dropdown.addOption(user.id, user.label);
          dropdown.setValue(values.assignedToResourceID).setDisabled(!users.length);
          userStatus.setText(users.length ? '' : 'No active named users were returned. Current assignment is retained.');
        } catch { if (!this.closed) userStatus.setText('Unable to load Autotask users. Current assignment is retained; schedule edits remain available. Check resource-read permissions or retry.'); }
      };
      new Setting(this.contentEl).addButton(b => b.setButtonText('Reload users').onClick(loadUsers));
      const calendars = {};
      new Setting(this.contentEl).setName('Timezone').addDropdown(d => d.addOptions({ local: `Local — ${Intl.DateTimeFormat().resolvedOptions().timeZone}`, utc: 'UTC' }).setValue(zone).onChange(next => {
        try {
          const converted = {};
          for (const [key, original] of [['startDateTime', this.item.start], ['endDateTime', this.item.due]]) {
            const parsed = fromCalendarValue(values[key], zone);
            const instant = toCalendarValue(parsed, zone).slice(0, 16) === toCalendarValue(original, zone).slice(0, 16) ? original : parsed;
            converted[key] = toCalendarValue(instant, next).slice(0, 16);
          }
          zone = next;
          for (const key of Object.keys(converted)) { values[key] = converted[key]; calendars[key].input.setValue(values[key]); calendars[key].setting.setDesc(calendarZoneLabel(zone, values[key])); }
          status.setText('');
        } catch (e) { d.setValue(zone); status.setText(e.message); }
      }));
      for (const [key, label] of [['startDateTime', 'Start date and time'], ['endDateTime', 'End date and time']]) {
        const setting = new Setting(this.contentEl).setName(label).setDesc(calendarZoneLabel(zone, values[key]));
        setting.addText(t => {
          t.inputEl.type = 'datetime-local'; t.inputEl.step = '60';
          t.inputEl.min = '1000-01-01T00:00'; t.inputEl.max = '9999-12-31T23:59';
          t.setValue(values[key]).onChange(v => { values[key] = v; setting.setDesc(calendarZoneLabel(zone, v)); });
          calendars[key] = { input: t, setting };
        });
      }
      this.contentEl.createEl('p', { text: 'Use the calendar and time controls. Times use hours and minutes; timezone conversion is automatic. Reassigned items leave this view after refresh.' });
      loadUsers();
    }
    new Setting(this.contentEl).addButton(b => b.setButtonText('Cancel').onClick(() => { if (!this.busy) this.close(); })).addButton(b => b.setButtonText(this.reopening ? 'Reopen and verify' : this.completing ? 'Complete To-Do' : 'Save changes').setCta().onClick(async () => {
      if (this.busy) return;
      this.busy = true; b.setDisabled(true); status.setText('Submitting…');
      try {
        if (this.provider !== this.view.plugin.provider) throw new Error('Connection changed. Close this dialog and refresh.');
        if (this.reopening) await this.provider.reopen(this.item);
        else if (this.completing) await this.provider.complete(this.item);
        else {
          const changes = collectChanges();
          if (!Object.keys(changes).length) { status.setText('No changes to save.'); return; }
          await this.provider.update(this.item, changes);
        }
        new Notice(this.reopening ? 'Autotask confirmed the To-Do is open.' : 'Autotask accepted the update.'); this.close(); await this.view.refresh();
      } catch (e) { status.setText(e.message); }
      finally { this.busy = false; b.setDisabled(false); }
    }));
  }
  onClose() { this.closed = true; this.contentEl.empty(); }
}
class AutotaskInspectModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; this.provider = plugin.provider; this.closed = false; }
  onClose() { this.closed = true; this.contentEl.empty(); }
  onOpen() {
    const el = this.contentEl; el.createEl('h2', { text: 'Check Autotask To-Do by ID' });
    el.createEl('p', { text: 'Reads one CRM To-Do regardless of list filters. Does not change the task.' });
    let id = ''; const result = el.createDiv();
    new Setting(el).setName('To-Do ID').addText(t => t.setPlaceholder('Numeric CRM To-Do ID').onChange(v => id = v)).addButton(b => b.setButtonText('Check task').onClick(async () => {
      b.setDisabled(true); result.empty();
      try {
        if (!this.provider || this.provider !== this.plugin.provider) throw new Error('Connect to Autotask, then reopen this check.');
        const item = await this.provider.inspectTask(id); if (this.closed) return;
        result.createEl('p', { text: `To-Do #${item.remoteId}: ${item.completed ? 'Completed' : 'Open'}` });
        result.createEl('p', { text: `Assigned to: ${item.assigneeName} (#${item.assigneeId}) · configured assigned resource: #${item.configuredAssigneeId}` });
        result.createEl('p', { text: `Created by: ${item.creatorName} (#${item.creatorId ?? 'not supplied'}) · configured creator resource: #${item.configuredCreatorId}` });
        if (item.configuredApiResourceId) result.createEl('p', { text: `API user resource: #${item.configuredApiResourceId} · creator query includes both actual user and API user.` });
        if (item.impersonatorCreatorId) result.createEl('p', { text: `Impersonator creator resource: #${item.impersonatorCreatorId}. This is not substituted for the recorded creator.` });
        result.createEl('p', { text: item.matchesAssigned ? 'Matches My Tasks and All Tasks.' : item.matchesCreated ? 'Matches Delegated by Me and All Tasks.' : 'Does not match either configured resource. Check Creator Resource ID (actual user) and API user Resource ID in settings.' });
        const pref = this.plugin.settings.viewPreferences[VIEW], visible = selectAutotaskList(selectTasks([item], pref), pref.scope, item.configuredAssigneeId, item.configuredCreatorIds || [item.configuredCreatorId]).length > 0;
        result.createEl('p', { text: visible ? 'Current state/search filters allow this task.' : 'Current state/search filters hide this task. Choose All Tasks, All states and clear search, then refresh.' });
      } catch (e) { if (!this.closed) result.createEl('p', { text: e.message + ' A missing record may reflect CRM To-Do access permissions or a different task entity.' }); }
      finally { b.setDisabled(false); }
    }));
  }
}
class ToDoView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.generation = 0; }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Task2Do: Autotask Tasks'; }
  getIcon() { return 'list-checks'; }
  async onOpen() { await this.refresh(); }
  async onClose() { this.generation++; }
  currentProvider() { return this.plugin.provider; }
  async loadItems(provider) { return provider.enrich(await (provider.listForUser ? provider.listForUser() : provider.list())); }
  panelToolbar(el) { const toolbar = new Setting(el); toolbar.settingEl.addClass?.('task2do-toolbar'); return toolbar; }
  toolbar(el) { this.panelToolbar(el).addButton(b => b.setButtonText('New task').onClick(() => new AutotaskCreateModal(this.plugin, this).open())).addButton(b => b.setButtonText('Refresh').onClick(() => this.refresh())).addButton(b => b.setButtonText('Connect').onClick(() => new ConnectModal(this.plugin).open())); }
  taskActions(card, item, provider) {
    if (!provider.capabilities.update) return;
    const actions = new Setting(card);
    if (item.completed) actions.addButton(b => b.setButtonText('Reopen').onClick(() => new UpdateModal(this, item, false, true).open()));
    else {
      actions.addButton(b => b.setButtonText('Edit').onClick(() => new UpdateModal(this, item).open())).addButton(b => b.setButtonText('Complete').onClick(() => new UpdateModal(this, item, true).open())).addButton(b => b.setButtonText('Note').onClick(() => new AutotaskTextNoteModal(this, item).open()));
    }
  }
  /**= Use text-only DOM nodes for metadata; preserve raw lines for editing. */
  renderTodoTxt(card, item) {
    const shown = todoPresentation(item);
    hintElement(card.createEl('p', { text: shown.title, cls: 'autotask-todo-title task2do-txt-title' }),taskHint({...item,start:shown.start||item.start,due:shown.end||item.due,dueDate:shown.end?undefined:item.dueDate},true),setTooltip);
    const chips = card.createDiv({ cls: 'task2do-txt-chips' });
    if (shown.priority) hintElement(chips.createEl('span', { text: `Priority ${shown.priority}`, cls: 'task2do-txt-chip task2do-priority' }),'Local priority: A is highest. Use Edit to change it; it is not automatically mapped to Microsoft.',setTooltip);
    for (const token of [...shown.projects, ...shown.contexts]) hintElement(chips.createEl('span', { text: token, cls: 'task2do-txt-chip' }),token.startsWith('+')?'Project tag. Use Edit → Projects to change it.':'Context tag. Use Edit → Contexts to change it.',setTooltip);
    if (shown.company || shown.assignee) card.createEl('small', { text: [shown.company, shown.assignee].filter(Boolean).join(' · '), cls: 'task2do-txt-people' });
    const times = [];
    for (const [label, value] of [['Start', shown.start], ['End', shown.end]]) if (value) times.push(`${label}: ${Number.isFinite(Date.parse(value)) ? formatTaskDate(value) : 'invalid date/time'}`);
    if (times.length) card.createEl('small', { text: times.join(' · '), cls: 'task2do-txt-schedule' });
    if(item.description)card.createEl('p',{text:item.description,cls:'task2do-txt-description'});
    const details = card.createEl('details', { cls: 'task2do-txt-details' });
    hintElement(details.createEl('summary', { text: 'Details' }),'Expand to inspect task metadata, stable identity, source file and the raw todo.txt line.',setTooltip);
    const fields = details.createEl('dl', { cls: 'task2do-txt-fields' });
    for (const field of shown.fields) { fields.createEl('dt', { text: field.key }); fields.createEl('dd', { text: field.value }); }
    if (item.createdDate) { fields.createEl('dt', { text: 'Created' }); fields.createEl('dd', { text: item.createdDate }); }
    if (item.completedDate) { fields.createEl('dt', { text: 'Completed' }); fields.createEl('dd', { text: item.completedDate }); }
    fields.createEl('dt', { text: 'File' }); fields.createEl('dd', { text: item.source || 'todo.txt' });
    details.createEl('p', { text: item.rawLine, cls: 'task2do-txt-raw' });
  }
  renderItems(items, el, provider) {
    const options = { state: 'open', search: '', sort: 'due-asc', scope: 'all', localView:'inbox', ...this.plugin.settings.viewPreferences?.[this.getViewType()] };
    const summary = el.createEl('p'), list = el.createDiv();
    const draw = () => {
      list.empty(); let visible = selectTasks(this.getViewType()===TXT_VIEW?selectTodoView(items,options.localView):items, options);
      const resourceId = String(provider.resourceId ?? this.plugin.settings.resourceId);
      const creatorResourceIds = (provider.creatorResourceIds || [provider.creatorResourceId ?? (this.plugin.settings.creatorResourceId || resourceId), this.plugin.settings.apiResourceId].filter(Boolean)).map(String);
      if (this.getViewType() === VIEW) visible = selectAutotaskList(visible, options.scope, resourceId, creatorResourceIds);
      summary.setText(`${visible.length} of ${items.length} ${this.getViewType() === VIEW ? 'unique ' : ''}tasks shown. ${provider.capabilities.update ? 'Editing enabled.' : 'Read-only mode.'}`);
      if (!visible.length) list.createEl('p', { text: 'No matching tasks. Try All Tasks, choose All states, clear search, or refresh.' });
      const groups = this.getViewType() === VIEW ? [{ label: { my: 'My Tasks', delegated: 'Delegated by Me', all: 'All Tasks' }[options.scope] || 'All Tasks', items: visible }] : [{ items: visible }];
      for (const group of groups) {
        const target = group.label ? list.createDiv({ cls: 'task2do-task-group' }) : list;
        if (group.label) { target.createEl('h3', { text: `${group.label} (${group.items.length})`, cls: 'task2do-group-heading' }); if (!group.items.length) target.createEl('small', { text: 'No matching tasks in this list.' }); }
      for (const item of group.items) {
        const urgency = taskUrgency(item);
        const card = target.createDiv({ cls: `autotask-todo-card task2do-${urgency.kind}` });
        hintElement(card.createEl('strong', { text: `${item.provider==='autotask-tickets'?'Status: '+item.statusName:item.completed ? 'Completed' : 'Open'}${item.provider==='todotxt'?'':' #'+(item.ticketNumber||item.remoteId)} · Due: ${item.dueDate || formatTaskDate(item.due, item.dueDisplay)}${!item.completed && urgency.label ? ' · ' + urgency.label : ''}` }),`Dates use the local calendar/timezone. ${item.dueDate?/(?:^|\s)endDateTime:/.test(item.rawLine||'')?'The precise source deadline is retained in Details. ':'This task has a date-only deadline. ':''}${provider.capabilities.update?'Use Edit to change supported schedule fields.':'This provider is read-only.'}`,setTooltip);
        if (item.provider === 'todotxt') this.renderTodoTxt(card, item);
        else {
        if (item.title) hintElement(card.createEl('p', { text: item.title, cls: 'autotask-todo-title' }),taskHint(item,provider.capabilities.update),setTooltip);
        if (item.description) { const details = card.createEl('details'); hintElement(details.createEl('summary', { text: item.description.split('\n')[0].slice(0, 140) }),taskHint(item,provider.capabilities.update)+'\nExpand to read the full description.',setTooltip); details.createEl('p', { text: item.description }); }
        card.createEl('small', { text: item.provider === 'autotask-todo' ? `${item.organizationName} · ${item.assigneeName}` : item.listName || item.source });
        }
        this.taskActions(card, item, provider);
      }
      }
    };
    const changed = async () => {
      this.plugin.settings.viewPreferences[this.getViewType()] = { ...options }; draw();
      try { await this.plugin.persist(); } catch { new Notice('Unable to save view preferences.'); }
    };
    const controls = new Setting(el);
    if (this.getViewType() === VIEW) controls.addDropdown(d => d.addOptions({ my: 'My Tasks', delegated: 'Delegated by Me', all: 'All Tasks' }).setValue(options.scope).onChange(v => { options.scope = v; changed(); }));
    if(this.getViewType()===TXT_VIEW)controls.addDropdown(d=>d.addOptions({inbox:'Inbox',today:'Today (includes overdue)',upcoming:'Upcoming',completed:'Completed',all:'All tasks'}).setValue(options.localView||'inbox').onChange(v=>{options.localView=v;options.state=v==='completed'?'completed':v==='all'?'all':'open';changed();}));
    controls.addDropdown(d => d.addOptions({ open: 'Open', completed: 'Completed', all: 'All' }).setValue(options.state).onChange(v => { options.state = v; changed(); }));
    controls.addDropdown(d => d.addOptions({ 'due-asc': 'Due: earliest first', 'due-desc': 'Due: latest first', none: 'Original order' }).setValue(options.sort).onChange(v => { options.sort = v; changed(); }));
    controls.addText(t => t.setPlaceholder('Search tasks, names…').setValue(options.search).onChange(v => { options.search = v; changed(); }));
    el.insertBefore(controls.settingEl, summary); draw();
  }
  async refresh() {
    const generation = ++this.generation;
    const el = this.contentEl; el.empty();
    el.createEl('h2', { text: this.getDisplayText() });
    this.toolbar(el);
    const provider = this.currentProvider();
    if (!provider) { el.createEl('p', { text: this.getViewType() === MOOVILA_VIEW || this.getViewType() === OP_VIEW ? 'Connect this provider using its instance configuration and credentials.' : this.getViewType() === VIEW ? 'Configure your zone URL and Resource ID in settings, then connect.' : 'Configure your Microsoft client ID in settings, then sign in.' }); return; }
    const status = el.createEl('p', { text: 'Loading…' });
    try {
      const items = await this.loadItems(provider);
      if (generation !== this.generation || provider !== this.currentProvider()) return;
      status.remove(); this.renderItems(items, el, provider);
      if (this.plugin.settings.publishIndex) { try { await this.plugin.publishTasks(provider.id, items); } catch (e) { el.createEl('p', { text: 'Index: ' + e.message }); } }
    } catch (e) { if (generation === this.generation) status.setText(e.message); }
  }
}
/**= Ticket changes never reuse the CRM To-Do completion or description writer. */
class AutotaskTicketUpdateModal extends Modal {
  constructor(view,item){super(view.app);this.view=view;this.item=item;this.provider=view.currentProvider();this.closed=false;}
  onClose(){this.closed=true;this.contentEl.empty();}
  async onOpen(){
    const el=this.contentEl;el.createEl('h2',{text:`Update ticket ${this.item.ticketNumber||this.item.remoteId}`});
    el.createEl('p',{text:'Edit supported ticket fields. Autotask permissions and workflows still apply. Reassigned tickets may leave this list after refresh.'});const status=el.createEl('p');
    try{
      const fields=await this.provider.fields();if(this.closed)return;
      const raw=this.item.raw||{},selected={status:this.item.statusId,priority:this.item.priorityId},changes={};let confirmPlainTextReplacement=false,descriptionEnabled=false,assignmentEnabled=false,assignmentReady=false,assignmentGeneration=0;
      for(const name of ['status','priority'])new Setting(el).setName(name==='status'?'Ticket status':'Ticket priority').addDropdown(d=>{const choices=this.provider.choices(fields,name);d.addOption(selected[name],this.item[name+'Name']||'Current value');for(const choice of choices)if(choice.id!==selected[name])d.addOption(choice.id,choice.label);d.setValue(selected[name]).onChange(v=>selected[name]=v);});
      new Setting(el).setName('Ticket title').setDesc('Change the ticket name; maximum 255 characters, subject to tenant metadata.').addText(t=>t.setValue(this.item.title||'').onChange(v=>changes.title=v));
      const dueValue=this.item.due?toCalendarValue(this.item.due).slice(0,16):'';
      new Setting(el).setName('Ticket due date / time').setDesc(`Local timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Hours and minutes only; unchanged precision is retained.`).addText(t=>{t.inputEl.type='datetime-local';t.inputEl.step='60';t.setValue(dueValue).onChange(v=>{if(v===dueValue)delete changes.dueDateTime;else changes.dueDateTime=v;});});
      const descriptionArea=el.createDiv();
      new Setting(el).setName('Replace ticket description').setDesc('Optional destructive replacement: Autotask formatting and embedded images will be lost. Leave off to preserve them.').addToggle(t=>t.setValue(false).onChange(v=>{
        descriptionEnabled=v;confirmPlainTextReplacement=false;delete changes.description;descriptionArea.empty();if(!v)return;
        descriptionArea.createEl('p',{text:'Autotask returns a plain-text description. Saving a changed description replaces all existing rich text and images.'});
        new Setting(descriptionArea).setName('Ticket description (plain text)').addTextArea(a=>a.setValue(this.item.description||'').onChange(value=>{if(value===(this.item.description||''))delete changes.description;else changes.description=value;}));
        new Setting(descriptionArea).setName('I accept losing description formatting and images').addToggle(a=>a.setValue(false).onChange(value=>confirmPlainTextReplacement=value));
      }));
      const assignmentArea=el.createDiv();const assignment={assignedResourceID:String(raw.assignedResourceID??''),assignedResourceroleID:String(raw.assignedResourceroleID??''),queueID:String(raw.queueID??'')};
      new Setting(el).setName('Change ticket assignment').setDesc('Choose an active resource, service desk role and resource queue. Existing secondary assignments are not removed.').addToggle(t=>t.setValue(false).onChange(async enabled=>{
        assignmentEnabled=enabled;assignmentReady=false;const generation=++assignmentGeneration;assignmentArea.empty();if(!enabled)return;
        const message=assignmentArea.createEl('p',{text:'Loading resources…'}),dependent=assignmentArea.createDiv();
        try{
          const users=await this.provider.resources();if(this.closed||generation!==assignmentGeneration)return;
          const load=async()=>{assignmentReady=false;dependent.empty();message.setText('Loading roles and queues…');const requested=assignment.assignedResourceID;
            try{const available=await this.provider.assignmentOptions(requested,fields);if(this.closed||generation!==assignmentGeneration||requested!==assignment.assignedResourceID)return;
              for(const [key,label,list]of [['assignedResourceroleID','Ticket resource role',available.roles],['queueID','Ticket queue',available.queues]])new Setting(dependent).setName(label).addDropdown(d=>{d.addOption('','Choose explicitly');for(const option of list)d.addOption(option.id,option.label);if(!list.some(v=>v.id===assignment[key]))assignment[key]='';d.setValue(assignment[key]).onChange(v=>assignment[key]=v);});
              assignmentReady=true;message.setText('Assignment choices are revalidated when saved.');
            }catch(e){if(!this.closed&&generation===assignmentGeneration&&requested===assignment.assignedResourceID)message.setText(e.message);}
          };
          new Setting(assignmentArea).setName('Assigned resource').addDropdown(d=>{d.addOption('','Choose resource');for(const user of users)d.addOption(String(user.id),user.label||user.name);d.setValue(assignment.assignedResourceID).onChange(async v=>{assignment.assignedResourceID=v;assignment.assignedResourceroleID='';assignment.queueID='';await load();});});
          if(assignment.assignedResourceID)await load();else message.setText('Choose a resource.');
        }catch(e){if(!this.closed&&generation===assignmentGeneration)message.setText(e.message);}
      }));
      new Setting(el).addButton(b=>b.setButtonText('Save ticket changes').setCta().onClick(async()=>{
        b.setDisabled(true);try{
          if(this.provider!==this.view.currentProvider())throw new Error('Ticket configuration changed. Refresh first.');
          const payload={...changes};if(!descriptionEnabled)delete payload.description;if(Object.hasOwn(payload,'description')&&!confirmPlainTextReplacement)throw new Error('Accept description formatting and image loss before saving.');
          if(Object.hasOwn(payload,'dueDateTime'))payload.dueDateTime=fromCalendarValue(payload.dueDateTime,'local');
          if(selected.status!==this.item.statusId)payload.status=selected.status;if(selected.priority!==this.item.priorityId)payload.priority=selected.priority;
          if(assignmentEnabled){if(!assignmentReady||Object.values(assignment).some(v=>!v))throw new Error('Choose a resource, role and queue after the assignment choices have loaded.');for(const [key,value]of Object.entries(assignment))if(String(raw[key]??'')!==value)payload[key]=value;}
          if(!Object.keys(payload).length){status.setText('No changes to save.');return;}
          await this.provider.update(this.item,payload,{confirmPlainTextReplacement});this.close();await this.view.refresh();
        }catch(e){if(!this.closed)status.setText(e.message);}finally{b.setDisabled(false);}
      }));
    }catch(e){if(!this.closed)status.setText(e.message);}
  }
}
class AutotaskTicketNotesModal extends Modal {
  constructor(view,item){super(view.app);this.view=view;this.item=item;this.provider=view.currentProvider();this.closed=false;}
  onClose(){this.closed=true;this.contentEl.empty();}
  async onOpen(){const el=this.contentEl;el.createEl('h2',{text:`Ticket notes: ${this.item.ticketNumber||this.item.remoteId}`});const status=el.createEl('p',{text:'Loading notes…'});try{
    const notes=await this.provider.notes(this.item.remoteId),fields=await this.provider.fields('TicketNotes').catch(()=>[]);if(this.closed)return;status.setText(`${notes.length} notes. Visibility labels reflect Autotask; external visibility and workflows must be reviewed before submission.`);
    for(const note of notes){const card=el.createDiv({cls:'autotask-todo-card'});card.createEl('strong',{text:`Note #${note.id} · ${formatTaskDate(note.createDateTime)}`});card.createEl('p',{text:note.title||'(Untitled note)'});card.createEl('small',{text:'Visibility: '+(this.provider.choices(fields,'publish').find(v=>v.id===String(note.publish))?.label||'#'+note.publish)});card.createEl('p',{text:note.description||''});}
    if(!this.provider.enableWrites)return;
    const journal=await this.provider.noteState(this.item.remoteId);if(this.closed)return;if(journal&&journal.status!=='verified'){el.createEl('p',{text:`A note write needs review${journal.noteID?' (accepted ID #'+journal.noteID+')':''}. Inspect Autotask and reconcile the matching note; another creation is blocked.`});let noteID=journal.noteID?String(journal.noteID):'';new Setting(el).setName('Existing ticket note ID').addText(t=>t.setValue(noteID).onChange(v=>noteID=v));new Setting(el).addButton(b=>b.setButtonText('Reconcile ticket note').onClick(async()=>{b.setDisabled(true);try{await this.provider.reconcileNote(this.item.remoteId,noteID);this.close();new AutotaskTicketNotesModal(this.view,this.item).open();}catch(e){status.setText(e.message);b.setDisabled(false);}}));return;}
    const values={title:'',description:'',noteType:'',publish:''};new Setting(el).setName('Note title').addText(t=>t.onChange(v=>values.title=v));new Setting(el).setName('Note text').addTextArea(t=>t.onChange(v=>values.description=v));for(const [name,label]of [['noteType','Note type'],['publish','Note visibility']])new Setting(el).setName(label).addDropdown(d=>{d.addOption('','Choose explicitly');for(const choice of this.provider.choices(fields,name))d.addOption(choice.id,choice.label);d.onChange(v=>values[name]=v);});
    let submitted=false;new Setting(el).addButton(b=>b.setButtonText('Add ticket note').setCta().onClick(async()=>{b.setDisabled(true);try{if(this.provider!==this.view.currentProvider())throw new Error('Ticket connection changed. Reopen notes.');submitted=true;await this.provider.addNote(this.item,{...values});this.close();new AutotaskTicketNotesModal(this.view,this.item).open();}catch(e){if(!this.closed)status.setText(e.message+' Close and reopen notes to check the recorded outcome.');}finally{if(submitted)try{const record=await this.provider.noteState(this.item.remoteId);submitted=!!record&&record.status!=='verified';}catch{}b.setDisabled(submitted);}}));
  }catch(e){if(!this.closed)status.setText(e.message);}}
}
class AutotaskTicketAssignmentFilterModal extends Modal {
  constructor(view){super(view.app);this.view=view;this.provider=view.currentProvider();this.closed=false;}
  onClose(){this.closed=true;this.contentEl.empty();}
  async onOpen(){
    const el=this.contentEl,pref=this.view.plugin.settings.viewPreferences[TICKET_VIEW]||{};
    let mode=['user','group'].includes(pref.ticketAssignmentMode)?pref.ticketAssignmentMode:'me',single=String(pref.ticketUserId||''),search='',users=[];
    const selected=new Set(Array.isArray(pref.ticketUserIds)?pref.ticketUserIds.map(String):[]);
    el.createEl('h2',{text:'Ticket assignment filter'});el.createEl('p',{text:'Me uses the configured Autotask Assigned Resource ID. Group means a selected set of users, not an Autotask queue or security group. Primary assignments only; API permissions still apply.'});
    const status=el.createEl('p'),choices=el.createDiv();
    const draw=()=>{
      choices.empty();if(mode==='me')return;
      if(mode==='user'){new Setting(choices).setName('Ticket assignee').addDropdown(d=>{d.addOption('','Choose a user');for(const user of users)d.addOption(String(user.id),user.label||user.name);d.setValue(single).onChange(v=>single=v);});return;}
      new Setting(choices).setName('Search ticket assignees').addText(t=>t.setValue(search).onChange(v=>{search=v;drawUsers();}));
      const list=choices.createDiv(),count=choices.createEl('p');
      const drawUsers=()=>{list.empty();count.setText(`${selected.size} selected (maximum 50).`);for(const user of users.filter(u=>(u.label||u.name||'').toLowerCase().includes(search.toLowerCase())))new Setting(list).setName(user.label||user.name).addToggle(t=>t.setValue(selected.has(String(user.id))).onChange(value=>{if(value)selected.add(String(user.id));else selected.delete(String(user.id));count.setText(`${selected.size} selected (maximum 50).`);}));};drawUsers();
    };
    new Setting(el).setName('Tickets assigned to').addDropdown(d=>d.addOption('me','Me').addOption('user','A selected user').addOption('group','A selected group of users').setValue(mode).onChange(v=>{mode=v;draw();}));
    draw();
    new Setting(el).addButton(b=>b.setButtonText('Apply assignment filter').setCta().onClick(async()=>{
      b.setDisabled(true);try{
        if(this.provider!==this.view.currentProvider())throw new Error('Autotask connection changed. Reopen the filter.');
        const ids=mode==='user'?[single]:[...selected];
        if(mode!=='me'&&(!ids.length||ids.length>50||ids.some(id=>!users.some(u=>String(u.id)===id))))throw new Error('Choose between 1 and 50 available users.');
        const preferences=this.view.plugin.settings.viewPreferences,before=preferences[TICKET_VIEW];
        preferences[TICKET_VIEW]={...before,ticketAssignmentMode:mode,ticketUserId:single,ticketUserIds:[...selected]};
        try{await this.view.plugin.persist();}catch(e){preferences[TICKET_VIEW]=before;throw e;}
        this.close();await this.view.refresh();
      }catch(e){if(!this.closed)status.setText(e.message);}finally{b.setDisabled(false);}
    }));
    status.setText('Loading available Autotask users…');
    try{users=await this.provider.resources();if(this.closed)return;status.setText('Selections are saved for this panel. Existing status, queue and search filters still apply.');draw();}
    catch(e){if(!this.closed)status.setText(e.message+' You can still select Me.');}
  }
}
class AutotaskTicketsView extends ToDoView {
  getViewType(){return TICKET_VIEW;}getDisplayText(){return 'Task2Do: Autotask Tickets';}
  currentProvider(){return this.plugin.registry.get('autotask-tickets');}async loadItems(provider){const p=this.plugin.settings.viewPreferences[TICKET_VIEW]||{};if(p.ticketAssignmentMode==='user')return provider.list([p.ticketUserId]);if(p.ticketAssignmentMode==='group')return provider.list(p.ticketUserIds||[]);return provider.list();}
  toolbar(el){this.panelToolbar(el).addButton(b=>{b.setButtonText('New task').setDisabled(true);b.buttonEl?.setAttribute('title','Ticket creation is deferred; use Autotask to create tickets.');}).addButton(b=>b.setButtonText('Refresh').onClick(()=>this.refresh())).addButton(b=>b.setButtonText('Connect').onClick(()=>new ConnectModal(this.plugin,()=>this.plugin.openTicketsView()).open())).addButton(b=>b.setButtonText('Assignment filter').onClick(()=>new AutotaskTicketAssignmentFilterModal(this).open()));}
  renderItems(items,el,provider){const p=this.plugin.settings.viewPreferences[TICKET_VIEW]||{},label=p.ticketAssignmentMode==='user'?'Selected user':p.ticketAssignmentMode==='group'?`Selected group (${(p.ticketUserIds||[]).length} users)`:'Me';new Setting(el).setName('Assigned to: '+label);const controls=new Setting(el),holder=el.createDiv();const pref=()=>this.plugin.settings.viewPreferences[TICKET_VIEW];const draw=()=>{holder.empty();const p=pref();super.renderItems(items.filter(item=>(!p.ticketStatus||item.statusId===p.ticketStatus)&&(!p.ticketPriority||item.priorityId===p.ticketPriority)&&(!p.ticketQueue||String(item.raw?.queueID??'')===p.ticketQueue)),holder,provider);};for(const [key,label,idField,nameField]of [['ticketStatus','Status','statusId','statusName'],['ticketPriority','Priority','priorityId','priorityName'],['ticketQueue','Queue','queueID','queueName']])controls.addDropdown(d=>{d.addOption('','All '+label.toLowerCase()+' values');const seen=new Set();for(const item of items){const id=key==='ticketQueue'?String(item.raw?.queueID??''):item[idField];if(id&&!seen.has(id)){d.addOption(id,item[nameField]||id);seen.add(id);}}d.setValue(pref()[key]||'').onChange(async v=>{pref()[key]=v;draw();try{await this.plugin.persist();}catch(e){new Notice(e.message);}});});draw();}
  taskActions(card,item,provider){card.createEl('small',{text:[item.organizationName,item.assigneeName,item.queueName].filter(Boolean).join(' · ')});hintElement(card.createEl('small',{text:'Ticket status: '+item.statusName+' · Priority: '+item.priorityName}),`Status: ${item.statusName} (#${item.statusId})\nPriority: ${item.priorityName} (#${item.priorityId})\nQueue: ${item.queueName} (#${item.raw?.queueID??'unassigned'})\nUse Update ticket to edit title, description, due date, status, priority or assignment.`,setTooltip);const controls=new Setting(card);if(provider.enableWrites)controls.addButton(b=>b.setButtonText('Update ticket').onClick(()=>new AutotaskTicketUpdateModal(this,item).open()));controls.addButton(b=>b.setButtonText('Ticket notes').onClick(()=>new AutotaskTicketNotesModal(this,item).open()));}
}
class MicrosoftSignInModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; this.cancelled = false; this.auth = null; }
  onOpen() {
    this.contentEl.createEl('h2', { text: 'Sign in to Microsoft To Do' });
    this.contentEl.createEl('p', { text: 'Uses your Entra public client app and Tasks.ReadWrite. No client secret is required.' });
    const status = this.contentEl.createEl('p');
    new Setting(this.contentEl).addButton(b => b.setButtonText('Start sign-in').setCta().onClick(async () => {
      b.setDisabled(true);
      try {
        this.auth = this.plugin.makeMicrosoftAuth();
        const device = await this.auth.begin();
        if (this.cancelled) return;
        status.setText(`Enter code ${device.userCode} on the Microsoft sign-in page. Waiting for sign-in…`);
        const link = this.contentEl.createEl('a', { text: 'Open Microsoft sign-in', href: device.verificationUri });
        link.target = '_blank'; link.rel = 'noopener noreferrer';
        await this.auth.poll(device, () => this.cancelled || this.plugin.unloaded);
        if (this.cancelled || this.plugin.unloaded) return;
        this.plugin.installMicrosoft(this.auth); this.auth = null;
        new Notice('Microsoft To Do connected.'); this.close(); await this.plugin.openMicrosoftView();
      } catch (e) { if (!this.cancelled) { status.setText(e.message); b.setDisabled(false); } this.auth?.dispose(); this.auth = null; }
    }));
  }
  onClose() { this.cancelled = true; this.auth?.dispose(); this.contentEl.empty(); }
}
class MicrosoftTaskModal extends Modal {
  constructor(plugin, view, item = null, action = 'create', initial = {}) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; this.action = action; this.initial = initial; this.closed = false; this.busy = false; this.provider = plugin.registry.get('microsoft-todo'); }
  async onOpen() {
    this.contentEl.createEl('h2', { text: `${this.action === 'create' ? 'Create' : this.action === 'edit' ? 'Edit' : this.action === 'complete' ? 'Complete' : 'Reopen'} Microsoft To Do task` });
    const status = this.contentEl.createEl('p');
    if (!this.provider) { status.setText('Sign in to Microsoft To Do first.'); return; }
    const values = { title: this.item?.title || this.initial.title || '', description: this.item?.description || this.initial.description || '', due: this.item?.due || '' };
    let listId;
    try {
      if (this.action === 'create') {
        status.setText('Loading task lists…'); const lists = await this.provider.destinations();
        if (this.closed) return;
        if (!lists.length) { status.setText('No Microsoft To Do lists found. Create a list in Microsoft To Do first.'); return; }
        listId = lists[0].id;
        new Setting(this.contentEl).setName('List').addDropdown(d => { for (const list of lists) d.addOption(list.id, list.displayName); d.setValue(listId).onChange(v => listId = v); });
      }
      if (['create', 'edit'].includes(this.action)) new Setting(this.contentEl).setName('Title').addText(t => t.setValue(values.title).onChange(v => values.title = v));
      let dueChanged = false;
      if (['create', 'edit'].includes(this.action)) {
        new Setting(this.contentEl).setName('Description').addTextArea(t => t.setValue(values.description).onChange(v => values.description = v));
        new Setting(this.contentEl).setName('Due (optional local date/time)').setDesc(`Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`).addText(t => { t.inputEl.type = 'datetime-local'; t.inputEl.step = '60'; t.setValue(values.due ? toCalendarValue(values.due).slice(0,16) : '').onChange(v => { dueChanged = true; values.due = v ? fromCalendarValue(v) : ''; }); });
      } else this.contentEl.createEl('p', { text: this.item.title });
      status.setText('');
      new Setting(this.contentEl).addButton(b => b.setButtonText('Cancel').onClick(() => { if (!this.busy) this.close(); })).addButton(b => b.setButtonText(this.action === 'create' ? 'Create task' : this.action === 'edit' ? 'Save changes' : this.action === 'complete' ? 'Complete task' : 'Reopen task').setCta().onClick(async () => {
        if (this.busy) return;
        this.busy = true; b.setDisabled(true); status.setText('Submitting…');
        try {
          if (this.provider !== this.plugin.registry.get('microsoft-todo')) throw new Error('Microsoft connection changed. Close and try again.');
          if (this.action === 'create') await this.provider.create(listId, values);
          else if (this.action === 'edit') { const changes = {}; if(values.title !== this.item.title)changes.title = values.title; if(values.description !== this.item.description)changes.description = values.description; if(dueChanged)changes.due = values.due || null; await this.provider.update(this.item, changes); }
          else if (this.action === 'complete') await this.provider.complete(this.item);
          else await this.provider.reopen(this.item);
          new Notice('Microsoft To Do accepted the change.'); this.close();
          if (this.view) await this.view.refresh(); else await this.plugin.openMicrosoftView();
        } catch (e) { status.setText(e.message); }
        finally { this.busy = false; b.setDisabled(false); }
      }));
    } catch (e) { if (!this.closed) status.setText(e.message); }
  }
  onClose() { this.closed = true; this.contentEl.empty(); }
}
class MicrosoftToDoView extends ToDoView {
  getViewType() { return GRAPH_VIEW; }
  getDisplayText() { return 'Task2Do: Microsoft To Do Tasks'; }
  currentProvider() { return this.plugin.registry.get('microsoft-todo'); }
  async loadItems(provider) { return provider.list(); }
  toolbar(el) {
    this.panelToolbar(el).addButton(b => b.setButtonText('New task').onClick(() => new MicrosoftTaskModal(this.plugin, this).open())).addButton(b => b.setButtonText('Refresh').onClick(() => this.refresh())).addButton(b => b.setButtonText('Sign in').onClick(() => new MicrosoftSignInModal(this.plugin).open()));
  }
  taskActions(card, item, provider) {
    const actions = new Setting(card);
    if (provider.capabilities.update) actions.addButton(b => b.setButtonText('Edit').onClick(() => new MicrosoftTaskModal(this.plugin, this, item, 'edit').open()));
    actions.addButton(b=>b.setButtonText('Attachments').onClick(()=>new MicrosoftAttachmentsModal(this,item).open()));
    const action = item.completed ? 'reopen' : 'complete';
    if (provider.capabilities[action]) actions.addButton(b => b.setButtonText(item.completed ? 'Reopen' : 'Complete').onClick(() => new MicrosoftTaskModal(this.plugin, this, item, action).open()));
  }
}
class AutotaskCreateModal extends Modal {
  constructor(plugin, view = null) { super(plugin.app); this.plugin = plugin; this.view = view; this.provider = plugin.provider; this.closed = false; this.busy = false; }
  async onOpen() {
    const el = this.contentEl; el.createEl('h2', { text: 'Create Autotask To-Do' }); const status = el.createEl('p');
    if (!this.provider?.capabilities.create) { status.setText('Connect and enable To-Do updates first.'); return; }
    const values = { activityDescription: '', companyID: '', assignedToResourceID: this.plugin.settings.resourceId, actionType: '' };
    let search = '', companies;
    try {
      const [users, actions] = await Promise.all([this.provider.listResources(), this.provider.actionTypes()]);
      if (this.closed) return;
      if (!users.length || !actions.length) throw new Error('No assignable users or action types available.');
      values.assignedToResourceID = users.some(u => u.id === values.assignedToResourceID) ? values.assignedToResourceID : users[0].id;
      values.actionType = (actions.find(a => a.isDefault) || actions[0]).id;
      new Setting(el).setName('Search companies').addText(t => t.setPlaceholder('At least two characters').onChange(v => search = v)).addButton(b => b.setButtonText('Search').onClick(async () => {
        b.setDisabled(true); try { const result = await this.provider.searchCompanies(search); if (this.closed) return; companies.selectEl?.replaceChildren(); companies.addOption('', 'Choose company'); for (const c of result.items) companies.addOption(c.id, `${c.name} (#${c.id})`); values.companyID = ''; companies.setValue(''); status.setText(result.hasMore ? 'Refine search to see more companies.' : result.items.length ? 'Choose company.' : 'No matching companies.'); } catch (e) { status.setText(e.message); } finally { b.setDisabled(false); }
      }));
      new Setting(el).setName('Company').addDropdown(d => { companies = d; d.addOption('', 'Search first').onChange(v => values.companyID = v); });
      new Setting(el).setName('Assigned resource').addDropdown(d => { for (const u of users) d.addOption(u.id, u.label); d.setValue(values.assignedToResourceID).onChange(v => values.assignedToResourceID = v); });
      new Setting(el).setName('Action type').addDropdown(d => { for (const a of actions) d.addOption(a.id, a.label); d.setValue(values.actionType).onChange(v => values.actionType = v); });
      new Setting(el).setName('Description').addTextArea(t => t.onChange(v => values.activityDescription = v));
      el.createEl('p', { text: `Times use ${Intl.DateTimeFormat().resolvedOptions().timeZone}.` });
      const times = { startDateTime: toCalendarValue(new Date().toISOString()).slice(0,16), endDateTime: toCalendarValue(new Date(Date.now()+900000).toISOString()).slice(0,16) };
      for (const [key, label] of [['startDateTime','Start'],['endDateTime','End / due']]) new Setting(el).setName(label).addText(t => { t.inputEl.type = 'datetime-local'; t.inputEl.step = '60'; t.setValue(times[key]).onChange(v => times[key] = v); });
      status.setText('');
      new Setting(el).addButton(b => b.setButtonText('Create task').setCta().onClick(async () => {
        if (this.busy) return; this.busy = true; b.setDisabled(true);
        let submitted = false;
        try {
          if (this.provider !== this.plugin.provider) throw new Error('Connection changed. Close and try again.');
          const dates = Object.fromEntries(Object.entries(times).map(([key,v]) => [key, fromCalendarValue(v)]));
          if (!values.companyID || !values.activityDescription.trim()) throw new Error('Choose company and enter description.');
          if (Date.parse(dates.endDateTime) < Date.parse(dates.startDateTime)) throw new Error('End must be at or after start.');
          submitted = true; await this.provider.create({ ...values, ...dates }); this.close(); new Notice('Autotask confirmed creation.'); if (this.view) await this.view.refresh(); else await this.plugin.openView();
        } catch (e) { status.setText(e.message + (submitted ? ' Close, refresh and check before creating again.' : '')); }
        finally { this.busy = false; b.setDisabled(submitted); }
      }));
    } catch (e) { if (!this.closed) status.setText(e.message); }
  }
  onClose() { this.closed = true; this.contentEl.empty(); }
}
/**= Local-first setup never requires a connected account. */
class TodoTxtSetupModal extends Modal {
  constructor(plugin){super(plugin.app);this.plugin=plugin;}
  onClose(){this.contentEl.empty();}
  onOpen(){const el=this.contentEl;el.createEl('h2',{text:'Start with todo.txt'});el.createEl('p',{text:'Choose an existing vault-relative .txt file or create a new one. Task2Do adds stable uid: tokens to task rows while retaining their text and custom fields. No account is required.'});let path=this.plugin.settings.todoTxtPath||'Task2Do/todo.txt',pathControl;new Setting(el).setName('Task file').addText(t=>{pathControl=t;t.setValue(path).setPlaceholder('Task2Do/todo.txt').onChange(v=>path=v);});const files=(this.plugin.app.vault.getFiles?.()||[]).filter(f=>{try{vaultPath(f.path,'.txt');return true;}catch{return false;}});if(files.length)new Setting(el).setName('Existing task file').addDropdown(d=>{d.addOption('','Choose a file…');for(const f of files)d.addOption(f.path,f.path);d.onChange(v=>{if(v){path=v;pathControl.setValue(v);}});});const status=el.createEl('p');new Setting(el).addButton(b=>b.setButtonText('Use or create task file').setCta().onClick(async()=>{b.setDisabled(true);try{vaultPath(path,'.txt');const vault=this.plugin.app.vault;if(!await vault.adapter.exists(path))await vaultStorage(vault,path).write('','');this.plugin.settings.todoTxtPath=path;this.plugin.installTodoTxt();await this.plugin.registry.get('todotxt').ensureIdentities();this.plugin.settings.localSetupComplete=true;await this.plugin.persist();this.close();await this.plugin.openTodoTxtView();}catch(e){status.setText(e.message);b.setDisabled(false);}}));}
}
class TodoTxtTaskModal extends Modal {
  constructor(plugin, view = null, item = null) { super(plugin.app); this.plugin = plugin; this.view = view; this.item = item; this.provider = plugin.registry.get('todotxt'); }
  onClose() { this.contentEl.empty(); }
  onOpen() {
    const values=todoFields(this.item),el=this.contentEl;let rawMode=false,raw=this.item?.rawLine||'';
    el.createEl('h2', { text: this.item ? 'Edit todo.txt task' : 'Create todo.txt task' });
    new Setting(el).setName('Title').addText(t=>t.setValue(values.title).onChange(v=>values.title=v));
    new Setting(el).setName('Description').addTextArea(t=>t.setValue(values.description).onChange(v=>values.description=v));
    new Setting(el).setName('Priority').addDropdown(d=>{d.addOption('','None');for(const rank of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')d.addOption(rank,rank);d.setValue(values.priority).onChange(v=>values.priority=v);});
    for(const [key,label]of [['createdDate','Created date'],['startDate','Start date'],['dueDate','Due date']])new Setting(el).setName(label).addText(t=>{t.inputEl.type='date';t.setValue(values[key]).onChange(v=>values[key]=v);});
    for(const [key,label]of [['projects','Projects'],['contexts','Contexts']])new Setting(el).setName(label).setDesc('Separate names with spaces or commas.').addText(t=>t.setValue(values[key]).onChange(v=>values[key]=v));
    const advanced=el.createEl('details');advanced.createEl('summary',{text:'Advanced raw line'});new Setting(advanced).setName('Save raw line instead').setDesc('Use either structured controls or this raw line. Keep the existing uid: token.').addToggle(t=>t.setValue(false).onChange(v=>rawMode=v));new Setting(advanced).setName('Task line').addTextArea(t=>t.setValue(raw).onChange(v=>raw=v));
    const status = el.createEl('p');
    new Setting(el).addButton(b=>b.setButtonText('Cancel').onClick(()=>this.close())).addButton(b => b.setButtonText('Save task').setCta().onClick(async () => {
      b.setDisabled(true); try { if (this.provider !== this.plugin.registry.get('todotxt')) throw new Error('todo.txt path changed. Close and refresh.');const changes=rawMode?{line:raw}:values;if(this.item)await this.provider.update(this.item,changes);else await this.provider.create(changes);this.close();if(this.view)await this.view.refresh();else await this.plugin.openTodoTxtView(); } catch (e) { status.setText(e.message); } finally { b.setDisabled(false); }
    }));
  }
}
class TodoTxtView extends ToDoView {
  getViewType() { return TXT_VIEW; }
  getDisplayText() { return 'Task2Do: todo.txt Tasks'; }
  currentProvider() { return this.plugin.registry.get('todotxt'); }
  async loadItems(provider) { if(this.plugin.app?.vault?.adapter&&!await this.plugin.app.vault.adapter.exists(provider.path))throw new Error('Task file missing or renamed. Use Task file to select or create it.');return provider.list(); }
  toolbar(el) { this.panelToolbar(el).addButton(b => b.setButtonText('New task').onClick(() => new TodoTxtTaskModal(this.plugin, this).open())).addButton(b => b.setButtonText('Refresh').onClick(() => this.refresh())).addButton(b=>b.setButtonText('Task file').onClick(()=>new TodoTxtSetupModal(this.plugin).open())).addButton(b=>b.setButtonText('Providers').onClick(()=>new Task2DoLauncherModal(this.plugin).open())); }
  taskActions(card, item, provider) {
    new Setting(card).addButton(b => b.setButtonText('Edit').onClick(() => new TodoTxtTaskModal(this.plugin, this, item).open())).addButton(b => b.setButtonText(item.completed ? 'Reopen' : 'Complete').onClick(async () => {
      b.setDisabled(true); try { if (provider !== this.currentProvider()) throw new Error('Path changed. Refresh first.'); await provider[item.completed ? 'reopen' : 'complete'](item); await this.refresh(); } catch (e) { new Notice(e.message); b.setDisabled(false); }
    })).addButton(b=>b.setButtonText('Publish…').onClick(()=>new LocalPublishModal(this.plugin,item,()=>this.refresh()).open()));
  }
}
class ProviderConnectModal extends Modal {
  constructor(plugin, id) { super(plugin.app); this.plugin=plugin; this.id=id; this.closed=false; }
  onClose() { this.closed=true; this.contentEl.empty(); }
  onOpen() {
    const op=this.id==='openproject', name=op?'OpenProject':'Moovila', config={...this.plugin.settings[this.id]}, el=this.contentEl;
    let token=this.plugin.registry.get(this.id)?.config.token || config.token || '';
    el.createEl('h2',{text:`Connect ${name}`});
    new Setting(el).setName(op?'Instance URL':'API URL').setDesc(op?'HTTPS URL, including any installation subpath. Cloud and self-hosted instances supported.':'Published Moovila PublicAPI host.').addText(t=>t.setValue(config.baseUrl).onChange(v=>config.baseUrl=v));
    new Setting(el).setName(op?'API key':'Bearer access token').setDesc(op?'Create an API token in OpenProject account settings.':'Obtain a bearer token through your vendor-approved API/OAuth integration. Token refresh is not automated.').addText(t=>{t.inputEl.type='password';t.setValue(token).onChange(v=>token=v);});
    if(op){
      new Setting(el).setName('Project ID (optional)').setDesc('Leave blank for all accessible work packages.').addText(t=>t.setValue(config.projectId||'').onChange(v=>config.projectId=v));
      new Setting(el).setName('Trusted CA / self-signed certificate (PEM)').setDesc('Paste the public CA chain or self-signed server certificate obtained from your administrator. Trust applies only to this instance. Hostname and validity checks stay enabled. Leave blank for normal public certificate trust.').addTextArea(t=>t.setValue(config.caPem||'').onChange(v=>config.caPem=v));
      new Setting(el).setName('Enable OpenProject writes').addToggle(t=>t.setValue(config.enableWrites).onChange(v=>config.enableWrites=v));
    }
    new Setting(el).setName('Remember connection credentials').setDesc('Remember credentials; enable the encrypted credential vault in settings to protect saved secrets.').addToggle(t=>t.setValue(config.remember).onChange(v=>config.remember=v));
    const status=el.createEl('p');
    new Setting(el).addButton(b=>b.setButtonText('Connect').setCta().onClick(async()=>{
      b.setDisabled(true);let provider;
      try {
        provider=this.plugin.makeExternalProvider(this.id,{...config,token});
        if(op)await provider.destinations();else await provider.report('Project');
        if(this.closed||this.plugin.unloaded){provider.dispose();return;}
        const settings={...this.plugin.settings,[this.id]:{...config,...(config.remember?{token}:{})}};if(!config.remember)delete settings[this.id].token;
        await this.plugin.persist(settings);if(this.closed||this.plugin.unloaded){provider.dispose();return;}
        this.plugin.settings=settings;this.plugin.registry.register(provider);provider=null;this.close();new Notice(`${name} connected.`);await this.plugin.openExternalView(this.id);
      }catch(e){provider?.dispose();if(!this.closed)status.setText(e.message);}finally{b.setDisabled(false);}
    }));
  }
}
class OpenProjectTaskModal extends Modal {
  constructor(plugin,view=null,item=null,action='edit'){super(plugin.app);this.plugin=plugin;this.view=view;this.item=item;this.action=action;this.provider=plugin.registry.get('openproject');this.closed=false;this.busy=false;this.generation=0;}
  onClose(){this.closed=true;this.generation++;this.contentEl.empty();}
  async onOpen(){
    const el=this.contentEl, creating=!this.item, provider=this.provider;
    el.createEl('h2',{text:creating?'Create OpenProject task':this.action==='edit'?'Edit OpenProject task':this.action==='complete'?'Complete OpenProject task':'Reopen OpenProject task'});const status=el.createEl('p');
    if(!provider?.capabilities.update){status.setText('Connect and enable OpenProject writes first.');return;}
    let projectId=provider.config.projectId, values={}, fields=el.createDiv(), submitted=false;
    const buildFields=async()=>{
      const generation=++this.generation;fields.empty();status.setText('Loading allowed fields…');
      try{
        let form=await provider.form(this.item,projectId,provider.payload(values));
        if(this.closed||generation!==this.generation)return;
        if(creating&&!values.type){const types=await provider.choices(form,'type');if(this.closed||generation!==this.generation)return;values.type=form._embedded?.payload?._links?.type?.href||types[0]?.href;if(values.type)form=await provider.form(null,projectId,provider.payload(values));}
        if(this.closed||generation!==this.generation)return;
        if(this.action==='edit'||creating){
          const title=values.title??this.item?.title??'';new Setting(fields).setName('Title').addText(t=>t.setValue(title).onChange(v=>values.title=v));
          const desc=values.description??this.item?.description??'';new Setting(fields).setName('Description (Markdown)').addTextArea(t=>t.setValue(desc).onChange(v=>values.description=v));
          if(creating){values.title=title;values.description=desc;}
          for(const [key,label]of [['startDate','Start date'],['dueDate','Due date']]){const original=this.item?.raw?.[key]||'';new Setting(fields).setName(label).addText(t=>{t.inputEl.type='date';t.setValue(values[key]??original).onChange(v=>values[key]=v);});}
          for(const field of creating?['type','assignee']:['assignee']){
            const choices=await provider.choices(form,field);if(this.closed||generation!==this.generation)return;
            if(!choices.length)continue;
            new Setting(fields).setName(field==='type'?'Type':'Assignee').addDropdown(d=>{
              const initial=values[field]??this.item?.raw?._links?.[field]?.href??'';if(field==='assignee')d.addOption('','Unassigned');
              for(const c of choices)d.addOption(c.href,c.name);
              if(initial&&!choices.some(c=>c.href===initial))d.addOption(initial,this.item?.raw?._links?.[field]?.title||'Current selection');
              d.setValue(initial).onChange(v=>{values[field]=v;if(field==='type')buildFields();});
            });
          }
        }
        if(!creating){
          let choices=await provider.choices(form,'status');if(this.closed||generation!==this.generation)return;
          if(this.action!=='edit')choices=choices.filter(c=>c.isClosed===(this.action==='complete'));
          if(!choices.length&&this.action!=='edit')throw new Error('No allowed '+(this.action==='complete'?'closed':'open')+' workflow status.');
          if(choices.length)new Setting(fields).setName('Status').addDropdown(d=>{d.addOption('',this.action==='edit'?'Keep current status':'Choose destination status');for(const c of choices)d.addOption(c.href,c.name);d.setValue(values.status||'').onChange(v=>{if(v)values.status=v;else delete values.status;});});
        }
        status.setText('');
      }catch(e){if(!this.closed&&generation===this.generation)status.setText(e.message);}
    };
    try{
      if(creating){const projects=await provider.destinations();if(this.closed)return;if(!projects.length)throw new Error('No accessible projects.');projectId=projectId||String(projects[0].id);new Setting(el).setName('Project').addDropdown(d=>{for(const p of projects)d.addOption(String(p.id),p.name);d.setValue(projectId).onChange(v=>{projectId=v;values={};buildFields();});});}
      await buildFields();if(this.closed)return;
      new Setting(el).addButton(b=>b.setButtonText(creating?'Create task':'Save changes').setCta().onClick(async()=>{
        if(this.busy)return;this.busy=true;b.setDisabled(true);
        try{
          if(provider!==this.plugin.registry.get('openproject'))throw new Error('Connection changed. Close and refresh.');
          if(!creating&&this.action!=='edit'&&!values.status)throw new Error('Choose a destination status.');
          submitted=true;
          if(creating)await provider.create(projectId,values);else if(this.action==='complete')await provider.complete(this.item,values.status);else if(this.action==='reopen')await provider.reopen(this.item,values.status);else await provider.update(this.item,values);
          this.close();new Notice('OpenProject confirmed the change.');if(this.view)await this.view.refresh();else await this.plugin.openExternalView('openproject');
        }catch(e){if(!this.closed)status.setText(e.message+(creating&&submitted?' Close and check the source before creating again.':''));}finally{this.busy=false;b.setDisabled(creating&&submitted);}
      }));
    }catch(e){if(!this.closed)status.setText(e.message);}
  }
}
class ExternalProviderView extends ToDoView {
  constructor(leaf,plugin,id){super(leaf,plugin);this.id=id;}
  getViewType(){return this.id==='moovila'?MOOVILA_VIEW:OP_VIEW;}
  getDisplayText(){return `Task2Do: ${this.id==='moovila'?'Moovila':'OpenProject'} Tasks`;}
  currentProvider(){return this.plugin.registry.get(this.id);}
  async loadItems(provider){return provider.list();}
  toolbar(el){
    const controls=this.panelToolbar(el);
    controls.addButton(b=>{b.setButtonText('New task');if(this.id==='openproject')b.onClick(()=>new OpenProjectTaskModal(this.plugin,this,null).open());else {b.setDisabled(true);b.buttonEl?.setAttribute('title','Moovila published API is read-only.');}});
    controls.addButton(b=>b.setButtonText('Refresh').onClick(()=>this.refresh())).addButton(b=>b.setButtonText('Connect').onClick(()=>new ProviderConnectModal(this.plugin,this.id).open()));
  }
  taskActions(card,item,provider){
    card.createEl('small',{text:[item.assigneeName,item.statusName].filter(Boolean).join(' · ')});
    if(this.id!=='openproject'||!provider.capabilities.update)return;
    new Setting(card).addButton(b=>b.setButtonText('Edit').onClick(()=>new OpenProjectTaskModal(this.plugin,this,item,'edit').open())).addButton(b=>b.setButtonText(item.completed?'Reopen':'Complete').onClick(()=>new OpenProjectTaskModal(this.plugin,this,item,item.completed?'reopen':'complete').open()));
  }
}

class Task2DoLauncherModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }
  onClose() { this.contentEl.empty(); }
  onOpen() {
    this.contentEl.createEl('h2', { text: 'Task2Do' });
    for (const [label, open] of [
      ['Autotask Tasks', () => this.plugin.openView()],
      ['Autotask Tickets', () => this.plugin.openTicketsView()],
      ['Microsoft To Do Tasks', () => this.plugin.openMicrosoftView()],
      ['Microsoft Planner Tasks', () => this.plugin.openPlannerView()],
      ['todo.txt Tasks', () => this.plugin.openTodoTxtView()],
      ['Task Sync', () => this.plugin.openSyncView()],
      ['OpenProject Tasks', () => this.plugin.openExternalView('openproject')],
      ['Moovila Tasks', () => this.plugin.openExternalView('moovila')]
    ]) new Setting(this.contentEl).setName(label).addButton(b => b.setButtonText('Open').onClick(async () => {
      try { await open(); this.close(); } catch (e) { new Notice(e.message); }
    }));
  }
}
class PlannerTaskModal extends Modal {
  constructor(plugin,view=null,item=null,action='edit'){super(plugin.app);this.plugin=plugin;this.view=view;this.item=item;this.action=action;this.provider=plugin.registry.get('microsoft-planner');this.closed=false;this.busy=false;this.generation=0;}
  onClose(){this.closed=true;this.generation++;this.contentEl.empty();}
  async onOpen(){
    const el=this.contentEl,creating=!this.item;el.createEl('h2',{text:creating?'Create Planner task':`${this.action} Planner task`});const status=el.createEl('p');if(!this.provider){status.setText('Configure Planner plan IDs, then sign in to Microsoft.');return;}
    let planId=this.item?.listId,values={},submitted=false;const fields=el.createDiv();
    const load=async()=>{const generation=++this.generation;fields.empty();status.setText('Loading plan buckets and members…');try{
      const [buckets,members]=await Promise.all([this.provider.buckets(planId),this.provider.members(planId)]);if(this.closed||generation!==this.generation)return;
      new Setting(fields).setName('Title').addText(t=>t.setValue(this.item?.title||'').onChange(v=>values.title=v));
      new Setting(fields).setName('Description').addTextArea(t=>t.setValue(this.item?.description||'').onChange(v=>values.description=v));
      if(creating){values.title='';values.description='';}
      for(const [key,label]of [['start','Start'],['due','Due']])new Setting(fields).setName(`${label} (local time)`).addText(t=>{t.inputEl.type='datetime-local';t.inputEl.step='60';t.setValue(this.item?.[key]?toCalendarValue(this.item[key]).slice(0,16):'').onChange(v=>values[key]=v?fromCalendarValue(v):null);});
      if(!buckets.length)throw new Error('This plan has no buckets. Add one in Planner first.');
      new Setting(fields).setName('Bucket').addDropdown(d=>{for(const b of buckets)d.addOption(b.id,b.name);const current=this.item?.bucketId||buckets[0].id;if(creating)values.bucketId=current;d.setValue(current).onChange(v=>values.bucketId=v);});
      new Setting(fields).setName('Assignee').setDesc('Keep preserves existing assignments. Selecting a user replaces the assignment set with that user.').addDropdown(d=>{if(!creating)d.addOption('keep','Keep assignments');d.addOption('none','Unassigned');for(const m of members)d.addOption(m.id,m.name);d.setValue(creating?'none':'keep').onChange(v=>{if(v==='keep')delete values.assigneeIds;else values.assigneeIds=v==='none'?[]:[v];});});
      status.setText('');
    }catch(e){if(!this.closed&&generation===this.generation)status.setText(e.message);}};
    try{
      if(creating){const plans=await this.provider.destinations();if(this.closed)return;planId=plans[0].id;new Setting(el).setName('Plan').addDropdown(d=>{for(const p of plans)d.addOption(p.id,p.title);d.setValue(planId).onChange(v=>{planId=v;values={};load();});});}
      if(creating||this.action==='edit')await load();else el.createEl('p',{text:this.item.title});if(this.closed)return;
      new Setting(el).addButton(b=>b.setButtonText(creating?'Create task':'Save changes').setCta().onClick(async()=>{
        if(this.busy)return;this.busy=true;b.setDisabled(true);try{if(this.provider!==this.plugin.registry.get('microsoft-planner'))throw new Error('Planner connection changed. Close and refresh.');submitted=true;if(creating)await this.provider.create(planId,values);else if(this.action==='edit')await this.provider.update(this.item,values);else await this.provider[this.action](this.item);this.close();if(this.view)await this.view.refresh();else await this.plugin.openPlannerView();}catch(e){if(!this.closed)status.setText(e.message);}finally{this.busy=false;b.setDisabled(creating&&submitted);}
      }));
    }catch(e){if(!this.closed)status.setText(e.message);}
  }
}
class PlannerView extends ToDoView {
  getViewType(){return PLANNER_VIEW;}getDisplayText(){return 'Task2Do: Microsoft Planner Tasks';}currentProvider(){return this.plugin.registry.get('microsoft-planner');}async loadItems(provider){return provider.list();}
  toolbar(el){this.panelToolbar(el).addButton(b=>b.setButtonText('New task').onClick(()=>new PlannerTaskModal(this.plugin,this,null).open())).addButton(b=>b.setButtonText('Refresh').onClick(()=>this.refresh())).addButton(b=>b.setButtonText('Sign in').onClick(()=>new MicrosoftSignInModal(this.plugin).open()));}
  taskActions(card,item){card.createEl('small',{text:[item.statusName,item.assigneeName].filter(Boolean).join(' · ')});new Setting(card).addButton(b=>b.setButtonText('Edit').onClick(()=>new PlannerTaskModal(this.plugin,this,item).open())).addButton(b=>b.setButtonText(item.completed?'Reopen':'Complete').onClick(()=>new PlannerTaskModal(this.plugin,this,item,item.completed?'reopen':'complete').open()));}
}

class SyncMappingsModal extends Modal {
  constructor(plugin){super(plugin.app);this.plugin=plugin;this.closed=false;this.generation=0;}
  onClose(){this.closed=true;this.generation++;this.contentEl.empty();}
  async onOpen(){
    const engine=this.plugin.syncEngine(),el=this.contentEl;el.createEl('h2',{text:'Review task mappings'});const status=el.createEl('p');
    try{
      const catalog=(await engine.json('catalogs.json',{schemaVersion:1,companies:[],users:[]})).value;if(!catalog.companies?.length)throw new Error('Pull Autotask catalogs first.');let companyId=String(catalog.companies[0].id),resourceId='',target='microsoft-planner',destination='',bucket='',member='';const fields=el.createDiv();
      const reload=async()=>{const generation=++this.generation;fields.empty();destination='';bucket='';member='';status.setText('Loading destination choices…');try{const provider=this.plugin.registry.get(target);if(!provider)throw new Error('Connect this destination provider first.');const lists=await provider.destinations();if(this.closed||generation!==this.generation)return;if(!lists.length)throw new Error('No destinations available.');destination=lists[0].id;
        const more=fields.createDiv();const details=async()=>{more.empty();if(target!=='microsoft-planner'){status.setText('To Do destinations belong to the signed-in account; user assignments cannot be transferred.');return;}const [buckets,members]=await Promise.all([provider.buckets(destination),provider.members(destination)]);if(this.closed||generation!==this.generation)return;if(!buckets.length)throw new Error('Add a bucket in Planner.');bucket=buckets[0].id;new Setting(more).setName('Planner bucket').addDropdown(d=>{for(const b of buckets)d.addOption(b.id,b.name);d.setValue(bucket).onChange(v=>bucket=v);});new Setting(more).setName('Source Autotask resource').addDropdown(d=>{d.addOption('','No user mapping');for(const u of catalog.users)d.addOption(String(u.id),`${u.name} (#${u.id})`);d.setValue(resourceId).onChange(v=>resourceId=v);});new Setting(more).setName('Entra group member').addDropdown(d=>{d.addOption('','Choose member');for(const m of members)d.addOption(m.id,`${m.name}${m.email?' — '+m.email:''}`);d.onChange(v=>member=v);});status.setText('Review the company destination and any selected user mapping before saving.');};
        new Setting(fields).setName('Destination').addDropdown(d=>{for(const l of lists)d.addOption(l.id,l.displayName||l.title||l.id);d.setValue(destination).onChange(async v=>{destination=v;bucket='';member='';try{await details();}catch(e){status.setText(e.message);}});});await details();
      }catch(e){if(!this.closed&&generation===this.generation)status.setText(e.message);}};
      new Setting(el).setName('Autotask company').addDropdown(d=>{for(const c of catalog.companies)d.addOption(String(c.id),`${c.name} (#${c.id})`);d.setValue(companyId).onChange(v=>companyId=v);});new Setting(el).setName('Destination provider').addDropdown(d=>d.addOptions({'microsoft-planner':'Microsoft Planner','microsoft-todo':'Microsoft To Do'}).setValue(target).onChange(v=>{target=v;reload();}));await reload();
      new Setting(el).addButton(b=>b.setButtonText('Save reviewed mappings').setCta().onClick(async()=>{b.setDisabled(true);try{if(!destination||target==='microsoft-planner'&&!bucket)throw new Error('Choose a valid destination.');if(resourceId&&!member&&target==='microsoft-planner')throw new Error('Choose the matching Entra member.');const maps=await engine.mappings();maps.value.companies[companyId]=maps.value.companies[companyId]||{};maps.value.companies[companyId][target]={reviewed:true,reviewedAt:new Date().toISOString(),...(target==='microsoft-planner'?{planId:destination,bucketId:bucket}:{listId:destination})};if(target==='microsoft-planner'&&resourceId)maps.value.users[resourceId]={entraId:member,reviewed:true,reviewedAt:new Date().toISOString()};await engine.save('mappings.json',maps);new Notice('Reviewed mappings saved.');this.close();}catch(e){status.setText(e.message);}finally{b.setDisabled(false);}}));
    }catch(e){status.setText(e.message);}
  }
}
/**= Review local task ownership/destination without requiring Autotask catalogs. */
class LocalPublishModal extends Modal {
  constructor(plugin,item,onDone){super(plugin.app);this.plugin=plugin;this.item=item;this.onDone=onDone;this.generation=0;this.closed=false;}
  onClose(){this.closed=true;this.generation++;this.contentEl.empty();}
  async onOpen(){const el=this.contentEl;el.createEl('h2',{text:'Map local task for publishing'});const uid=this.item.remoteId;
    if(todoPresentation(this.item).fields.some(f=>f.key==='source'&&f.value==='autotask-todo')){this.close();new SyncPushModal(this.plugin,uid,this.onDone).open();return;}
    let target='microsoft-todo',destination='',bucket='',assignee='',ready=false;const fields=el.createDiv(),status=el.createEl('p');
    const reload=async()=>{const generation=++this.generation;ready=false;destination='';bucket='';assignee='';fields.empty();status.setText('Loading destinations…');try{const provider=this.plugin.registry.get(target);if(!provider)throw new Error('Connect Microsoft To Do or Planner in settings first. Local tasks remain available without a connection.');const lists=await provider.destinations();if(this.closed||generation!==this.generation)return;if(!lists.length)throw new Error('No destinations available.');destination=lists[0].id;const more=fields.createDiv();let detailGeneration=0;
      const details=async()=>{const detail=++detailGeneration,selected=destination;ready=false;bucket='';assignee='';more.empty();if(target==='microsoft-todo'){ready=true;status.setText('This task will belong to your signed-in Microsoft To Do account.');return;}const [buckets,members]=await Promise.all([provider.buckets(selected),provider.members(selected)]);if(this.closed||generation!==this.generation||detail!==detailGeneration)return;if(!buckets.length)throw new Error('Create a bucket in this Planner plan first.');bucket=buckets[0].id;new Setting(more).setName('Bucket').addDropdown(d=>{for(const b of buckets)d.addOption(b.id,b.name);d.setValue(bucket).onChange(v=>bucket=v);});new Setting(more).setName('Assign to').addDropdown(d=>{d.addOption('','Unassigned');for(const m of members)d.addOption(m.id,m.name);d.onChange(v=>assignee=v);});ready=true;status.setText('Review the plan, bucket and assignee before building a preview.');};
      new Setting(fields).setName('Destination').addDropdown(d=>{for(const list of lists)d.addOption(list.id,list.displayName||list.title||list.id);d.setValue(destination).onChange(async v=>{destination=v;try{await details();}catch(e){status.setText(e.message);}});});await details();
    }catch(e){if(!this.closed&&generation===this.generation)status.setText(e.message);}};
    new Setting(el).setName('Provider').addDropdown(d=>d.addOptions({'microsoft-todo':'Microsoft To Do','microsoft-planner':'Microsoft Planner'}).setValue(target).onChange(v=>{target=v;reload();}));await reload();
    new Setting(el).addButton(b=>b.setButtonText('Save mapping and preview').setCta().onClick(async()=>{b.setDisabled(true);try{if(!ready)throw new Error('Choose an available destination first.');await this.plugin.syncEngine().mapLocal(uid,target,target==='microsoft-planner'?{planId:destination,bucketId:bucket,assigneeIds:assignee?[assignee]:[]}:{listId:destination});const selected=target;this.close();new SyncPushModal(this.plugin,uid,this.onDone,selected).open();}catch(e){status.setText(e.message);b.setDisabled(false);}}));
  }
}
class SyncPushModal extends Modal {
  constructor(plugin,uid,onDone,target='microsoft-planner'){super(plugin.app);this.plugin=plugin;this.uid=uid;this.onDone=onDone;this.initialTarget=target;this.closed=false;}
  onClose(){this.closed=true;this.contentEl.empty();}
  onOpen(){
    const el=this.contentEl;el.createEl('h2',{text:'Preview selected task push'});let target=this.initialTarget||'microsoft-planner',allowPersonal=false,preview=null;const status=el.createEl('p');const fields=el.createDiv();
    new Setting(el).setName('Destination').addDropdown(d=>d.addOptions({'microsoft-planner':'Microsoft Planner','microsoft-todo':'Microsoft To Do'}).setValue(target).onChange(v=>{target=v;preview=null;fields.empty();}));new Setting(el).setName('Use my personal To Do list').setDesc('Explicitly allow dropping another user assignment when the destination is Microsoft To Do. Planner retains mapped assignments.').addToggle(t=>t.setValue(false).onChange(v=>{allowPersonal=v;preview=null;fields.empty();}));
    new Setting(el).addButton(b=>b.setButtonText('Build preview').onClick(async()=>{b.setDisabled(true);preview=null;fields.empty();try{const result=await this.plugin.syncEngine().preview(this.uid,target,allowPersonal);if(this.closed)return;preview=result;fields.createEl('p',{text:`${result.operation.toUpperCase()} → ${target} · destination ${result.destination}`});fields.createEl('pre',{text:JSON.stringify(result.values,null,2)});status.setText(result.operation==='noop'?'Already synchronized.':'Review these exact values before pushing.');}catch(e){status.setText(e.message);}finally{b.setDisabled(false);}})).addButton(b=>b.setButtonText('Push reviewed task').setCta().onClick(async()=>{if(!preview){status.setText('Build and review a preview first.');return;}b.setDisabled(true);try{await this.plugin.syncEngine().push(preview);new Notice('Task push verified.');this.close();await this.onDone();}catch(e){status.setText(e.message);preview=null;}finally{b.setDisabled(false);}}));
  }
}
class SyncReconcileModal extends Modal {
  constructor(plugin,uid,target,onDone){super(plugin.app);this.plugin=plugin;this.uid=uid;this.target=target;this.onDone=onDone;}
  onClose(){this.contentEl.empty();}
  onOpen(){let id='',listId='';const el=this.contentEl;el.createEl('h2',{text:'Reconcile an existing destination task'});el.createEl('p',{text:'Inspect the destination first. Binding acknowledges this existing task as the counterpart and prevents another creation.'});for(const [label,key]of [['Existing task ID','id'],['Destination list/plan ID','list']])new Setting(el).setName(label).addText(t=>t.onChange(v=>{if(key==='id')id=v;else listId=v;}));const status=el.createEl('p');new Setting(el).addButton(b=>b.setButtonText('Verify and bind existing task').onClick(async()=>{b.setDisabled(true);try{await this.plugin.syncEngine().bindExisting(this.uid,this.target,{remoteId:id,listId});this.close();await this.onDone();}catch(e){status.setText(e.message);b.setDisabled(false);}}));}
}
class TaskSyncView extends ItemView {
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.generation=0;}
  getViewType(){return SYNC_VIEW;}getDisplayText(){return 'Task2Do: Task Sync';}getIcon(){return 'refresh-cw';}async onOpen(){await this.refresh();}async onClose(){this.generation++;}
  async refresh(){const generation=++this.generation,el=this.contentEl;el.empty();el.createEl('h2',{text:this.getDisplayText()});const status=el.createEl('p');
    new Setting(el).addButton(b=>b.setButtonText('Pull Autotask').onClick(async()=>{b.setDisabled(true);try{const report=await this.plugin.syncEngine().pull();new Notice(`Imported ${report.imported}; refreshed ${report.updated}; conflicts ${report.conflicts}.`);await this.refresh();}catch(e){status.setText(e.message);b.setDisabled(false);}})).addButton(b=>b.setButtonText('Mappings').onClick(()=>new SyncMappingsModal(this.plugin).open())).addButton(b=>b.setButtonText('Refresh destinations').onClick(async()=>{b.setDisabled(true);try{await this.plugin.syncEngine().refreshDestinations();await this.refresh();}catch(e){status.setText(e.message);b.setDisabled(false);}}));
    try{const engine=this.plugin.syncEngine(),rows=await engine.rows(),state=await engine.state();if(generation!==this.generation)return;status.setText('Pull → review mappings → preview selected pushes. Automatic sync updates only already-bound tasks; it never creates destinations automatically.');
      for(const row of rows.items.filter(r=>r.uid&&!state.value.records[r.uid]&&!/(?:^|\s)source:autotask-todo(?:\s|$)/.test(r.rawLine))){const card=el.createDiv({cls:'autotask-todo-card'});card.createEl('strong',{text:localCanonical(row).title});card.createEl('small',{text:'Local task · no destination binding'});new Setting(card).addButton(b=>b.setButtonText('Map and preview').onClick(()=>new LocalPublishModal(this.plugin,row,()=>this.refresh()).open()));}
      for(const [uid,record]of Object.entries(state.value.records)){const row=rows.items.find(t=>t.uid===uid);const card=el.createDiv({cls:'autotask-todo-card'});card.createEl('strong',{text:row?localCanonical(row).title:`Missing local row for ${record.source.id}`});card.createEl('small',{text:`${record.source.provider==='todotxt'?'Local todo.txt task':'Autotask #'+record.source.id} · ${Object.keys(record.remotes).join(', ')||'No destination binding'}`});if(record.conflict){card.createEl('p',{text:`Conflict: ${record.conflict.kind}${record.conflict.fields?' · '+record.conflict.fields.join(', '):''}`});card.createEl('pre',{text:JSON.stringify({local:record.conflict.local,remote:record.conflict.remote},null,2)});for(const [choice,label]of [['local','Keep local values'],...(record.source.provider==='todotxt'?[]:[['remote','Use Autotask values']]),...(record.conflict.kind==='destination'?[['destination','Use destination values']]:[])])new Setting(card).addButton(b=>b.setButtonText(label).onClick(async()=>{try{await engine.resolveConflict(uid,choice);await this.refresh();}catch(e){new Notice(e.message);}}));}
        else {new Setting(card).addButton(b=>b.setButtonText('Preview push').onClick(()=>new SyncPushModal(this.plugin,uid,()=>this.refresh(),Object.keys(record.remotes)[0]||'microsoft-todo').open()));if(record.source.provider!=='todotxt')new Setting(card).addButton(b=>b.setButtonText('Push local to Autotask').onClick(async()=>{b.setDisabled(true);try{await engine.pushSource(uid);await this.refresh();}catch(e){new Notice(e.message);b.setDisabled(false);}}));else if(row)new Setting(card).addButton(b=>b.setButtonText('Review mapping').onClick(()=>new LocalPublishModal(this.plugin,row,()=>this.refresh()).open()));}
        if(record.intents?.source&&record.intents.source.status!=='verified')new Setting(card).setName('Autotask write needs review').setDesc('Inspect the source task first. Reconciliation refreshes the source baseline and keeps local edits for a later explicit retry.').addButton(b=>b.setButtonText('Reconcile Autotask').onClick(async()=>{try{await engine.resolveConflict(uid,'local');await this.refresh();}catch(e){new Notice(e.message);}}));
        for(const target of new Set([...Object.keys(record.remotes),...Object.keys(record.intents||{}).filter(t=>t!=='source')])){const unresolved=record.intents?.[target]?.status!=='verified';if(record.intents?.[target]&&unresolved)card.createEl('p',{text:`${target}: write needs review. No creation retry is allowed.`});new Setting(card).addButton(b=>b.setButtonText(`Reconcile ${target}`).onClick(()=>new SyncReconcileModal(this.plugin,uid,target,()=>this.refresh()).open()));}
      }
    }catch(e){if(generation===this.generation)status.setText(e.message);}
  }
}

class CredentialVaultModal extends Modal {
  constructor(plugin,enable=false){super(plugin.app);this.plugin=plugin;this.enable=enable;}
  onClose(){this.contentEl.empty();}
  onOpen(){const el=this.contentEl;el.createEl('h2',{text:this.enable?'Encrypt Task2Do credentials':'Unlock Task2Do credentials'});el.createEl('p',{text:'The master passphrase is not saved. Unlock once after startup or a plugin reload. Keep the encrypted vault and passphrase when moving machines.'});let password='',confirmation='';new Setting(el).setName('Master passphrase').addText(t=>{t.inputEl.type='password';t.onChange(v=>password=v);});if(this.enable)new Setting(el).setName('Confirm passphrase').addText(t=>{t.inputEl.type='password';t.onChange(v=>confirmation=v);});const status=el.createEl('p');new Setting(el).addButton(b=>b.setButtonText(this.enable?'Encrypt and migrate':'Unlock').setCta().onClick(async()=>{b.setDisabled(true);try{if(this.enable&&password!==confirmation)throw new Error('Passphrases do not match.');const adapter=this.plugin.app.vault.adapter,path=this.plugin.credentialVaultPath();let envelope=null;if(!this.enable){if(!await adapter.exists(path))throw new Error('Encrypted credential file is missing. Restore credentials.enc from this vault backup.');envelope=JSON.parse(await adapter.read(path));}const opened=await PasswordCredentialVault.open(password,envelope);password='';confirmation='';this.plugin._credentialVault?.dispose();this.plugin._credentialVault=opened.vault;
      if(this.enable){this.plugin.settings.encryptCredentials=true;try{await this.plugin.persist();}catch(e){this.plugin.settings.encryptCredentials=false;throw e;}}else{const secrets=opened.secrets;if(secrets.savedCredentials)this.plugin.settings.savedCredentials=secrets.savedCredentials;if(secrets.microsoftTokens)this.plugin.settings.microsoft.tokens=secrets.microsoftTokens;for(const id of ['openproject','moovila'])if(secrets[id])this.plugin.settings[id].token=secrets[id];this.plugin.restoreCredentialSessions();for(const type of [VIEW,GRAPH_VIEW,PLANNER_VIEW,OP_VIEW,MOOVILA_VIEW,TICKET_VIEW])for(const leaf of this.plugin.app.workspace.getLeavesOfType(type))leaf.view.refresh();}new Notice('Credential vault unlocked.');this.close();}catch(e){status.setText(e.message);}finally{b.setDisabled(false);}}));}
}

class AutotaskTextNoteModal extends Modal {
  constructor(view,item){super(view.app);this.view=view;this.item=item;this.provider=view.plugin.provider;}
  onClose(){this.contentEl.empty();}
  onOpen(){const el=this.contentEl;el.createEl('h2',{text:'Add note to Autotask task text'});el.createEl('p',{text:'Appends a timestamped note to the task description. This is not a separate threaded comment.'});let note='';new Setting(el).setName('Note').addTextArea(t=>t.onChange(v=>note=v));const status=el.createEl('p');new Setting(el).addButton(b=>b.setButtonText('Append note').onClick(async()=>{b.setDisabled(true);try{if(this.provider!==this.view.plugin.provider)throw new Error('Connection changed. Refresh first.');await this.provider.addTextNote(this.item,note);this.close();await this.view.refresh();}catch(e){status.setText(e.message);b.setDisabled(false);}}));}
}
class MicrosoftAttachmentsModal extends Modal {
  constructor(view,item){super(view.app);this.view=view;this.item=item;this.provider=view.currentProvider();this.closed=false;}
  onClose(){this.closed=true;this.contentEl.empty();}
  async onOpen(){const el=this.contentEl;el.createEl('h2',{text:'Microsoft To Do attachments'});const status=el.createEl('p');const list=el.createDiv();const refresh=async()=>{list.empty();const items=await this.provider.attachments(this.item);if(this.closed)return;for(const attachment of items)new Setting(list).setName(attachment.name).setDesc(`${attachment.size||0} bytes`).addButton(b=>b.setButtonText('Save to vault').onClick(async()=>{b.setDisabled(true);try{
      if(attachment.size>10000000)throw new Error('Use Microsoft To Do to download files larger than 10 MB.');
      const raw=await this.provider.attachment(this.item,attachment.id);if(typeof raw.contentBytes!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw.contentBytes))throw new Error('Invalid attachment data.');const bytes=Buffer.from(raw.contentBytes,'base64');if(bytes.length>10000000)throw new Error('Attachment exceeds download limit.');const adapter=this.app.vault.adapter,folder=vaultPath(this.view.plugin.settings.sync.folder)+'/Attachments';if(!await adapter.exists(folder)){if(!await adapter.exists(this.view.plugin.settings.sync.folder))await this.app.vault.createFolder(this.view.plugin.settings.sync.folder);await this.app.vault.createFolder(folder);}const safe=String(attachment.name||'attachment').replace(/[\\/\\\\<>:"|?*\\x00-\\x1f]/g,'_').replace(/^\\.+/,'_');const path=folder+'/'+String(attachment.id).replace(/[^A-Za-z0-9_-]/g,'').slice(0,20)+'-'+safe;if(await adapter.exists(path))throw new Error('A copy already exists in the attachment folder.');await this.app.vault.createBinary(path,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));new Notice('Attachment saved to vault.');}catch(e){status.setText(e.message);}finally{b.setDisabled(false);}}));};
    let path='';new Setting(el).setName('Vault file to attach').setDesc('Relative vault path; files under 3 MB. Hidden configuration folders are excluded.').addText(t=>t.onChange(v=>path=v)).addButton(b=>b.setButtonText('Attach file').onClick(async()=>{b.setDisabled(true);try{vaultPath(path);const file=this.app.vault.getAbstractFileByPath(path);if(!file||typeof file.extension!=='string')throw new Error('Choose a vault file.');if(file.stat?.size>=3000000)throw new Error('Choose a file under 3 MB.');const bytes=await this.app.vault.readBinary(file);await this.provider.addAttachment(this.item,{name:file.name,contentBytes:Buffer.from(bytes).toString('base64')});await refresh();status.setText('Attachment created.');}catch(e){status.setText(e.message);}finally{b.setDisabled(false);}}));try{await refresh();}catch(e){status.setText(e.message);}
  }
}

/**= Version 0.9.0-alpha.2. Independent settings panes retain existing persisted keys. */
class Settings extends PluginSettingTab {
  constructor(plugin) { super(plugin.app, plugin); this.plugin = plugin; this.activePane='general'; }
  display() {
    const el=this.containerEl;el.empty();el.createEl('h2',{text:'Task2Do Settings'});
    el.createEl('p',{text:`Version ${this.plugin.manifest?.version || '0.9.0-alpha.2'}`,cls:'task2do-settings-version'});
    const panes=[['general','General'],['todotxt','todo.txt'],['autotask','Autotask'],['tickets','Autotask Tickets'],['microsoft','Microsoft To Do'],['planner','Microsoft Planner'],['openproject','OpenProject'],['moovila','Moovila']];
    if(!panes.some(([id])=>id===this.activePane))this.activePane='general';
    const nav=new Setting(el);nav.settingEl.addClass?.('task2do-settings-nav');
    for(const [id,label]of panes)nav.addButton(b=>{b.setButtonText(label);if(id===this.activePane)b.setCta();b.buttonEl?.setAttribute('aria-pressed',String(id===this.activePane));b.onClick(()=>{this.activePane=id;this.display();});});
    const pane=el.createDiv({cls:'task2do-settings-pane'});pane.createEl('h3',{text:panes.find(([id])=>id===this.activePane)[1]});
    if(['openproject','moovila'].includes(this.activePane))this.external(pane,this.activePane);else this[this.activePane](pane);
  }
  general(el) {
    el.createEl('p',{text:'todo.txt is the local task manager. Configure optional providers in their own panes. The bundled docs/Task2Do-Guide.md covers setup, publishing and troubleshooting.'});
    new Setting(el).setName('Encrypted credential vault').setDesc(this.plugin.settings.encryptCredentials?'Credentials are password-encrypted in credentials.enc; unlock after startup/reload.':'Optional AES-256-GCM credential storage. Enabling migrates remembered secrets out of data.json after a verified encrypted save.').addButton(b=>b.setButtonText(this.plugin.settings.encryptCredentials?'Unlock credentials':'Enable encryption').onClick(()=>new CredentialVaultModal(this.plugin,!this.plugin.settings.encryptCredentials).open()));
    new Setting(el).setName('Publish searchable Markdown indexes').setDesc('One-way snapshots on sidebar refresh. Checkbox edits do not update source tasks. Enable, then refresh each provider.').addToggle(t => t.setValue(this.plugin.settings.publishIndex).onChange(async value => { this.plugin.settings.publishIndex = value; await this.plugin.persist(); }));
    new Setting(el).setName('Index folder').addText(t => t.setValue(this.plugin.settings.indexFolder).onChange(async value => { try { vaultPath(value); this.plugin.settings.indexFolder = value; await this.plugin.persist(); } catch (e) { new Notice(e.message); } }));
    el.createEl('h3', { text: 'Task sync' });
    new Setting(el).setName('Sync catalog/state folder').addText(t=>t.setValue(this.plugin.settings.sync.folder).onChange(async value=>{try{vaultPath(value);this.plugin.settings.sync.folder=value;this.plugin._syncEngine=null;await this.plugin.persist();this.plugin.installTickets();}catch(e){new Notice(e.message);}}));
    new Setting(el).setName('Automatic sync').setDesc('Runs while Obsidian is open. Pulls source and destination changes; never creates a destination task without a reviewed push.').addToggle(t=>t.setValue(this.plugin.settings.sync.automatic).onChange(async value=>{this.plugin.settings.sync.automatic=value;await this.plugin.persist();this.plugin.startSyncTimer();}));
    new Setting(el).setName('Write updates to already-bound tasks').setDesc('Opt in to bidirectional title/description/deadline/completion updates. Conflicts or uncertain writes stop the affected operation. Autotask writes must also be enabled. Deletions are never propagated.').addToggle(t=>t.setValue(this.plugin.settings.sync.writeExisting).onChange(async value=>{this.plugin.settings.sync.writeExisting=value;await this.plugin.persist();}));
    new Setting(el).setName('Sync interval (minutes)').addText(t=>t.setValue(String(this.plugin.settings.sync.intervalMinutes)).onChange(async value=>{if(!/^\d+$/.test(value)||Number(value)<5||Number(value)>1440){new Notice('Use 5–1440 minutes.');return;}this.plugin.settings.sync.intervalMinutes=Number(value);await this.plugin.persist();this.plugin.startSyncTimer();}));
    new Setting(el).addButton(b=>b.setButtonText('Open task sync').onClick(()=>this.plugin.openSyncView()));
  }
  todotxt(el) {
    el.createEl('p',{text:'Standalone tasks work without credentials. Existing files receive stable uid: tokens; custom task fields are retained.'});
    new Setting(el).setName('todo.txt path').setDesc('Relative vault path ending in .txt. Existing text is retained.').addText(t => t.setValue(this.plugin.settings.todoTxtPath).onChange(async value => {
      try { vaultPath(value, '.txt'); this.plugin.settings.todoTxtPath = value; this.plugin.installTodoTxt(); await this.plugin.persist(); for (const leaf of this.app.workspace.getLeavesOfType(TXT_VIEW)) leaf.view.refresh(); } catch (e) { new Notice(e.message); }
    }));
    new Setting(el).addButton(b=>b.setButtonText('Select or create task file').onClick(()=>new TodoTxtSetupModal(this.plugin).open())).addButton(b=>b.setButtonText('Open todo.txt tasks').onClick(()=>this.plugin.openTodoTxtView()));
  }
  autotask(el) {
    for (const [key, label] of [['baseUrl', 'Autotask Zone REST URL'], ['resourceId', 'Assigned Resource ID']]) new Setting(el).setName(label).addText(t => t.setValue(this.plugin.settings[key]).onChange(async v => {
      this.plugin.provider?.dispose(); this.plugin.provider = null;
      this.plugin.settings[key] = v; await this.plugin.persist();
    }));
    new Setting(el).setName('Creator Resource ID (optional)').setDesc('Your Autotask user ID for Delegated by Me. Leave blank to use Assigned Resource ID. Set separately when viewing tasks assigned to another user.').addText(t => t.setValue(this.plugin.settings.creatorResourceId).onChange(async value => {
      if (value && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) { new Notice('Enter a positive creator Resource ID or leave blank.'); return; }
      const credentials = this.plugin.provider?.credentials ? { ...this.plugin.provider.credentials } : null;
      this.plugin.settings.creatorResourceId = value; await this.plugin.persist(); if (credentials) this.plugin.setProvider(credentials);
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) leaf.view.refresh();
    }));
    new Setting(el).setName('API user Resource ID (optional)').setDesc('Also include tasks created by the API account. Leave blank to resolve the connected API username automatically; enter the numeric ID if Resources access is restricted.').addText(t => t.setValue(this.plugin.settings.apiResourceId).onChange(async value => {
      if (value && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) { new Notice('Enter a positive API Resource ID or leave blank.'); return; }
      const credentials = this.plugin.provider?.credentials ? { ...this.plugin.provider.credentials } : null;
      this.plugin.settings.apiResourceId = value; await this.plugin.persist(); if (credentials) this.plugin.setProvider(credentials);
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) leaf.view.refresh();
    }));
    new Setting(el).setName('Missing Autotask task').setDesc('Read a specific CRM To-Do and compare its creator/assignee with your configured IDs and filters.').addButton(b => b.setButtonText('Check task by ID').onClick(() => new AutotaskInspectModal(this.plugin).open()));
    el.createEl('p', { text: 'Use a dedicated API user with restricted CRM access. Enable the encrypted credential vault to protect saved credentials.' });
    new Setting(el).setName('Remember credentials').setDesc('Automatically reconnect after restart. Turning this off removes saved credentials from the current settings file.').addToggle(t => t.setValue(this.plugin.settings.rememberCredentials).onChange(async value => {
      this.plugin.settings.rememberCredentials = value;
      if (value && this.plugin.provider?.credentials) this.plugin.settings.savedCredentials = { ...this.plugin.provider.credentials };
      if (!value) delete this.plugin.settings.savedCredentials;
      await this.plugin.persist();
    }));
    new Setting(el).setName('Enable To-Do updates').setDesc('Allow explicit assignment, schedule and completion changes. Applies immediately to an active connection.').addToggle(t => t.setValue(this.plugin.settings.enableWrites).onChange(async value => {
      const credentials = this.plugin.provider?.credentials ? { ...this.plugin.provider.credentials } : null;
      this.plugin.settings.enableWrites = value; await this.plugin.persist();
      if (credentials) this.plugin.setProvider(credentials);
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) leaf.view.refresh();
    }));
    new Setting(el).addButton(b=>b.setButtonText('Connect Autotask').onClick(()=>new ConnectModal(this.plugin).open())).addButton(b=>b.setButtonText('Open Autotask tasks').onClick(()=>this.plugin.openView()));
  }
  tickets(el){el.createEl('p',{text:'Service Desk Tickets share the Autotask connection and Assigned resource ID. CRM To-Dos remain a separate provider. This release retrieves primary assignments; ticket creation, time entries and cross-sync are deferred. Title, description, due date and validated reassignment are available through Update ticket.'});
    new Setting(el).setName('Enable ticket updates').setDesc('Separately enable supported ticket edits, reassignment and native ticket notes. Autotask workflows and API permissions apply.').addToggle(t=>t.setValue(this.plugin.settings.autotaskTickets.enableWrites).onChange(async value=>{const before=this.plugin.settings.autotaskTickets.enableWrites;try{this.plugin.settings.autotaskTickets.enableWrites=value;await this.plugin.persist();this.plugin.installTickets();for(const leaf of this.app.workspace.getLeavesOfType(TICKET_VIEW))leaf.view.refresh();}catch(e){this.plugin.settings.autotaskTickets.enableWrites=before;new Notice(e.message);}}));
    new Setting(el).setName('Completed ticket status IDs').setDesc('Optional comma-separated status IDs classified as completed by this panel. Blank uses completedDate. Hover ticket status details to see IDs. No IDs or translated labels are assumed.').addText(t=>t.setValue(this.plugin.settings.autotaskTickets.closedStatusIds).onChange(async value=>{try{ticketStatusIds(value);this.plugin.settings.autotaskTickets.closedStatusIds=value;await this.plugin.persist();this.plugin.installTickets();for(const leaf of this.app.workspace.getLeavesOfType(TICKET_VIEW))leaf.view.refresh();}catch(e){new Notice(e.message);}}));
    new Setting(el).addButton(b=>b.setButtonText('Connect Autotask').onClick(()=>new ConnectModal(this.plugin,()=>this.plugin.openTicketsView()).open())).addButton(b=>b.setButtonText('Open Autotask tickets').onClick(()=>this.plugin.openTicketsView()));
  }
  microsoft(el) {
    for (const [key, label] of [['clientId', 'Entra application client ID'], ['tenant', 'Tenant ID/domain (or common)']]) new Setting(el).setName(label).addText(t => t.setValue(this.plugin.settings.microsoft[key]).onChange(async value => {
      this.plugin.microsoftEpoch++; this.plugin.registry.remove('microsoft-planner');this.plugin.registry.remove('microsoft-todo');
      this.plugin.settings.microsoft[key] = value; delete this.plugin.settings.microsoft.tokens; await this.plugin.persist();
    }));
    new Setting(el).setName('Remember Microsoft sign-in').setDesc('Remember access/refresh tokens. Enable the encrypted credential vault to protect saved tokens.').addToggle(t => t.setValue(this.plugin.settings.microsoft.remember).onChange(async value => {
      this.plugin.settings.microsoft.remember = value;
      if (value && this.plugin.registry.get('microsoft-todo')?.auth.tokens) this.plugin.settings.microsoft.tokens = { ...this.plugin.registry.get('microsoft-todo').auth.tokens };
      else delete this.plugin.settings.microsoft.tokens;
      await this.plugin.persist();
    }));
    new Setting(el).addButton(b => b.setButtonText('Sign in to Microsoft').onClick(() => new MicrosoftSignInModal(this.plugin).open())).addButton(b => b.setButtonText('Forget Microsoft sign-in').onClick(async () => {
      this.plugin.microsoftEpoch++; this.plugin.registry.remove('microsoft-planner');this.plugin.registry.remove('microsoft-todo'); delete this.plugin.settings.microsoft.tokens; await this.plugin.persist();
      for (const leaf of [...this.app.workspace.getLeavesOfType(GRAPH_VIEW),...this.app.workspace.getLeavesOfType(PLANNER_VIEW)]) leaf.view.refresh();
    }));
  }
  planner(el) {
    new Setting(el).setName('Basic Planner plan IDs').setDesc('Comma/newline separated plan IDs. Work/school account required. Sign in again after configuring plans to grant Tasks.ReadWrite and GroupMember.Read.All. Premium plans are not supported.').addTextArea(t=>t.setValue(this.plugin.settings.planner.planIds).onChange(async value=>{this.plugin.settings.planner.planIds=value;this.plugin.registry.remove('microsoft-planner');await this.plugin.persist();const auth=this.plugin.registry.get('microsoft-todo')?.auth;if(auth&&value.trim())try{this.plugin.registry.register(new MicrosoftPlannerProvider(auth,requestUrl,this.plugin.settings.planner));}catch(e){new Notice(e.message);}}));
    el.createEl('p',{text:'Shares the Microsoft To Do application and sign-in. Configure them in that pane. Adding plans requires fresh consent for group membership access.'});new Setting(el).addButton(b=>b.setButtonText('Sign in to Microsoft').onClick(()=>new MicrosoftSignInModal(this.plugin).open())).addButton(b=>b.setButtonText('Open Planner tasks').onClick(()=>this.plugin.openPlannerView()));
  }
  external(el,id) {
      const name=id==='moovila'?'Moovila':'OpenProject';
      el.createEl('p',{text:id==='moovila'?'Published Report API: read-only; vendor-issued bearer token required.':'Cloud/on-premises API v3. Configure instance URL, API key and custom CA/self-signed PEM trust in Connect.'});
      new Setting(el).addButton(b=>b.setButtonText(`Connect ${name}`).onClick(()=>new ProviderConnectModal(this.plugin,id).open())).addButton(b=>b.setButtonText(`Forget ${name} credentials`).onClick(async()=>{this.plugin.registry.remove(id);delete this.plugin.settings[id].token;this.plugin.settings[id].remember=false;await this.plugin.persist();for(const leaf of this.app.workspace.getLeavesOfType(id==='moovila'?MOOVILA_VIEW:OP_VIEW))leaf.view.refresh();}));
  }
}
module.exports = class Task2DoPlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = { baseUrl: typeof saved?.baseUrl === 'string' ? saved.baseUrl : '', resourceId: typeof saved?.resourceId === 'string' ? saved.resourceId : '', creatorResourceId: typeof saved?.creatorResourceId === 'string' ? saved.creatorResourceId : '', apiResourceId: typeof saved?.apiResourceId === 'string' ? saved.apiResourceId : '', enableWrites: saved?.enableWrites === true, rememberCredentials: saved?.rememberCredentials === true };
    this.settings.autotaskTickets={enableWrites:saved?.autotaskTickets?.enableWrites===true,closedStatusIds:typeof saved?.autotaskTickets?.closedStatusIds==='string'?saved.autotaskTickets.closedStatusIds:''};
    try{ticketStatusIds(this.settings.autotaskTickets.closedStatusIds);}catch{this.settings.autotaskTickets.closedStatusIds='';new Notice('Invalid completed ticket status IDs were ignored. Check Autotask Tickets settings.');}
    this.settings.encryptCredentials = saved?.encryptCredentials === true;
    this.settings.viewPreferences = {};
    for (const key of [VIEW, GRAPH_VIEW, TXT_VIEW, PLANNER_VIEW, OP_VIEW, MOOVILA_VIEW, TICKET_VIEW]) {
      const pref = saved?.viewPreferences?.[key];
      this.settings.viewPreferences[key] = { state: ['open', 'completed', 'all'].includes(pref?.state) ? pref.state : 'open', sort: ['due-asc', 'due-desc', 'none'].includes(pref?.sort) ? pref.sort : 'due-asc', search: typeof pref?.search === 'string' ? pref.search : '', ...(key===TICKET_VIEW?{ticketStatus:typeof pref?.ticketStatus==='string'?pref.ticketStatus:'',ticketPriority:typeof pref?.ticketPriority==='string'?pref.ticketPriority:'',ticketQueue:typeof pref?.ticketQueue==='string'?pref.ticketQueue:'',ticketAssignmentMode:['user','group'].includes(pref?.ticketAssignmentMode)?pref.ticketAssignmentMode:'me',ticketUserId:typeof pref?.ticketUserId==='string'?pref.ticketUserId:'',ticketUserIds:Array.isArray(pref?.ticketUserIds)?pref.ticketUserIds.filter(v=>typeof v==='string'):[]}:{}), ...(key===TXT_VIEW?{localView:['inbox','today','upcoming','completed','all'].includes(pref?.localView)?pref.localView:'inbox'}:{}), ...(key === VIEW ? { scope: ['my', 'delegated', 'all'].includes(pref?.scope) ? pref.scope : 'all' } : {}) };
    }
    this.settings.microsoft = { clientId: typeof saved?.microsoft?.clientId === 'string' ? saved.microsoft.clientId : '', tenant: typeof saved?.microsoft?.tenant === 'string' ? saved.microsoft.tenant : 'common', remember: saved?.microsoft?.remember === true };
    if (this.settings.microsoft.remember && saved?.microsoft?.tokens) this.settings.microsoft.tokens = saved.microsoft.tokens;
    if (this.settings.rememberCredentials && saved?.savedCredentials && ['username', 'secret', 'integrationCode'].every(k => typeof saved.savedCredentials[k] === 'string')) this.settings.savedCredentials = { username: saved.savedCredentials.username, secret: saved.savedCredentials.secret, integrationCode: saved.savedCredentials.integrationCode };
    this.provider = null;
    this.registry = new ProviderRegistry(); this.microsoftEpoch = 0; this.unloaded = false; this.saveChain = Promise.resolve();
    this.registerView(VIEW, leaf => new ToDoView(leaf, this));
    this.registerView(TICKET_VIEW,leaf=>new AutotaskTicketsView(leaf,this));this.addCommand({id:'open-autotask-tickets',name:'Open Autotask Tickets',callback:()=>this.openTicketsView()});
    this.registerView(GRAPH_VIEW, leaf => new MicrosoftToDoView(leaf, this));
    this.settings.planner = { planIds: typeof saved?.planner?.planIds === 'string' ? saved.planner.planIds : '' };
    this.registerView(PLANNER_VIEW, leaf => new PlannerView(leaf, this));
    this.settings.sync = { folder: typeof saved?.sync?.folder === 'string' ? saved.sync.folder : 'Task2Do', automatic: saved?.sync?.automatic === true, writeExisting: saved?.sync?.writeExisting === true, intervalMinutes: Math.max(5,Math.min(1440,Number(saved?.sync?.intervalMinutes)||15)) };
    this.installTickets();
    this.registerView(SYNC_VIEW, leaf => new TaskSyncView(leaf, this));
    this.addCommand({id:'open-task-sync',name:'Open task sync',callback:()=>this.openSyncView()});
    this.startSyncTimer();
    this.addCommand({ id: 'open-planner-tasks', name: 'Open Microsoft Planner Tasks', callback: () => this.openPlannerView() });
    this.addCommand({ id: 'create-planner-task', name: 'Create Microsoft Planner task', callback: () => new PlannerTaskModal(this, null, null).open() });
    this.registerView(TXT_VIEW, leaf => new TodoTxtView(leaf, this));
    for(const id of ['openproject','moovila']) {
      const config=saved?.[id]||{};
      this.settings[id]={baseUrl:typeof config.baseUrl==='string'?config.baseUrl:id==='moovila'?'https://api.moovila.com':'',remember:config.remember===true,...(id==='openproject'?{projectId:typeof config.projectId==='string'?config.projectId:'',caPem:typeof config.caPem==='string'?config.caPem:'',enableWrites:config.enableWrites===true}:{})};
      if(this.settings[id].remember&&typeof config.token==='string')this.settings[id].token=config.token;
      this.registerView(id==='moovila'?MOOVILA_VIEW:OP_VIEW,leaf=>new ExternalProviderView(leaf,this,id));
      this.addCommand({id:`open-${id}-tasks`,name:`Open ${id==='moovila'?'Moovila':'OpenProject'} Tasks`,callback:()=>this.openExternalView(id)});
      this.addCommand({id:`connect-${id}`,name:`Connect ${id==='moovila'?'Moovila':'OpenProject'}`,callback:()=>new ProviderConnectModal(this,id).open()});
      if(this.settings[id].token)try{this.registry.register(this.makeExternalProvider(id,this.settings[id]));}catch{new Notice(`Saved ${id} configuration could not be restored. Connect again.`);}
    }
    this.addCommand({id:'create-openproject-task',name:'Create OpenProject task',callback:()=>new OpenProjectTaskModal(this,null,null).open()});
    this.settings.todoTxtPath = typeof saved?.todoTxtPath === 'string' ? saved.todoTxtPath : 'Task2Do/todo.txt';
    this.settings.localSetupComplete=saved?.localSetupComplete===true||typeof saved?.todoTxtPath==='string';
    this.settings.publishIndex = saved?.publishIndex !== false;
    this.settings.indexFolder = typeof saved?.indexFolder === 'string' ? saved.indexFolder : 'Task2Do';
    try { this.installTodoTxt(); } catch { new Notice('Invalid todo.txt path. Check settings.'); }
    this.addCommand({ id: 'create-autotask-task', name: 'Create Autotask To-Do', callback: () => new AutotaskCreateModal(this).open() });
    this.addCommand({ id: 'open-todotxt', name: 'Open todo.txt Tasks', callback: () => this.openTodoTxtView() });
    this.addCommand({ id: 'create-todotxt-task', name: 'Create todo.txt task', callback: () => new TodoTxtTaskModal(this).open() });
    this.addCommand({id:'setup-todotxt',name:'Select or create todo.txt task file',callback:()=>new TodoTxtSetupModal(this).open()});
    if(this.app?.vault?.on&&this.registerEvent){const changed=(file,oldPath)=>{if(file?.path!==this.settings.todoTxtPath&&oldPath!==this.settings.todoTxtPath)return;if(this.localRefreshTimer)clearTimeout(this.localRefreshTimer);this.localRefreshTimer=setTimeout(()=>{if(!this.unloaded)for(const leaf of this.app.workspace.getLeavesOfType(TXT_VIEW))leaf.view.refresh();},180);};for(const event of ['modify','create','delete','rename'])this.registerEvent(this.app.vault.on(event,changed));}
    if(!this.settings.localSetupComplete)this.app?.workspace?.onLayoutReady?.(()=>{if(!this.unloaded)new TodoTxtSetupModal(this).open();});
    this.addSettingTab(new Settings(this));
    this.addRibbonIcon?.('list-checks', 'Task2Do', () => this.settings.localSetupComplete?this.openTodoTxtView():new TodoTxtSetupModal(this).open());
    this.addCommand({id:'unlock-task2do-credentials',name:'Unlock encrypted credentials',callback:()=>new CredentialVaultModal(this).open()});
    this.addCommand({ id: 'open-task2do', name: 'Open Task2Do provider launcher', callback: () => new Task2DoLauncherModal(this).open() });
    this.addCommand({ id: 'open-autotask-todos', name: 'Open Autotask Tasks (assigned and created)', callback: () => this.openView() });
    this.addCommand({ id: 'inspect-autotask-task', name: 'Check Autotask To-Do by ID', callback: () => new AutotaskInspectModal(this).open() });
    this.addCommand({ id: 'connect-autotask', name: 'Connect for this session', callback: () => new ConnectModal(this).open() });
    this.addCommand({ id: 'disconnect-autotask', name: 'Disconnect', callback: () => { this.registry.remove('autotask-todo'); this.provider = null; for (const leaf of [...this.app.workspace.getLeavesOfType(VIEW),...this.app.workspace.getLeavesOfType(TICKET_VIEW)]) leaf.view.refresh(); } });
    this.addCommand({ id: 'open-microsoft-todos', name: 'Open Microsoft To Do Tasks', callback: () => this.openMicrosoftView() });
    this.addCommand({ id: 'signin-microsoft-todo', name: 'Sign in to Microsoft To Do', callback: () => new MicrosoftSignInModal(this).open() });
    this.addCommand({ id: 'create-microsoft-task', name: 'Create Microsoft To Do task', callback: () => new MicrosoftTaskModal(this, null).open() });
    this.addCommand({ id: 'selection-to-microsoft-task', name: 'Create Microsoft To Do task from selection', editorCallback: (editor, context) => {
      const selected = editor.getSelection().trim();
      if (!selected) { new Notice('Select text to create a Microsoft To Do task.'); return; }
      const source = context.file ? `\n\nSource: ${context.file.path}` : '';
      new MicrosoftTaskModal(this, null, null, 'create', { title: selected.split('\n')[0].slice(0, 255), description: (selected + source).slice(0, 32000) }).open();
    } });
    if (this.settings.savedCredentials) {
      try { this.setProvider(this.settings.savedCredentials); }
      catch { new Notice('Saved Autotask connection settings are invalid. Check settings and connect again.'); }
    }
    if (this.settings.microsoft.tokens) {
      try { const auth = this.makeMicrosoftAuth(false); auth.restore(this.settings.microsoft.tokens); this.installMicrosoft(auth); }
      catch { new Notice('Saved Microsoft sign-in could not be restored. Sign in again.'); }
    }
    this.app?.workspace?.onLayoutReady?.(() => {
      if (this.unloaded) return;
      if(this.settings.encryptCredentials&&!this._credentialVault)new CredentialVaultModal(this).open();
      for (const type of [VIEW, GRAPH_VIEW, TXT_VIEW, PLANNER_VIEW, OP_VIEW, MOOVILA_VIEW, TICKET_VIEW]) for (const leaf of this.app.workspace.getLeavesOfType(type)) leaf.view.refresh();
    });
  }
  /**= Serialize settings writes so token refresh and UI preferences do not race on disk. */
  credentialVaultPath(){return `${this.manifest?.dir||this.app.vault.configDir+'/plugins/task2do'}/credentials.enc`;}
  restoreCredentialSessions(){
    if(this.settings.rememberCredentials&&this.settings.savedCredentials)try{this.setProvider(this.settings.savedCredentials);}catch{new Notice('Saved Autotask configuration invalid.');}
    if(this.settings.microsoft.remember&&this.settings.microsoft.tokens)try{const auth=this.makeMicrosoftAuth(false);auth.restore(this.settings.microsoft.tokens);this.installMicrosoft(auth);}catch{new Notice('Microsoft sign-in must be renewed.');}
    for(const id of ['openproject','moovila'])if(this.settings[id].remember&&this.settings[id].token)try{this.registry.register(this.makeExternalProvider(id,this.settings[id]));}catch{new Notice(`Saved ${id} configuration invalid.`);}
  }
  async persist(settings = this.settings) {
    const snapshot = JSON.parse(JSON.stringify(settings));
    this.saveChain = (this.saveChain || Promise.resolve()).catch(() => {}).then(async () => {
      if(snapshot.encryptCredentials){if(!this._credentialVault)throw new Error('Unlock the credential vault before saving changes.');const {publicSettings,secrets}=credentialSnapshot(snapshot);const envelope=this._credentialVault.encrypt(secrets),text=JSON.stringify(envelope);const adapter=this.app.vault.adapter,path=this.credentialVaultPath(),previous=await adapter.exists(path)?await adapter.read(path):null;try{await adapter.write(path,text);const check=JSON.parse(await adapter.read(path));if(JSON.stringify(this._credentialVault.decrypt(check))!==JSON.stringify(secrets))throw new Error('Encrypted credential save could not be verified.');await this.saveData(publicSettings);}catch(e){if(previous!==null)await adapter.write(path,previous);else if(await adapter.exists(path))await adapter.remove(path);throw e;}}else await this.saveData(snapshot);
    });
    return this.saveChain;
  }
  makeMicrosoftAuth(replace = true) {
    if (replace) { this.microsoftEpoch++; this.registry.remove('microsoft-planner'); this.registry.remove('microsoft-todo'); }
    const epoch = this.microsoftEpoch, config = { clientId: this.settings.microsoft.clientId, tenant: this.settings.microsoft.tenant, plannerDirectory: !!this.settings.planner.planIds.trim() };
    return new MicrosoftAuth(config, requestUrl, async tokens => {
      if (this.unloaded || epoch !== this.microsoftEpoch || config.clientId !== this.settings.microsoft.clientId || config.tenant !== this.settings.microsoft.tenant) throw new Error('Microsoft connection changed. Sign in again.');
      if (this.settings.microsoft.remember) { this.settings.microsoft.tokens = { ...tokens }; await this.persist(); }
    }, entry => console.info('[Task2Do]', JSON.stringify(entry)));
  }
  installMicrosoft(auth) {
    this.registry.remove('microsoft-planner');
    this.registry.register(new MicrosoftToDoProvider(auth, requestUrl, entry => console.info('[Task2Do]', JSON.stringify(entry))));
    if (this.settings.planner.planIds.trim()) this.registry.register(new MicrosoftPlannerProvider(auth, requestUrl, this.settings.planner, entry => console.info('[Task2Do]', JSON.stringify(entry))));
  }
  async openPlannerView(){let leaf=this.app.workspace.getLeavesOfType(PLANNER_VIEW)[0];if(!leaf){leaf=this.app.workspace.getRightLeaf(false);if(!leaf)throw new Error('Unable to open Planner panel.');await leaf.setViewState({type:PLANNER_VIEW,active:true});}else await leaf.view.refresh();await this.app.workspace.revealLeaf(leaf);}

  /**= Persist only explicitly remembered credentials; initialize sessions without a network write. */
  setProvider(credentials) {
    const provider = new AutotaskToDoProvider(this.settings, credentials, requestUrl, entry => console.info('[Task2Do]', JSON.stringify(entry)));
    this.provider?.dispose(); this.provider = this.registry.register(provider);
  }
  async connect(credentials, remember) {
    const provider = new AutotaskToDoProvider(this.settings, credentials, requestUrl, entry => console.info('[Task2Do]', JSON.stringify(entry)));
    const settings = { ...this.settings, rememberCredentials: remember === true };
    if (settings.rememberCredentials) settings.savedCredentials = { ...provider.credentials };
    else delete settings.savedCredentials;
    try { await this.persist(settings); }
    catch { provider.dispose(); throw new Error('Unable to save connection preferences.'); }
    this.settings = settings; this.provider?.dispose(); this.provider = this.registry.register(provider);
  }
  async openView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); if (!leaf) throw new Error('Unable to open sidebar.'); await leaf.setViewState({ type: VIEW, active: true }); }
    else await leaf.view.refresh();
    await this.app.workspace.revealLeaf(leaf);
  }
  async openMicrosoftView() {
    let leaf = this.app.workspace.getLeavesOfType(GRAPH_VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); if (!leaf) throw new Error('Unable to open Microsoft sidebar.'); await leaf.setViewState({ type: GRAPH_VIEW, active: true }); }
    else await leaf.view.refresh();
    await this.app.workspace.revealLeaf(leaf);
  }
  makeExternalProvider(id,config) {
    const log=entry=>console.info('[Task2Do]',JSON.stringify(entry));
    if(id==='moovila')return new MoovilaProvider(config,requestUrl,log);
    if(id==='openproject')return new OpenProjectProvider(config,desktopHttps(config.baseUrl,config.caPem),log);
    throw new Error('Unknown provider.');
  }
  async openExternalView(id){
    const type=id==='moovila'?MOOVILA_VIEW:OP_VIEW;let leaf=this.app.workspace.getLeavesOfType(type)[0];
    if(!leaf){leaf=this.app.workspace.getRightLeaf(false);if(!leaf)throw new Error('Unable to open sidebar.');await leaf.setViewState({type,active:true});}else await leaf.view.refresh();await this.app.workspace.revealLeaf(leaf);
  }
  installTickets(){const folder=this.settings.sync.folder;const storage=()=>vaultStorage(this.app.vault,vaultPath(folder)+'/ticket-note-journal.json');const journal={read:()=>storage().read(),write:(next,expected)=>storage().write(next,expected)};this.registry.register(new AutotaskTicketProvider(()=>this.provider,this.settings.autotaskTickets,journal,text=>require('node:crypto').createHash('sha256').update(text).digest('hex'),entry=>console.info('[Task2Do]',JSON.stringify(entry))));}
  async openTicketsView(){let leaf=this.app.workspace.getLeavesOfType(TICKET_VIEW)[0];if(!leaf){leaf=this.app.workspace.getRightLeaf(false);if(!leaf)throw new Error('Unable to open ticket panel.');await leaf.setViewState({type:TICKET_VIEW,active:true});}else await leaf.view.refresh();await this.app.workspace.revealLeaf(leaf);}
  syncEngine(){
    const todo=this.registry.get('todotxt'),folder=vaultPath(this.settings.sync.folder);
    if(!this._syncEngine||this._syncEngine.context.todo!==todo||this._syncEngine.folder!==folder){
      const context={todo,parse:parseTodoLine,serialize:structuredTodo,autotask:()=>this.provider,provider:id=>this.registry.get(id)};
      const storage={read:name=>vaultStorage(this.app.vault,`${folder}/${name}`).read(),write:(name,content,expected)=>vaultStorage(this.app.vault,`${folder}/${name}`).write(content,expected)};
      this._syncEngine=new TaskSyncEngine(context,storage,()=>require('node:crypto').randomUUID());this._syncEngine.folder=folder;
    }return this._syncEngine;
  }
  startSyncTimer(){if(this.syncTimer)clearInterval(this.syncTimer);this.syncTimer=null;if(!this.settings.sync?.automatic)return;this.syncTimer=setInterval(async()=>{if(this.unloaded||this.syncRunning||this.settings.encryptCredentials&&!this._credentialVault)return;this.syncRunning=true;try{const report=await this.syncEngine().cycle(this.settings.sync.writeExisting);console.info('[Task2Do]',JSON.stringify({event:'sync.cycle',...report}));}catch(e){console.info('[Task2Do]',JSON.stringify({event:'sync.cycle-failed'}));new Notice(e.message);}finally{this.syncRunning=false;}},this.settings.sync.intervalMinutes*60000);}
  async openSyncView(){let leaf=this.app.workspace.getLeavesOfType(SYNC_VIEW)[0];if(!leaf){leaf=this.app.workspace.getRightLeaf(false);if(!leaf)throw new Error('Unable to open sync panel.');await leaf.setViewState({type:SYNC_VIEW,active:true});}else await leaf.view.refresh();await this.app.workspace.revealLeaf(leaf);}
  installTodoTxt() {
    const path = vaultPath(this.settings.todoTxtPath, '.txt');
    const storage = { read: () => vaultStorage(this.app.vault, path).read(), write: (content, expected) => vaultStorage(this.app.vault, path).write(content, expected) };
    this.registry.register(new TodoTxtProvider(path, storage, entry => console.info('[Task2Do]', JSON.stringify(entry))));
  }
  async publishTasks(id, items) {
    const folder = vaultPath(this.settings.indexFolder), path = `${folder}/${id}.md`;
    const storage = vaultStorage(this.app.vault, path), current = await storage.read();
    if (await this.app.vault.adapter.exists(path) && !ownsIndex(current)) throw new Error('Existing note is not a Task2Do index. Choose another folder.');
    await storage.write(markdownIndex(id, id==='todotxt'?items.map(item=>({...item,title:todoPresentation(item).title})):items, localDay()), current);
  }
  async openTodoTxtView() {
    let leaf = this.app.workspace.getLeavesOfType(TXT_VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); if (!leaf) throw new Error('Unable to open sidebar.'); await leaf.setViewState({ type: TXT_VIEW, active: true }); } else await leaf.view.refresh();
    await this.app.workspace.revealLeaf(leaf);
  }
  onunload() { this.unloaded = true; if(this.localRefreshTimer)clearTimeout(this.localRefreshTimer);if(this.syncTimer)clearInterval(this.syncTimer); this.microsoftEpoch++; this.registry?.dispose(); this._credentialVault?.dispose(); this.provider = null; }
};
