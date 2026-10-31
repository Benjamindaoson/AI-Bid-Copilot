const fs = require('node:fs');
const path = require('node:path');
const { dialog } = require('electron');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const { extractRequirements, evaluateAll, riskReport, hash } = require('./manufacturingRules.cjs');

const DEFAULT_SKILLS = [
  { id: 'interpret', name: '招标文件解读', content: '场景：上传招标 PDF 或 Word 后梳理条款。\n材料：招标文件及补遗。\n步骤：按项目、截止、资格、商务、技术、评分、否决分类；逐项核对原文。\n规则：只记录可定位原文；页码不明写未定位；不得补造要求。\n输出：可编辑招标要求清单。\n人工确认：模糊或冲突条款由经办人确认。' },
  { id: 'matrix', name: '招标要求与企业资料对照', content: '场景：准备投标响应矩阵。\n材料：招标文件、企业资质、产品手册、技术参数、历史方案。\n步骤：逐项寻找证据并记录文件、行或页；比较数值、日期和金额。\n规则：缺证据一律待核实；确定性数值由程序比较。\n输出：要求、响应、证据、满足/不满足/待核实、待处理事项。\n人工确认：资质真实性与关键承诺必须确认。' },
  { id: 'writing', name: '投标技术方案编写', content: '场景：按评分要求编写技术或商务章节。\n材料：招标要求清单、企业产品资料、已确认承诺。\n步骤：按评分项建目录；逐章写响应；保留证据；局部修改。\n规则：不得虚构资质、业绩、参数、价格、工期和质保。\n输出：可编辑章节及 Word 文件。\n人工确认：所有关键承诺核实后才能定稿。' },
  { id: 'risk', name: '投标文件查漏和风险检查', content: '场景：提交前复核。\n材料：招标清单、企业资料、响应矩阵、报价和标书。\n步骤：检查缺失/过期资质、强制参数、遗漏、报价算术、交期、质保、附件及签章。\n规则：证据不足标待核实；只报告有依据的结论。\n输出：风险问题、判断依据、原文证据、建议、人工确认状态。\n人工确认：经办人逐项签认。' },
];

