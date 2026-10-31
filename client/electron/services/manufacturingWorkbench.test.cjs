const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { createManufacturingWorkbench } = require('./manufacturingWorkbench.cjs');

test('synthetic tender produces editable, cited chapters with explicit confirmation', async () => {
  const fixture = path.resolve(__dirname, '../../scripts/fixtures/construction-dev');
  const output = fs.mkdtempSync(path.resolve(__dirname, '../../scripts/fixtures/.workbench-test-'));
  let tender = fs.readFileSync(path.join(fixture, 'tender.md'), 'utf8');
  const enterprise = fs.readFileSync(path.join(fixture, 'enterprise.md'), 'utf8');
  const service = createManufacturingWorkbench({
    app: { getPath: () => output },
    saveDialog: async () => ({ canceled: false, filePath: path.join(output, 'synthetic-review.docx') }),
    fileService: { importTechnicalPlanDocument: async () => ({ success: true, message: '已导入', documents: [{ file_name: 'enterprise.md', file_content: enterprise, source_path: path.join(fixture, 'enterprise.md') }] }) },
    technicalPlanStore: { loadTechnicalPlan: () => ({ tenderFiles: [{ id: 'tender', fileName: 'tender.md' }] }), readTenderSourceMarkdown: () => tender },
  });
  try {
    service.analyze();
    await service.importEnterprise();
    const state = service.generateChapterDraft();
    assert.ok(state.chapterDrafts.length >= 3);
    assert.ok(state.chapterDrafts.every((chapter) => chapter.requirementIds.length && !chapter.confirmed));
    assert.deepEqual(state.chapterDrafts.flatMap((chapter) => chapter.requirementIds).sort(), state.requirements.map((requirement) => requirement.id).sort(), '每条招标要求恰好进入一个章节');
    assert.ok(state.chapterDrafts.some((chapter) => chapter.body.includes('安全生产许可证') && chapter.body.includes('tender.md 第')));
    assert.ok(state.chapterDrafts.some((chapter) => chapter.body.includes('待处理（不满足）')));
    const first = state.chapterDrafts[0];
    const edited = service.update({ chapterDrafts: state.chapterDrafts.map((chapter) => chapter.id === first.id ? { ...chapter, body: `${chapter.body}\n人工补充：待核实。`, confirmed: true } : chapter) });
    assert.equal(edited.chapterDrafts[0].confirmed, false, '修改正文不能顺带确认');
    const confirmed = service.update({ chapterDrafts: edited.chapterDrafts.map((chapter) => chapter.id === first.id ? { ...chapter, confirmed: true } : chapter) });
    assert.equal(confirmed.chapterDrafts[0].confirmed, true);
    const exported = await service.exportWord();
    assert.equal(exported.success, true);
    const zip = new AdmZip(exported.filePath);
    const documentXml = zip.getEntry('word/document.xml').getData().toString('utf8');
    assert.ok(documentXml.includes('人工已确认') && documentXml.includes('待人工确认'));
    assert.ok(documentXml.includes('人工补充：待核实。'));
    const marker = confirmed.chapterDrafts[0].body.match(/tender\.md 第\d+行/)[0];
    const broken = service.update({ chapterDrafts: confirmed.chapterDrafts.map((chapter) => chapter.id === first.id ? { ...chapter, body: chapter.body.replace(marker, '来源不详') } : chapter) });
    assert.ok(broken.chapterIssues.some((issue) => issue.chapterId === first.id));
    const rejected = service.update({ chapterDrafts: broken.chapterDrafts.map((chapter) => chapter.id === first.id ? { ...chapter, confirmed: true } : chapter) });
    assert.equal(rejected.chapterDrafts[0].confirmed, false, '缺失原文定位不能确认');
    tender += '\n补遗：施工现场需复核。';
    assert.equal(service.load().tenderStale, true);
    assert.ok(service.load().matrix.every((row) => row.status === '待核实'));
    assert.throws(() => service.generateChapterDraft(), /来源文件已变化/);
    assert.equal(service.analyze().chapterDrafts.length, 0, '招标文件变化使旧章节失效');
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
