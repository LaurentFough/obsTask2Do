const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const {AutotaskTicketProvider,ticketStatusIds}=require('../tickets.cjs');
const choices=(name,values)=>({name,isReadOnly:false,picklistValues:values.map(([value,label])=>({value:String(value),label,isActive:true}))});
const fields=[choices('status',[[1,'New'],[9,'Resolved']]),choices('priority',[[1,'Urgent'],[2,'Normal']]),choices('queueID',[[7,'Service Desk']])];
const noteFields=[{name:'title',isReadOnly:false,length:250},{name:'description',isReadOnly:false,length:32000},choices('noteType',[[1,'General']]),choices('publish',[[2,'Internal'],[1,'All']])];
function fixture(config={enableWrites:true,closedStatusIds:'9'}){let raw={id:55,ticketNumber:'T20261106.0001',companyID:7,assignedResourceID:123,creatorResourceID:456,title:'Customer issue',description:'Existing rich text',status:1,priority:2,queueID:7,lastActivityDate:'2026-11-06T10:00:00Z'},notes=[],journalText='';const calls=[];const source={base:'https://webservices4.autotask.net/atservicesrest/v1.0/',resourceId:123,credentials:{username:'fixture',secret:'hidden'},resolveName:async(entity,id)=>entity==='Companies'?'Client':'LaurentFough Example',request:async(url,method,body,readOnly)=>{const path=new URL(url).pathname.split('/v1.0/')[1];calls.push({path,method,body,readOnly});if(path==='Tickets/entityInformation/fields')return{fields};if(path==='TicketNotes/entityInformation/fields')return{fields:noteFields};if(path==='Tickets/query')return{items:[{...raw}]};if(path==='Tickets/55')return{item:{...raw}};if(path==='Tickets'&&method==='PATCH'){raw={...raw,...body};return{itemId:55};}if(path==='TicketNotes/query')return{items:notes.map(n=>({...n}))};if(path==='Tickets/55/Notes'){const note={...body,id:77};notes.push(note);return{itemId:77};}if(path==='TicketNotes/77')return{item:{...notes[0]}};throw Error('Unexpected '+path);}};let current=source;const journal={read:async()=>journalText,write:async(next,expected)=>{assert.equal(journalText,expected);journalText=next;}};const digest=text=>crypto.createHash('sha256').update(text).digest('hex'),provider=new AutotaskTicketProvider(()=>current,config,journal,digest);return{provider,source,calls,journal,digest,get raw(){return raw;},set raw(v){raw=v;},get notes(){return notes;},get journalText(){return journalText;},set current(v){current=v;}};}
test('tickets list queries primary assignments and resolves names with runtime labels',async()=>{const f=fixture();const [ticket]=await f.provider.list();assert.equal(ticket.ticketNumber,'T20261106.0001');assert.equal(ticket.organizationName,'Client');assert.equal(ticket.assigneeName,'LaurentFough Example');assert.equal(ticket.statusName,'New');assert.equal(ticket.priorityName,'Normal');assert.equal(ticket.queueName,'Service Desk');assert.equal(ticket.completed,false);const query=f.calls.find(c=>c.path==='Tickets/query');assert.deepEqual(query.body.filter,[{op:'eq',field:'assignedResourceID',value:123}]);assert.equal(query.readOnly,true);});
test('ticket status update patches only changed fields and confirms readback',async()=>{const f=fixture(),ticket=await f.provider.get(55);await f.provider.update(ticket,{status:'9'});const patch=f.calls.find(c=>c.method==='PATCH');assert.deepEqual(patch.body,{id:55,status:9});assert.equal(patch.path,'Tickets');assert.equal(patch.readOnly,false);assert.equal(f.raw.description,'Existing rich text');assert.equal((await f.provider.get(55)).completed,true);});
test('read-only tickets, unknown fields and inactive status choices cannot write',async()=>{const f=fixture({enableWrites:false});await assert.rejects(f.provider.update({remoteId:'55'},{status:9}),/Enable ticket/);assert.equal(f.calls.length,0);const enabled=fixture(),ticket=await enabled.provider.get(55);await assert.rejects(enabled.provider.update(ticket,{resolution:'Overwrite'}),/Unsupported ticket edit/);await assert.rejects(enabled.provider.update(ticket,{status:500}),/active, writable/);assert.ok(!enabled.calls.some(c=>c.method==='PATCH'));});
test('stale ticket, connection replacement and failed verification block unsafe edits',async()=>{const f=fixture(),ticket=await f.provider.get(55);f.raw={...f.raw,title:'Changed elsewhere'};await assert.rejects(f.provider.update(ticket,{priority:1}),/changed remotely/);assert.ok(!f.calls.some(c=>c.method==='PATCH'));f.current=null;await assert.rejects(f.provider.list(),/Connect Autotask/);const g=fixture(),before=await g.provider.get(55),request=g.source.request;g.source.request=async(...args)=>{if(args[1]==='PATCH')return{itemId:55};return request(...args);};await assert.rejects(g.provider.update(before,{priority:1}),/readback differs/);});
test('ticket provider rejects foreign or unrelated pagination before shared transport',async()=>{const f=fixture();await assert.rejects(f.provider.request('https://example.invalid/Tickets/query'),/unexpected/);await assert.rejects(f.provider.request('Companies/7'),/unexpected/);await assert.rejects(f.provider.request('Tickets/55/Notes','DELETE',undefined,false),/Unsupported/);assert.equal(f.calls.length,0);});
test('pagination traverses all ticket pages and rejects cycles and incomplete identity',async()=>{const f=fixture(),request=f.source.request;f.source.request=async(url,...args)=>{if(url.includes('Tickets/query'))return url.includes('page=2')?{items:[{...f.raw,id:56,ticketNumber:'T2'}]}:{items:[f.raw],pageDetails:{nextPageUrl:f.source.base+'Tickets/query?page=2'}};return request(url,...args);};assert.equal((await f.provider.list()).length,2);f.source.request=async(url,...args)=>url.includes('Tickets/query')?{items:[f.raw],pageDetails:{nextPageUrl:f.source.base+'Tickets/query'}}:request(url,...args);await assert.rejects(f.provider.list(),/Repeated ticket pagination/);});
const noteValues={title:'Work performed',description:'Checked the service',noteType:'1',publish:'2'};
test('ticket notes require explicit visibility and are created on the ticket child collection',async()=>{const f=fixture(),ticket=await f.provider.get(55);await assert.rejects(f.provider.addNote(ticket,{...noteValues,publish:''}),/Explicitly choose/);assert.equal(f.notes.length,0);const note=await f.provider.addNote(ticket,noteValues);assert.equal(note.id,77);const post=f.calls.find(c=>c.path==='Tickets/55/Notes');assert.equal(post.readOnly,false);assert.deepEqual(post.body,{ticketID:55,title:noteValues.title,description:noteValues.description,noteType:1,publish:2});assert.equal((await f.provider.noteState(55)).status,'verified');assert.ok(!f.journalText.includes(noteValues.description));assert.equal((await f.provider.notes(55)).length,1);});
test('uncertain accepted note persists intent across restart and reconciles without another POST',async()=>{const f=fixture(),ticket=await f.provider.get(55),request=f.source.request;let posts=0;f.source.request=async(...args)=>{const result=await request(...args);if(args[0].endsWith('/Notes')&&args[1]==='POST'){posts++;throw Error('response lost');}return result;};await assert.rejects(f.provider.addNote(ticket,noteValues),/response lost/);assert.equal((await f.provider.noteState(55)).status,'needs-review');const restarted=new AutotaskTicketProvider(()=>f.source,{enableWrites:true},f.journal,f.digest);await assert.rejects(restarted.addNote(ticket,noteValues),/reconciliation/);assert.equal(posts,1);await restarted.reconcileNote(55,77);assert.equal((await restarted.noteState(55)).status,'verified');assert.equal(posts,1);});
test('notes from another ticket, mismatched note bodies and broken journals cannot reconcile or create',async()=>{const f=fixture(),ticket=await f.provider.get(55),request=f.source.request;f.source.request=async(...args)=>{const result=await request(...args);if(args[0].endsWith('/Notes')&&args[1]==='POST')throw Error('lost');return result;};await assert.rejects(f.provider.addNote(ticket,noteValues));f.notes[0].ticketID=99;await assert.rejects(f.provider.reconcileNote(55,77),/does not match/);f.notes[0].ticketID=55;f.notes[0].description='Different';await assert.rejects(f.provider.reconcileNote(55,77),/does not match/);const broken=new AutotaskTicketProvider(()=>f.source,{enableWrites:true},{read:async()=>'{invalid',write:async()=>{throw Error('not expected');}},f.digest);await assert.rejects(broken.addNote(ticket,noteValues),/not valid JSON/);});
test('completion classification uses configured IDs or completion date, never an English label guess',()=>{const f=fixture({closedStatusIds:'9'});assert.equal(f.provider.normalize({...f.raw,status:9},fields).completed,true);assert.equal(f.provider.normalize({...f.raw,status:1,completedDate:'2026-11-06'},fields).completed,false);const fallback=fixture({closedStatusIds:''});assert.equal(fallback.provider.normalize({...fallback.raw,status:9},fields).completed,false);assert.deepEqual(ticketStatusIds('9,10 9'),['9','10']);assert.throws(()=>ticketStatusIds('abc'),/numeric/);});
test('failed journal save prevents POST and readback mismatches preserve the accepted note ID',async()=>{const f=fixture(),ticket=await f.provider.get(55);const blocked=new AutotaskTicketProvider(()=>f.source,{enableWrites:true},{read:async()=>'',write:async()=>{throw Error('disk full');}},f.digest);await assert.rejects(blocked.addNote(ticket,noteValues),/disk full/);assert.ok(!f.calls.some(c=>c.path.endsWith('/Notes')&&c.method==='POST'));const request=f.source.request;f.source.request=async(...args)=>{const result=await request(...args);if(args[0].endsWith('TicketNotes/77'))result.item.description='Server changed the note';return result;};await assert.rejects(f.provider.addNote(ticket,noteValues),/readback differs/);assert.equal((await f.provider.noteState(55)).noteID,77);assert.equal((await f.provider.noteState(55)).status,'needs-review');});
test('the ticket adapter does not dispose shared credentials, and invalid saved status configuration is rejected',async()=>{const f=fixture();f.provider.dispose();assert.equal(f.source.credentials.username,'fixture');await assert.rejects(f.provider.list(),/Connect Autotask/);assert.throws(()=>new AutotaskTicketProvider(()=>f.source,{closedStatusIds:'not-an-id'}),/numeric/);});

