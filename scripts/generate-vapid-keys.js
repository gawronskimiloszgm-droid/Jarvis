// Uzycie: node scripts/generate-vapid-keys.js
// Generuje pare kluczy VAPID potrzebna do powiadomien push. Wklej wynik do .env.
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
