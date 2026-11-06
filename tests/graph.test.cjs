const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MicrosoftAuth, MicrosoftToDoProvider, graphConfig, dueValue } = require('../graph.cjs');
const config = { clientId: '11111111-2222-3333-4444-555555555555', tenant: 'common' };
const raw = { id: 'task/1', title: 'Review', body: { content: 'Notes' }, status: 'notStarted', lastModifiedDateTime: '2026-10-14T00:00:00Z', '@odata.etag': 'etag1' };
const list = { id: 'list/1', displayName: 'Work' };
const tokenBody = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, scope: 'Tasks.ReadWrite' };
function provider(transport) { return new MicrosoftToDoProvider({ accessToken: async () => 'fixture-token', dispose() {} }, transport, () => {}, async () => {}); }
test('validate Microsoft configuration and saved tokens', () => {
  assert.deepEqual(graphConfig(config), config);
  assert.throws(() => graphConfig({ ...config, tenant: 'evil.test/path' }));
  assert.throws(() => graphConfig({ ...config, clientId: 'bad' }));
  const auth = new MicrosoftAuth(config, () => {});
  assert.throws(() => auth.restore({ accessToken: 'bad\nheader', expiresAt: 123 }));
});
test('device-code polling handles pending and slow_down; tokens saved without secret logging', async () => {
  let clock = 0, polls = 0; const pauses = [], saved = [], logs = [], requests = [];
  const auth = new MicrosoftAuth(config, async request => {
    requests.push(request);
    if (request.url.endsWith('devicecode')) return { status: 200, json: { device_code: 'device', user_code: 'ABCD', verification_uri: 'https://microsoft.com/devicelogin', interval: 5, expires_in: 900 } };
    polls++; return polls === 1 ? { status: 400, json: { error: 'authorization_pending' } } : polls === 2 ? { status: 400, json: { error: 'slow_down' } } : { status: 200, json: tokenBody };
  }, async tokens => saved.push(tokens), entry => logs.push(entry), async ms => { pauses.push(ms); clock += ms; }, () => clock);
  const device = await auth.begin(); await auth.poll(device);
  assert.deepEqual(pauses, [5000, 5000, 10000]); assert.equal(saved.length, 1);
  assert.ok(new URLSearchParams(requests[0].body).get('scope').includes('Tasks.ReadWrite'));
  assert.ok(!JSON.stringify(logs).includes('fixture-access')); assert.equal(await auth.accessToken(), 'fixture-access');
});
test('cancelled sign-in never persists tokens', async () => {
  let cancelled = false, saves = 0;
  const auth = new MicrosoftAuth(config, async () => ({ status: 200, json: tokenBody }), async () => saves++, () => {}, async () => { cancelled = true; });
  await assert.rejects(auth.poll({ deviceCode: 'device', interval: 5, expiresAt: Date.now() + 60000 }, () => cancelled), /cancelled/);
  assert.equal(saves, 0);
});
test('refresh uses one shared refresh request and saves rotated tokens', async () => {
  let calls = 0, saves = 0;
  const auth = new MicrosoftAuth(config, async request => {
    calls++; assert.equal(new URLSearchParams(request.body).get('grant_type'), 'refresh_token');
    return { status: 200, json: { ...tokenBody, refresh_token: 'rotated' } };
  }, async () => saves++);
  auth.restore({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 0 });
  assert.deepEqual(await Promise.all([auth.accessToken(), auth.accessToken()]), ['fixture-access', 'fixture-access']);
  assert.equal(calls, 1); assert.equal(saves, 1); assert.equal(auth.tokens.refreshToken, 'rotated');
});
test('reject unexpected verification URL', async () => {
  const auth = new MicrosoftAuth(config, async () => ({ status: 200, json: { device_code: 'd', user_code: 'u', expires_in: 900, verification_uri: 'https://evil.test/sign-in' } }));
  await assert.rejects(auth.begin(), /Unexpected Microsoft/);
});
test('Graph pagination remains on trusted origin', async () => {
  let calls = 0;
  const p = provider(async () => { calls++; return { status: 200, json: { value: [list], '@odata.nextLink': 'https://evil.test/steal' } }; });
  await assert.rejects(p.destinations(), /unexpected Microsoft Graph URL/); assert.equal(calls, 1);
});
test('list task normalization preserves provider, destination and completion', async () => {
  const p = provider(async request => ({ status: 200, json: { value: request.url.endsWith('/lists') ? [list] : [{ ...raw, status: 'completed', dueDateTime: { dateTime: '2026-10-15T00:00:00.0000000', timeZone: 'UTC' } }] } }));
  const items = await p.list(); assert.equal(items[0].listName, 'Work'); assert.equal(items[0].completed, true); assert.equal(items[0].due, '2026-10-15T00:00:00.000Z');
});
test('Graph creation encodes list ID, validates title and converts timezone to UTC', async () => {
  const calls = []; const p = provider(async request => { calls.push(request); return { status: 201, json: { ...raw, title: 'New' } }; });
  await assert.rejects(p.create(list.id, { title: '' })); assert.equal(calls.length, 0);
  await p.create(list.id, { title: 'New', description: 'From note', due: '2026-10-14T09:00:00-07:00' });
  assert.ok(calls[0].url.includes('list%2F1')); assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].body).dueDateTime, { dateTime: '2026-10-14T16:00:00.000', timeZone: 'UTC' });
});
test('Graph complete and reopen use explicit status with concurrency etag', async () => {
  for (const action of ['complete', 'reopen']) {
    const calls = [], initial = { ...raw, status: action === 'reopen' ? 'completed' : 'notStarted' };
    const p = provider(async request => { calls.push(request); return { status: 200, json: request.method === 'GET' ? initial : { ...initial, status: JSON.parse(request.body).status } }; });
    const snapshot = p.normalize(initial, list); await p[action](snapshot);
    assert.equal(calls[1].headers['If-Match'], 'etag1');
    assert.deepEqual(JSON.parse(calls[1].body), { status: action === 'complete' ? 'completed' : 'notStarted' });
  }
});
test('Graph changed task prevents mutation', async () => {
  let calls = 0; const p = provider(async () => { calls++; return { status: 200, json: { ...raw, title: 'Remote edit' } }; });
  await assert.rejects(p.complete(p.normalize(raw, list)), /changed remotely/); assert.equal(calls, 1);
});
test('Graph writes are never retried after a server failure', async () => {
  let calls = 0; const p = provider(async () => { calls++; return { status: 500, json: {} }; });
  await assert.rejects(p.create(list.id, { title: 'New' }), /Write not retried/); assert.equal(calls, 1);
});
test('Graph conditional update failure requires refresh', async () => {
  let calls = 0; const p = provider(async request => { calls++; return request.method === 'GET' ? { status: 200, json: raw } : { status: 412, json: {} }; });
  await assert.rejects(p.complete(p.normalize(raw, list)), /changed remotely/); assert.equal(calls, 2);
});
test('due dates convert UTC, Pacific and IANA DST; unknown zones stay display-only', () => {
  assert.equal(dueValue({ dateTime: '2026-10-14T09:00:00', timeZone: 'Pacific Standard Time' }), '2026-10-14T16:00:00.000Z');
  assert.equal(dueValue({ dateTime: '2026-12-14T09:00:00', timeZone: 'America/Los_Angeles' }), '2026-12-14T17:00:00.000Z');
  assert.equal(dueValue({ dateTime: '2026-10-14T09:00:00', timeZone: 'Unknown Zone' }), undefined);
});
