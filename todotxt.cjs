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
