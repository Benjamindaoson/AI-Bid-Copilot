const crypto = require('node:crypto');

const FIELD_RULES = [
  { key: 'delivery', label: '交货期', pattern: /交(?:货|付)(?:期|期限|时间)|工期/, unit: '天', direction: 'max' },
  { key: 'warranty', label: '质保期', pattern: /质保(?:期|期限)|保修期/, unit: '月', direction: 'min' },
  { key: 'pressure', label: '额定排气压力', pattern: /(?:额定)?排气压力/, unit: 'MPa', direction: 'min' },
  { key: 'flow', label: '额定排气量', pattern: /(?:额定)?排气量|排气流量/, unit: 'm³/min', direction: 'min' },
  { key: 'power', label: '电机功率', pattern: /电机功率|装机功率/, unit: 'kW', direction: 'max' },
  { key: 'certificate', label: '资质证书', pattern: /证书|资质|认证|许可证/, direction: 'date' },
  { key: 'safetyStaff', label: '专职安全人员', pattern: /专职安全(?:生产管理)?人员|专职安全员/, unit: '人', direction: 'min' },
  { key: 'price', label: '报价', pattern: /(?:投标)?报价|总价|最高限价/, unit: '元', direction: 'max' },
];

const REQUIREMENT_PATTERN = /应当|应|必须|不得|不低于|不少于|不超过|≤|≥|至少|不小于|不大于|要求|满分|否决|无效|废标|截止|评分|提供|提交|盖章|签字/;
const MANDATORY_PATTERN = /必须|应当|应(?=提供|提交|包含|说明|配备|附)|不得|不低于|不少于|不超过|至少|不小于|不大于|否决|无效|废标|实质性|★|▲|强制|不接受/;

