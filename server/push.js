import webpush from 'web-push';
import * as memory from './memory.js';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:example@example.com';

export function isConfigured() {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY);
}

if (isConfigured()) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
}

export function getPublicKey() {
  return PUBLIC_KEY || null;
}

export async function sendToAll(payload) {
  if (!isConfigured()) return;
  const subscriptions = memory.getPushSubscriptions();
  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          memory.removePushSubscription(sub.endpoint);
        }
      }
    })
  );
}
