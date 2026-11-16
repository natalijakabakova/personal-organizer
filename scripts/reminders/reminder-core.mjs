import {createHash} from 'node:crypto';

// Calendar records from Personal Organizer: {id,title,date:'YYYY-MM-DD',time:'HH:mm'|''}.
export function reminderTime(event) {
  if (!event || typeof event !== 'object') return null;
  const date = String(event.date || '');
  const explicitTime = String(event.time || '').trim();
  const time = explicitTime || '09:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const local = new Date(`${date}T${time}:00`);
  if (Number.isNaN(local.getTime())) return null;
  // Reject silently normalized impossible dates (e.g. February 30).
  const [y,m,d] = date.split('-').map(Number);
  if (local.getFullYear() !== y || local.getMonth() + 1 !== m || local.getDate() !== d) return null;
  if (!explicitTime) {
    // Date-only event: 09:00 on the preceding calendar day, even across DST changes.
    const previousDay = new Date(y, m - 1, d - 1, 9, 0, 0);
    return previousDay.getTime();
  }
  return local.getTime() - 24 * 60 * 60 * 1000;
}

export function dueEvents(events, nowMs, lookbackMs = 2 * 60 * 60 * 1000) {
  if (!Array.isArray(events)) return [];
  return events.filter(e => {
    const when = reminderTime(e);
    return when !== null && when <= nowMs && when > nowMs - lookbackMs && typeof e.id === 'string' && e.id.length > 0;
  });
}

export function deliveryId(event) {
  return createHash('sha256').update(JSON.stringify([event.id, event.date, event.time || ''])).digest('hex');
}

export function safeTitle(value) {
  return String(value || 'Событие календаря').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 110) || 'Событие календаря';
}
