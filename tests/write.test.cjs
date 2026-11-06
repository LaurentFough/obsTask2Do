const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutotaskToDoProvider } = require('../core.cjs');
const config = { baseUrl: 'https://webservices4.autotask.net/atservicesrest/v1.0/', resourceId: '123', enableWrites: true };
const credentials = { username: 'test@example.invalid', secret: 'fixture', integrationCode: 'fixture' };
const raw = { id: 9, companyID: 7, assignedToResourceID: 123, activityDescription: 'Review', startDateTime: '2026-10-14T16:00:00Z', endDateTime: '2026-10-14T17:00:00Z', completedDate: null, lastModifiedDate: '2026-10-13T12:00:00Z' };
function setup(overrides = {}, responder = () => ({ status: 200, json: { itemId: 9 } })) {
  const calls = [];
  const p = new AutotaskToDoProvider({ ...config, ...overrides }, credentials, async request => {
    calls.push(request);
    return request.method === 'GET' ? { status: 200, json: { item: { ...raw } } } : responder(request);
  });
  return { p, calls, snapshot: p.normalize(raw) };
}
test('write toggle is enforced before any request', async () => {
  const { p, calls, snapshot } = setup({ enableWrites: false });
  await assert.rejects(p.complete(snapshot), /Enable writes/); assert.equal(calls.length, 0);
});
test('completion uses a minimal child PATCH after a fresh read', async () => {
  const { p, calls, snapshot } = setup();
  assert.deepEqual(await p.complete(snapshot), { remoteId: '9', accepted: true });
  assert.equal(calls[0].url, config.baseUrl + 'CompanyToDos/9');
  assert.equal(calls[1].url, config.baseUrl + 'Companies/7/ToDos');
  assert.equal(calls[1].method, 'PATCH');
  const body = JSON.parse(calls[1].body);
  assert.deepEqual(Object.keys(body).sort(), ['completedDate', 'id']); assert.ok(Number.isFinite(Date.parse(body.completedDate)));
});
test('conflict blocks writes', async () => {
  const { p, calls, snapshot } = setup(); snapshot.modified = 'stale';
  await assert.rejects(p.complete(snapshot), /changed remotely/); assert.equal(calls.length, 1);
});
test('invalid inputs, unsupported fields and backwards schedules are rejected', async () => {
  const { p, calls, snapshot } = setup();
  for (const changes of [{}, { activityDescription: '' }, { completedDate: null }, { assignedToResourceID: '0' }, { startDateTime: 'tomorrow' }]) await assert.rejects(p.update(snapshot, changes));
  assert.equal(calls.length, 0);
  await assert.rejects(p.update(snapshot, { endDateTime: '2026-10-14T15:00:00Z' }), /End time/); assert.equal(calls.length, 1);
});
test('ambiguous network writes and server failures are never retried', async () => {
  for (const responder of [() => { throw new Error('secret remote error'); }, () => ({ status: 500, json: {} })]) {
    const { p, calls, snapshot } = setup({}, responder);
    await assert.rejects(p.complete(snapshot), /refresh before attempting again/);
    assert.equal(calls.filter(c => c.method === 'PATCH').length, 1);
    assert.equal(p.pending.size, 0);
  }
});
test('only changed assignment/schedule fields are transmitted', async () => {
  const { p, calls, snapshot } = setup();
  await p.update(snapshot, { assignedToResourceID: '456', endDateTime: '2026-10-14T11:00:00-07:00' });
  assert.deepEqual(JSON.parse(calls[1].body), { id: 9, assignedToResourceID: 456, endDateTime: '2026-10-14T18:00:00.000Z' });
});
test('unverified write responses require reconciliation', async () => {
  const { p, calls, snapshot } = setup({}, () => ({ status: 200, json: { itemId: 88 } }));
  await assert.rejects(p.complete(snapshot), /not verified/); assert.equal(calls.length, 2);
});
test('concurrent writes to the same item are blocked', async () => {
  let release;
  const wait = new Promise(resolve => release = resolve);
  const p = new AutotaskToDoProvider(config, credentials, async request => {
    if (request.method === 'GET') { await wait; return { status: 200, json: { item: raw } }; }
    return { status: 200, json: { itemId: 9 } };
  });
  const snapshot = p.normalize(raw), first = p.complete(snapshot);
  await assert.rejects(p.complete(snapshot), /already in progress/);
  release(); await first;
});
