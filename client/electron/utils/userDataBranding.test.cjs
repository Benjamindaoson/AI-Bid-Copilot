const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { chooseUserDataPath } = require('./userDataBranding.cjs');

test('renaming keeps an existing model registry and workspace in place', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-branding-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, '头标智能体');
  fs.mkdirSync(path.join(legacy, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'model-providers.json'), '{"version":1}', 'utf8');
  assert.equal(chooseUserDataPath(root, '投标智能体'), legacy);
  assert.equal(fs.readFileSync(path.join(legacy, 'model-providers.json'), 'utf8'), '{"version":1}');

  const current = path.join(root, '投标智能体');
  fs.mkdirSync(current);
  fs.writeFileSync(path.join(current, 'user_config.json'), '{}', 'utf8');
  assert.equal(chooseUserDataPath(root, '投标智能体'), current);
});

test('new installs use the corrected name and earlier client data remains accessible', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-branding-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(chooseUserDataPath(root, '投标智能体'), path.join(root, '投标智能体'));
  const upstream = path.join(root, 'yibiao-client');
  fs.mkdirSync(upstream);
  fs.writeFileSync(path.join(upstream, 'user_config.json'), '{}', 'utf8');
  assert.equal(chooseUserDataPath(root, '投标智能体'), upstream);
});
