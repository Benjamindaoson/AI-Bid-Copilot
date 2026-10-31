const test = require('node:test');
const assert = require('node:assert/strict');
const { auditDocument } = require('./constructionAudit.cjs');

function review(lines) {
  const doc = { blocks: lines.map((text, index) => ({ kind: 'paragraph', text, location: `P${index + 1}`, chapter: '第一章', section: '人员配置' })), headings: [], images: [] };
  return auditDocument(doc).find((item) => item.id === 'staff-count');
}

test('same-role count conflict with no phase distinction is explicit and cited', () => {
  const result = review(['本项目配备专职安全员2人。', '项目组织机构配置专职安全员4人。']);
  assert.equal(result.status, '明确矛盾');
  assert.deepEqual(result.evidence.map((item) => item.location), ['P1', 'P2']);
});

test('different construction phases can have different staff counts', () => {
  const result = review(['基础施工阶段配备专职安全员2人。', '主体施工阶段配备专职安全员4人。']);
  assert.equal(result.status, '无问题');
  assert.equal(result.evidence.length, 2);
});

test('phase-specific and unspecified counts require review', () => {
  const result = review(['配备专职安全员2人。', '主体施工阶段配置专职安全员4人。']);
  assert.equal(result.status, '疑似不一致');
});

test('one mention cannot establish a contradiction', () => {
  const result = review(['配备专职安全员2人。']);
  assert.equal(result.status, '证据不足');
});
