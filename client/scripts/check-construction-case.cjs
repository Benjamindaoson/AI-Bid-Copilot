const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { parseDocx } = require('../electron/services/constructionDocx.cjs');
const { auditDocument } = require('../electron/services/constructionAudit.cjs');
const { createConstructionCheckService } = require('../electron/services/constructionCheckService.cjs');

async function main() {
  const caseDir = path.resolve(process.argv[2] || '');
  const manifest = JSON.parse(fs.readFileSync(path.join(caseDir, 'source_manifest.json'), 'utf8'));
  const review = JSON.parse(fs.readFileSync(path.join(caseDir, 'manual_review_set.json'), 'utf8'));
  const source = path.join(caseDir, manifest.copyPath);
  const doc = parseDocx(source);
  assert.equal(doc.sha256, manifest.sha256, '原文副本 SHA-256');
  assert.equal(doc.headings.filter((x) => !x.toc && /^第.+章/.test(x.text)).length, 16, '正文 16 章');
  assert.ok(doc.counts.paragraphs > 3000 && doc.counts.tables > 20 && doc.counts.media > 0, '全文段落、表格与媒体');
  const locations = new Set(doc.blocks.flatMap((block) => block.kind === 'table' ? [block.location, ...block.rows.flat().map((cell) => cell.location)] : [block.location]));
  const findings = auditDocument(doc);
  for (const item of review.items) {
    const actual = findings.find((finding) => finding.id === item.id);
    assert.ok(actual, `缺少问题 ${item.id}`);
    assert.equal(actual.status, item.expected, `${item.id} 预期判断`);
    for (const expectedLocation of item.evidence) assert.ok(actual.evidence.some((ev) => ev.location === expectedLocation), `${item.id} 缺少人工证据 ${expectedLocation}`);
    for (const evidence of actual.evidence) for (const location of evidence.location.split(' + ')) assert.ok(locations.has(location), `${item.id} 证据坐标不存在：${location}`);
  }
  const extracted = path.join(caseDir, 'extracted');
  fs.mkdirSync(extracted, { recursive: true });
  fs.writeFileSync(path.join(extracted, 'document_index.json'), JSON.stringify(doc, null, 2), 'utf8');
  const service = createConstructionCheckService({ app: { getPath: () => path.join(caseDir, 'runtime-test') }, dialog: {} });
  const imported = await service.importFile(source);
  assert.equal(imported.success, true);
  assert.ok(imported.state.sourceMarkdownLength > 50000, '复用本地 Markdown 解析');
  assert.equal(imported.state.findings.length, review.items.length);
  const confirmed = service.confirmFinding('staff-count', true);
  assert.equal(confirmed.findings.find((item) => item.id === 'staff-count').confirmed, true, '人工确认状态持久化');
  const paragraph = confirmed.sectionBlocks.find((block) => block.kind === 'paragraph' && block.location === review.revisionProbe.location);
  assert.ok(paragraph, '定位 4.17 节可编辑段落');
  assert.ok(paragraph.text.includes(review.revisionProbe.find), '人工修订样本原文仍存在');
  const replacement = paragraph.text.replace(review.revisionProbe.find, review.revisionProbe.replace);
  service.confirmEdit(paragraph.location, replacement, false);
  assert.equal(service.load().sectionBlocks.find((block) => block.location === paragraph.location).editConfirmed, false, '暂存不等于确认');
  service.confirmEdit(paragraph.location, replacement, true);
  await assert.rejects(() => service.exportRevision(source), /拒绝覆盖/, '原件保护');
  assert.equal(parseDocx(source).sha256, manifest.sha256, '被拒绝导出后原文仍完整');
  const outputs = path.join(caseDir, 'outputs');
  const report = await service.exportAudit(path.join(outputs, '标书体检报告.docx'));
  const revision = await service.exportRevision(path.join(outputs, '适老化专项修订稿.docx'));
  assert.ok(report.success && revision.success && report.bytes > 5000 && revision.bytes > 1000000);
  const reportProperties = new AdmZip(report.filePath).getEntry('docProps/core.xml').getData().toString('utf8');
  assert.match(reportProperties, /<dc:creator>投标智能体<\/dc:creator>/, '体检报告作者属性为当前产品名');
  const reportXml = new DOMParser().parseFromString(new AdmZip(report.filePath).getEntry('word/document.xml').getData().toString('utf8'), 'text/xml');
  const reportText = Array.from(reportXml.getElementsByTagName('w:t')).map((node) => node.textContent).join(' ');
  for (const item of findings) {
    assert.ok(reportText.includes(item.title) && reportText.includes(item.status), `报告缺少 ${item.id} 的判断`);
    for (const evidence of item.evidence) assert.ok(reportText.includes(evidence.location), `报告缺少 ${item.id} 原文位置 ${evidence.location}`);
  }
  assert.ok(reportText.includes('人工确认：已确认问题记录'), '报告保留人工确认状态');
  const revised = parseDocx(revision.filePath);
  assert.equal(revised.blocks.find((block) => block.location === paragraph.location).text, replacement);
  assert.equal(revised.counts.tables, doc.counts.tables, '原有表格保留');
  assert.equal(revised.counts.media, doc.counts.media, '原有图片保留');
  const sourceZip = new AdmZip(source);
  const revisedZip = new AdmZip(revision.filePath);
  const originalEntries = sourceZip.getEntries().map((entry) => entry.entryName).sort();
  assert.deepEqual(revisedZip.getEntries().map((entry) => entry.entryName).sort(), originalEntries, 'Word 包文件清单保留');
  for (const name of originalEntries.filter((entry) => entry !== 'word/document.xml')) {
    assert.deepEqual(revisedZip.getEntry(name).getData(), sourceZip.getEntry(name).getData(), `${name} 原始部件保留`);
  }
  const paragraphAt = (zip) => {
    const xml = new DOMParser().parseFromString(zip.getEntry('word/document.xml').getData().toString('utf8'), 'text/xml');
    return Array.from(xml.getElementsByTagName('w:body')[0].childNodes).filter((node) => node.nodeType === 1 && node.localName === 'p')[Number(paragraph.location.slice(1)) - 1];
  };
  const runProperties = (p) => Array.from(p.getElementsByTagName('w:rPr')).map((node) => new XMLSerializer().serializeToString(node));
  assert.deepEqual(runProperties(paragraphAt(revisedZip)), runProperties(paragraphAt(sourceZip)), '目标段落字符格式保留');
  for (const block of doc.blocks) {
    if (block.location === paragraph.location) continue;
    const after = revised.blocks.find((item) => item.location === block.location);
    assert.ok(after, `${block.location} 未保留`);
    assert.deepEqual(after.kind === 'paragraph' ? after.text : after.rows.map((row) => row.map((cell) => cell.text)), block.kind === 'paragraph' ? block.text : block.rows.map((row) => row.map((cell) => cell.text)), `${block.location} 非目标内容变化`);
  }
  const guiReport = path.join(outputs, '标书体检报告_GUI.docx');
  const guiRevision = path.join(outputs, '适老化专项修订稿_GUI.docx');
  const guiReportEntry = new AdmZip(guiReport).getEntry('word/document.xml');
  assert.ok(guiReportEntry, 'GUI 导出体检报告可读取');
  const guiReportXml = new DOMParser().parseFromString(guiReportEntry.getData().toString('utf8'), 'text/xml');
  const guiReportText = Array.from(guiReportXml.getElementsByTagName('w:t')).map((node) => node.textContent).join(' ');
  for (const item of findings) assert.ok(guiReportText.includes(item.title) && guiReportText.includes(item.status), `GUI 报告缺少 ${item.id}`);
  const guiRevised = parseDocx(guiRevision);
  assert.equal(guiRevised.blocks.find((block) => block.location === paragraph.location).text, replacement, 'GUI 导出包含人工确认的修订');
  assert.equal(guiRevised.counts.tables, doc.counts.tables, 'GUI 导出保留表格');
  assert.equal(guiRevised.counts.media, doc.counts.media, 'GUI 导出保留媒体');
  console.log(JSON.stringify({ sourceSha256: doc.sha256, counts: doc.counts, headings: 16, findings: findings.map((item) => `${item.id}:${item.status}`), localMarkdownCharacters: imported.state.sourceMarkdownLength, confirmedEdit: paragraph.location, report, revision }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
