const fs = require('node:fs');
const path = require('node:path');
const { indexDocumentFacts, selectCandidatePairs, compareFactPair } = require('../electron/services/constructionFactIntelligence.cjs');

const datasetPath = process.env.YIBIAO_EVAL_DATASET || path.join(__dirname, '../evaluation/construction-facts-v2.json');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const rows = dataset.cases.map((fixture) => {
  const blocks = fixture.lines.map((text, i) => ({ kind: 'paragraph', location: `P${i + 1}`, chapter: '第二章', section: '技术方案', text }));
  if (fixture.tableRow) {
    const { label, unit, quantity, gridSpan } = fixture.tableRow;
    blocks.push({ kind: 'table', location: 'T1', chapter: '第二章', section: '材料计划', rows: [[
      { text: label, location: 'T1.R1.C1', gridSpan }, { text: unit, location: 'T1.R1.C2' }, { text: quantity, location: 'T1.R1.C3' },
    ]] });
  }
  const facts = indexDocumentFacts({ blocks });
  const candidates = selectCandidatePairs(facts);
  const first = candidates[0];
  const result = first ? compareFactPair(...first) : { status: facts.length >= 2 ? '无问题' : '未检出' };
  const evidenceCorrect = !first ? null : first.every((fact) => {
    const block = blocks.find((item) => item.location === fact.location || item.location === fact.location.split('.')[0]);
    if (!block) return false;
    if (block.kind === 'paragraph') return block.text === fact.quote;
    const rowText = block.rows.flat().map((cell) => cell.text);
    return rowText.some((text) => fact.quote.includes(text)) && rowText.includes(fact.raw.replace(/[^\d,\.]/g, ''));
  });
  return { id: fixture.id, split: fixture.split, project: fixture.project, expected: fixture.expected, actual: result.status, distinction: result.distinction || '', facts: facts.length, candidates: candidates.length, evidence: first?.map((fact) => fact.location) || [], evidenceCorrect };
});
function metrics(items, positive) {
  const isPositive = (status) => positive.includes(status);
  const tp = items.filter((row) => isPositive(row.expected) && isPositive(row.actual)).length;
  const fp = items.filter((row) => !isPositive(row.expected) && isPositive(row.actual)).length;
  const fn = items.filter((row) => isPositive(row.expected) && !isPositive(row.actual)).length;
  const negatives = items.filter((row) => !isPositive(row.expected)).length;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return { tp, fp, fn, precision, recall, f1: precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall), falsePositiveRate: negatives ? fp / negatives : null };
}
const result = { version: dataset.version, rows, splits: {} };
for (const split of ['dev', 'holdout']) {
  const items = rows.filter((row) => row.split === split);
  const cited = items.filter((row) => row.actual === '明确矛盾' || row.actual === '疑似不一致');
  result.splits[split] = {
    cases: items.length,
    exactStatus: items.filter((row) => row.expected === row.actual).length,
    explicitConflict: metrics(items, ['明确矛盾']),
    needsReview: metrics(items, ['疑似不一致', '证据不足']),
    evidenceCitation: { correct: cited.filter((row) => row.evidenceCorrect).length, total: cited.length },
  };
}
const outputPath = process.argv[2];
if (outputPath) {
  if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite evaluation: ${outputPath}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
}
console.log(JSON.stringify({ version: result.version, splits: result.splits, mismatches: rows.filter((row) => row.actual !== row.expected), outputPath }, null, 2));
