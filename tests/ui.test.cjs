const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
/**= Minimal host/UI model exercises rendered controls and commands without Obsidian. */
async function harness(saved = {}, app = null) {
  const controls = [], views = new Map(), commands = [], modals = [], writes = [], tabs = [];
  class Element {
    constructor(text = '') { this.text = text; this.children = [];this.attributes={}; }
    get textContent(){return this.text;}set textContent(v){this.text=v;}
    setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}removeAttribute(k){delete this.attributes[k];}
    createEl(tag, options = {}) { const child = new Element(options.text || ''); child.tag = tag; child.cls = options.cls || ''; this.children.push(child); return child; }
    createDiv(options = {}) { return this.createEl('div', options); }
    empty() { this.children = []; this.text = ''; }
    setText(text) { this.text = text; }
    remove() { this.text = ''; }
    insertBefore() {}
    allText() { return [this.text, ...this.children.map(c => c.allText())].join('\n'); }
  }
  class Component {
    constructor(type) { this.type = type; this.inputEl = new Element();this.selectEl=this.inputEl;this.selectEl.replaceChildren=()=>{this.options={};};this.toggleEl=new Element();this.buttonEl=new Element();this.options = {}; this.text = ''; controls.push(this); }
    setValue(v) { this.value = v; return this; } setPlaceholder(v) { this.inputEl.placeholder=v;return this; }
    setButtonText(v) { this.text = v;this.buttonEl.textContent=v; return this; } setCta() { return this; }
    setDisabled(v) { this.disabled = v; return this; }
    onChange(callback) { this.change = callback; return this; } onClick(callback) { this.click = callback; return this; }
    addOptions(options) { Object.assign(this.options, options); return this; }
    addOption(key, label) { this.options[key] = label; return this; }
  }
  class Setting {
    constructor(el) { this.settingEl = el.createDiv(); }
    setName(name) { this.settingEl.createEl('span', { text: name }); return this; } setDesc() { return this; }
    addButton(cb) { cb(new Component('button')); return this; }
    addDropdown(cb) { cb(new Component('dropdown')); return this; }
    addText(cb) { cb(new Component('text')); return this; }
    addTextArea(cb) { cb(new Component('textarea')); return this; }
    addToggle(cb) { cb(new Component('toggle')); return this; }
  }
  class ItemView { constructor(leaf) { this.app = leaf.app; this.contentEl = new Element(); } }
  class Modal {
    constructor(app) { this.app = app; this.contentEl = new Element(); }
    open() { modals.push(this); this.openPromise = Promise.resolve(this.onOpen()); }
    close() { this.onClose(); }
  }
  class Plugin {
    constructor() { this.app = app || { workspace: { getLeavesOfType: () => [] } }; }
    async loadData() { return { resourceId: '123', ...saved }; } async saveData(value) { writes.push(value); }
    registerView(type, factory) { views.set(type, factory); }
    registerEvent() {}
    addCommand(command) { commands.push(command); } addSettingTab(tab) { tabs.push(tab); }
    addRibbonIcon(icon, title, callback) { this.ribbon = { icon, title, callback }; }
  }
  class PluginSettingTab { constructor(app,plugin){this.app=app;this.plugin=plugin;this.containerEl=new Element();} }
  const context = { module: { exports: {} }, console, Buffer, URL, URLSearchParams, setTimeout, clearTimeout, require: name => name==='obsidian'?({ Plugin, PluginSettingTab, Setting, Modal, ItemView, Notice: class {}, requestUrl: async () => { throw new Error('No live network in UI test'); } }):require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  const plugin = new context.module.exports(); await plugin.onload();
  return { plugin, controls, views, commands, modals, writes, tabs };
}
test('Autotask sidebar displays names, filters immediately and persists search', async () => {
  const { plugin, controls, views, writes } = await harness();
  plugin.provider = { capabilities: { update: false }, list: async () => [{ provider: 'autotask-todo', remoteId: '1', description: 'Open Review', completed: false, organizationName: 'Acme', assigneeName: 'LaurentFough' }, { provider: 'autotask-todo', remoteId: '2', description: 'Closed Review', completed: true, organizationName: 'Acme', assigneeName: 'LaurentFough' }], enrich: async items => items };
  const view = views.get('autotask-todo-view')({ app: plugin.app }); await view.onOpen();
  assert.ok(view.contentEl.allText().includes('Open Review')); assert.ok(!view.contentEl.allText().includes('Closed Review'));
  assert.ok(view.contentEl.allText().includes('Acme · LaurentFough'));
  controls.find(c => c.type === 'dropdown' && c.options.completed).change('completed'); await plugin.saveChain;
  assert.ok(view.contentEl.allText().includes('Closed Review')); assert.ok(!view.contentEl.allText().includes('Open Review'));
  const search = controls.find(c => c.type === 'text'); search.change('missing'); await plugin.saveChain;
  assert.ok(view.contentEl.allText().includes('No matching'));
  assert.equal(writes.at(-1).viewPreferences['autotask-todo-view'].search, 'missing');
});
test('Graph selection command populates create modal and sends explicit creation', async () => {
  const { plugin, commands, modals, controls } = await harness(); const creations = [];
  const provider = { id: 'microsoft-todo', capabilities: { read: true, create: true }, list: async () => [], destinations: async () => [{ id: 'list1', displayName: 'Work' }], create: async (id, values) => creations.push({ id, values }) };
  plugin.registry.register(provider); plugin.openMicrosoftView = async () => {};
  commands.find(c => c.id === 'selection-to-microsoft-task').editorCallback({ getSelection: () => 'Review policy\nDetailed note' }, { file: { path: 'work.md' } });
  await modals[0].openPromise;
  assert.equal(controls.find(c => c.type === 'text').value, 'Review policy');
  assert.ok(controls.find(c => c.type === 'textarea').value.includes('Source: work.md'));
  await controls.find(c => c.text === 'Create task').click();
  assert.equal(creations.length, 1); assert.equal(creations[0].id, 'list1'); assert.equal(creations[0].values.title, 'Review policy');
});
test('saved Graph session restores alongside remembered Autotask credentials', async () => {
  const { plugin } = await harness({ baseUrl: 'https://webservices4.autotask.net/atservicesrest/v1.0/', resourceId: '123', rememberCredentials: true, savedCredentials: { username: 'fixture', secret: 'fixture', integrationCode: 'fixture' }, microsoft: { clientId: '11111111-2222-3333-4444-555555555555', tenant: 'common', remember: true, tokens: { accessToken: 'fixture', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 3600000 } } });
  assert.ok(plugin.registry.get('autotask-todo')); assert.ok(plugin.registry.get('microsoft-todo'));
  assert.equal(plugin.provider.credentials.secret, 'fixture');
  plugin.onunload(); assert.equal(plugin.registry.providers.size, 0);
});
test('Autotask edit provides named assignment and minute-resolution calendar controls', async () => {
  const { plugin, controls, views, modals } = await harness(); const writes = [];
  const item = { provider: 'autotask-todo', remoteId: '1', description: 'Review', completed: false, assigneeId: 123, companyId: 7, organizationName: 'Acme', assigneeName: 'LaurentFough Example', start: '2026-10-14T16:30:45.123Z', due: '2026-10-14T17:30:45.123Z' };
  plugin.provider = { capabilities: { update: true }, list: async () => [item], enrich: async items => items, listResources: async () => [{ id: '123', label: 'LaurentFough Example' }, { id: '456', label: 'Alice Smith' }], update: async (snapshot, changes) => writes.push(changes) };
  const view = views.get('autotask-todo-view')({ app: plugin.app }); await view.onOpen();
  const offset = controls.length; controls.find(c => c.text === 'Edit').click(); await modals[0].openPromise; await new Promise(resolve => setImmediate(resolve));
  const editorControls = controls.slice(offset), calendars = editorControls.filter(c => c.inputEl.type === 'datetime-local');
  assert.equal(calendars.length, 2); assert.equal(calendars[0].inputEl.step, '60'); assert.equal(calendars[0].value.length, 16);
  const users = editorControls.find(c => c.type === 'dropdown' && c.options['456']);
  assert.equal(users.options['456'], 'Alice Smith'); users.change('456');
  await editorControls.find(c => c.text === 'Save changes').click();
  assert.equal(writes.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { assignedToResourceID: '456' });
});
test('changing calendar timezone does not generate a remote date edit', async () => {
  const { plugin, controls, views, modals } = await harness(); let writes = 0;
  const item = { provider: 'autotask-todo', remoteId: '1', description: 'Review', completed: false, assigneeId: 123, companyId: 7, organizationName: 'Acme', assigneeName: 'LaurentFough Example', start: '2026-10-14T16:30:45.123Z', due: '2026-10-14T17:30:45.123Z' };
  plugin.provider = { capabilities: { update: true }, list: async () => [item], enrich: async items => items, listResources: async () => [{ id: '123', label: 'LaurentFough Example' }], update: async () => writes++ };
  const view = views.get('autotask-todo-view')({ app: plugin.app }); await view.onOpen();
  const offset = controls.length; controls.find(c => c.text === 'Edit').click(); await modals[0].openPromise;
  const editorControls = controls.slice(offset);
  editorControls.find(c => c.type === 'dropdown' && c.options.utc).change('utc');
  await editorControls.find(c => c.text === 'Save changes').click();
  assert.equal(writes, 0); assert.ok(modals[0].contentEl.allText().includes('No changes'));
});
test('company dialog searches names and submits only the chosen company', async () => {
  const { plugin, controls, views, modals } = await harness(); const moves = [];
  const item = { provider: 'autotask-todo', remoteId: '1', description: 'Review', completed: false, assigneeId: 123, companyId: 7, organizationName: 'Acme', assigneeName: 'LaurentFough', start: '2026-10-14T16:00:00Z', due: '2026-10-14T17:00:00Z' };
  plugin.provider = { capabilities: { update: true, changeCompany: true }, list: async () => [item], enrich: async items => items, listResources: async () => [], searchCompanies: async query => ({ items: [{ id: '0', name: query }], hasMore: false }), changeCompany: async (snapshot, destination) => moves.push(destination) };
  const view = views.get('autotask-todo-view')({ app: plugin.app }); await view.onOpen();
  assert.ok(!controls.some(c => c.text === 'Change company'));
  controls.find(c => c.text === 'Edit').click(); await modals[0].openPromise;
  const offset = controls.length; controls.find(c => c.text === 'Change company').click(); await modals[1].openPromise;
  const editor = controls.slice(offset); editor.find(c => c.type === 'text').change('Internal');
  await editor.find(c => c.text === 'Search').click();
  const companies = editor.find(c => c.type === 'dropdown'); assert.equal(companies.options['0'], 'Internal'); companies.change('0');
  await editor.find(c => c.text === 'Change company').click(); assert.deepEqual(moves, ['0']);
});
test('task header places a minute-only due date beside status and ID', async () => {
  const { plugin, views } = await harness();
  const item = { provider: 'autotask-todo', remoteId: '12345', description: 'Review', completed: false, organizationName: 'Acme', assigneeName: 'LaurentFough', due: '2026-10-14T01:50:00.123Z' };
  plugin.provider = { capabilities: { update: false }, list: async () => [item], enrich: async items => items };
  const view = views.get('autotask-todo-view')({ app: plugin.app }); await view.onOpen();
  const text = view.contentEl.allText();
  assert.match(text, /Open #12345 · Due: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.ok(!text.includes('T01:50')); assert.ok(!text.includes('.123Z'));
  assert.equal((text.match(/Due: /g) || []).length, 1);
});
test('Autotask creation UI uses named choices, local minute fields and chosen company', async () => {
  const {plugin,commands,controls,modals}=await harness({resourceId:'123'}); const created=[];
  plugin.provider={capabilities:{create:true},listResources:async()=>[{id:'123',label:'LaurentFough Example'}],actionTypes:async()=>[{id:'1',label:'Call'}],searchCompanies:async()=>({items:[{id:'7',name:'Acme'}]}),create:async v=>created.push(v)}; plugin.openView=async()=>{};
  commands.find(c=>c.id==='create-autotask-task').callback(); await modals[0].openPromise;
  controls.find(c=>c.type==='text'&&!c.inputEl.type).change('Acme'); await controls.find(c=>c.text==='Search').click();
  controls.find(c=>c.type==='dropdown'&&c.options['7']).change('7'); controls.find(c=>c.type==='textarea').change('Review client');
  const calendars=controls.filter(c=>c.inputEl.type==='datetime-local'); assert.equal(calendars.length,2); assert.equal(calendars[0].inputEl.step,'60');
  await controls.find(c=>c.text==='Create task').click(); assert.equal(created.length,1); assert.equal(created[0].companyID,'7'); assert.equal(created[0].assignedToResourceID,'123'); assert.ok(created[0].startDateTime.endsWith('Z'));
});
test('todo.txt sidebar and create command edit the configured file provider', async () => {
  const {plugin,commands,controls,modals,views}=await harness({viewPreferences:{'task2do-todotxt-view':{localView:'all'}}}); const creations=[];
  const provider={id:'todotxt',capabilities:{read:true,update:true,create:true},list:async()=>[{provider:'todotxt',remoteId:'1',title:'Call +Work',source:'todo.txt',completed:false,dueDate:'2026-10-16'}],create:async v=>creations.push(v)}; plugin.registry.register(provider); plugin.openTodoTxtView=async()=>{};
  const view=views.get('task2do-todotxt-view')({app:plugin.app}); await view.onOpen(); assert.ok(view.contentEl.allText().includes('Call') && view.contentEl.allText().includes('+Work')); assert.ok(view.contentEl.allText().includes('Due: 2026-10-16'));
  const offset=controls.length;commands.find(c=>c.id==='create-todotxt-task').callback(); await modals[0].openPromise; controls.slice(offset).find(c=>c.type==='text').change('New');controls.find(c=>c.type==='textarea').change('Task details'); await controls.find(c=>c.text==='Save task').click(); assert.equal(creations[0].title,'New');assert.equal(creations[0].description,'Task details');
});
test('publishing indexes refuses an existing user-owned note', async () => {
  const {plugin}=await harness(); let writes=0;
  plugin.app.vault={adapter:{exists:async()=>true,read:async()=> '# My note',write:async()=>writes++}};
  await assert.rejects(plugin.publishTasks('todotxt',[]),/not a Task2Do index/); assert.equal(writes,0);
});

test('each panel and opening command names Task2Do and its provider', async () => {
  const {plugin,views,commands}=await harness();
  for (const [id,provider] of [['autotask-todo-view','Autotask'],['autotask-microsoft-todo-view','Microsoft To Do'],['task2do-todotxt-view','todo.txt']]) assert.equal(views.get(id)({app:plugin.app}).getDisplayText(),`Task2Do: ${provider} Tasks`);
  for (const [id,provider] of [['open-autotask-todos','Autotask'],['open-microsoft-todos','Microsoft To Do'],['open-todotxt','todo.txt']]) assert.ok(commands.find(c=>c.id===id).name.includes(provider));
});
test('todo.txt renders a clean title, badges and names with extension values in Details', async () => {
  const {plugin,views}=await harness({viewPreferences:{'task2do-todotxt-view':{localView:'all'}}});
  const item=require('../todotxt.cjs').parseTodoLine('(A) 2026-10-13 Call client +Work @phone due:2026-10-16 companyID:7 companyName:Example_Company assignedToResourceID:123 resourceName:Alex_Example startDateTime:2026-10-16T10:00-07:00 endDateTime:2026-10-16T10:30-07:00 custom:keep',0,'Task2Do/todo.txt');
  plugin.registry.register({id:'todotxt',capabilities:{read:true,update:true},list:async()=>[item]});
  const view=views.get('task2do-todotxt-view')({app:plugin.app}); await view.onOpen();
  const descendants=el=>[el,...el.children.flatMap(descendants)]; const nodes=descendants(view.contentEl);
  assert.equal(nodes.find(el=>el.cls?.includes('task2do-txt-title')).text,'Call client');
  assert.ok(nodes.some(el=>el.text==='Example Company · Alex Example')); assert.ok(nodes.some(el=>el.text==='Priority A')); assert.ok(nodes.some(el=>el.text==='+Work'));
  const details=nodes.find(el=>el.cls==='task2do-txt-details'); assert.ok(details.allText().includes('custom')); assert.ok(details.allText().includes('keep')); assert.ok(details.allText().includes('companyID')); assert.ok(details.allText().includes(item.rawLine));
});

test('new provider panels use explicit labels and can restore remembered sessions without network',async()=>{
 const {plugin,views,commands}=await harness({moovila:{remember:true,token:'fixture',baseUrl:'https://api.moovila.com'},openproject:{remember:true,token:'fixture',baseUrl:'https://projects.example.invalid/op',caPem:'',enableWrites:true}});
 assert.ok(plugin.registry.get('moovila'));assert.ok(plugin.registry.get('openproject'));assert.equal(plugin.registry.get('moovila').capabilities.update,false);
 assert.equal(views.get('task2do-moovila-view')({app:plugin.app}).getDisplayText(),'Task2Do: Moovila Tasks');assert.equal(views.get('task2do-openproject-view')({app:plugin.app}).getDisplayText(),'Task2Do: OpenProject Tasks');assert.ok(commands.find(c=>c.id==='open-openproject-tasks').name.includes('OpenProject'));plugin.onunload();
});
test('OpenProject onboarding accepts scoped PEM trust and persists only remembered credentials',async()=>{
 const {plugin,commands,modals,controls,writes}=await harness();let received;
 plugin.makeExternalProvider=(id,config)=>{received={id,config};return{id,config,capabilities:{read:true},list:async()=>[],destinations:async()=>[],dispose(){}};};plugin.openExternalView=async()=>{};
 commands.find(c=>c.id==='connect-openproject').callback();await modals[0].openPromise;
 const text=controls.filter(c=>c.type==='text');text[0].change('https://projects.example.invalid/op');text[1].change('fixture');text[2].change('7');controls.find(c=>c.type==='textarea').change('-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----');const toggles=controls.filter(c=>c.type==='toggle');toggles[0].change(true);toggles[1].change(true);await controls.find(c=>c.text==='Connect').click();
 assert.equal(received.config.projectId,'7');assert.ok(received.config.caPem.includes('CERTIFICATE'));assert.equal(writes.at(-1).openproject.token,'fixture');assert.equal(writes.at(-1).openproject.enableWrites,true);
});
test('OpenProject status action uses only allowed workflow destinations and submits the chosen status',async()=>{
 const {plugin,views,controls,modals}=await harness();const changes=[];
 const item={provider:'openproject',remoteId:'9',title:'Review',description:'Notes',completed:false,lockVersion:2,listName:'Work',raw:{id:9,lockVersion:2}};
 const provider={id:'openproject',config:{},capabilities:{read:true,update:true},list:async()=>[item],form:async()=>({_embedded:{schema:{}}}),payload:()=>({}),choices:async()=>[{href:'/api/v3/statuses/1',name:'New',isClosed:false},{href:'/api/v3/statuses/2',name:'Closed',isClosed:true}],complete:async(snapshot,href)=>changes.push(href)};plugin.registry.register(provider);
 const view=views.get('task2do-openproject-view')({app:plugin.app});await view.onOpen();controls.find(c=>c.text==='Complete').click();await modals[0].openPromise;const dropdown=controls.find(c=>c.type==='dropdown'&&c.options['/api/v3/statuses/2']);assert.ok(dropdown);assert.ok(!dropdown.options['/api/v3/statuses/1']);dropdown.change('/api/v3/statuses/2');await controls.find(c=>c.text==='Save changes').click();assert.deepEqual(changes,['/api/v3/statuses/2']);
});

test('every provider toolbar puts New task before refresh and connection controls',async()=>{
 const {plugin,views,controls}=await harness();
 for(const id of ['autotask-todo-view','autotask-microsoft-todo-view','task2do-todotxt-view','task2do-moovila-view','task2do-openproject-view']){
  const offset=controls.length;const view=views.get(id)({app:plugin.app});view.toolbar(view.contentEl);
  const buttons=controls.slice(offset).filter(c=>c.type==='button');assert.equal(buttons[0].text,'New task');assert.equal(buttons[1].text,'Refresh');if(buttons[2])assert.ok(['Connect','Sign in','Task file'].includes(buttons[2].text));if(id==='task2do-moovila-view')assert.equal(buttons[0].disabled,true);
 }
});
test('Autotask switches between My Tasks, Delegated by Me and deduplicated All Tasks',async()=>{
 const {plugin,views,controls}=await harness();
 const records=[{remoteId:'1',assigneeId:123,creatorId:456,description:'Assigned item'},{remoteId:'2',assigneeId:456,creatorId:123,description:'Delegated item'},{remoteId:'3',assigneeId:123,creatorId:123,description:'Self-created item'}].map(t=>({...t,provider:'autotask-todo',completed:false}));
 plugin.provider={resourceId:123,creatorResourceIds:[123,555],capabilities:{update:false},listForUser:async()=>records,enrich:async t=>t};
 const view=views.get('autotask-todo-view')({app:plugin.app});await view.onOpen();const scope=controls.find(c=>c.type==='dropdown'&&c.options.my);
 assert.ok(view.contentEl.allText().includes('All Tasks (3)'));scope.change('my');await plugin.saveChain;assert.ok(view.contentEl.allText().includes('My Tasks (2)'));assert.ok(!view.contentEl.allText().includes('Delegated item'));
 scope.change('delegated');await plugin.saveChain;assert.ok(view.contentEl.allText().includes('Delegated by Me (1)'));assert.ok(!view.contentEl.allText().includes('Self-created item'));assert.equal(plugin.settings.viewPreferences['autotask-todo-view'].scope,'delegated');
 scope.change('all');await plugin.saveChain;controls.find(c=>c.type==='text').change('Delegated');await plugin.saveChain;assert.ok(view.contentEl.allText().includes('All Tasks (1)'));
});
test('missing-task diagnostic reads outside list filters and identifies creator mismatch',async()=>{
 const {plugin,commands,controls,modals}=await harness();let checked;
 plugin.provider={inspectTask:async id=>{checked=id;return{remoteId:'9',assigneeId:456,assigneeName:'Alex',creatorId:789,creatorName:'LaurentFough',configuredAssigneeId:123,configuredCreatorId:123,matchesAssigned:false,matchesCreated:false,completed:true};}};
 commands.find(c=>c.id==='inspect-autotask-task').callback();await modals[0].openPromise;controls.find(c=>c.type==='text').change('9');await controls.find(c=>c.text==='Check task').click();assert.equal(checked,'9');const text=modals[0].contentEl.allText();assert.ok(text.includes('LaurentFough (#789)'));assert.ok(text.includes('Check Creator Resource ID'));assert.ok(text.includes('filters hide this task'));
});
test('Delegated by Me includes human and API creators',async()=>{
 const {plugin,views}=await harness({viewPreferences:{'autotask-todo-view':{scope:'delegated'}}});plugin.provider={resourceId:123,creatorResourceId:123,creatorResourceIds:[123,555],capabilities:{update:false},listForUser:async()=>[{remoteId:'1',creatorId:123,assigneeId:456,description:'Native created'},{remoteId:'2',creatorId:555,assigneeId:456,description:'Plugin created'}].map(t=>({...t,provider:'autotask-todo',completed:false})),enrich:async t=>t};const view=views.get('autotask-todo-view')({app:plugin.app});await view.onOpen();const walk=el=>[el,...el.children.flatMap(walk)];const group=walk(view.contentEl).filter(el=>el.cls==='task2do-task-group')[0];assert.ok(group.allText().includes('Delegated by Me (2)'));assert.ok(group.allText().includes('Plugin created'));assert.ok(group.allText().includes('Native created'));
});
test('Autotask Edit can rename text while retaining unchanged schedule precision',async()=>{
 const {plugin,views,controls,modals}=await harness();const changes=[];const item={provider:'autotask-todo',remoteId:'1',description:'Old name\nKeep these details',assigneeId:123,creatorId:123,companyId:7,start:'2026-10-14T12:00:45.123Z',due:'2026-10-14T13:00:45.123Z',completed:false};plugin.provider={resourceId:123,capabilities:{update:true},list:async()=>[item],enrich:async t=>t,listResources:async()=>[],update:async(snapshot,values)=>changes.push(values)};const view=views.get('autotask-todo-view')({app:plugin.app});await view.onOpen();controls.find(c=>c.text==='Edit').click();await modals[0].openPromise;const text=controls.find(c=>c.type==='textarea');assert.equal(text.value,item.description);assert.equal(text.inputEl.maxLength,32000);text.change('New name\nKeep these details');await controls.find(c=>c.text==='Save changes').click();assert.deepEqual(JSON.parse(JSON.stringify(changes)),[{activityDescription:'New name\nKeep these details'}]);
});

test('ribbon launcher opens provider panels using the existing view entry points',async()=>{
 const {plugin,modals,controls,commands}=await harness();let opened='';plugin.openView=async()=>opened='autotask';assert.equal(plugin.ribbon.title,'Task2Do');assert.equal(plugin.ribbon.icon,'list-checks');commands.find(c=>c.id==='open-task2do').callback();await modals[0].openPromise;const text=modals[0].contentEl.allText();assert.ok(text.includes('Autotask Tasks'));assert.ok(text.includes('OpenProject Tasks'));await controls.find(c=>c.text==='Open').click();assert.equal(opened,'autotask');
});
test('Planner view is registered and Microsoft sign-in requests directory permission only with configured plans',async()=>{const {plugin,views}=await harness({planner:{planIds:'plan1'},microsoft:{clientId:'11111111-2222-3333-4444-555555555555',tenant:'organizations'}});assert.equal(views.get('task2do-planner-view')({app:plugin.app}).getDisplayText(),'Task2Do: Microsoft Planner Tasks');const auth=plugin.makeMicrosoftAuth();assert.ok(auth.scopes.includes('GroupMember.Read.All'));auth.dispose();});
test('encrypted persistence excludes secrets from data.json and restores previous encrypted bytes on save failure',async()=>{const {plugin,writes}=await harness();const data=new Map();plugin.app.vault={configDir:'.obsidian',adapter:{exists:async p=>data.has(p),read:async p=>data.get(p),write:async(p,v)=>data.set(p,v),remove:async p=>data.delete(p)}};const {PasswordCredentialVault}=require('../secrets.cjs');plugin._credentialVault=(await PasswordCredentialVault.open('test-only-passphrase')).vault;plugin.settings.encryptCredentials=true;plugin.settings.savedCredentials={username:'fixture',secret:'fixture-sensitive',integrationCode:'fixture'};await plugin.persist();assert.equal(writes.at(-1).savedCredentials,undefined);assert.ok(!data.get(plugin.credentialVaultPath()).includes('fixture-sensitive'));const previous=data.get(plugin.credentialVaultPath());plugin.saveData=async()=>{throw Error('disk');};plugin.settings.savedCredentials.secret='updated';await assert.rejects(plugin.persist(),/disk/);assert.equal(data.get(plugin.credentialVaultPath()),previous);plugin.onunload();});

test('fresh local setup creates the default file, enables indexing and opens local tasks without accounts',async()=>{const {plugin,commands,controls,modals,writes}=await harness();const files=new Map(),folders=new Set();plugin.app.vault={getFiles:()=>[],getAbstractFileByPath:()=>null,adapter:{exists:async p=>files.has(p)||folders.has(p),read:async p=>files.get(p),write:async(p,t)=>files.set(p,t)},createFolder:async p=>folders.add(p),create:async(p,t)=>files.set(p,t)};let opened=false;plugin.openTodoTxtView=async()=>opened=true;assert.equal(plugin.settings.todoTxtPath,'Task2Do/todo.txt');assert.equal(plugin.settings.publishIndex,true);commands.find(c=>c.id==='setup-todotxt').callback();await modals[0].openPromise;await controls.find(c=>c.text==='Use or create task file').click();assert.equal(files.get('Task2Do/todo.txt'),'');assert.equal(writes.at(-1).localSetupComplete,true);assert.equal(opened,true);assert.equal(plugin.provider,null);plugin.onunload();});
test('first layout offers setup and external modify/rename events refresh local views',async()=>{const listeners=new Map();const ready=[];let refreshes=0;const app={vault:{on:(event,fn)=>{listeners.set(event,fn);return{};}},workspace:{onLayoutReady:fn=>ready.push(fn),getLeavesOfType:()=>[{view:{refresh:()=>refreshes++}}]}};const {plugin,modals}=await harness({},app);for(const fn of ready)fn();await modals[0].openPromise;assert.ok(modals[0].contentEl.allText().includes('Start with todo.txt'));refreshes=0;listeners.get('modify')({path:'Task2Do/todo.txt'});await new Promise(r=>setTimeout(r,230));assert.equal(refreshes,1);listeners.get('rename')({path:'Elsewhere.txt'},'Task2Do/todo.txt');await new Promise(r=>setTimeout(r,230));assert.equal(refreshes,2);plugin.onunload();});
test('ribbon opens local tasks after setup and searchable index uses readable title and stable identity',async()=>{const {plugin}=await harness({localSetupComplete:true});let opened=false;plugin.openTodoTxtView=async()=>opened=true;await plugin.ribbon.callback();assert.equal(opened,true);const files=new Map();plugin.app.vault={getAbstractFileByPath:()=>null,adapter:{exists:async p=>files.has(p),read:async p=>files.get(p),write:async(p,t)=>files.set(p,t)},createFolder:async p=>files.set(p,''),create:async(p,t)=>files.set(p,t)};const id='33333333-3333-4333-8333-333333333333',item=require('../todotxt.cjs').parseTodoLine('Read titleEnd:1 +Work @desk details:Some%20notes uid:'+id);await plugin.publishTasks('todotxt',[item]);const text=files.get('Task2Do/todotxt.md');assert.ok(text.includes('- [ ] #task Read [provider:: todotxt]'));assert.ok(!text.includes('titleEnd:1'));assert.ok(text.includes('[remote_id:: '+id+']'));assert.ok(text.includes('[projects:: Work]'));assert.ok(text.includes('Some notes'));plugin.onunload();});
test('local Publish UI saves a selected list mapping then requires preview before sending',async()=>{const {plugin,controls,modals,views}=await harness({todoTxtPath:'Task2Do/todo.txt'}),id='55555555-5555-4555-8555-555555555555',item=require('../todotxt.cjs').parseTodoLine('Local titleEnd:1 details:Notes uid:'+id),calls=[];plugin.registry.register({id:'todotxt',capabilities:{read:true,update:true},list:async()=>[item]});plugin.registry.register({id:'microsoft-todo',capabilities:{read:true},list:async()=>[],destinations:async()=>[{id:'personal',displayName:'My list'}]});const preview={operation:'create',destination:'personal',values:{title:'Local',description:'Notes'}};plugin.syncEngine=()=>({mapLocal:async(...args)=>calls.push(['map',...args]),preview:async(...args)=>{calls.push(['preview',...args]);return preview;},push:async p=>calls.push(['push',p])});const view=views.get('task2do-todotxt-view')({app:plugin.app});await view.onOpen();controls.find(c=>c.text==='Publish…').click();await modals[0].openPromise;assert.ok(modals[0].contentEl.allText().includes('Map local task'));await controls.find(c=>c.text==='Save mapping and preview').click();await modals[1].openPromise;assert.equal(calls[0][1],id);assert.equal(calls[0][2],'microsoft-todo');assert.equal(calls[0][3].listId,'personal');await controls.find(c=>c.text==='Push reviewed task').click();assert.equal(calls.length,1);await controls.find(c=>c.text==='Build preview').click();assert.equal(calls[1][2],'microsoft-todo');await controls.find(c=>c.text==='Push reviewed task').click();assert.equal(calls[2][0],'push');assert.equal(plugin.provider,null);});

test('settings expose General and separate provider panes while keeping the installed version visible',async()=>{const {plugin,tabs,controls}=await harness();plugin.manifest={version:'9.8.7-test'};const settings=tabs[0];settings.display();assert.ok(settings.containerEl.allText().includes('Version 9.8.7-test'));assert.ok(settings.containerEl.allText().includes('Automatic sync'));assert.ok(!settings.containerEl.allText().includes('Autotask Zone REST URL'));const cases=[['todo.txt','todo.txt path'],['Autotask','Autotask Zone REST URL'],['Microsoft To Do','Entra application client ID'],['Microsoft Planner','Basic Planner plan IDs'],['OpenProject','Connect OpenProject'],['Moovila','Connect Moovila']];for(const [label,field]of cases){const offset=controls.length;await controls.find(c=>c.text===label).click();assert.equal(settings.activePane,{'todo.txt':'todotxt','Autotask':'autotask','Microsoft To Do':'microsoft','Microsoft Planner':'planner','OpenProject':'openproject','Moovila':'moovila'}[label]);assert.ok(settings.containerEl.allText().includes('Version 9.8.7-test'));assert.ok(settings.containerEl.allText().includes(field)||controls.slice(offset).some(c=>c.text===field));}plugin.onunload();});
test('forgetting shared Microsoft sign-in removes both providers and saved tokens',async()=>{const {plugin,tabs,controls}=await harness({microsoft:{remember:true}});const removed=[];for(const id of ['microsoft-todo','microsoft-planner'])plugin.registry.register({id,capabilities:{read:true},list:async()=>[],dispose:()=>removed.push(id)});plugin.settings.microsoft.tokens={accessToken:'fixture'};tabs[0].activePane='microsoft';tabs[0].display();await controls.find(c=>c.text==='Forget Microsoft sign-in').click();assert.equal(plugin.registry.get('microsoft-todo'),undefined);assert.equal(plugin.registry.get('microsoft-planner'),undefined);assert.equal(plugin.settings.microsoft.tokens,undefined);assert.deepEqual(removed,['microsoft-planner','microsoft-todo']);plugin.onunload();});
test('all settings input kinds and provider connection inputs receive value-free hints',async()=>{const {tabs,controls,commands,modals}=await harness();for(const pane of ['general','todotxt','autotask','microsoft','planner']){const offset=controls.length;tabs[0].activePane=pane;tabs[0].display();for(const control of controls.slice(offset).filter(c=>['text','textarea','dropdown','toggle'].includes(c.type))){const el=control.type==='toggle'?control.toggleEl:control.inputEl;assert.ok(el.title?.length>15,`${pane} ${control.type} hint missing`);}}commands.find(c=>c.id==='connect-openproject').callback();await modals[0].openPromise;const certificate=controls.find(c=>c.type==='textarea'&&c.inputEl.title?.includes('Public CA chain'));assert.ok(certificate);const secret=controls.find(c=>c.inputEl.type==='password');secret.change('NOT-FOR-TOOLTIPS');assert.ok(!secret.inputEl.title.includes('NOT-FOR-TOOLTIPS'));});
test('panel buttons and task fields carry useful hints without implying inline editing',async()=>{const {plugin,views,controls}=await harness({viewPreferences:{'task2do-todotxt-view':{localView:'all'}}});plugin.registry.register({id:'todotxt',capabilities:{read:true,update:true},list:async()=>[require('../todotxt.cjs').parseTodoLine('(A) Call +Work @phone uid:66666666-6666-4666-8666-666666666666')]});const view=views.get('task2do-todotxt-view')({app:plugin.app});await view.onOpen();assert.match(controls.find(c=>c.text==='Edit').buttonEl.title,/editor/);assert.match(controls.find(c=>c.text==='Publish…').buttonEl.title,/destination mapping/);const descendants=el=>[el,...el.children.flatMap(descendants)],nodes=descendants(view.contentEl);assert.match(nodes.find(n=>n.cls?.includes('task2do-txt-title')).title,/not a direct-edit control/);assert.match(nodes.find(n=>n.text==='Priority A').title,/A is highest/);assert.match(nodes.find(n=>n.tag==='summary').title,/raw todo.txt/);const moovila=views.get('task2do-moovila-view')({app:plugin.app}),offset=controls.length;moovila.toolbar(moovila.contentEl);assert.match(controls.slice(offset).find(c=>c.text==='New task').buttonEl.title,/read-only/);plugin.onunload();});
test('Autotask Tickets is a separate read-only-by-default provider sharing the CRM session',async()=>{const {plugin,commands,views,tabs,controls}=await harness();assert.equal(plugin.settings.autotaskTickets.enableWrites,false);assert.ok(plugin.registry.get('autotask-tickets'));assert.ok(commands.some(c=>c.id==='open-autotask-tickets'&&c.name==='Open Autotask Tickets'));assert.equal(views.get('task2do-autotask-tickets-view')({app:plugin.app}).getDisplayText(),'Task2Do: Autotask Tickets');await assert.rejects(plugin.registry.get('autotask-tickets').list(),/Connect Autotask/);tabs[0].activePane='tickets';tabs[0].display();assert.ok(tabs[0].containerEl.allText().includes('Enable ticket updates'));assert.ok(tabs[0].containerEl.allText().includes('Completed ticket status IDs'));assert.ok(!tabs[0].containerEl.allText().includes('Enable To-Do updates'));const before=plugin.registry.get('autotask-tickets');await controls.find(c=>c.type==='toggle').change(true);assert.equal(plugin.registry.get('autotask-tickets').enableWrites,true);assert.equal(before.disposed,true);assert.equal(plugin.settings.enableWrites,false);plugin.onunload();});
test('ticket panel filters by status, searches ticket numbers and updates the selected status',async()=>{const {plugin,views,controls,modals}=await harness();const writes=[],item={provider:'autotask-tickets',remoteId:'55',ticketNumber:'T20261106.0001',title:'Ticket A',description:'Notes',statusId:'1',statusName:'New',priorityId:'2',priorityName:'Normal',queueName:'Desk',raw:{id:55,queueID:7},completed:false};const provider={id:'autotask-tickets',enableWrites:true,capabilities:{read:true,update:true},list:async()=>[item,{...item,remoteId:'56',ticketNumber:'T20261106.0002',title:'Ticket B',statusId:'9',statusName:'Resolved'}],fields:async()=>[],choices:(_,name)=>name==='status'?[{id:'1',label:'New'},{id:'9',label:'Resolved'}]:[{id:'2',label:'Normal'}],update:async(snapshot,changes)=>writes.push({snapshot,changes})};plugin.registry.register(provider);const view=views.get('task2do-autotask-tickets-view')({app:plugin.app});await view.onOpen();assert.ok(view.contentEl.allText().includes('Ticket A'));assert.ok(view.contentEl.allText().includes('T20261106.0001'));const filter=controls.find(c=>c.type==='dropdown'&&c.options['1']==='New');await filter.change('1');assert.ok(!view.contentEl.allText().includes('Ticket B'));const offset=controls.length;controls.find(c=>c.text==='Update ticket').click();await modals[0].openPromise;const status=controls.slice(offset).find(c=>c.type==='dropdown'&&c.options['9']==='Resolved');status.change('9');await controls.find(c=>c.text==='Save ticket changes').click();assert.equal(writes.length,1);assert.equal(writes[0].changes.status,'9');assert.equal(Object.keys(writes[0].changes).length,1);plugin.onunload();});
test('ticket note UI requires explicit type/visibility and preserves native note display',async()=>{const {plugin,views,controls,modals}=await harness();const item={provider:'autotask-tickets',remoteId:'55',ticketNumber:'T1',title:'Ticket',statusName:'New',statusId:'1',completed:false,raw:{}},submitted=[];const provider={id:'autotask-tickets',enableWrites:true,capabilities:{read:true,update:true},list:async()=>[item],notes:async()=>[{id:77,title:'Existing note',description:'Keep note text',publish:2}],fields:async()=>[],choices:(_,name)=>name==='publish'?[{id:'2',label:'Internal'}]:[{id:'1',label:'General'}],noteState:async()=>null,addNote:async(snapshot,values)=>submitted.push(values)};plugin.registry.register(provider);const view=views.get('task2do-autotask-tickets-view')({app:plugin.app});await view.onOpen();const offset=controls.length;controls.find(c=>c.text==='Ticket notes').click();await modals[0].openPromise;assert.ok(modals[0].contentEl.allText().includes('Existing note'));assert.ok(modals[0].contentEl.allText().includes('Visibility: Internal'));const form=controls.slice(offset),dropdowns=form.filter(c=>c.type==='dropdown');assert.ok(dropdowns.every(c=>Object.keys(c.options).includes('')));assert.ok(dropdowns.every(c=>c.value===undefined));form.find(c=>c.type==='text').change('Update');form.find(c=>c.type==='textarea').change('Some work');dropdowns[0].change('1');dropdowns[1].change('2');await form.find(c=>c.text==='Add ticket note').click();assert.equal(submitted[0].publish,'2');assert.equal(submitted[0].noteType,'1');assert.equal(submitted[0].description,'Some work');plugin.onunload();});
test('connecting from the Tickets panel returns to Tickets while retaining the shared connection form',async()=>{const {plugin,views,controls,modals}=await harness();let ticketOpened=false,crmOpened=false;plugin.connect=async()=>{};plugin.openTicketsView=async()=>ticketOpened=true;plugin.openView=async()=>crmOpened=true;const view=views.get('task2do-autotask-tickets-view')({app:plugin.app});view.toolbar(view.contentEl);const offset=controls.length;controls.find(c=>c.text==='Connect').click();await modals[0].openPromise;await controls.slice(offset).find(c=>c.text==='Connect').click();assert.equal(ticketOpened,true);assert.equal(crmOpened,false);plugin.onunload();});

test('ticket editor preserves due precision for title-only changes and requires description acceptance',async()=>{
 const {plugin,views,controls,modals}=await harness(),writes=[];
 const item={provider:'autotask-tickets',remoteId:'55',title:'Original',description:'Original description',statusId:'1',priorityId:'2',statusName:'New',priorityName:'Normal',due:'2026-11-10T16:30:45.123Z',raw:{id:55,assignedResourceID:123,assignedResourceroleID:8,queueID:7},completed:false};
 const provider={id:'autotask-tickets',enableWrites:true,capabilities:{read:true,update:true},list:async()=>[item],fields:async()=>[],choices:()=>[],update:async(s,c,o)=>writes.push({changes:c,options:o})};plugin.registry.register(provider);
 const view=views.get('task2do-autotask-tickets-view')({app:plugin.app});await view.onOpen();const offset=controls.length;controls.find(c=>c.text==='Update ticket').click();await modals[0].openPromise;
 const added=controls.slice(offset),title=added.find(c=>c.type==='text'&&c.value==='Original');title.change('Renamed');
 await added.find(c=>c.text==='Save ticket changes').click();assert.equal(writes.length,1);assert.deepEqual(Object.keys(writes[0].changes),['title']);
 const offset2=controls.length;controls.find(c=>c.text==='Update ticket').click();await modals[1].openPromise;
 const current=controls.slice(offset2),toggles=current.filter(c=>c.type==='toggle');await toggles[0].change(true);
 const description=controls.find(c=>c.type==='textarea'&&c.value==='Original description');description.change('Replacement');
 await current.find(c=>c.text==='Save ticket changes').click();assert.equal(writes.length,1);assert.ok(modals[1].contentEl.allText().includes('Accept description'));
 controls.filter(c=>c.type==='toggle').at(-1).change(true);await current.find(c=>c.text==='Save ticket changes').click();assert.equal(writes.length,2);assert.equal(writes[1].changes.description,'Replacement');assert.equal(writes[1].options.confirmPlainTextReplacement,true);plugin.onunload();
});
test('ticket editor loads resource roles and queues before submitting reassignment',async()=>{
 const {plugin,views,controls,modals}=await harness(),writes=[];
 const item={provider:'autotask-tickets',remoteId:'55',title:'Ticket',description:'Body',statusId:'1',priorityId:'2',statusName:'New',priorityName:'Normal',raw:{id:55,assignedResourceID:123,assignedResourceroleID:8,queueID:7},completed:false};
 const provider={id:'autotask-tickets',enableWrites:true,capabilities:{read:true,update:true},list:async()=>[item],fields:async()=>[],choices:()=>[],resources:async()=>[{id:'123',label:'Current Person'},{id:'456',label:'New Person'}],assignmentOptions:async()=>({roles:[{id:'8',label:'Engineer'}],queues:[{id:'7',label:'Helpdesk'}]}),update:async(s,c)=>writes.push(c)};plugin.registry.register(provider);
 const view=views.get('task2do-autotask-tickets-view')({app:plugin.app});await view.onOpen();const offset=controls.length;controls.find(c=>c.text==='Update ticket').click();await modals[0].openPromise;
 const added=controls.slice(offset);await added.filter(c=>c.type==='toggle')[1].change(true);
 await controls.find(c=>c.type==='dropdown'&&c.options['456']==='New Person').change('456');
 controls.filter(c=>c.type==='dropdown'&&c.options['8']==='Engineer').at(-1).change('8');controls.filter(c=>c.type==='dropdown'&&c.options['7']==='Helpdesk').at(-1).change('7');
 await added.find(c=>c.text==='Save ticket changes').click();assert.equal(writes.length,1);assert.equal(writes[0].assignedResourceID,'456');assert.equal(Object.keys(writes[0]).length,1);plugin.onunload();
});

test('ticket due editor converts local minutes to UTC without submitting other unchanged fields',async()=>{
 const {plugin,views,controls,modals}=await harness(),writes=[];
 const item={provider:'autotask-tickets',remoteId:'55',title:'Ticket',description:'Body',statusId:'1',priorityId:'2',due:'2026-11-10T16:30:45.123Z',raw:{id:55},completed:false};
 const provider={id:'autotask-tickets',enableWrites:true,capabilities:{read:true,update:true},list:async()=>[item],fields:async()=>[],choices:()=>[],update:async(s,c)=>writes.push(c)};plugin.registry.register(provider);
 const view=views.get('task2do-autotask-tickets-view')({app:plugin.app});await view.onOpen();const offset=controls.length;controls.find(c=>c.text==='Update ticket').click();await modals[0].openPromise;
 const added=controls.slice(offset),calendar=added.find(c=>c.inputEl.type==='datetime-local');assert.equal(calendar.inputEl.step,'60');calendar.change('2026-11-12T09:45');
 await added.find(c=>c.text==='Save ticket changes').click();assert.equal(writes.length,1);assert.equal(writes[0].dueDateTime,new Date(2026,10,12,9,45).toISOString());assert.equal(Object.keys(writes[0]).length,1);plugin.onunload();
});
