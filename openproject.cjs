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
