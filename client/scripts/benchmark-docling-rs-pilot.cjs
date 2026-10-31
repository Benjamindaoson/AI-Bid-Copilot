// Isolated comparison. Pass a local docling.rs wrapper directory; no case text is logged.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { parseDocx } = require('../electron/services/constructionDocx.cjs');

const [source, binding] = process.argv.slice(2);
if (!source || !binding || !fs.existsSync(source)) throw new Error('Usage: node benchmark-docling-rs-pilot.cjs <docx> <isolated-package-dir>');
const { convertFile } = require(binding);
const samples = [];
let result;
for (let i = 0; i < 7; i += 1) {
  global.gc?.();
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  result = convertFile(source, { to: 'json' });
  const parsed = JSON.parse(result.content);
  const cpu = process.cpuUsage(cpuStart);
  samples.push({ ms: +(performance.now() - start).toFixed(2), cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(2), rssAfterMiB: +(process.memoryUsage().rss / 1048576).toFixed(2) });
  if (result.status !== 'success' || !parsed.body) throw new Error('docling.rs conversion failed');
}
const docling = JSON.parse(result.content);
const original = parseDocx(source);
const textValues = (docling.texts || []).map((item) => item.text || '');
const tableValues = (docling.tables || []).flatMap((item) => (item.data?.table_cells || []).map((cell) => cell.text || ''));
const normalized = (value) => String(value).replace(/\s+/g, '').replace(/[，,]/g, '');
const corpus = normalized([...textValues, ...tableValues].join(''));
const bodyParagraphs = original.blocks.filter((block) => block.kind === 'paragraph' && block.text.length >= 12);
const headings = original.headings.filter((item) => !item.toc);
const covered = (items) => items.filter((item) => corpus.includes(normalized(item.text))).length;
const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
const percentile = (p) => times[Math.min(times.length - 1, Math.ceil(p * times.length) - 1)];
console.log(JSON.stringify({
  sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').toUpperCase(),
  packageVersion: require(require('node:path').join(binding, 'package.json')).version,
  status: result.status, errors: result.errors?.length || 0,
  docling: { texts: docling.texts?.length, tables: docling.tables?.length, tableCells: docling.tables?.reduce((n, table) => n + (table.data?.table_cells?.length || 0), 0), pictures: docling.pictures?.length, pageObjects: Object.keys(docling.pages || {}).length, paragraphsCovered: covered(bodyParagraphs), paragraphsChecked: bodyParagraphs.length, headingsCovered: covered(headings), headingsChecked: headings.length },
  existing: original.counts,
  samples, p50Ms: percentile(.5), p95Ms: percentile(.95), maxObservedRssMiB: Math.max(...samples.map((sample) => sample.rssAfterMiB)),
  caveat: 'In-process seven runs, JSON deserialization included; RSS sampled after conversion, not peak. Coverage compares normalized string presence; semantic fidelity and visual layout remain unverified.'
}, null, 2));