function createManufacturingWorkbench({ app, fileService, technicalPlanStore, saveDialog }) {
  const statePath = path.join(app.getPath('userData'), 'manufacturing-workbench.json');
  const freshState = () => ({ tenderHash: '', enterpriseHash: '', requirements: [], documents: [], deadline: '', chapter: '', chapterDrafts: [], skills: DEFAULT_SKILLS, riskConfirmations: {}, updatedAt: null });
  function load() {
    try { return { ...freshState(), ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; }
    catch { return freshState(); }
  }
  function save(next) {
    const state = { ...next, updatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temp = `${statePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temp, statePath);
    return view(state);
  }
  function tenderDocuments() {
    const plan = technicalPlanStore.loadTechnicalPlan();
    return (plan.tenderFiles || []).map((file) => ({ name: file.fileName, content: technicalPlanStore.readTenderSourceMarkdown(file.id) })).filter((doc) => doc.content);
  }
  function view(state) {
    const docs = tenderDocuments();
    const projectInfo = docs.map((doc) => {
      const lines = doc.content.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, '').trim()).filter(Boolean);
      const number = lines.find((line) => /项目编号\s*[:：]/.test(line)) || '';
      const deadlines = lines.filter((line) => /(?:投标|递交|提交)(?:文件)?截止(?:时间|日期)?/.test(line) && /\d{4}[年\/-]\d{1,2}[月\/-]\d{1,2}/.test(line)).map((text) => text.slice(0, 200));
      return { file: doc.name, name: lines[0] || '未提取到项目名', number, deadlines };
    });
    const deadlineConflict = new Set(projectInfo.flatMap((info) => info.deadlines.map((item) => item.match(/\d{4}[年\/-]\d{1,2}[月\/-]\d{1,2}(?:日|\s|T)*\d{1,2}[:：]\d{2}/)?.[0] || item))).size > 1;
    const currentHash = hash(docs.map((doc) => `${doc.name}\n${doc.content}`).join('\n'));
    const stale = Boolean(state.tenderHash && state.tenderHash !== currentHash);
    const enterpriseStale = state.documents.some((doc) => {
      try { return doc.sourcePath && hash(fs.readFileSync(doc.sourcePath)) !== doc.sourceHash; } catch { return Boolean(doc.sourcePath); }
    });
    let matrix = evaluateAll(state.requirements, state.documents, state.deadline);
    if (stale || enterpriseStale) matrix = matrix.map((row) => ({ ...row, status: '待核实', reason: '来源文件已变更，原结论失效', action: '重新导入并复核' }));
    const risks = riskReport(matrix, state.documents).map((risk) => ({ ...risk, confirmed: !stale && !enterpriseStale && Boolean(state.riskConfirmations[hash(risk.issue + risk.reason)]) }));
    const chapterIssues = chapterEvidenceIssues(state.chapterDrafts || [], state.requirements, matrix);
    return { ...state, tenderFiles: docs.map((doc) => doc.name), projectInfo, deadlineConflict, tenderStale: stale, enterpriseStale, matrix, risks, chapterIssues };
  }
  function chapterEvidenceIssues(drafts, requirements, matrix) {
    const byId = new Map(requirements.map((item) => [item.id, item]));
    const responses = new Map(matrix.map((row) => [row.requirement.id, row]));
    return drafts.flatMap((draft) => draft.requirementIds.flatMap((id) => {
      const requirement = byId.get(id);
      if (!requirement) return [{ chapterId: draft.id, requirementId: id, reason: '招标要求已失效，请重建章节' }];
      const marker = `${requirement.file} 第${requirement.line}行`;
      const issues = draft.body.includes(marker) && draft.body.includes(requirement.original) ? [] : [{ chapterId: draft.id, requirementId: id, reason: `缺少招标原文或定位：${marker}` }];
      const evidence = responses.get(id)?.evidence;
      if (evidence && (!draft.body.includes(`${evidence.file} 第${evidence.line}行`) || !draft.body.includes(evidence.text))) issues.push({ chapterId: draft.id, requirementId: id, reason: `缺少企业证据或定位：${evidence.file} 第${evidence.line}行` });
      return issues;
    }));
  }
  function analyze() {
    const docs = tenderDocuments();
    if (!docs.length) throw new Error('请先在投标文件工作台上传招标文件');
    const prev = load();
    const requirements = extractRequirements(docs);
    const deadlineText = docs.map((doc) => doc.content).join('\n').match(/(?:投标|递交|提交)(?:文件)?截止(?:时间|日期)?\s*[:：]?\s*(\d{4})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
    const deadline = deadlineText ? `${deadlineText[1]}-${deadlineText[2].padStart(2, '0')}-${deadlineText[3].padStart(2, '0')}` : prev.deadline;
    return save({ ...prev, tenderHash: hash(docs.map((doc) => `${doc.name}\n${doc.content}`).join('\n')),
      requirements, deadline, chapter: '', chapterDrafts: [], riskConfirmations: {} });
  }
  async function importEnterprise(filePaths) {
    const result = await fileService.importTechnicalPlanDocument('企业资料', { multiple: true, filePaths, preserveImages: false, assetScopePrefix: 'manufacturing-enterprise' });
    if (!result.success) return { success: false, message: result.message };
    const state = load();
    const incoming = (result.documents || []).map((doc) => ({ name: doc.file_name, content: doc.file_content, sourcePath: doc.source_path, sourceHash: hash(fs.readFileSync(doc.source_path)) }));
    const documents = [...state.documents.filter((doc) => !incoming.some((next) => next.name === doc.name)), ...incoming];
    return { success: true, message: result.message, state: save({ ...state, documents, enterpriseHash: hash(JSON.stringify(documents)), chapter: '', chapterDrafts: [], riskConfirmations: {} }) };
  }
  function update(patch) {
    const state = load();
    const allowed = {};
    if (Array.isArray(patch.requirements)) {
      const oldById = new Map(state.requirements.map((r) => [r.id, r]));
      allowed.requirements = patch.requirements.map((r) => {
        const text = String(r.text || '').slice(0, 2000);
        const changed = oldById.get(r.id)?.text !== text;
        return { ...r, text, note: String(r.note || '').slice(0, 2000), field: changed ? null : r.field };
      });
      allowed.riskConfirmations = {};
      if (JSON.stringify(allowed.requirements) !== JSON.stringify(state.requirements)) { allowed.chapterDrafts = []; allowed.chapter = ''; }
    }
    if (typeof patch.deadline === 'string') { allowed.deadline = patch.deadline.slice(0, 30); if (patch.deadline !== state.deadline) { allowed.riskConfirmations = {}; allowed.chapterDrafts = []; allowed.chapter = ''; } }
    if (typeof patch.chapter === 'string') allowed.chapter = patch.chapter.slice(0, 100000);
    if (Array.isArray(patch.chapterDrafts)) {
      const previous = new Map((state.chapterDrafts || []).map((item) => [item.id, item]));
      allowed.chapterDrafts = patch.chapterDrafts.filter((item) => previous.has(item.id)).map((item) => {
        const old = previous.get(item.id);
        const body = String(item.body || '').slice(0, 100000);
        const candidate = { ...old, body };
        return { ...candidate, confirmed: body === old.body && Boolean(item.confirmed) && chapterEvidenceIssues([candidate], state.requirements, evaluateAll(state.requirements, state.documents, state.deadline)).length === 0 };
      });
      allowed.chapter = allowed.chapterDrafts.map((item) => item.body).join('\n\n');
    }
    if (Array.isArray(patch.skills)) allowed.skills = patch.skills.map((s) => ({ id: s.id, name: String(s.name || '').slice(0, 100), content: String(s.content || '').slice(0, 20000) }));
    if (patch.riskConfirmations && typeof patch.riskConfirmations === 'object') allowed.riskConfirmations = patch.riskConfirmations;
    return save({ ...state, ...allowed });
  }
  function generateChapterDraft() {
    const state = load();
    const current = view(state);
    if (current.tenderStale || current.enterpriseStale) throw new Error('来源文件已变化，请重新解读招标文件并重新导入企业资料');
    if (!state.requirements.length) throw new Error('请先导入并解读招标文件');
    const rows = evaluateAll(state.requirements, state.documents, state.deadline);
    const groups = [
      { id: 'qualification', title: '资格与商务响应', categories: ['资格要求', '商务要求', '关键时间'] },
      { id: 'technical', title: '技术参数响应', categories: ['技术参数'] },
      { id: 'scoring', title: '评分项对应方案', categories: ['评分标准'] },
      { id: 'clauses', title: '必答条款与附件核对', categories: ['响应条款', '否决风险'] },
    ];
    const chapterDrafts = groups.map((group) => {
      const items = rows.filter((row) => group.categories.includes(row.requirement.category));
      if (!items.length) return null;
      const body = [`# ${group.title}`, '仅根据已上传材料整理；待核实项不得作为正式承诺。'];
      for (const row of items) {
        body.push('', `## ${row.requirement.text}`, `招标证据：${row.requirement.file} 第${row.requirement.line}行${row.requirement.page ? `，第${row.requirement.page}页` : '，页码未定位'}；${row.requirement.original}`);
        body.push(row.status === '满足' ? `已有企业证据：${row.response}` : `待处理（${row.status}）：${row.reason}`);
        if (row.evidence) body.push(`企业资料：${row.evidence.file} 第${row.evidence.line}行；${row.evidence.text}`);
      }
      return { id: group.id, title: group.title, requirementIds: items.map((row) => row.requirement.id), body: body.join('\n'), confirmed: false };
    }).filter(Boolean);
    return save({ ...state, chapterDrafts, chapter: chapterDrafts.map((item) => item.body).join('\n\n') });
  }
  function confirmRisk(issue, reason, confirmed) {
    const state = load();
    return save({ ...state, riskConfirmations: { ...state.riskConfirmations, [hash(String(issue) + String(reason))]: Boolean(confirmed) } });
  }
  async function exportWord() {
    const state = view(load());
    const result = await (saveDialog || dialog.showSaveDialog)({ title: '导出制造企业投标核验报告', defaultPath: '制造企业投标核验报告.docx', filters: [{ name: 'Word 文档', extensions: ['docx'] }] });
    if (result.canceled || !result.filePath) return { success: false, message: '已取消导出' };
    const p = (text, heading) => new Paragraph({ text: String(text || ''), ...(heading ? { heading } : {}) });
    const children = [p('制造企业投标核验报告', HeadingLevel.TITLE), p(`生成时间：${new Date().toLocaleString('zh-CN')}`),
      p('招标要求清单', HeadingLevel.HEADING_1), ...state.requirements.flatMap((r) => [p(`[${r.category}] ${r.text}`), p(`来源：${r.file} 第${r.line}行；${r.page ? `第${r.page}页` : '页码未定位'}`)]),
      p('投标响应矩阵', HeadingLevel.HEADING_1), ...state.matrix.flatMap((row) => [p(`${row.status}｜${row.requirement.text}`), p(`企业响应：${row.response || '待核实'}`), p(`证据：${row.evidence ? `${row.evidence.file} 第${row.evidence.line}行` : '未找到'}`), p(`判断：${row.reason}`)]),
      p('投标风险检查报告', HeadingLevel.HEADING_1), ...state.risks.flatMap((risk) => [p(risk.issue), p(`判断依据：${risk.reason}`), p(`招标原文：${risk.tenderEvidence ? `${risk.tenderEvidence.file} 第${risk.tenderEvidence.line}行 ${risk.tenderEvidence.text}` : '见报价算术项'}`), p(`企业证据：${risk.evidence ? `${risk.evidence.file} 第${risk.evidence.line}行 ${risk.evidence.text}` : '未找到'}`), p(`处理建议：${risk.action}；人工确认：${risk.confirmed ? '已确认' : '待确认'}`)]),
      p('技术/商务响应草稿（须人工核实）', HeadingLevel.HEADING_1), ...state.chapterDrafts.flatMap((draft) => [p(`${draft.title}｜${draft.confirmed ? '人工已确认' : '待人工确认'}`, HeadingLevel.HEADING_2), ...draft.body.split('\n').filter(Boolean).map((line) => p(line.replace(/^#+\s*/, ''), line.startsWith('## ') ? HeadingLevel.HEADING_3 : undefined))])];
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
    fs.writeFileSync(result.filePath, buffer);
    return { success: true, filePath: result.filePath, bytes: buffer.length };
  }
  return { load: () => view(load()), analyze, importEnterprise, update, generateChapterDraft, confirmRisk, exportWord };
}
module.exports = { createManufacturingWorkbench, DEFAULT_SKILLS };
