import test from 'node:test';
import assert from 'node:assert/strict';
import {reminderTime, dueEvents, deliveryId, safeTitle} from './reminder-core.mjs';

test('24 hours before timed event', () => {
  const event = {id:'1', date:'2026-11-18', time:'14:30'};
  assert.equal(new Date(reminderTime(event)).toString().includes('Nov 17 2026 14:30'), true);
});
test('all-day events use 09:00 the preceding day', () => {
  const event = {id:'2', date:'2026-11-18', time:''};
  assert.equal(new Date(reminderTime(event)).toString().includes('Nov 17 2026 09:00'), true);
});
test('events outside the window and invalid dates are skipped', () => {
  const now = new Date('2026-11-17T14:45:00').getTime();
  assert.equal(dueEvents([{id:'1',date:'2026-11-18',time:'14:30'}, {id:'2',date:'2026-11-19',time:'14:30'}], now).length, 1);
  assert.equal(reminderTime({date:'2026-02-30',time:'12:00'}), null);
});
test('stable reminder id and sanitized titles', () => {
  const a = {id:'abc',date:'2026-11-18',time:'14:30'};
  assert.equal(deliveryId(a), deliveryId({...a}));
  assert.notEqual(deliveryId(a), deliveryId({...a,time:'15:00'}));
  assert.equal(safeTitle('Test\nTitle'), 'Test Title');
});

test('date-only reminder stays at 09:00 across daylight-saving change', () => {
  const t = new Date(reminderTime({id:'dst',date:'2027-03-29',time:''}));
  assert.equal(t.getHours(), 9);
  assert.equal(t.getDate(), 28);
});
