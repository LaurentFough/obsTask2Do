const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutotaskToDoProvider, companyIdValue } = require('../core.cjs');
const config = { baseUrl: 'https://webservices4.autotask.net/atservicesrest/v1.0/', resourceId: '123', enableWrites: true };
const credentials = { username: 'fixture', secret: 'fixture', integrationCode: 'fixture' };
const raw = { id: 9, companyID: 7, assignedToResourceID: 123, activityDescription: 'Review', startDateTime: '2026-10-14T16:00:00Z', endDateTime: '2026-10-14T17:00:00Z', completedDate: null, lastModifiedDate: '2026-10-13T12:00:00Z' };
function setup(options = {}) {
  const calls = []; let reads = 0;
  const record = { ...raw, ...options.raw };
  const p = new AutotaskToDoProvider(config, credentials, async request => {
    calls.push(request);
    if (request.url.endsWith('/fields')) return { status: 200, json: { fields: [{ name: 'companyID', isReadOnly: options.readOnly ?? false }] } };
    if (request.url.endsWith('Companies/0')) return { status: 200, json: { item: { id: 0, companyName: 'Internal', isActive: options.active ?? true } } };
    if (request.url.includes('Contacts/')) return { status: 200, json: { item: { id: 20, companyID: options.contactCompany ?? 0, isActive: true } } };
    if (request.url.includes('Tickets/')) return { status: 200, json: { item: { id: 21, companyID: options.ticketCompany ?? 0 } } };
    if (request.url.includes('Contracts/')) return { status: 200, json: { item: { id: 22, companyID: options.contractCompany ?? 0 } } };
    if (request.url.includes('Opportunities/')) return { status: 200, json: { item: { id: 23, companyID: options.opportunityCompany ?? 0 } } };
    if (request.method === 'PATCH') return { status: 200, json: { itemId: 9 } };
    reads++; return { status: 200, json: { item: reads === 1 ? record : { ...record, companyID: options.confirmed === false ? 7 : 0, ...options.readback } } };
  });
  return { p, calls, snapshot: p.normalize(record) };
}
test('company IDs include internal organization zero and reject invalid values', () => {
  assert.equal(companyIdValue('0'), 0); assert.equal(companyIdValue('7'), 7);
  for (const value of [-1, '', null, '7.1', '0abc']) assert.throws(() => companyIdValue(value));
});
test('company move uses one minimal source-parent PATCH and confirms destination', async () => {
  const { p, calls, snapshot } = setup(); const result = await p.changeCompany(snapshot, '0');
  assert.equal(result.verified, true); assert.equal(result.companyId, 0);
  const writes = calls.filter(c => c.method === 'PATCH'); assert.equal(writes.length, 1);
  assert.equal(writes[0].url, config.baseUrl + 'Companies/7/ToDos');
  assert.deepEqual(JSON.parse(writes[0].body), { id: 9, companyID: 0 });
});
test('inactive destination or read-only metadata blocks company changes', async () => {
  for (const options of [{ active: false }, { readOnly: true }]) {
    const { p, calls, snapshot } = setup(options); await assert.rejects(p.changeCompany(snapshot, '0'));
    assert.ok(calls.every(c => c.method !== 'PATCH'));
  }
});
test('every incompatible linked entity blocks reassociation without clearing links', async () => {
  for (const [field, option, label] of [['contactID', 'contactCompany', 'contact'], ['ticketID', 'ticketCompany', 'ticket'], ['contractID', 'contractCompany', 'contract'], ['opportunityID', 'opportunityCompany', 'opportunity']]) {
    const id = { contactID: 20, ticketID: 21, contractID: 22, opportunityID: 23 }[field];
    const { p, calls, snapshot } = setup({ raw: { [field]: id }, [option]: 7 });
    await assert.rejects(p.changeCompany(snapshot, '0'), new RegExp(`Linked ${label}`));
    assert.ok(calls.every(c => c.method !== 'PATCH'));
  }
});
test('unconfirmed company change or altered linked fields never reports success', async () => {
  for (const options of [{ confirmed: false }, { raw: { contactID: 20 }, readback: { contactID: null } }]) {
    const { p, snapshot } = setup(options); await assert.rejects(p.changeCompany(snapshot, '0'), /did not confirm/);
  }
});
test('company search validates input and limits active-name query', async () => {
  const calls = [];
  const p = new AutotaskToDoProvider(config, credentials, async request => { calls.push(request); return { status: 200, json: { items: [{ id: 0, companyName: 'Internal', isActive: true }, { id: 2, companyName: 'Inactive', isActive: false }], pageDetails: { nextPageUrl: config.baseUrl + 'Companies/query?next=2' } } }; });
  await assert.rejects(p.searchCompanies('a')); assert.equal(calls.length, 0);
  const result = await p.searchCompanies('Internal'); assert.equal(result.items[0].id, '0'); assert.equal(result.items.length, 1); assert.equal(result.hasMore, true);
  assert.equal(JSON.parse(calls[0].body).MaxRecords, 50);
});
