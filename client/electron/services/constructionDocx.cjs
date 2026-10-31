const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { DOMParser } = require('@xmldom/xmldom');

const MiB = 1048576;
const limits = { file: 100 * MiB, entries: 2000, total: 300 * MiB, entry: 100 * MiB, xml: 40 * MiB, ratio: 300 };
function validateDocxSize(size) {
  if (!Number.isSafeInteger(size) || size < 1 || size > limits.file) throw new Error('DOCX 文件大小超出本地安全处理范围（上限 100 MiB）');
}
function validateDocxArchive(zip) {
  const entries = zip.getEntries();
  if (entries.length > limits.entries) throw new Error('DOCX 内部文件过多，已拒绝解析');
  let total = 0;
  const names = new Set();
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (name.startsWith('/') || name.split('/').includes('..') || names.has(name.toLowerCase())) throw new Error('DOCX 包含无效或重复的内部路径');
    names.add(name.toLowerCase());
    if (entry.isDirectory) continue;
    const size = entry.header.size, compressed = entry.header.compressedSize;
    if (entry.header.encrypted || !Number.isSafeInteger(size) || !Number.isSafeInteger(compressed) || size < 0 || compressed < 0 ||
      size > limits.entry || (/\.(?:xml|rels)$/i.test(name) && size > limits.xml) || (size > 0 && compressed === 0) ||
      size / Math.max(1, compressed) > limits.ratio) throw new Error(`DOCX 内部文件体积或压缩比异常：${name}`);
    total += size;
    if (total > limits.total) throw new Error('DOCX 解压后体积超出本地安全处理范围');
    if (/\.(?:xml|rels)$/i.test(name) && /<!DOCTYPE|<!ENTITY/i.test(entry.getData().toString('utf8'))) {
      throw new Error(`DOCX XML 包含不受支持的实体声明：${name}`);
    }
  }
  if (!names.has('word/document.xml')) throw new Error('DOCX 缺少 word/document.xml');
  return zip;
}
function openValidatedDocx(filePath) {
  validateDocxSize(fs.statSync(filePath).size);
  const bytes = fs.readFileSync(filePath);
  return { bytes, zip: validateDocxArchive(new AdmZip(bytes)) };
}
function safeXml(entry, parser) {
  const xml = entry.getData().toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DOCX XML 包含不受支持的实体声明');
  return parser.parseFromString(xml, 'text/xml');
}

