const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutotaskToDoProvider } = require('../core.cjs');
const config = { baseUrl: 'https://webservices4.autotask.net/atservicesrest/v1.0/', resourceId: '123', enableWrites: true };
const credentials = { username: 'fixture', secret: 'fixture', integrationCode: 'fixture' };
const raw = { id: 9, companyID: 7, assignedToResourceID: 123, activityDescription: 'Review', startDateTime: '2026-10-14T16:00:00Z', endDateTime: '2026-10-14T17:00:00Z', completedDate: '2026-10-14T17:00:00Z', lastModifiedDate: '2026-10-14T17:00:00Z' };
test('organization and resource names are cached and ID failures degrade gracefully', async () => {
  let calls = 0;
  const p = new AutotaskToDoProvider(config, credentials, async request => {
    calls++; return request.url.includes('Companies') ? { status: 200, json: { item: { id: 7, companyName: 'Acme' } } } : { status: 200, json: { item: { id: 123, firstName: 'LaurentFough', lastName: 'Example' } } };
  });
  const enriched = await p.enrich([p.normalize(raw)]);
  assert.equal(enriched[0].organizationName, 'Acme'); assert.equal(enriched[0].assigneeName, 'LaurentFough Example');
  await p.enrich([p.normalize(raw)]); assert.equal(calls, 2);
  const blocked = new AutotaskToDoProvider(config, credentials, async () => ({ status: 403 }));
  const fallback = await blocked.enrich([blocked.normalize(raw)]);
  assert.equal(fallback[0].organizationName, 'Organization #7'); assert.equal(fallback[0].assigneeName, 'Resource #123');
});
function reopenFixture(field, completedAfter = null) {
  const calls = []; let reads = 0;
  const p = new AutotaskToDoProvider(config, credentials, async request => {
    calls.push(request);
    if (request.url.endsWith('/fields')) return { status: 200, json: { fields: [field] } };
    if (request.method === 'PATCH') return { status: 200, json: { itemId: 9 } };
    reads++; return { status: 200, json: { item: { ...raw, completedDate: reads === 1 ? raw.completedDate : completedAfter } } };
  });
  return { p, calls, snapshot: p.normalize(raw) };
}
test('reopen checks field metadata, sends only null completion and verifies readback', async () => {
  const { p, calls, snapshot } = reopenFixture({ name: 'completedDate', isReadOnly: false, isRequired: false });
  assert.equal((await p.reopen(snapshot)).verified, true);
  assert.deepEqual(JSON.parse(calls.find(c => c.method === 'PATCH').body), { id: 9, completedDate: null });
  assert.equal(calls.length, 4);
});
test('read-only or absent completion metadata blocks reopening', async () => {
  for (const field of [{ name: 'completedDate', isReadOnly: true, isRequired: false }, { name: 'other' }, { name: 'completedDate', isReadOnly: false, isRequired: true }]) {
    const { p, calls, snapshot } = reopenFixture(field); await assert.rejects(p.reopen(snapshot), /unavailable/);
    assert.ok(calls.every(c => c.method !== 'PATCH'));
  }
});
test('accepted null clearing that leaves item complete does not report success', async () => {
  const { p, snapshot } = reopenFixture({ name: 'completedDate', isReadOnly: false, isRequired: false }, raw.completedDate);
  await assert.rejects(p.reopen(snapshot), /did not confirm/);
});
test('resource selector paginates active named users, excludes API licenses and distinguishes duplicate names', async () => {
  const calls = [];
  const p = new AutotaskToDoProvider(config, credentials, async request => {
    calls.push(request);
    if (request.url.endsWith('/fields')) return { status: 200, json: { fields: [{ name: 'licenseType', picklistValues: [{ value: '99', label: 'API User (system)' }] }] } };
    if (request.method === 'POST') return { status: 200, json: { items: [{ id: 2, firstName: 'LaurentFough', lastName: 'Example', isActive: true, licenseType: 1 }, { id: 3, firstName: 'API', lastName: 'Account', isActive: true, licenseType: 99 }, { id: 4, firstName: 'Inactive', lastName: 'User', isActive: false, licenseType: 1 }], pageDetails: { nextPageUrl: config.baseUrl + 'Resources/query?page=2' } } };
    return { status: 200, json: { items: [{ id: 5, firstName: 'LaurentFough', lastName: 'Example', isActive: true, licenseType: 1 }, { id: 6, firstName: 'Alice', lastName: 'Smith', isActive: true, licenseType: 1 }] } };
  });
  const users = await p.listResources();
  assert.deepEqual(users.map(u => u.label), ['Alice Smith', 'LaurentFough Example (#2)', 'LaurentFough Example (#5)']);
  assert.equal(JSON.parse(calls[1].body).filter[0].field, 'isActive'); assert.equal(calls[2].method, 'GET');
});
