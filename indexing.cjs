'use strict';
/**= Version 0.8.0-alpha.2. Searchable Markdown snapshots; never write remote tasks back. */
function plain(value) { return String(value || '').replace(/[\r\n]+/g, ' ').replace(/[\[\]<>]/g, '').replace(/\s+/g, ' ').trim(); }
function markdownIndex(provider, items, day) {
  const lines = ['---', `title: ${JSON.stringify('Task2Do — ' + provider)}`, 'description: Task2Do generated task index', `slug: task2do-${provider}`, 'author: LaurentFough', 'type: task-index', `date-created: ${day}`, `date-modified: ${day}`, 'date-published: null', `source: ${JSON.stringify(provider)}`, 'domain: tasks', 'url: null', 'draft: false', 'tags: [task2do, tasks]', 'keywords: [task-index]', 'task2do-owned: true', '---', '', '# Task2Do tasks', '', '> Generated snapshot. Edit tasks in Task2Do or their source. Checkbox changes here do not update the source and are overwritten on refresh.', ''];
  for (const item of items) {
    const title = plain(item.title || item.description || 'Task #' + item.remoteId).replace(/(^|\s)#task(?=\s|$)/g, '$1').slice(0, 1000);
    const due = item.dueDate || (item.due && Number.isFinite(Date.parse(item.due)) ? (() => { const date = new Date(item.due), pad = n => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; })() : '');
    lines.push(`- [${item.completed ? 'x' : ' '}] #task ${title}${due ? ' 📅 ' + due : ''} [provider:: ${plain(provider)}] [remote_id:: ${plain(item.remoteId)}]${item.priority?' [priority:: '+plain(item.priority)+']':''}${item.projects?.length?' [projects:: '+item.projects.map(plain).join(', ')+']':''}${item.contexts?.length?' [contexts:: '+item.contexts.map(plain).join(', ')+']':''}${item.listId ? ' [list_id:: ' + plain(item.listId) + ']' : ''}${item.organizationName ? ' [organization:: ' + plain(item.organizationName) + ']' : ''}${item.assigneeName ? ' [assignee:: ' + plain(item.assigneeName) + ']' : ''}${item.source ? ' [source_file:: ' + plain(item.source) + ']' : ''}`);
    if (item.description) lines.push('  > ' + plain(item.description));
  }
  return lines.join('\n') + '\n';
}
function ownsIndex(content) { const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content); return !!frontmatter && /(?:^|\r?\n)task2do-owned: true(?:\r?\n|$)/.test(frontmatter[1]); }
module.exports = { markdownIndex, ownsIndex };
