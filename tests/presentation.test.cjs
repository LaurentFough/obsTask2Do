const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectTasks, ProviderRegistry } = require('../task-core.cjs');
const items = [{ remoteId: '1', completed: false, due: '2026-10-20T00:00:00Z', description: 'Review', organizationName: 'Acme', assigneeName: 'El' }, { remoteId: '2', completed: true, due: '2026-10-14T00:00:00Z', title: 'Done', listName: 'Work' }, { remoteId: '3', completed: false, description: 'Later' }];
test('status filters and cross-provider text search', () => {
  assert.deepEqual(selectTasks(items).map(i => i.remoteId), ['1', '3']);
  assert.deepEqual(selectTasks(items, { state: 'completed' }).map(i => i.remoteId), ['2']);
  for (const search of ['ACME', 'el', 'review']) assert.equal(selectTasks(items, { state: 'all', search })[0].remoteId, '1');
  assert.equal(selectTasks(items, { state: 'all', search: 'work' })[0].remoteId, '2');
  assert.equal(selectTasks(items, { search: 'missing' }).length, 0);
});
test('due order keeps undated tasks last in both directions without mutating input', () => {
  assert.deepEqual(selectTasks(items, { state: 'all', sort: 'due-asc' }).map(i => i.remoteId), ['2', '1', '3']);
  assert.deepEqual(selectTasks(items, { state: 'all', sort: 'due-desc' }).map(i => i.remoteId), ['1', '2', '3']);
  assert.deepEqual(items.map(i => i.remoteId), ['1', '2', '3']);
});
test('provider registry disposes replaced and removed providers', () => {
  const registry = new ProviderRegistry(); let disposed = 0;
  const provider = { id: 'fixture', capabilities: { read: true }, list() {}, dispose() { disposed++; } };
  registry.register(provider); registry.register({ ...provider }); assert.equal(disposed, 1);
  registry.remove('fixture'); assert.equal(disposed, 2); assert.equal(registry.get('fixture'), undefined);
  assert.throws(() => registry.register({}));
});
test('Autotask personal/delegated scopes are exclusive and All deduplicates task IDs',()=>{
 const {selectAutotaskList}=require('../task-core.cjs');const personal={remoteId:'1',assigneeId:123,creatorId:123};const delegated={remoteId:'2',assigneeId:456,creatorId:123};const api={remoteId:'3',assigneeId:456,creatorId:555};const items=[personal,delegated,api,personal];
 assert.deepEqual(selectAutotaskList(items,'my',123,[123,555]).map(t=>t.remoteId),['1']);assert.deepEqual(selectAutotaskList(items,'delegated',123,[123,555]).map(t=>t.remoteId),['2','3']);assert.equal(selectAutotaskList(items,'all',123,[123,555]).length,3);
});
