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
