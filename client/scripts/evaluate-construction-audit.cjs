const fs = require('node:fs');
const path = require('node:path');
const { auditDocument } = require('../electron/services/constructionAudit.cjs');

const datasetPath = path.resolve(process.argv[2] || path.join(__dirname, '../evaluation/construction-facts-v1.json'));
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const flagged = new Set(['明确矛盾', '疑似不一致']);
const metrics = { version: dataset.version, cases: 0, exact: 0, falsePositive: 0, falseNegative: 0, missingEvidence: 0, mismatches: [] };
for (const fixture of dataset.cases) {
  const blocks = fixture.lines.map((text, index) => ({ kind: 'paragraph', location: `P${index + 1}`, chapter: '第一章', section: '资料说明', text }));
  if (fixture.stageTotals) blocks.push({ kind: 'table', location: 'T1', chapter: '第一章', section: '劳动力计划', rows: [
    [{ text: '按工程施工阶段投入劳动力', location: 'T1.R1.C1' }],
    [{ text: '合计', location: 'T1.R2.C1' }, ...fixture.stageTotals.map((value, index) => ({ text: String(value), location: `T1.R2.C${index + 2}` }))],
  ] });
  const document = { blocks, headings: [], images: [] };
  const item = auditDocument(document).find((result) => result.id === fixture.focus);
  metrics.cases += 1;
  if (item?.status === fixture.expected) metrics.exact += 1;
  else metrics.mismatches.push({ id: fixture.id, expected: fixture.expected, actual: item?.status || 'missing' });
  if (flagged.has(item?.status) && !flagged.has(fixture.expected)) metrics.falsePositive += 1;
  if (!flagged.has(item?.status) && flagged.has(fixture.expected)) metrics.falseNegative += 1;
  if (item && item.status !== '证据不足' && !item.evidence.length) metrics.missingEvidence += 1;
}
console.log(JSON.stringify(metrics, null, 2));
if (metrics.mismatches.length || metrics.missingEvidence) process.exitCode = 1;
