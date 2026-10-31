const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { attachStartupProbe } = require('../electron/services/startupProbe.cjs');

test('startup diagnostics cannot prevent the ready window from opening when stdout is closed', async () => {
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.webContents = new EventEmitter();
  window.webContents.executeJavaScript = async () => true;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('renderer readiness was not delivered')), 1000);
    attachStartupProbe(window, {
      enabled: true,
      log: () => { throw new Error('EPIPE'); },
      onReady: () => { clearTimeout(timeout); resolve(); },
    });
  });
  assert.ok(true);
});