/**= Live catalogs are simulated separately from the shared transport and write journal. */
function editingFixture(){
 const f=fixture(),original=f.source.request;
 const metadata=[...fields,{name:'title',isReadOnly:false,length:255},{name:'description',isReadOnly:false,length:8000},{name:'dueDateTime',isReadOnly:false},{name:'assignedResourceID',isReadOnly:false},{name:'assignedResourceroleID',isReadOnly:false}];
 const catalog={users:[{id:'123',label:'Existing User'},{id:'456',label:'Another User'}],roles:[{id:81,resourceID:456,roleID:8,isActive:true}],queues:[{id:82,resourceID:456,queueID:7}],role:{id:8,name:'Support Engineer',isActive:true},secondary:[]};
 f.raw={...f.raw,assignedResourceroleID:8,dueDateTime:'2026-11-10T16:30:45.123Z'};
 f.source.listResources=async()=>catalog.users;
 f.source.request=async(url,method,body,readOnly)=>{
  const p=new URL(url).pathname.split('/v1.0/')[1];
  if(p==='Tickets/entityInformation/fields')return{fields:metadata};
  const rows={'ResourceRoleQueues/query':catalog.queues,'ResourceServiceDeskRoles/query':catalog.roles,'TicketSecondaryResources/query':catalog.secondary};
  if(rows[p]){f.calls.push({path:p,method,body,readOnly});return{items:rows[p]};}
  if(p==='Roles/8')return{item:catalog.role};
  return original(url,method,body,readOnly);
 };
 return Object.assign(f,{catalog,metadata});
}
test('ticket title/date updates are minimal and retain unchanged rich text and schedule precision',async()=>{
 const f=editingFixture(),snapshot=await f.provider.get(55);
 await f.provider.update(snapshot,{title:'Renamed ticket'});
 assert.deepEqual(f.calls.find(c=>c.method==='PATCH').body,{id:55,title:'Renamed ticket'});
 assert.equal(f.raw.description,'Existing rich text');assert.equal(f.raw.dueDateTime,'2026-11-10T16:30:45.123Z');
 await f.provider.update(await f.provider.get(55),{dueDateTime:'2026-11-11T17:45:00Z'});
 assert.equal(f.raw.dueDateTime,'2026-11-11T17:45:00.000Z');
});
test('ticket description replacement requires explicit confirmation and respects metadata length',async()=>{
 const f=editingFixture(),snapshot=await f.provider.get(55);
 await assert.rejects(f.provider.update(snapshot,{description:'Replacement'}),/Confirm plain-text/);
 assert.ok(!f.calls.some(c=>c.method==='PATCH'));
 await f.provider.update(snapshot,{description:'Replacement'},{confirmPlainTextReplacement:true});assert.equal(f.raw.description,'Replacement');
 await assert.rejects(f.provider.update(await f.provider.get(55),{description:'x'.repeat(8001)},{confirmPlainTextReplacement:true}),/valid ticket description/);
});
test('ticket editing rejects invalid dates, empty titles and read-only metadata without PATCH',async()=>{
 const f=editingFixture(),snapshot=await f.provider.get(55);
 for(const due of ['','2026-02-30T12:00:00Z','2026-11-11T10:00','junk'])await assert.rejects(f.provider.update(snapshot,{dueDateTime:due}),/valid UTC/);
 await assert.rejects(f.provider.update(snapshot,{title:'   '}),/valid ticket title/);
 f.metadata.find(v=>v.name==='title').isReadOnly=true;await assert.rejects(f.provider.update(snapshot,{title:'No'}),/not writable/);
 assert.ok(!f.calls.some(c=>c.method==='PATCH'));
});
test('ticket reassignment verifies active resource, service desk role, queue and secondary scope',async()=>{
 const f=editingFixture(),snapshot=await f.provider.get(55);
 const choices=await f.provider.assignmentOptions(456);assert.deepEqual(choices,{roles:[{id:'8',label:'Support Engineer'}],queues:[{id:'7',label:'Service Desk',parentValue:''}]});
 await f.provider.update(snapshot,{assignedResourceID:'456'});
 assert.deepEqual(f.calls.find(c=>c.method==='PATCH').body,{id:55,assignedResourceID:456});
 assert.equal(f.calls.find(c=>c.path==='TicketSecondaryResources/query').body.filter[0].value,55);
});
test('invalid assignment relationships never write or remove a secondary resource',async()=>{
 for(const scenario of ['resource','role','queue','secondary','wrongScope']){
  const f=editingFixture(),snapshot=await f.provider.get(55);
  if(scenario==='resource')f.catalog.users=[];
  if(scenario==='role')f.catalog.role.isActive=false;
  if(scenario==='queue')f.catalog.queues=[];
  if(scenario==='secondary')f.catalog.secondary.push({id:99,ticketID:55,resourceID:456});
  if(scenario==='wrongScope')f.catalog.roles[0].resourceID=999;
  await assert.rejects(f.provider.update(snapshot,{assignedResourceID:456}));assert.ok(!f.calls.some(c=>c.method==='PATCH'||c.method==='DELETE'));
 }
});
test('reassignment rechecks ticket after catalog lookups and refuses new remote edits',async()=>{
 const f=editingFixture(),snapshot=await f.provider.get(55);f.source.listResources=async()=>{f.raw={...f.raw,title:'External edit'};return f.catalog.users;};
 await assert.rejects(f.provider.update(snapshot,{assignedResourceID:456}),/changed remotely/);assert.ok(!f.calls.some(c=>c.method==='PATCH'));
});
test('ticket edits never retry uncertain writes and compare string readback exactly',async()=>{
 const f=editingFixture(),snapshot=await f.provider.get(55),request=f.source.request;let patches=0;
 f.source.request=async(...args)=>{if(args[1]==='PATCH'){patches++;throw Error('Connection lost');}return request(...args);};
 await assert.rejects(f.provider.update(snapshot,{title:'New'}),/Connection lost/);assert.equal(patches,1);
 f.source.request=async(...args)=>{if(args[1]==='PATCH')return{itemId:55};return request(...args);};
 await assert.rejects(f.provider.update(snapshot,{title:'New'}),/readback differs/);
});