function hash(value) { return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value || '')).digest('hex'); }
function normalizedLines(markdown) { return String(markdown || '').replace(/\r\n?/g, '\n').split('\n'); }
function fieldFor(text) { return FIELD_RULES.find((rule) => rule.pattern.test(text)) || null; }
function categoryFor(text) {
  if (/否决|无效|废标|签字|盖章/.test(text)) return '否决风险';
  if (/评分|得分|满分/.test(text)) return '评分标准';
  if (/排气|压力|功率|技术|参数/.test(text)) return '技术参数';
  if (/资质|证书|资格|许可证|专职安全/.test(text)) return '资格要求';
  if (/价格|报价|交货|质保|商务/.test(text)) return '商务要求';
  if (/截止/.test(text)) return '关键时间';
  return '响应条款';
}
function extractRequirements(documents) {
  const results = [];
  for (const doc of documents || []) {
    let section = '';
    let page = null;
    normalizedLines(doc.content).forEach((raw, index) => {
      const text = raw.replace(/^\s*[-*\d.、()（）]+\s*/, '').trim();
      const pageMark = raw.match(/<!--\s*p:(\d+)\s*-->/i);
      if (pageMark) page = Number(pageMark[1]);
      if (/^#{1,6}\s+/.test(raw)) section = raw.replace(/^#+\s*/, '').trim();
      if (/^(?:资格与商务要求|技术参数|评分标准|否决投标与附件|否决条款|响应文件要求)$/.test(text)) { section = text; return; }
      if (!text || text.startsWith('#') || !REQUIREMENT_PATTERN.test(text) || text.length > 600) return;
      const field = fieldFor(text);
      results.push({ id: hash(`${doc.name}:${index}:${text}`).slice(0, 16), text, original: raw.trim(), file: doc.name,
        section, line: index + 1, page, category: categoryFor(text), mandatory: MANDATORY_PATTERN.test(text),
        field: field?.key || null, confirmed: false, note: '' });
    });
  }
  return results;
}
function chineseNumber(value) {
  const digits = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === '十') return 10;
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return digits[value] ?? null;
}
function numericValue(text, unit) {
  const normalized = String(text || '').replace(/([一二两三四五六七八九十]+)(?=\s*(?:年|个月|月|人|名|位))/g, (match) => String(chineseNumber(match) ?? match));
  const escaped = unit === 'm³/min' ? '(?:m³\/min|m3\/min|立方米\/分钟)' : unit === '元' ? '(?:元|万元)' : unit === '月' ? '(?:个月|月|年)' : unit === '天' ? '(?:天|日)' : unit === '人' ? '(?:人|名|位)' : unit;
  const found = normalized.match(new RegExp(`([\\d,]+(?:\\.\\d+)?)\\s*(${escaped})`, 'i'));
  if (!found) return null;
  const n = Number(found[1].replaceAll(',', ''));
  if (!Number.isFinite(n)) return null;
  const actualUnit = found[2].toLowerCase();
  return unit === '元' && actualUnit === '万元' ? n * 10000 : unit === '月' && actualUnit === '年' ? n * 12 : n;
}
function constraint(text) {
  if (/低于.{0,40}(?:无效|否决)|(?:无效|否决).{0,40}低于/.test(text)) return 'min';
  if (/不超过|不得超过|≤|最多|不大于|最高|以内/.test(text)) return 'max';
  if (/不低于|不少于|不得少于|不得低于|≥|至少|不小于|以上/.test(text)) return 'min';
  return null;
}
function sharedSubject(requirement, candidate) {
  const clean = (value) => String(value || '').replace(/施工组织设计|施工方案|投标文件|本项目|应当|必须|不得|至少|不少于|不超过|不得少于|提供|提交|包含|说明|采用|经审批|未经审批|附件|拟|已/g, '').replace(/[\d\s，。,:：；;（）()\-]+/g, '');
  const a = clean(requirement);
  const b = clean(candidate);
  for (let length = Math.min(12, a.length); length >= 4; length--) {
    for (let start = 0; start + length <= a.length; start++) {
      if (b.includes(a.slice(start, start + length))) return true;
    }
  }
  return false;
}
function extractEvidence(requirement, documents) {
  const rule = FIELD_RULES.find((item) => item.key === requirement.field);
  for (const doc of documents || []) {
    const lines = normalizedLines(doc.content);
    for (let i = 0; i < lines.length; i++) {
      if (rule ? !rule.pattern.test(lines[i]) : !sharedSubject(requirement.text, lines[i])) continue;
      const value = rule?.unit ? numericValue(lines[i], rule.unit) : null;
      if (rule?.unit && value === null) continue;
      const pageMatch = lines.slice(0, i + 1).reverse().find((line) => /<!--\s*p:\d+\s*-->/.test(line));
      const page = pageMatch ? Number(pageMatch.match(/<!--\s*p:(\d+)/)[1]) : null;
      return { text: lines[i].trim(), file: doc.name, line: i + 1, page, value };
    }
  }
  return null;
}
function evaluate(requirement, documents, deadline) {
  const evidence = extractEvidence(requirement, documents);
  const rule = FIELD_RULES.find((item) => item.key === requirement.field);
  if (!evidence) return { status: '待核实', response: '', evidence: null, reason: '未找到对应企业证据；不能推断满足或不满足', action: '上传材料或人工核实' };
  if (rule?.direction === 'date') {
    const match = evidence.text.match(/(?:有效期至|截止|到期|有效至)\s*[:：]?\s*(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})/);
    if (!match || !deadline) return { status: '待核实', response: evidence.text, evidence, reason: '证书有效期或投标截止日期不明确', action: '人工核实有效期' };
    const expiry = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const bidDate = Date.parse(deadline);
    if (!Number.isFinite(bidDate)) return { status: '待核实', response: evidence.text, evidence, reason: '截止日期无法可靠解析', action: '人工核实日期' };
    const pass = expiry >= bidDate;
    return { status: pass ? '满足' : '不满足', response: evidence.text, evidence, reason: `证书有效期 ${match[1]}-${match[2]}-${match[3]}，投标截止 ${deadline}`, action: pass ? '' : '更新有效证书' };
  }
  if (!rule?.unit) return { status: '待核实', response: evidence.text, evidence, reason: '文本相似但无确定性比较规则', action: '人工核实' };
  const target = numericValue(requirement.text, rule.unit);
  const direction = constraint(requirement.text);
  if (target === null || !direction) return { status: '待核实', response: evidence.text, evidence, reason: '招标数值或比较方向不明确', action: '人工核实' };
  const pass = direction === 'min' ? evidence.value >= target : evidence.value <= target;
  return { status: pass ? '满足' : '不满足', response: evidence.text, evidence,
    reason: `${evidence.value} ${rule.unit} ${pass ? '符合' : '不符合'} ${direction === 'min' ? '≥' : '≤'} ${target} ${rule.unit}`,
    action: pass ? '' : '调整响应或确认偏离' };
}
function evaluateAll(requirements, documents, deadline) {
  const quotationIssues = quotationRisk(documents);
  return (requirements || []).map((requirement) => {
    const result = evaluate(requirement, documents, deadline);
    if (requirement.field === 'price' && result.status === '满足' && quotationIssues.length) {
      return { requirement, ...result, status: '待核实', reason: '报价数值在限价内，但分项算术不一致', action: '更正报价后重新核对', confirmed: false };
    }
    return { requirement, ...result, confirmed: false };
  });
}
function quotationRisk(documents) {
  const lines = (documents || []).flatMap((doc) => normalizedLines(doc.content).map((text, index) => ({ text, file: doc.name, line: index + 1 })));
  const items = lines.map((row) => {
    const match = row.text.match(/数量\s*[:：]?\s*(\d+)\s*[,，;； ]+单价\s*[:：]?\s*([\d.]+)\s*元\s*[,，;； ]+小计\s*[:：]?\s*([\d.]+)\s*元/);
    return match ? { ...row, quantity: Number(match[1]), unitPrice: Number(match[2]), subtotal: Number(match[3]) } : null;
  }).filter(Boolean);
  const risks = items.filter((item) => Math.abs(item.quantity * item.unitPrice - item.subtotal) > 0.01).map((item) => ({
    issue: '报价小计算术不一致', reason: `${item.quantity} × ${item.unitPrice} = ${item.quantity * item.unitPrice}，填写 ${item.subtotal}`,
    evidence: { file: item.file, line: item.line, text: item.text }, action: '核对并更正分项报价', confirmed: false,
  }));
  const totalRow = lines.find((row) => /报价总额\s*[:：]?\s*[\d.]+\s*元/.test(row.text));
  if (totalRow && items.length) {
    const given = Number(totalRow.text.match(/报价总额\s*[:：]?\s*([\d.]+)\s*元/)[1]);
    const sum = items.reduce((n, item) => n + item.subtotal, 0);
    if (Math.abs(given - sum) > 0.01) risks.push({ issue: '报价总额与分项小计不一致', reason: `分项合计 ${sum} 元，填写 ${given} 元`, evidence: totalRow, action: '核对总价', confirmed: false });
  }
  return risks;
}
function riskReport(matrix, documents) {
  const risks = matrix.filter((row) => row.status !== '满足').map((row) => ({ issue: `${row.requirement.category}：${row.requirement.text}`,
    status: row.status, reason: row.reason, tenderEvidence: { file: row.requirement.file, line: row.requirement.line, page: row.requirement.page, text: row.requirement.original },
    evidence: row.evidence,
    action: row.action, confirmed: row.confirmed || false }));
  const priceRequirement = matrix.find((row) => row.requirement.field === 'price')?.requirement;
  const quotation = quotationRisk(documents).map((risk) => ({ ...risk, tenderEvidence: priceRequirement ? {
    file: priceRequirement.file, line: priceRequirement.line, page: priceRequirement.page, text: priceRequirement.original,
  } : null }));
  return [...risks, ...quotation];
}
module.exports = { extractRequirements, evaluateAll, riskReport, quotationRisk, numericValue, hash };
