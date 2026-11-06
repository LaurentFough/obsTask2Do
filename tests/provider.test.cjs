const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apiBase, positiveId, AutotaskToDoProvider } = require('../core.cjs');
const config = { baseUrl: 'https://webservices4.autotask.net/atservicesrest/v1.0/', resourceId: '123', apiResourceId: '123' };
const credentials = { username: 'test@example.invalid', secret: 'fixture', integrationCode: 'fixture' };
const response = (items, next) => ({ status: 200, json: { items, pageDetails: { nextPageUrl: next } } });
test('reject invalid IDs and credential destinations', () => {
  for (const v of [0, -1, '12abc', '1.1', '9007199254740992']) assert.throws(() => positiveId(v));
  for (const v of ['http://webservices4.autotask.net/atservicesrest/v1.0/', 'https://webservices4.autotask.net.evil.test/atservicesrest/v1.0/', 'https://user:pass@webservices4.autotask.net/atservicesrest/v1.0/']) assert.throws(() => apiBase(v));
});
test('paginate, deduplicate, normalize and filter by assignee', async () => {
  const calls = [];
  const p = new AutotaskToDoProvider(config, credentials, async request => {
    calls.push(request);
    return calls.length === 1 ? response([{ id: 1, activityDescription: 'Review', completedDate: null }], config.baseUrl + 'CompanyToDos/query?next=2') : response([{ id: 1 }, { id: 2, completedDate: '2026-10-13' }]);
  });
  const items = await p.list();
  assert.equal(items.length, 2); assert.equal(items[1].completed, true);
  assert.equal(JSON.parse(calls[0].body).filter[0].value, 123);
  assert.equal(calls[1].method, 'GET'); assert.equal(calls[1].body, undefined);
});
test('reject foreign continuation before credentials leave origin', async () => {
  let count = 0;
  const p = new AutotaskToDoProvider(config, credentials, async () => { count++; return response([], 'https://evil.test/steal'); });
  await assert.rejects(p.list(), /pagination URL/); assert.equal(count, 1);
});
test('bounded retries emit only request status', async () => {
  let count = 0; const logs = [], pauses = [];
  const p = new AutotaskToDoProvider(config, credentials, async () => ++count < 3 ? { status: 429, headers: { 'retry-after': '2' } } : response([]), x => logs.push(x), async ms => pauses.push(ms));
  assert.deepEqual(await p.list(), []); assert.equal(count, 3); assert.deepEqual(pauses, [2000, 2000]);
  assert.ok(!JSON.stringify(logs).includes(credentials.username)); assert.ok(!JSON.stringify(logs).includes(credentials.secret));
});
test('authentication errors are not retried; dispose invalidates provider', async () => {
  let count = 0;
  const p = new AutotaskToDoProvider(config, credentials, async () => { count++; return { status: 401 }; });
  await assert.rejects(p.list(), /HTTP 401/); assert.equal(count, 1);
  p.dispose(); await assert.rejects(p.list(), /session has ended/); assert.equal(count, 1);
});
test('malformed result fails rather than showing incomplete success', async () => {
  const p = new AutotaskToDoProvider(config, credentials, async () => ({ status: 200, json: {} }));
  await assert.rejects(p.list(), /task list/);
});

test('personal listing fetches assigned and created scopes and deduplicates overlap',async()=>{
 const fields=[];const p=new AutotaskToDoProvider(config,credentials,async request=>{const field=JSON.parse(request.body).filter[0].field;fields.push(field);return response(field==='assignedToResourceID'?[{id:1,assignedToResourceID:123,creatorResourceID:456},{id:3,assignedToResourceID:123,creatorResourceID:123}]:[{id:2,assignedToResourceID:456,creatorResourceID:123},{id:3,assignedToResourceID:123,creatorResourceID:123}]);});
 const items=await p.listForUser();assert.deepEqual(fields.sort(),['assignedToResourceID','creatorResourceID'].sort());assert.equal(items.length,3);assert.equal(items.find(t=>t.remoteId==='2').creatorId,123);await assert.rejects(p.list('all'),/Invalid/);
});
test('failure in creator query does not return a misleading partial personal listing',async()=>{
 const p=new AutotaskToDoProvider(config,credentials,async request=>JSON.parse(request.body).filter[0].field==='creatorResourceID'?{status:403}:response([{id:1}]));await assert.rejects(p.listForUser(),/HTTP 403/);
});

test('creator lookup uses independently configured Resource ID',async()=>{
 const queries=[];const p=new AutotaskToDoProvider({...config,creatorResourceId:'789'},credentials,async r=>{queries.push(JSON.parse(r.body).filter[0]);return response([]);});await p.listForUser();assert.ok(queries.some(q=>q.field==='assignedToResourceID'&&q.value===123));assert.ok(queries.some(q=>q.field==='creatorResourceID'&&q.value===789));
});
test('task inspection bypasses list scope but verifies requested ID and remains read-only',async()=>{
 const calls=[];const p=new AutotaskToDoProvider(config,credentials,async r=>{calls.push(r);return{status:200,json:r.url.endsWith('/CompanyToDos/9')?{item:{id:9,assignedToResourceID:456,creatorResourceID:789,completedDate:'2026-10-14'}}:{item:{firstName:'Example',lastName:'User'}}};});const item=await p.inspectTask('9');assert.equal(item.creatorId,789);assert.equal(item.matchesCreated,false);assert.equal(item.matchesAssigned,false);assert.ok(calls.every(r=>r.method==='GET'));assert.equal(item.completed,true);
});
test('creator union resolves API username and fetches API plus actual-user tasks once',async()=>{
 const calls=[];const p=new AutotaskToDoProvider({...config,apiResourceId:'',creatorResourceId:'789'},credentials,async request=>{calls.push(request);const filter=JSON.parse(request.body).filter[0];if(request.url.endsWith('Resources/query'))return response([{id:555,userName:credentials.username}]);return response(filter.field==='assignedToResourceID'?[{id:1,assignedToResourceID:123,creatorResourceID:789}]:filter.value===555?[{id:2,assignedToResourceID:456,creatorResourceID:555}]:[{id:1,assignedToResourceID:123,creatorResourceID:789}]);});
 const items=await p.listForUser();assert.deepEqual(p.creatorResourceIds,[789,555]);assert.equal(items.length,2);assert.equal(items.find(t=>t.remoteId==='2').creatorId,555);const creators=calls.filter(r=>r.url.endsWith('CompanyToDos/query')).map(r=>JSON.parse(r.body).filter[0]).filter(f=>f.field==='creatorResourceID');assert.deepEqual(creators.map(f=>f.value).sort(),[555,789]);await p.listForUser();assert.equal(calls.filter(r=>r.url.endsWith('Resources/query')).length,1);
});
test('API identity lookup fails explicitly on ambiguous resources instead of claiming a complete list',async()=>{
 const p=new AutotaskToDoProvider({...config,apiResourceId:''},credentials,async()=>response([{id:555,userName:credentials.username},{id:666,userName:credentials.username}]));await assert.rejects(p.listForUser(),/one exact resource/);
});
test('explicit API Resource ID bypasses resource discovery and deduplicates identical creator IDs',async()=>{
 const fields=[];const p=new AutotaskToDoProvider({...config,creatorResourceId:'555',apiResourceId:'555'},credentials,async r=>{assert.ok(r.url.endsWith('CompanyToDos/query'));fields.push(JSON.parse(r.body).filter[0]);return response([]);});await p.listForUser();assert.equal(fields.filter(f=>f.field==='creatorResourceID').length,1);assert.deepEqual(p.creatorResourceIds,[555]);
});
