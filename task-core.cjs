'use strict';
/**= Version 0.9.0-alpha.2. Shared task presentation and provider registration. */
class ProviderRegistry {
  constructor() { this.providers = new Map(); }
  register(provider) {
    if (!provider || typeof provider.id !== 'string' || typeof provider.list !== 'function' || !provider.capabilities) throw new Error('Invalid task provider.');
    this.providers.get(provider.id)?.dispose?.(); this.providers.set(provider.id, provider); return provider;
  }
  get(id) { return this.providers.get(id); }
  remove(id) { this.providers.get(id)?.dispose?.(); this.providers.delete(id); }
  dispose() { for (const provider of this.providers.values()) provider.dispose?.(); this.providers.clear(); }
}
function selectTasks(items, options = {}) {
  const state = ['all', 'open', 'completed'].includes(options.state) ? options.state : 'open';
  const search = String(options.search || '').trim().toLocaleLowerCase();
  const result = items.filter(item => (state === 'all' || item.completed === (state === 'completed')) && (!search || [item.title, item.description, item.organizationName, item.assigneeName, item.listName, item.remoteId, item.ticketNumber, item.statusName, item.priorityName, item.queueName].filter(Boolean).join(' ').toLocaleLowerCase().includes(search)));
  if (options.sort !== 'none') result.sort((a, b) => {
    const left = Date.parse(a.due), right = Date.parse(b.due);
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : String(a.remoteId).localeCompare(String(b.remoteId));
    if (!Number.isFinite(right)) return -1;
    return (options.sort === 'due-desc' ? right - left : left - right) || String(a.remoteId).localeCompare(String(b.remoteId));
  });
  return result;
}
/**= Native calendar fields have no timezone; explicitly convert local or UTC values. */
function toCalendarValue(iso, zone = 'local') {
  if (!iso) return '';
  const date = new Date(iso); if (!Number.isFinite(date.getTime())) throw new Error('Invalid saved date/time.');
  const get = part => date[`${zone === 'utc' ? 'getUTC' : 'get'}${part}`]();
  const pad = value => String(value).padStart(2, '0');
  return `${get('FullYear')}-${pad(get('Month') + 1)}-${pad(get('Date'))}T${pad(get('Hours'))}:${pad(get('Minutes'))}:${pad(get('Seconds'))}`;
}
function fromCalendarValue(value, zone = 'local') {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error('Select a complete date and time.');
  const [year, month, day, hours, minutes, seconds] = match.slice(1).map(v => Number(v || 0));
  if (year < 1000 || year > 9999) throw new Error('Select a year between 1000 and 9999.');
  const date = zone === 'utc' ? new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)) : new Date(year, month - 1, day, hours, minutes, seconds);
  const canonical = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}`;
  if (!Number.isFinite(date.getTime()) || toCalendarValue(date.toISOString(), zone) !== canonical) throw new Error('Invalid date/time, or the selected local time does not exist because of a clock change.');
  return date.toISOString();
}
function calendarZoneLabel(zone, value) {
  if (zone === 'utc') return 'UTC (UTC+00:00)';
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let date; try { date = new Date(fromCalendarValue(value, 'local')); } catch { return name; }
  const offset = -date.getTimezoneOffset(), absolute = Math.abs(offset);
  return `${name} (UTC${offset < 0 ? '-' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')})`;
}
/**= Display task timestamps at minute precision; retain the original API values. */
function formatTaskDate(iso, fallback = '') {
  if (iso) {
    try { return toCalendarValue(iso, 'local').slice(0, 16).replace('T', ' '); } catch {}
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(fallback);
  return match ? `${match[1]} ${match[2]}` : 'unspecified';
}
function taskUrgency(item, now = Date.now()) {
  if (item.completed) return { kind: 'completed', label: 'Completed' };
  const due = Date.parse(item.due); if (!Number.isFinite(due)) return { kind: 'undated', label: '' };
  if (due < now) return { kind: 'overdue', label: 'Overdue' };
  const ordinal = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  const days = ordinal(new Date(due)) - ordinal(new Date(now));
  return days === 0 ? { kind: 'today', label: 'Today' } : days <= 3 ? { kind: 'urgent', label: 'Within 3 days' } : days <= 7 ? { kind: 'upcoming', label: 'This week' } : { kind: 'later', label: 'Later' };
}
/**= Personal/delegated membership is exclusive; All is a deduplicated combined view. */
function selectAutotaskList(items, scope, assigneeId, creatorIds) {
  const assigned = item => String(item.assigneeId) === String(assigneeId) || (item.assigneeId === undefined && item.creatorId === undefined);
  const creators = new Set(creatorIds.map(String));
  const unique = [...new Map(items.map(item => [item.remoteId, item])).values()];
  return unique.filter(item => scope === 'my' ? assigned(item) : scope === 'delegated' ? !assigned(item) && creators.has(String(item.creatorId)) : true);
}
module.exports = { ProviderRegistry, selectTasks, toCalendarValue, fromCalendarValue, calendarZoneLabel, formatTaskDate, taskUrgency, selectAutotaskList };
