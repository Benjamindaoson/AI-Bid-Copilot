const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Document, Packer, Paragraph } = require('docx');
const AdmZip = require('adm-zip');
const { createConstructionCheckService } = require('./constructionCheckService.cjs');

test('semantic review requires exact document hash and destination authorization before model call', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-semantic-test-'));
  const source = path.join(root, 'synthetic.docx');
  const userData = path.join(root, 'profile');
  const destination = 'https://synthetic-model.invalid';
  let calls = 0;
  let approval = 0;
  try {
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('主体阶段配备安全员2人。'), new Paragraph('主体阶段配备安全员4人。'),
    ] }] }));
    fs.writeFileSync(source, bytes);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
    const stateDir = path.join(userData, 'workspace', 'construction-check');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({ sourcePath: source, originalName: 'synthetic.docx', sourceHash: hash, sourceMarkdownLength: 0, confirmations: {}, edits: {} }));
    const service = createConstructionCheckService({
      app: { getPath: () => userData }, dialog: { showMessageBox: async () => ({ response: approval }) },
      configStore: { load: () => ({ base_url: `${destination}/v1` }) },
      aiService: { requestJson: async (request) => {
        calls += 1;
        const output = request.normalizer({ pairs: [{ factIds: ['F1', 'F2'], explanation: '模型仅建议关联' }] });
        request.validator(output);
        return output;
      } },
    });
    await assert.rejects(service.semanticReview({ approved: true, sourceHash: 'wrong', destination }), /确认当前文件摘要/);
    await assert.rejects(service.semanticReview({ approved: true, sourceHash: hash, destination: 'https://other.invalid' }), /确认当前文件摘要/);
    assert.equal(calls, 0);
    await assert.rejects(service.semanticReview({ approved: true, sourceHash: hash, destination }), /已取消模型语义复核/);
    assert.equal(calls, 0);
    approval = 1;
    const reviewed = await service.semanticReview({ approved: true, sourceHash: hash, destination });
    assert.equal(calls, 1);
    assert.equal(reviewed.semanticReview.candidateCount, 1);
    assert.equal(reviewed.semanticReview.results[0].status, '明确矛盾');
    assert.equal(reviewed.semanticReview.results[0].id, 'F1|F2');
    assert.deepEqual(reviewed.semanticReview.results[0].evidence.map((item) => item.location), ['P1', 'P2']);
    assert.throws(() => service.decideSemanticFinding('F1|F999', 'accepted'), /模型建议不存在/);
    assert.throws(() => service.decideSemanticFinding('F1|F2', 'approved'), /人工决定无效/);
    assert.equal(service.decideSemanticFinding('F1|F2', 'accepted').semanticReview.decisions['F1|F2'], 'accepted');
    const reportPath = path.join(root, 'synthetic-report.docx');
    const report = await service.exportAudit(reportPath);
    assert.equal(report.success, true);
    const reportXml = new AdmZip(reportPath).readAsText('word/document.xml');
    assert.match(reportXml, /模型语义复核/);
    assert.match(reportXml, /数值判断由本地规则复核/);
    assert.match(reportXml, /接受此判断/);
    assert.doesNotMatch(reportXml, /未使用模型/);
    assert.equal(service.decideSemanticFinding('F1|F2', 'rejected').semanticReview.decisions['F1|F2'], 'rejected');
    assert.equal(service.decideSemanticFinding('F1|F2', 'pending').semanticReview.decisions['F1|F2'], undefined);
    assert.equal(calls, 1, 'human decisions cannot trigger another model call');
    fs.appendFileSync(source, 'changed');
    assert.equal(service.load().semanticReview, null, 'source changes invalidate model conclusions');
    assert.throws(() => service.decideSemanticFinding('F1|F2', 'accepted'), /已失效/);
  } finally {
    const relative = path.relative(os.tmpdir(), root);
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(root).startsWith('yibiao-semantic-test-')) fs.rmSync(root, { recursive: true, force: true });
  }
});
