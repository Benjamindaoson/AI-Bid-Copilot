const { app, safeStorage } = require('electron');
const crypto = require('node:crypto');

app.whenReady().then(() => {
  if (!safeStorage.isEncryptionAvailable()) {
    console.error('BLOCKED: Windows safeStorage is unavailable');
    app.exit(2);
    return;
  }
  const secret = crypto.randomUUID();
  const ciphertext = safeStorage.encryptString(secret);
  if (ciphertext.includes(secret) || safeStorage.decryptString(ciphertext) !== secret) {
    console.error('FAIL: safeStorage round trip or ciphertext check failed');
    app.exit(1);
    return;
  }
  console.log('PASS: Windows safeStorage encrypted and decrypted a synthetic key');
  app.exit(0);
}).catch((error) => {
  console.error(`FAIL: safeStorage initialization failed (${error.name})`);
  app.exit(1);
});
