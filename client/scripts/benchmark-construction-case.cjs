// Read-only measurements on the source DOCX. Only throwaway export files are created in outputDir.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { parseDocx } = require('../electron/services/constructionDocx.cjs');
const { auditDocument } = require('../electron/services/constructionAudit.cjs');
const { section417, writeRevision } = require('../electron/services/constructionCheckService.cjs');

const percentile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
async function measure(times, fn) {
  const samples = [];
  for (let i = 0; i < times; i += 1) {
    global.gc?.();
    const cpuBefore = process.cpuUsage();
    const start = process.hrtime.bigint();
    const value = await fn(i);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const cpu = process.cpuUsage(cpuBefore);
    samples.push({ ms: Number(ms.toFixed(2)), cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(2)), rssAfterMiB: Number((process.memoryUsage().rss / 1048576).toFixed(2)) });
    if (i === 0 && value == null) throw new Error('Benchmark did not return a result');
  }
  const sorted = samples.map((item) => item.ms).sort((a, b) => a - b);
  return { samples, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), maxObservedRssMiB: Math.max(...samples.map((item) => item.rssAfterMiB)) };
}

async function main() {
  const source = path.resolve(process.argv[2] || '');
  const outputDir = path.resolve(process.argv[3] || '');
  const tag = process.argv[4] || Date.now().toString();
  if (!fs.statSync(source).isFile()) throw new Error('Source must be an existing file');
  fs.mkdirSync(outputDir, { recursive: true });
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').toUpperCase();
  const counts = parseDocx(source).counts;
  const parsing = await measure(7, () => parseDocx(source));
  const parsed = parseDocx(source);
  const auditing = await measure(20, () => auditDocument(parsed));
  const locating = await measure(20, () => section417(parsed));
  const { convertPathToMarkdown } = await import('../electron/services/doc2markdown/convert.mjs');
  const markdown = await measure(5, () => convertPathToMarkdown(source, { includeImages: false }));
  const exports = await measure(3, (i) => {
    const destination = path.join(outputDir, `${tag}-revision-${i}.docx`);
    if (fs.existsSync(destination)) throw new Error(`Refuse to overwrite benchmark evidence: ${destination}`);
    return writeRevision(source, destination, {});
  });
  console.log(JSON.stringify({ tag, sourceSha256: sha256, sourceBytes: fs.statSync(source).size, platform: process.platform, node: process.version, cpu: os.cpus()[0]?.model, counts, measurements: { parsing, auditing, locating, markdown, exports }, memoryCaveat: 'RSS sampled after synchronous operations; not an in-operation peak. Same-process warm measurements, no GUI startup.' }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
