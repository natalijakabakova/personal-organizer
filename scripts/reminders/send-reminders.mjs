import {initializeApp, cert} from 'firebase-admin/app';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {dueEvents, deliveryId, safeTitle} from './reminder-core.mjs';

const uid = (process.env.PERSONAL_ORGANIZER_UID || '').trim();
const credentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const dryRun = process.env.DRY_RUN === 'true';
const expectedProject = 'personal-organizer-7d310';
const appUrl = 'https://natalijakabakova.github.io/personal-organizer/';

if (!uid || uid.includes('/')) throw new Error('Configure PERSONAL_ORGANIZER_UID in GitHub Actions Variables.');
if (!credentials) throw new Error('Configure FIREBASE_SERVICE_ACCOUNT_JSON in GitHub Actions Secrets.');
let serviceAccount;
try { serviceAccount = JSON.parse(credentials); }
catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.'); }
if (serviceAccount.project_id !== expectedProject || !serviceAccount.private_key || !serviceAccount.client_email) {
  throw new Error('Firebase service account is incomplete or belongs to another project.');
}

initializeApp({credential: cert(serviceAccount)});
const db = getFirestore();
const messaging = getMessaging();
const userRef = db.collection('users').doc(uid);
const organizerSnap = await userRef.collection('private').doc('organizer').get();
if (!organizerSnap.exists) {
  console.log('No synchronized organizer document in Firestore. Nothing to send.');
  process.exit(0);
}
let organizer;
try { organizer = JSON.parse(organizerSnap.get('payload')); }
catch { throw new Error('Organizer payload is missing or invalid JSON.'); }
const now = Date.now();
const events = dueEvents(organizer.events, now);
console.log(`Checked ${Array.isArray(organizer.events) ? organizer.events.length : 0} events; ${events.length} reminders due. Dry run: ${dryRun}.`);
if (!events.length) process.exit(0);

const tokenDocs = await userRef.collection('pushTokens').get();
const tokens = [...new Set(tokenDocs.docs
  .filter(doc => doc.get('enabled') === true && typeof doc.get('token') === 'string')
  .map(doc => doc.get('token').trim()).filter(Boolean))];
if (!tokens.length) {
  console.log('No enabled FCM tokens; reminders will be retried during the due window.');
  process.exit(0);
}

for (const event of events) {
  const marker = userRef.collection('reminderDeliveries').doc(deliveryId(event));
  const existing = await marker.get();
  if (existing.exists) {
    if (existing.get('state') === 'sent') {
      console.log('Skipping previously delivered reminder.');
      continue;
    }
    const claimedAt = existing.get('claimedAt')?.toMillis?.() || 0;
    if (now - claimedAt < 30 * 60 * 1000) {
      console.log('Skipping reminder claimed by another recent run.');
      continue;
    }
  }
  if (dryRun) {
    console.log(`DRY RUN: would send one reminder for ${event.date} ${event.time || '(no time)'} to ${tokens.length} registered token(s).`);
    continue;
  }
  // A single GitHub Actions concurrency group serializes runs; Firestore marker survives reruns.
  await marker.set({state: 'sending', eventId: event.id, claimedAt: FieldValue.serverTimestamp()});
  try {
    // Firebase notification payload uses the same delivery path as the successful Console test.
    const title = `🔔 Завтра: ${safeTitle(event.title)}`;
    const body = event.time ? `Время: ${event.time}` : 'Событие на завтра (время не указано)';
    let successful = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const result = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: {title, body},
        webpush: {headers: {Urgency: 'high'}, fcmOptions: {link: appUrl}}
      });
      successful += result.successCount;
      if (result.failureCount) {
        console.warn(`FCM: ${result.failureCount} of ${batch.length} device sends failed.`);
        for (const r of result.responses) if (!r.success) console.warn('FCM error code:', r.error?.code || 'unknown');
      }
    }
    if (!successful) throw new Error('FCM did not accept the reminder for any registered token.');
    await marker.set({state: 'sent', eventId: event.id, sentAt: FieldValue.serverTimestamp(), acceptedDevices: successful});
    console.log(`Reminder accepted by FCM for ${successful} device(s).`);
  } catch (err) {
    // Do not leave a permanent marker for a failed send.
    await marker.delete().catch(() => {});
    console.error('Reminder send failed:', err.code || err.message);
    process.exitCode = 1;
  }
}
