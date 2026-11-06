const { test } = require('node:test'); const assert = require('node:assert/strict');
const { AutotaskToDoProvider } = require('../core.cjs');
const values = { companyID: '7', assignedToResourceID: '123', actionType: '1', activityDescription: 'Review', startDateTime: '2026-10-14T12:00:00Z', endDateTime: '2026-10-14T13:00:00Z' };
function setup(write = true, fail = false) { const calls = []; const p = new AutotaskToDoProvider({ baseUrl: 'https://webservices4.autotask.net/atservicesrest/v1.0/', resourceId: '123', enableWrites: write }, { username: 'fixture', secret: 'fixture', integrationCode: 'fixture' }, async r => {
  calls.push(r); let json;
  if (r.url.endsWith('/fields')) json = { fields: [{name:'actionType',picklistValues:[{value:'1',label:'Call',isActive:true}]}] };
  else if (r.url.endsWith('/Companies/7')) json = { item: {id:7,isActive:true} };
  else if (r.url.endsWith('/Resources/123')) json = { item: {id:123,isActive:true} };
  else if (r.method === 'POST') { if (fail) throw new Error('connection lost'); json = {itemId:9}; }
  else json = {item:{...values,id:9,companyID:7,assignedToResourceID:123,actionType:1}};
  return {status:200,json};
}); return {p,calls}; }
test('Autotask creation verifies destination, user, action and returned task', async () => { const {p,calls}=setup(); const task=await p.create(values); assert.equal(task.remoteId,'9'); const post=calls.find(r=>r.method==='POST'); assert.ok(post.url.endsWith('Companies/7/ToDos')); assert.equal(JSON.parse(post.body).assignedToResourceID,123); });
test('Autotask creation enforces write toggle and valid schedule before requests', async () => { const {p,calls}=setup(false); await assert.rejects(p.create(values),/Enable/); assert.equal(calls.length,0); const active=setup(); await assert.rejects(active.p.create({...values,endDateTime:'2026-10-14T11:00:00Z'}),/End/); assert.equal(active.calls.length,0); });
test('ambiguous creation never retries POST', async () => { const {p,calls}=setup(true,true); await assert.rejects(p.create(values)); assert.equal(calls.filter(r=>r.method==='POST').length,1); });
