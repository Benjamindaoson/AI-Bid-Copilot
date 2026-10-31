const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const AdmZip = require('adm-zip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { parseDocx } = require('../electron/services/constructionDocx.cjs');

function paragraph(zip, location) {
  const xml = new DOMParser().parseFromString(zip.getEntry('word/document.xml').getData().toString('utf8'), 'text/xml');
  return Array.from(xml.getElementsByTagName('w:body')[0].childNodes)
    .filter((node) => node.nodeType === 1 && node.localName === 'p')[Number(location.slice(1)) - 1];
}
function main() {
  const [sourcePath, revisedPath, expectedLocation] = process.argv.slice(2);
  if (!sourcePath || !revisedPath || !/^P\d+$/.test(expectedLocation || '')) throw new Error('Usage: node verify-construction-revision.cjs source.docx revised.docx Pnnn');
  const original = parseDocx(sourcePath), revised = parseDocx(revisedPath);
  assert.deepEqual(revised.counts, original.counts, '段落、表格、媒体与图片关系计数');
  const changes = original.blocks.filter((block, index) => {
    const after = revised.blocks[index];
    assert.equal(after?.location, block.location, '原文位置顺序');
    return JSON.stringify(block.kind === 'table' ? block.rows : block.text) !== JSON.stringify(after.kind === 'table' ? after.rows : after.text);
  }).map((block) => block.location);
  assert.deepEqual(changes, [expectedLocation], '仅指定段落有正文变化');
  const sourceZip = new AdmZip(sourcePath), revisedZip = new AdmZip(revisedPath);
  const names = sourceZip.getEntries().map((entry) => entry.entryName).sort();
  assert.deepEqual(revisedZip.getEntries().map((entry) => entry.entryName).sort(), names, 'Word 包部件清单');
  for (const name of names.filter((entry) => entry !== 'word/document.xml')) assert.deepEqual(revisedZip.getEntry(name).getData(), sourceZip.getEntry(name).getData(), `${name} 未改变`);
  const properties = (zip) => Array.from(paragraph(zip, expectedLocation).getElementsByTagName('w:rPr')).map((node) => new XMLSerializer().serializeToString(node));
  assert.deepEqual(properties(revisedZip), properties(sourceZip), '目标段落 run 格式属性');
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
  console.log(JSON.stringify({ sourceSha256: hash(sourcePath), revisedSha256: hash(revisedPath), changedLocations: changes, counts: revised.counts, otherPackagePartsIdentical: true, targetRunPropertiesIdentical: true }, null, 2));
}
main();
