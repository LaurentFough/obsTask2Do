'use strict';
/**= Bundle the local provider into main.js without changing source module names. */
const fs = require('node:fs');
const path = require('node:path');
const mainPath = path.join(__dirname, 'main.js');
const core = fs.readFileSync(path.join(__dirname, 'core.cjs'), 'utf8');
const start = '//= BEGIN BUNDLED CORE';
const end = '//= END BUNDLED CORE';
const graph = fs.readFileSync(path.join(__dirname, 'graph.cjs'), 'utf8');
const shared = fs.readFileSync(path.join(__dirname, 'task-core.cjs'), 'utf8');
const wrap = (names, code) => `const { ${names} } = (() => {\nconst module = { exports: {} };\n${code}\nreturn module.exports;\n})();`;
const block = `${start}\n${wrap('AutotaskToDoProvider', core)}\n${wrap('MicrosoftAuth, MicrosoftToDoProvider', graph)}\n${wrap('ProviderRegistry, selectTasks, toCalendarValue, fromCalendarValue, calendarZoneLabel, formatTaskDate, taskUrgency, selectAutotaskList', shared)}\n${wrap('TodoTxtProvider, parseTodoLine, vaultPath, localDay, todoPresentation, todoFields, structuredTodo, selectTodoView', fs.readFileSync(path.join(__dirname, 'todotxt.cjs'), 'utf8'))}\n${wrap('markdownIndex, ownsIndex', fs.readFileSync(path.join(__dirname, 'indexing.cjs'), 'utf8'))}\n${wrap('vaultStorage', fs.readFileSync(path.join(__dirname, 'vault-storage.cjs'), 'utf8'))}\n${wrap('MoovilaProvider', fs.readFileSync(path.join(__dirname, 'moovila.cjs'), 'utf8'))}\n${wrap('OpenProjectProvider', fs.readFileSync(path.join(__dirname, 'openproject.cjs'), 'utf8'))}\n${wrap('desktopHttps', fs.readFileSync(path.join(__dirname, 'desktop-https.cjs'), 'utf8'))}\n${wrap('MicrosoftPlannerProvider', fs.readFileSync(path.join(__dirname, 'planner.cjs'), 'utf8'))}\n${wrap('TaskSyncEngine, localCanonical', fs.readFileSync(path.join(__dirname, 'sync.cjs'), 'utf8'))}\n${wrap('PasswordCredentialVault, credentialSnapshot', fs.readFileSync(path.join(__dirname, 'secrets.cjs'), 'utf8'))}\n${wrap('hintElement, createHintedSetting, taskHint', fs.readFileSync(path.join(__dirname, 'hints.cjs'), 'utf8'))}\n${wrap('AutotaskTicketProvider, ticketStatusIds', fs.readFileSync(path.join(__dirname, 'tickets.cjs'), 'utf8'))}\n${end}`;
let main = fs.readFileSync(mainPath, 'utf8');
const importLine = "const { AutotaskToDoProvider } = require('./core.cjs');";
if (main.includes(start)) {
  const first = main.indexOf(start), last = main.indexOf(end, first);
  if (last < 0) throw new Error('Bundled core end marker missing.');
  main = main.slice(0, first) + block + main.slice(last + end.length);
} else {
  if (!main.includes(importLine)) throw new Error('Provider import marker missing.');
  main = main.replace(importLine, block);
}
fs.writeFileSync(mainPath, main);
console.info('Built main.js with embedded provider.');