const ns = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
};
const child = (node, name) => Array.from(node?.childNodes || []).find((item) => item.nodeType === 1 && item.localName === name);
const children = (node, name) => Array.from(node?.childNodes || []).filter((item) => item.nodeType === 1 && item.localName === name);
const all = (node, namespace, name) => Array.from(node?.getElementsByTagNameNS(namespace, name) || []);
const attr = (node, name, namespace) => node?.getAttributeNS(namespace || ns.w, name) || node?.getAttribute(name) || '';
function paragraphText(p) {
  const values = [];
  function walk(node) {
    if (node.nodeType !== 1) return;
    if (node.localName === 't' && node.namespaceURI === ns.w) values.push(node.textContent || '');
    else if (node.localName === 'tab' && node.namespaceURI === ns.w) values.push('\t');
    else if (node.localName === 'br' && node.namespaceURI === ns.w) values.push('\n');
    else for (const part of Array.from(node.childNodes || [])) walk(part);
  }
  walk(p);
  return values.join('').trim();
}
function isPlainTextParagraph(p) {
  let textNodes = 0;
  for (const node of Array.from(p.childNodes || []).filter((item) => item.nodeType === 1)) {
    if (node.namespaceURI !== ns.w) return false;
    if (node.localName === 'pPr') continue;
    if (node.localName !== 'r') return false;
    for (const part of Array.from(node.childNodes || []).filter((item) => item.nodeType === 1)) {
      if (part.namespaceURI !== ns.w) return false;
      if (part.localName === 'rPr') continue;
      if (part.localName !== 't') return false;
      textNodes += 1;
    }
  }
  return textNodes > 0;
}
function numericFacts(text, location) {
  const facts = [];
  const pattern = /(?:R\s*\d{1,2}|\d[\d,]*(?:\.\d+)?\s*(?:m³|m²|m3|m2|MPa|kW|mm|cm|m|%|‰|人|名|座|口|根|台|处|天|日|月|年|小时|h|万元|元))/gi;
  for (const match of text.matchAll(pattern)) facts.push({ raw: match[0], offset: match.index, location });
  return facts;
}
function parseDocx(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.docx') throw new Error('仅支持 DOCX');
  const { bytes, zip } = openValidatedDocx(filePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('DOCX 缺少 word/document.xml');
  const parser = new DOMParser({ errorHandler: { warning() {}, error(message) { throw new Error(message); }, fatalError(message) { throw new Error(message); } } });
  const xml = safeXml(entry, parser);
  const body = all(xml, ns.w, 'body')[0];
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  const rels = new Map();
  if (relsEntry) {
    const relXml = safeXml(relsEntry, parser);
    for (const rel of Array.from(relXml.getElementsByTagName('Relationship'))) rels.set(rel.getAttribute('Id'), { target: rel.getAttribute('Target'), type: rel.getAttribute('Type') });
  }
  const blocks = [], headings = [], images = [], facts = [];
  const trackedParagraphs = new WeakMap();
  const blockByLocation = new Map();
  let pIndex = 0, tIndex = 0, tableParagraphs = 0, tableCells = 0, chapter = '', section = '';
  function imageRefs(node, location) {
    const refs = [
      ...all(node, ns.a, 'blip').map((item) => attr(item, 'embed', ns.r)),
      ...Array.from(node.getElementsByTagName('*')).filter((item) => item.localName === 'imagedata' || item.localName === 'chart').map((item) => attr(item, 'id', ns.r)),
    ];
    for (const id of refs.filter(Boolean)) images.push({ location, relationshipId: id, ...(rels.get(id) || { target: '', type: '' }) });
  }
  function pushParagraph(p, location) {
    trackedParagraphs.set(p, location);
    const text = paragraphText(p);
    const style = attr(child(child(p, 'pPr'), 'pStyle'), 'val');
    const number = text.match(/^(第[一二三四五六七八九十百0-9]+章|\d+(?:\.\d+){1,3})(?:\s|　|(?=[^\d.]))/);
    const isHeading = Boolean(number) && text.length < 130;
    // Contents entries have a page number at the end and no paragraph body; keep them but do not set body context.
    const toc = Boolean(isHeading && /(?:\t|\s)\d{1,3}$/.test(text) && !/^\d+(?:\.\d+){1,3}\s*\d/.test(text));
    if (isHeading && !toc) {
      if (number[1].startsWith('第')) chapter = number[1];
      section = text;
    }
    const block = { kind: 'paragraph', location, text, style, chapter, section, isHeading, toc, editable: isPlainTextParagraph(p) };
    blocks.push(block);
    blockByLocation.set(location, block);
    if (isHeading) headings.push({ location, text, style, chapter, toc });
    facts.push(...numericFacts(text, location).map((fact) => ({ ...fact, chapter, section, text })));
    imageRefs(p, location);
  }
  for (const node of Array.from(body.childNodes || [])) {
    if (node.nodeType !== 1) continue;
    if (node.localName === 'p') {
      pIndex += 1;
      pushParagraph(node, `P${pIndex}`);
    } else if (node.localName === 'tbl') {
      tIndex += 1;
      const rows = [];
      for (const [r, row] of children(node, 'tr').entries()) {
        const cells = [];
        for (const [c, cell] of children(row, 'tc').entries()) {
          const paras = all(cell, ns.w, 'p').map(paragraphText);
          for (const nested of all(cell, ns.w, 'p')) trackedParagraphs.set(nested, `T${tIndex}.R${r + 1}.C${c + 1}`);
          tableParagraphs += paras.length;
          tableCells += 1;
          const location = `T${tIndex}.R${r + 1}.C${c + 1}`;
          const text = paras.join('\n').trim();
          cells.push({ location, text, paragraphs: paras, gridSpan: Number(attr(child(child(cell, 'tcPr'), 'gridSpan'), 'val') || 1), verticalMerge: attr(child(child(cell, 'tcPr'), 'vMerge'), 'val') || null });
          facts.push(...numericFacts(text, location).map((fact) => ({ ...fact, chapter, section, text })));
          imageRefs(cell, location);
        }
        rows.push(cells);
      }
      const block = { kind: 'table', location: `T${tIndex}`, chapter, section, rows };
      blocks.push(block);
      blockByLocation.set(block.location, block);
    }
  }
  const embeddedParagraphs = all(body, ns.w, 'p').filter((p) => !trackedParagraphs.has(p)).map((p, index) => {
    let parent = p.parentNode;
    while (parent && !trackedParagraphs.has(parent)) parent = parent.parentNode;
    const parentLocation = trackedParagraphs.get(parent) || '';
    const parentBlock = blockByLocation.get(parentLocation) || blockByLocation.get(parentLocation.split('.')[0]);
    return { location: `E${index + 1}`, parentLocation, chapter: parentBlock?.chapter || '', section: parentBlock?.section || '', text: paragraphText(p) };
  });
  const media = zip.getEntries().filter((item) => item.entryName.startsWith('word/media/') && !item.isDirectory).map((item) => ({ target: item.entryName, bytes: item.header.size }));
  return { fileName: path.basename(filePath), sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(), blocks, embeddedParagraphs, headings, facts, images, media, counts: { paragraphs: pIndex + tableParagraphs + embeddedParagraphs.length, bodyParagraphs: pIndex, tableParagraphs, embeddedParagraphs: embeddedParagraphs.length, tableCells, tables: tIndex, media: media.length, placedImages: images.length }, pageMapping: '未建立可靠渲染页码映射；使用段落/表格位置' };
}

module.exports = { parseDocx, numericFacts, isPlainTextParagraph, validateDocxSize, validateDocxArchive, openValidatedDocx, safeXml };
