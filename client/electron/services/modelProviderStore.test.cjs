const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createModelProviderStore, validateBaseUrl } = require('./modelProviderStore.cjs');
const { createConfigStore } = require('./configStore.cjs');
const { createAiService } = require('./aiService.cjs');
const { fetchWithRedirect } = require('../utils/fetchWithRedirect.cjs');

function fixture(secure = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'byok-test-'));
  const app = { getPath: () => root };
  const safeStorage = {
    isEncryptionAvailable: () => secure,
    encryptString: (value) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`),
    decryptString: (value) => {
      const text = value.toString();
      if (!text.startsWith('sealed:')) throw new Error('invalid encrypted payload');
      return Buffer.from(text.slice(7), 'base64').toString();
    },
  };
  return { root, app, safeStorage, store: createModelProviderStore({ app, safeStorage }), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('arbitrary model IDs, secure persistence, task routing and restart', () => {
  const x = fixture();
  try {
    const state = x.store.upsert({ name: 'Custom', baseUrl: 'https://example.invalid/v1', modelId: 'not-in-a-whitelist:2026', apiKey: 'secret-token' });
    const id = state.connections[0].id;
    assert.equal(state.defaultTextId, id);
    assert.equal(state.connections[0].hasApiKey, true);
    assert.equal(JSON.stringify(state).includes('secret-token'), false);
    assert.equal(fs.readFileSync(x.store.file, 'utf8').includes('secret-token'), false);
    x.store.select('general', id);
    x.store.select('construction-check', id);
    const reopened = createModelProviderStore({ app: x.app, safeStorage: x.safeStorage });
    assert.equal(reopened.list().defaultTextId, id);
    assert.equal(reopened.applyToConfig({}, 'construction-check').model_name, 'not-in-a-whitelist:2026');
    assert.equal(reopened.resolved('construction-check').apiKey, 'secret-token');
    reopened.removeKey(id);
    assert.equal(reopened.resolved().apiKey, '');
    reopened.remove(id);
    assert.equal(reopened.list().connections.length, 0);
  } finally { x.cleanup(); }
});

test('remote HTTP and embedded credentials are rejected; local HTTP is accepted', () => {
  assert.throws(() => validateBaseUrl('http://example.com/v1'), /HTTPS/);
  assert.throws(() => validateBaseUrl('https://user:pass@example.com/v1'), /不得包含/);
  assert.equal(validateBaseUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1');
  const x = fixture(false);
  try {
    assert.throws(() => x.store.upsert({ name: 'remote', baseUrl: 'https://example.com/v1', modelId: 'any', apiKey: 'secret' }), /安全存储不可用/);
    assert.equal(fs.existsSync(x.store.file), false);
    x.store.upsert({ name: 'Ollama', baseUrl: 'http://localhost:11434/v1', modelId: 'local:1' });
    assert.equal(x.store.list().connections.length, 1);
  } finally { x.cleanup(); }
});

test('legacy migration preserves all secrets or leaves original untouched', () => {
  const x = fixture();
  const oldFile = path.join(x.root, 'user_config.json');
  const old = { text_model_provider: 'custom', base_url: 'https://example.com/v1', model_name: 'legacy', api_key: 'old-secret' };
  try {
    fs.writeFileSync(oldFile, JSON.stringify(old));
    const result = x.store.migrateLegacy(oldFile);
    assert.equal(result.migrated, true);
    assert.equal(x.store.resolved().apiKey, 'old-secret');
    assert.equal(fs.readFileSync(oldFile, 'utf8').includes('old-secret'), false);
    assert.equal(fs.readFileSync(`${oldFile}.pre-byok.enc`, 'utf8').includes('old-secret'), false);
    const config = createConfigStore(x.app, x.store);
    config.save({ ...config.load(), developer_mode: true });
    assert.equal(fs.readFileSync(oldFile, 'utf8').includes('old-secret'), false);
  } finally { x.cleanup(); }

  const previous = fixture();
  try {
    const legacy = path.join(previous.root, 'previous-install', 'user_config.json');
    fs.mkdirSync(path.dirname(legacy));
    fs.writeFileSync(legacy, JSON.stringify({ ...old, developer_mode: true }));
    assert.equal(previous.store.migrateLegacy(legacy, { scrubSource: false }).migrated, true);
    assert.equal(fs.readFileSync(legacy, 'utf8').includes('old-secret'), true);
    const copied = JSON.parse(fs.readFileSync(path.join(previous.root, 'user_config.json'), 'utf8'));
    assert.equal(copied.developer_mode, true);
    assert.equal(copied.api_key, '');
    assert.equal(previous.store.resolved().apiKey, 'old-secret');
  } finally { previous.cleanup(); }

  const bad = fixture();
  try {
    const file = path.join(bad.root, 'user_config.json');
    fs.writeFileSync(file, JSON.stringify({ api_key: 'unmappable', base_url: 'http://remote.invalid/v1', model_name: 'legacy' }));
    const result = bad.store.migrateLegacy(file);
    assert.equal(result.migrated, false);
    assert.equal(fs.readFileSync(file, 'utf8').includes('unmappable'), true);
    assert.equal(fs.existsSync(bad.store.file), false);
  } finally { bad.cleanup(); }

  const unavailable = fixture(false);
  try {
    const file = path.join(unavailable.root, 'user_config.json');
    fs.writeFileSync(file, JSON.stringify(old));
    assert.equal(unavailable.store.migrateLegacy(file).migrated, false);
    assert.match(unavailable.store.list().migrationWarning, /安全存储不可用/);
    assert.equal(fs.readFileSync(file, 'utf8').includes('old-secret'), true);
    const config = createConfigStore(unavailable.app, unavailable.store);
    assert.equal(config.load().api_key, '');
    assert.throws(() => config.save({ developer_mode: true }), /安全迁移完成前不能覆盖/);
  } finally { unavailable.cleanup(); }
});

test('minimal connection diagnostics and model listing use the selected provider only', async () => {
  const requests = [];
  let mode = 200;
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization || '' });
    res.writeHead(mode, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith('/models') ? { data: [{ id: 'arbitrary' }] } : { choices: [{ message: { content: 'OK' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const x = fixture();
  try {
    const id = x.store.upsert({ name: 'local gateway', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, modelId: 'any-model', apiKey: 'private' }).connections[0].id;
    assert.equal((await x.store.testConnection(id)).success, true);
    assert.deepEqual((await x.store.listModels(id)).models, ['arbitrary']);
    assert.deepEqual(requests.map((r) => r.authorization), ['Bearer private', 'Bearer private']);
    for (const [status, expected] of [[401, 'API Key'], [403, '权限'], [404, 'Base URL'], [429, '限流']]) {
      mode = status;
      assert.match((await x.store.testConnection(id)).message, new RegExp(expected));
    }
  } finally { x.cleanup(); await new Promise((resolve) => server.close(resolve)); }
});

test('cross-origin redirects never forward Authorization', async () => {
  let calls = 0;
  await assert.rejects(fetchWithRedirect('https://one.example/v1/chat/completions', { headers: { Authorization: 'Bearer private' } }, async () => {
    calls += 1;
    return { status: 307, headers: new Headers({ location: 'https://other.example/v1/chat/completions' }), body: { cancel: async () => {} } };
  }), /跨域/);
  assert.equal(calls, 1);
});

test('image connection is checked against Images endpoint before availability', async () => {
  const paths = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ url: 'https://example.invalid/image.png' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const x = fixture();
  try {
    const id = x.store.upsert({ name: 'local image', capability: 'image', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, modelId: 'image-any' }).connections[0].id;
    x.store.select('image', id);
    assert.equal(x.store.applyToConfig({ image_model: {} }).image_model.status, 'untested');
    assert.equal((await x.store.testConnection(id)).success, true);
    assert.deepEqual(paths, ['/v1/images/generations']);
    assert.equal(x.store.applyToConfig({ image_model: {} }).image_model.status, 'available');
  } finally { x.cleanup(); await new Promise((resolve) => server.close(resolve)); }
});

test('AI service routes each text task through the selected BYOK provider', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ model: JSON.parse(body).model, key: req.headers.authorization || '' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const x = fixture();
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const general = x.store.upsert({ name: 'general', baseUrl, modelId: 'model-general', apiKey: 'key-general' }).connections[0].id;
    const special = x.store.upsert({ name: 'check', baseUrl, modelId: 'model-check', apiKey: 'key-check' }).connections[1].id;
    x.store.select('general', general);
    x.store.select('construction-check', special);
    const config = createConfigStore(x.app, x.store);
    config.save({ text_model_provider: 'custom', request_mode: 'normal' });
    const ai = createAiService({ app: x.app, configStore: config });
    await ai.chat({ taskType: 'construction-check', messages: [{ role: 'user', content: 'synthetic check' }] });
    await ai.chat({ taskType: 'tender-parse', messages: [{ role: 'user', content: 'synthetic tender' }] });
    assert.deepEqual(received, [
      { model: 'model-check', key: 'Bearer key-check' },
      { model: 'model-general', key: 'Bearer key-general' },
    ]);
  } finally { x.cleanup(); await new Promise((resolve) => server.close(resolve)); }
});
