const assert = require('node:assert/strict');
const { test } = require('node:test');
const { indexDocumentFacts, compareFactPair, verifyModelPairs, selectCandidatePairs, runModelSemanticReview } = require('./constructionFactIntelligence.cjs');

function paragraph(text, number) { return { kind: 'paragraph', location: `P${number}`, chapter: '第二章', section: '资源计划', text }; }
function pair(lines) {
  const facts = indexDocumentFacts({ blocks: lines.map((text, index) => paragraph(text, index + 1)) });
  assert.equal(facts.length, 2, JSON.stringify(facts));
  return [facts, compareFactPair(...facts)];
}

test('same phase, same role and different counts are an explicit conflict', () => {
  const [facts, result] = pair(['主体阶段配备安全员2人。', '主体阶段配备安全员4名。']);
  assert.equal(facts[0].entity, '安全员');
  assert.equal(result.status, '明确矛盾');
});
test('different construction phases remain a scoped difference', () => {
  const [, result] = pair(['基础阶段配备安全员2人。', '主体阶段配备安全员4人。']);
  assert.equal(result.status, '无问题');
  assert.equal(result.distinction, '口径差异');
});
test('unit conversion compares normalized values', () => {
  const [, result] = pair(['主体阶段管径1.2m。', '主体阶段管径120cm。']);
  assert.equal(result.status, '无问题');
});
test('different quantity bases are not declared erroneous', () => {
  const [, result] = pair(['主体阶段商品混凝土总量8240m³。', '主体阶段商品混凝土采购量15624立方米。']);
  assert.equal(result.status, '无问题');
  assert.equal(result.distinction, '口径差异');
});
test('unqualified difference stays suspected', () => {
  const [, result] = pair(['商品混凝土8240m3。', '商品混凝土15624立方米。']);
  assert.equal(result.status, '疑似不一致');
});
test('opposing thresholds with the same boundary require review', () => {
  const [, result] = pair(['安装阶段电缆长度不超过500m。', '安装阶段电缆长度不低于500m。']);
  assert.equal(result.status, '疑似不一致');
});
test('compatible and impossible numeric intervals are distinguished deterministically', () => {
  assert.equal(pair(['安装阶段电缆长度不低于800m。', '安装阶段电缆长度不超过900m。'])[1].status, '无问题');
  assert.equal(pair(['安装阶段电缆长度不低于900m。', '安装阶段电缆长度不超过800m。'])[1].status, '明确矛盾');
  assert.equal(pair(['安装阶段电缆长度不低于800m。', '安装阶段电缆长度为850m。'])[1].status, '无问题');
  assert.equal(pair(['安装阶段电缆长度不低于800m。', '安装阶段电缆长度为750m。'])[1].status, '疑似不一致');
});
test('entity label before a trailing verb remains indexed', () => {
  const [facts, result] = pair(['主体阶段水池容量为600m³。', '主体阶段水池容量不低于500m³。']);
  assert.deepEqual(facts.map((fact) => fact.entity), ['水池容量', '水池容量']);
  assert.equal(result.status, '无问题');
});
test('candidate budget covers a later entity after many early repeated values', () => {
  const facts = indexDocumentFacts({ blocks: [
    ...Array.from({ length: 12 }, (_, i) => paragraph(`主体阶段配备机修工${i + 1}人。`, i + 1)),
    paragraph('主体阶段配备测量员2人。', 13), paragraph('主体阶段配备测量员4人。', 14),
  ] });
  const selected = selectCandidatePairs(facts, 4);
  assert.equal(selected.length, 4);
  assert.ok(selected.some(([a, b]) => a.entity === '测量员' && b.entity === '测量员'));
});
test('table quantities inherit row label and exact cell evidence', () => {
  const facts = indexDocumentFacts({ blocks: [{ kind: 'table', location: 'T1', chapter: '第五章', section: '材料计划', rows: [[
    { text: '商品混凝土', location: 'T1.R1.C1' }, { text: 'm³', location: 'T1.R1.C2' }, { text: '15,624', location: 'T1.R1.C3' },
  ]] }] });
  assert.equal(facts.length, 1);
  assert.deepEqual([facts[0].entity, facts[0].value, facts[0].location], ['商品混凝土', 15624, 'T1.R1.C3']);
});
test('fabricated model evidence cannot become a confirmed conflict', () => {
  const [facts] = pair(['主体阶段配备安全员2人。', '主体阶段配备安全员4人。']);
  const result = verifyModelPairs([{ factIds: ['F1', 'F999'], explanation: '必然扣分' }], facts);
  assert.equal(result[0].status, '证据不足');
  assert.deepEqual(result[0].evidence, []);
});
test('model adapter sends only indexed candidate snippets and rejects invented IDs', async () => {
  const [facts] = pair(['主体阶段配备安全员2人。', '主体阶段配备安全员4人。']);
  let sent;
  const aiService = { requestJson: async (request) => {
    sent = JSON.parse(request.messages[1].content);
    assert.throws(() => request.validator(request.normalizer({ explanation: '没有结构化结果' })), /合法 pairs/);
    const output = request.normalizer({ pairs: [{ factIds: ['F1', 'F999'], explanation: '不存在的证据' }] });
    assert.throws(() => request.validator(output), /候选集以外/);
    return request.normalizer({ pairs: [{ factIds: ['F1', 'F2'], explanation: '请复核人数' }] });
  } };
  const result = await runModelSemanticReview({ facts, aiService });
  assert.deepEqual(sent.candidates, [['F1', 'F2']]);
  assert.equal(result.results[0].status, '明确矛盾');
  assert.deepEqual(result.results[0].evidence.map((item) => item.location), ['P1', 'P2']);
});
