const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractRequirements, evaluateAll } = require('../electron/services/manufacturingRules.cjs');

const root = path.join(__dirname, 'fixtures');
const names = ['construction-dev', 'construction-holdout'];
let tp = 0, fp = 0, fn = 0, tn = 0, statusCorrect = 0, statusTotal = 0, cited = 0, citations = 0, evidenceCited = 0, evidenceCount = 0;
const results = [];
for (const name of names) {
  const dir = path.join(root, name);
  const tenderText = fs.readFileSync(path.join(dir, 'tender.md'), 'utf8');
  const enterpriseText = fs.readFileSync(path.join(dir, 'enterprise.md'), 'utf8');
  const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
  const matrix = evaluateAll(extractRequirements([{ name: 'tender.md', content: tenderText }]), [{ name: 'enterprise.md', content: enterpriseText }], truth.deadline);
  for (const expected of truth.items) {
    const row = matrix.find((item) => item.requirement.text.includes(expected.contains));
    if (!row) { if (expected.mandatory) fn++; results.push({ name, item: expected.contains, actual: '未抽取' }); continue; }
    if (expected.mandatory && row.requirement.mandatory) tp++;
    if (expected.mandatory && !row.requirement.mandatory) fn++;
    if (!expected.mandatory && row.requirement.mandatory) fp++;
    if (!expected.mandatory && !row.requirement.mandatory) tn++;
    statusTotal++;
    if (row.status === expected.status) statusCorrect++;
    citations++;
    const tenderLine = tenderText.split(/\r?\n/)[row.requirement.line - 1];
    if (tenderLine === row.requirement.original && (!row.evidence || enterpriseText.split(/\r?\n/)[row.evidence.line - 1].trim() === row.evidence.text)) cited++;
    if (row.evidence) {
      evidenceCount++;
      if (enterpriseText.split(/\r?\n/)[row.evidence.line - 1].trim() === row.evidence.text) evidenceCited++;
    }
    results.push({ name, item: expected.contains, mandatory: row.requirement.mandatory, status: row.status, expected: expected.status, evidence: row.evidence?.text || null });
  }
}
const precision = tp + fp ? tp / (tp + fp) : 0;
const recall = tp + fn ? tp / (tp + fn) : 0;
const metrics = { mandatory: { precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, falsePositiveRate: fp / (fp + tn || 1) }, status: { correct: statusCorrect, total: statusTotal }, evidenceCitationAccuracy: cited / (citations || 1), enterpriseEvidenceCitationAccuracy: evidenceCited / (evidenceCount || 1), results };
console.log(JSON.stringify(metrics, null, 2));
if (!process.argv.includes('--baseline')) {
  assert.equal(metrics.mandatory.recall, 1);
  assert.equal(metrics.mandatory.precision, 1);
  assert.equal(statusCorrect, statusTotal);
  assert.equal(cited, citations);
}
