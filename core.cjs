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