test('ticket assignment selection queries each selected primary resource and preserves default Me',async()=>{
 const f=fixture(),original=f.source.request;f.source.listResources=async()=>[{id:'123',label:'Me'},{id:'456',label:'Colleague'}];
 f.source.request=async(url,method,body,readOnly)=>{if(url.endsWith('Tickets/query')){f.calls.push({path:'Tickets/query',method,body,readOnly});const id=body.filter[0].value;return{items:[{...f.raw,id:id===123?55:56,assignedResourceID:id}]};}return original(url,method,body,readOnly);};
 assert.equal((await f.provider.list()).length,1);f.calls.length=0;
 const tickets=await f.provider.list(['123','456','456']);assert.deepEqual(tickets.map(t=>t.remoteId),['55','56']);
 assert.deepEqual(f.calls.filter(c=>c.path==='Tickets/query').map(c=>c.body.filter[0].value),[123,456]);assert.ok(!f.calls.some(c=>!c.readOnly));
});
test('empty, malformed, oversized or unavailable assignee selections never broaden ticket queries',async()=>{
 const f=fixture();f.source.listResources=async()=>[{id:'123'}];
 for(const ids of [[],[''],['123 OR 1=1'],['456'],Array(51).fill('123')])await assert.rejects(f.provider.list(ids));
 assert.ok(!f.calls.some(c=>c.path==='Tickets/query'));
});
test('custom ticket queries reject tickets outside each requested assignee scope',async()=>{
 const f=fixture();f.source.listResources=async()=>[{id:'456'}];await assert.rejects(f.provider.list(['456']),/outside the selected primary assignment/);
});

