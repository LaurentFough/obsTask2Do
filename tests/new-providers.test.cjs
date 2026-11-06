const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TodoTxtProvider, parseTodoLine, vaultPath } = require('../todotxt.cjs');
const { markdownIndex, ownsIndex } = require('../indexing.cjs');
const { taskUrgency } = require('../task-core.cjs');
const { vaultStorage } = require('../vault-storage.cjs');
function txt(text) { const store = { text, writes: 0, async read() { return this.text; }, async write(next, expected) { assert.equal(this.text, expected); this.text = next; this.writes++; } }; return { p: new TodoTxtProvider('Tasks/todo.txt', store), store }; }
test('todo.txt parses dates, priority, context and extensions without losing text', () => {
  const line = '(A) 2026-10-14 Call client +Work @phone due:2026-10-16 custom:keep'; const t = parseTodoLine(line, 4, 'todo.txt');
  assert.equal(t.priority, 'A'); assert.equal(t.createdDate, '2026-10-14'); assert.equal(t.dueDate, '2026-10-16'); assert.equal(t.rawLine, line); assert.deepEqual(t.projects, ['Work']); assert.deepEqual(t.contexts, ['phone']);
  assert.equal(parseTodoLine('Bad due:2026-02-30').due, undefined);
});
test('completion and reopening preserve BOM, blank lines, CRLF and priority', async () => {
  const original = '\ufeff(A) 2026-10-14 Task +P custom:keep\r\n\r\nOther\n'; const { p, store } = txt(original);
  const [first] = await p.list(); const identified=store.text;await p.complete(first); assert.ok(store.text.startsWith('\ufeffx ')); assert.match(store.text,/\r\n\r\nOther uid:[^\r\n]+\n$/); assert.ok(store.text.includes('pri:A'));
  await p.reopen((await p.list())[0]); assert.equal(store.text, identified);
});
test('stale snapshots block todo.txt writes, including moved lines', async () => {
  const { p, store } = txt('Task\n'); const [item] = await p.list(); const beforeWrites=store.writes;store.text = 'External\n'+item.rawLine+'\n';
  await assert.rejects(p.update(item, { line: 'Replacement uid:'+item.remoteId }), /changed/); assert.equal(store.writes, beforeWrites);
});
test('todo.txt creates serialize and append without replacing existing content', async () => {
  const { p, store } = txt('Original\r\n'); await Promise.all([p.create({ line: 'First' }), p.create({ line: 'Second' })]); assert.equal(store.text.replace(/ uid:[^\r\n ]+/g,''),'Original\r\nFirst\r\nSecond\r\n');
  assert.throws(() => p.create({ line: 'two\nlines' }), /one non-empty/);
});
test('vault paths cannot escape or target configuration directories', () => { for (const p of ['../todo.txt', '/todo.txt', '.obsidian/todo.txt', 'x\\todo.txt', 'folder//todo.txt']) assert.throws(() => vaultPath(p, '.txt')); assert.equal(vaultPath('Tasks/todo.txt', '.txt'), 'Tasks/todo.txt'); });
test('Markdown indexes have Tasks checkboxes, Dataview fields, due dates and ownership', () => {
  const note = markdownIndex('todotxt', [{ title: 'Call\nclient', remoteId: '1', dueDate: '2026-10-16', source: 'todo.txt', completed: false }], '2026-10-14');
  assert.ok(ownsIndex(note)); assert.ok(note.includes('- [ ] #task Call client 📅 2026-10-16 [provider:: todotxt]')); assert.ok(note.includes('[source_file:: todo.txt]')); assert.equal(ownsIndex('---\ntitle: ordinary\n---\n'), false);
});
test('urgency distinguishes overdue, today, three days, a week, later and completed', () => {
  const now = new Date(2026,9,14,12).getTime(); const at = n => new Date(2026,9,14+n,18).toISOString();
  for (const [n,kind] of [[-1,'overdue'],[0,'today'],[3,'urgent'],[7,'upcoming'],[8,'later']]) assert.equal(taskUrgency({due:at(n)},now).kind,kind);
  assert.equal(taskUrgency({completed:true,due:at(-1)},now).kind,'completed'); assert.equal(taskUrgency({},now).kind,'undated');
});
test('Vault.process protects against intervening file edits', async () => {
  let current = 'external'; const vault = { getAbstractFileByPath: () => ({}), async process(file, fn) { current = fn(current); } };
  await assert.rejects(vaultStorage(vault,'todo.txt').write('new','original'),/changed/); assert.equal(current,'external');
});

test('todo.txt presentation preserves URLs and exposes unknown and duplicate extension fields', () => {
  const {todoPresentation}=require('../todotxt.cjs');
  const raw='Review https://example.invalid/item +Work @desk companyName:Client%20One resourceName:Alex_Example custom:first custom:second';
  const item=parseTodoLine(raw), shown=todoPresentation(item);
  assert.equal(shown.title,'Review https://example.invalid/item'); assert.equal(shown.company,'Client One'); assert.equal(shown.assignee,'Alex Example'); assert.equal(shown.fields.filter(f=>f.key==='custom').length,2); assert.equal(item.rawLine,raw);
  assert.equal(todoPresentation(parseTodoLine('companyID:7 assignedToResourceID:123')).title,'(Untitled task)');
});
