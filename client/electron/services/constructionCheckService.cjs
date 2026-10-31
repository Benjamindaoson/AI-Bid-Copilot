const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const branding = require('../../product-branding.json');
const { parseDocx, isPlainTextParagraph, openValidatedDocx } = require('./constructionDocx.cjs');
const { auditDocument } = require('./constructionAudit.cjs');
const { indexDocumentFacts, selectCandidatePairs, runModelSemanticReview } = require('./constructionFactIntelligence.cjs');

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const brief = (text, max = 380) => text.length > max ? `${text.slice(0, max)}…` : text;
function section417(doc) {
  const start = doc.blocks.findIndex((block) => block.kind === 'paragraph' && /^4\.17(?:\s|[^\d.])/.test(block.text));
  if (start < 0) return [];
  let end = doc.blocks.findIndex((block, i) => i > start && block.kind === 'paragraph' && (/^4\.(?:1[8-9]|[2-9]\d)(?:\s|[^\d.])/.test(block.text) || /^第五章/.test(block.text)));
  if (end < 0) end = doc.blocks.length;
  return doc.blocks.slice(start, end);
}
function suggestions(doc, findings) {
  const section = section417(doc);
  const slip = findings.find((item) => item.id === 'anti-slip');
  const range = section.filter((block) => block.kind === 'paragraph' && /适老化|防滑|无高差/.test(block.text)).slice(0, 8);
  return [
    { id: 'slip', title: '统一防滑指标口径', status: slip?.status === '无问题' ? '已一致' : '待核实', text: '4.17.2 指标表与 4.17.5 施工文字的湿态 COF 数值不同。确认适用区域、检测条件和设计要求后，仅修改已核实的文字；不得自行选用较高或较低值。', evidence: slip?.evidence || [] },
    { id: 'scope', title: '区分总则与分项工艺', status: '建议', text: '保留 4.17.2 的控制指标表，在各分项工艺段落引用该表；重复叙述可精简，但保留施工做法、检验批及验收依据。', evidence: range.map((block) => ({ location: block.location, chapter: block.chapter, section: block.section, text: brief(block.text, 180) })) },
    { id: 'external', title: '核实外部依据', status: '待核实', text: '招标文件、设计图纸、产品检测报告及企业实际承诺未随本 DOCX 提供。本地体检不能确认规范条文现行性或项目最终技术指标。', evidence: section.filter((block) => block.kind === 'paragraph' && /按设计|检测报告/.test(block.text)).slice(0, 4).map((block) => ({ location: block.location, chapter: block.chapter, section: block.section, text: brief(block.text, 180) })) },
  ];
}
function replaceParagraphText(paragraph, replacement) {
  if (!isPlainTextParagraph(paragraph)) throw new Error('目标段落包含图片、域、链接或其他复杂元素，已拒绝自动修订');
  const textNodes = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 't'));
  const original = textNodes.map((node) => node.textContent || '').join('');
  if (original === replacement) return;
  let prefix = 0;
  while (prefix < original.length && prefix < replacement.length && original[prefix] === replacement[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < original.length - prefix && suffix < replacement.length - prefix && original[original.length - suffix - 1] === replacement[replacement.length - suffix - 1]) suffix += 1;
  const end = original.length - suffix;
  const inserted = replacement.slice(prefix, replacement.length - suffix);
  let cursor = 0, placed = false;
  for (const node of textNodes) {
    const value = node.textContent || '';
    const nextCursor = cursor + value.length;
    let next = '';
    if (cursor < prefix) next += value.slice(0, Math.min(value.length, prefix - cursor));
    if (!placed && cursor <= prefix && prefix <= nextCursor) { next += inserted; placed = true; }
    if (nextCursor > end) next += value.slice(Math.max(0, end - cursor));
    node.textContent = next;
    node.setAttribute('xml:space', 'preserve');
    cursor = nextCursor;
  }
  if (!placed || textNodes.map((node) => node.textContent || '').join('') !== replacement) throw new Error('修订后文本校验失败');
}
function writeRevision(sourcePath, destination, edits) {
  const { zip } = openValidatedDocx(sourcePath);
  const entry = zip.getEntry('word/document.xml');
  const xml = new DOMParser().parseFromString(entry.getData().toString('utf8'), 'text/xml');
  const body = xml.getElementsByTagNameNS(WORD_NS, 'body')[0];
  const paragraphs = Array.from(body.childNodes).filter((node) => node.nodeType === 1 && node.localName === 'p');
  for (const [location, replacement] of Object.entries(edits)) {
    const index = Number(location.match(/^P(\d+)$/)?.[1]);
    const paragraph = paragraphs[index - 1];
    if (!paragraph) throw new Error(`无法定位修订段落：${location}`);
    replaceParagraphText(paragraph, replacement);
  }
  zip.updateFile('word/document.xml', Buffer.from(new XMLSerializer().serializeToString(xml), 'utf8'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  zip.writeZip(destination);
  return { filePath: destination, bytes: fs.statSync(destination).size, sha256: sha(destination) };
}
function createConstructionCheckService({ app, dialog, aiService, configStore }) {
  const base = path.join(app.getPath('userData'), 'workspace', 'construction-check');
  const statePath = path.join(base, 'state.json');
  let cached = null;
  function modelDestination() {
    try { return new URL(configStore?.load?.().base_url || '').origin; } catch { return ''; }
  }
  function readState() {
    try { const saved = JSON.parse(fs.readFileSync(statePath, 'utf8')); return { ...saved, confirmations: saved.confirmations || {}, edits: saved.edits || {} }; }
    catch { return { sourcePath: '', originalName: '', sourceHash: '', sourceMarkdownLength: 0, confirmations: {}, edits: {} }; }
  }
  function saveState(state) {
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(`${statePath}.tmp`, statePath);
  }
  function documentFor(state) {
    if (!state.sourcePath || !fs.existsSync(state.sourcePath)) return null;
    const currentHash = sha(state.sourcePath);
    if (cached?.sourcePath === state.sourcePath && cached.hash === currentHash) return cached.doc;
    const doc = parseDocx(state.sourcePath);
    cached = { sourcePath: state.sourcePath, hash: currentHash, doc };
    return doc;
  }
  function load() {
    const state = readState();
    const doc = documentFor(state);
    if (!doc) return { ...state, stale: false, counts: null, outline: [], findings: [], sectionBlocks: [], facts: [], images: [], suggestions: [], pageMapping: '', modelDestination: modelDestination(), semanticReview: null };
    const stale = doc.sha256 !== state.sourceHash;
    const findings = auditDocument(doc).map((item) => ({ ...item, confirmed: !stale && Boolean(state.confirmations[item.id]) }));
    const sectionBlocks = section417(doc).map((block) => ({ ...block, editedText: state.edits[block.location]?.text || '', editConfirmed: Boolean(state.edits[block.location]?.confirmed) }));
    return { ...state, stale, counts: doc.counts, outline: doc.headings.filter((item) => !item.toc), findings, sectionBlocks, facts: doc.facts.filter((item) => sectionBlocks.some((block) => block.location === item.location)).slice(0, 160), images: doc.images, media: doc.media, suggestions: suggestions(doc, findings), pageMapping: doc.pageMapping, modelDestination: modelDestination(), semanticReview: !stale && state.semanticReview?.sourceHash === doc.sha256 ? state.semanticReview : null };
  }
  async function importFile(filePath) {
    let selected = filePath;
    if (!selected) {
      const choice = await dialog.showOpenDialog({ title: '导入施工技术文件 DOCX', properties: ['openFile'], filters: [{ name: 'Word 文档', extensions: ['docx'] }] });
      if (choice.canceled || !choice.filePaths?.length) return { success: false, message: '已取消导入' };
      selected = choice.filePaths[0];
    }
    if (path.extname(selected).toLowerCase() !== '.docx') throw new Error('仅支持 DOCX');
    const doc = parseDocx(selected);
    const originalHash = doc.sha256;
    const sourcePath = path.join(base, 'source', `${crypto.randomUUID()}.docx`);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.copyFileSync(selected, sourcePath);
    if (sha(sourcePath) !== originalHash) throw new Error('导入副本校验失败');
    // Reuse OpenBidKit's local DOCX-to-Markdown converter; never consult the configured remote parser.
    const { convertPathToMarkdown } = await import('./doc2markdown/convert.mjs');
    const markdown = await convertPathToMarkdown(sourcePath, { includeImages: false });
    const state = { sourcePath, originalPath: path.resolve(selected), originalName: path.basename(selected), sourceHash: originalHash, sourceMarkdownLength: markdown.length, confirmations: {}, edits: {}, semanticReview: null, importedAt: new Date().toISOString() };
    saveState(state);
    cached = { sourcePath, hash: originalHash, doc };
    return { success: true, state: load() };
  }
  function confirmFinding(id, confirmed) {
    const state = readState();
    const doc = documentFor(state);
    if (!doc || doc.sha256 !== state.sourceHash) throw new Error('原文副本缺失或已变更，请重新导入');
    if (!auditDocument(doc).some((item) => item.id === id)) throw new Error('问题不存在');
    state.confirmations[id] = Boolean(confirmed);
    saveState(state);
    return load();
  }
  async function semanticReview(authorization) {
    const state = readState();
    const doc = documentFor(state);
    if (!doc || doc.sha256 !== state.sourceHash) throw new Error('源副本缺失或已变更，请重新导入');
    const destination = modelDestination();
    if (!destination || !authorization?.approved || authorization.sourceHash !== state.sourceHash || authorization.destination !== destination) throw new Error('需先确认当前文件摘要及模型接收地址，才可传送原文片段');
    const facts = indexDocumentFacts(doc);
    const candidateCount = selectCandidatePairs(facts).length;
    if (candidateCount) {
      const choice = await dialog.showMessageBox({
        type: 'warning', buttons: ['取消', '同意发送候选原文片段'], defaultId: 0, cancelId: 0, noLink: true,
        message: '确认向当前文本模型发送本文件的原文片段？',
        detail: `文件 SHA-256：${state.sourceHash}\n模型入口：${destination}\n候选对：${candidateCount}。模型服务方可能继续转发；请先确认资料授权范围。`,
      });
      if (choice.response !== 1) throw new Error('已取消模型语义复核，未发送文档片段');
    }
    const result = await runModelSemanticReview({ facts, aiService });
    state.semanticReview = { sourceHash: doc.sha256, destination, analyzedAt: new Date().toISOString(), decisions: {}, ...result };
    saveState(state);
    return load();
  }
  function decideSemanticFinding(id, decision) {
    const state = readState();
    const doc = documentFor(state);
    if (!doc || doc.sha256 !== state.sourceHash || state.semanticReview?.sourceHash !== doc.sha256) throw new Error('语义复核结果已失效，请重新导入或审查');
    if (!state.semanticReview.results.some((item) => item.id === id)) throw new Error('模型建议不存在');
    if (!['accepted', 'rejected', 'pending'].includes(decision)) throw new Error('人工决定无效');
    state.semanticReview.decisions ||= {};
    if (decision === 'pending') delete state.semanticReview.decisions[id];
    else state.semanticReview.decisions[id] = decision;
    saveState(state);
    return load();
  }
  function confirmEdit(location, text, confirmed) {
    const state = readState();
    const doc = documentFor(state);
    if (!doc || doc.sha256 !== state.sourceHash) throw new Error('原文副本缺失或已变更，请重新导入');
    const block = section417(doc).find((item) => item.location === location && item.kind === 'paragraph' && !item.isHeading);
    if (!block) throw new Error('只允许修改 4.17 节正文段落');
    if (!block.editable) throw new Error('本段包含复杂 Word 元素，需在 Word 中人工修改');
    if (!text.trim() || text === block.text) delete state.edits[location];
    else state.edits[location] = { text, confirmed: Boolean(confirmed), original: block.text };
    saveState(state);
    return load();
  }
  async function resolveOutput(requested, name) {
    if (requested) return requested;
    const result = await dialog.showSaveDialog({ title: `导出${name}`, defaultPath: name, filters: [{ name: 'Word 文档', extensions: ['docx'] }] });
    return result.canceled ? '' : result.filePath;
  }
  function assertSafeDestination(destination, state) {
    const target = path.resolve(destination).toLowerCase();
    if ([state.sourcePath, state.originalPath].filter(Boolean).some((source) => path.resolve(source).toLowerCase() === target) ||
      (fs.existsSync(destination) && sha(destination) === state.sourceHash)) {
      throw new Error('导出位置指向导入原文，已拒绝覆盖；请选择其他文件名');
    }
  }
  async function exportAudit(outputPath) {
    const state = load();
    if (!state.sourcePath || state.stale) throw new Error('请导入有效的 DOCX');
    const destination = await resolveOutput(outputPath, '标书体检报告.docx');
    if (!destination) return { success: false, message: '已取消导出' };
    assertSafeDestination(destination, state);
    const children = [new Paragraph({ text: '施工技术文件标书体检报告', heading: HeadingLevel.TITLE }),
      new Paragraph({ children: [new TextRun({ text: '来源：', bold: true }), state.originalName] }),
      new Paragraph({ text: `原文 SHA-256：${state.sourceHash}` }),
      new Paragraph({ text: `范围：本地 DOCX 结构与文字核查。${state.pageMapping}；${state.semanticReview ? '模型仅对候选事实提供语义建议，数值判断由本地规则复核' : '未使用模型'}；未核对缺失的招标文件、图纸和企业材料。` })];
    for (const issue of state.findings) {
      children.push(new Paragraph({ text: `${issue.title} — ${issue.status}`, heading: HeadingLevel.HEADING_1 }));
      children.push(new Paragraph({ text: `说明：${issue.explanation}` }));
      children.push(new Paragraph({ text: `处理建议：${issue.advice}` }));
      children.push(new Paragraph({ text: `人工确认：${issue.confirmed ? '已确认问题记录' : '待确认'}` }));
      for (const evidence of issue.evidence) children.push(new Paragraph({ text: `原文 ${evidence.chapter || ''} ${evidence.location}：${brief(evidence.text, 520)}` }));
    }
    if (state.semanticReview) {
      children.push(new Paragraph({ text: '模型语义复核（本地数值复核后）', heading: HeadingLevel.HEADING_1 }));
      children.push(new Paragraph({ text: `模型接收地址：${state.semanticReview.destination}；候选对 ${state.semanticReview.candidateCount}；返回 ${state.semanticReview.results.length} 项。结果仍需人工确认。` }));
      for (const result of state.semanticReview.results) {
        children.push(new Paragraph({ text: `${result.status}：${result.reason}${result.distinction ? `（${result.distinction}）` : ''}` }));
        const decision = state.semanticReview.decisions?.[result.id] || 'pending';
        children.push(new Paragraph({ text: `人工决定：${decision === 'accepted' ? '接受此判断' : decision === 'rejected' ? '排除此建议' : '待确认'}` }));
        for (const evidence of result.evidence) children.push(new Paragraph({ text: `原文 ${evidence.chapter || ''} ${evidence.location}：${brief(evidence.quote, 520)}` }));
      }
    }
    const bytes = await Packer.toBuffer(new Document({ creator: branding.productName, lastModifiedBy: branding.productName, sections: [{ children }] }));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    return { success: true, filePath: destination, bytes: bytes.length, sha256: sha(destination) };
  }
  async function exportRevision(outputPath) {
    const state = readState();
    const doc = documentFor(state);
    if (!doc || doc.sha256 !== state.sourceHash) throw new Error('原文副本缺失或已变更');
    const edits = Object.fromEntries(Object.entries(state.edits).filter(([, value]) => value.confirmed).map(([location, value]) => [location, value.text]));
    if (!Object.keys(edits).length) throw new Error('尚无已人工确认的 4.17 节局部修改');
    const destination = await resolveOutput(outputPath, '适老化专项修订稿.docx');
    if (!destination) return { success: false, message: '已取消导出' };
    assertSafeDestination(destination, state);
    return { success: true, ...writeRevision(state.sourcePath, destination, edits), editedLocations: Object.keys(edits) };
  }
  return { load, importFile, confirmFinding, confirmEdit, semanticReview, decideSemanticFinding, exportAudit, exportRevision };
}
module.exports = { createConstructionCheckService, section417, writeRevision, replaceParagraphText };