test('documented ticket query/next pagination works for selected users and preserves origin restrictions',async()=>{
 const f=fixture(),original=f.source.request;f.source.listResources=async()=>[{id:'123'},{id:'456'}];let current=123;
 f.source.request=async(url,method,body,readOnly)=>{const p=new URL(url).pathname.split('/v1.0/')[1];if(p==='Tickets/query'){current=body.filter[0].value;return{items:[{...f.raw,id:current,assignedResourceID:current}],pageDetails:{nextPageUrl:f.source.base+'Tickets/query/next?paging=opaque'}};}if(p==='Tickets/query/next'){assert.equal(method,'POST');assert.equal(body.MaxRecords,500);assert.equal(body.filter[0].value,current);return{items:[{...f.raw,id:current+1000,assignedResourceID:current}]};}return original(url,method,body,readOnly);};
 assert.deepEqual((await f.provider.list(['123','456'])).map(t=>t.remoteId),['123','1123','456','1456']);
 await assert.rejects(f.provider.request('https://foreign.invalid/atservicesrest/v1.0/Tickets/query/next'),/Rejected/);
});
test('ticket collection pagination cannot switch to another allowlisted entity',async()=>{
 const f=fixture(),original=f.source.request;f.source.request=async(url,...args)=>url.endsWith('Tickets/query')?{items:[],pageDetails:{nextPageUrl:f.source.base+'TicketNotes/query/next'}}:original(url,...args);
 await assert.rejects(f.provider.list(),/pagination path/);
});
function groupFixture(){
 const f=fixture(),original=f.source.request,catalog={members:[{id:11,departmentID:2,queueID:7,resourceID:123,isActive:true},{id:12,departmentID:2,queueID:7,resourceID:123,isActive:true},{id:13,departmentID:2,queueID:7,resourceID:456,isActive:true}]};
 f.source.listResources=async()=>[{id:'123',label:'First User'},{id:'456',label:'Second User'}];
 f.source.request=async(url,method,body,readOnly)=>{const p=new URL(url).pathname.split('/v1.0/')[1];if(p==='Departments/query')return{items:[{id:2,name:'Engineering'}]};if(['ResourceRoleDepartments/query','ResourceRoleQueues/query'].includes(p))return{items:catalog.members};if(p==='Tickets/query')return{items:[{...f.raw,id:body.filter[0].value,assignedResourceID:body.filter[0].value}]};return original(url,method,body,readOnly);};return Object.assign(f,{catalog});
}
test('native departments and queues resolve deduplicated current members before querying tickets',async()=>{
 const f=groupFixture();assert.ok((await f.provider.groups()).some(g=>g.id==='department:2'&&g.label==='Department: Engineering'));
 assert.deepEqual((await f.provider.groupMembers('department:2')).map(u=>u.id),['123','456']);assert.equal((await f.provider.listGroup('queue:7')).length,2);
 f.catalog.members=f.catalog.members.filter(m=>m.resourceID===123);assert.equal((await f.provider.listGroup('department:2')).length,1);
 f.catalog.members=[];assert.deepEqual(await f.provider.listGroup('department:2'),[]);
});
test('native group filters reject invalid groups and wrong-scope memberships',async()=>{
 const f=groupFixture();await assert.rejects(f.provider.listGroup('department:999'),/no longer available/);await assert.rejects(f.provider.listGroup('anything:2'),/Choose/);
 f.catalog.members[0].departmentID=3;await assert.rejects(f.provider.listGroup('department:2'),/outside the selected group/);
});
