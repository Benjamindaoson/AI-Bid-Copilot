// Evidence rules are generic to a construction technical document. Case answers live outside runtime code.
const E = (block, text = block.text, location = block.location) => ({ location, chapter: block.chapter, section: block.section, text });
const number = (text) => Number(String(text || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] || NaN);
const paras = (doc) => doc.blocks.filter((block) => block.kind === 'paragraph');
const tables = (doc) => doc.blocks.filter((block) => block.kind === 'table');
const finding = (id, title, status, explanation, advice, evidence) => ({ id, title, status, explanation, advice, evidence: evidence.filter(Boolean), confirmed: false });
function stageBefore(text, offset) {
  const prefix = String(text).slice(Math.max(0, offset - 35), offset);
  const stages = [...prefix.matchAll(/(基础|主体|装饰|装修|安装|收尾|竣工|开工|高峰|初期|后期)(?:施工)?(?:阶段|期)/g)];
  return stages.at(-1)?.[1] || '';
}

function inspectStaff(doc) {
  const tableValues = [];
  for (const table of tables(doc)) for (const row of table.rows) {
    const role = row.find((cell) => /^(?:专职)?安全员$/.test(cell.text));
    if (!role) continue;
    const count = row.slice(row.indexOf(role) + 1).find((cell) => /^\d+\s*(?:人|名)?$/.test(cell.text));
    if (count) tableValues.push({ value: number(count.text), phase: '', evidence: E(table, `${role.text}：${count.text}`, `${role.location} + ${count.location}`) });
  }
  const proseValues = paras(doc).flatMap((block) => [...block.text.matchAll(/(?:配备|配置|设置|安排)?\s*专职安全员\s*(\d+)\s*(?:人|名)/g)].map((match) => ({ value: Number(match[1]), phase: stageBefore(block.text, match.index), evidence: E(block) })));
  const values = [...tableValues, ...proseValues];
  const groups = new Map();
  for (const item of values) {
    if (!groups.has(item.phase)) groups.set(item.phase, new Set());
    groups.get(item.phase).add(item.value);
  }
  const conflictingGroup = [...groups.values()].some((counts) => counts.size > 1);
  const varying = new Set(values.map((item) => item.value)).size > 1;
  const hasUnknownStage = groups.has('');
  const status = values.length < 2 ? '证据不足' : conflictingGroup ? '明确矛盾' : varying && hasUnknownStage ? '疑似不一致' : '无问题';
  const detail = values.length < 2 ? '可比人数不足两处。' : `同一岗位记录人数：${values.map((item) => `${item.phase ? `${item.phase}阶段` : '未说明阶段'} ${item.value}`).join('、')} 人。`;
  return finding('staff-count', '安全员配置人数', status, detail, '核对项目组织机构与安全管理方案，确认拟投入的专职人数及岗位表。', values.map((item) => item.evidence));
}
function inspectWorkforce(doc) {
  const claims = paras(doc).flatMap((block) => [...block.text.matchAll(/高峰(?:期)?(?:投入)?劳动力\s*(?:约)?\s*(\d[\d,]*)\s*人/g)].map((match) => ({ value: number(match[1]), evidence: E(block) })));
  const plans = [];
  for (const table of tables(doc)) {
    if (!table.rows.some((row) => row.some((cell) => /按工程施工阶段投入劳动力|劳动力情况/.test(cell.text)))) continue;
    const total = table.rows.find((row) => /^合计$/.test(row[0]?.text || ''));
    if (!total) continue;
    const values = total.slice(1).filter((cell) => /^\d+$/.test(cell.text)).map((cell) => ({ value: number(cell.text), evidence: E(table, `劳动力计划表阶段合计：${cell.text}人`, cell.location) }));
    if (values.length) plans.push(values.reduce((best, item) => item.value > best.value ? item : best));
  }
  const peak = Math.max(...claims.map((item) => item.value));
  const plan = Math.max(...plans.map((item) => item.value));
  const status = !claims.length || !plans.length ? '证据不足' : peak !== plan ? '疑似不一致' : '无问题';
  return finding('workforce-peak', '高峰劳动力与阶段计划', status, status === '证据不足' ? '缺少高峰人数或计划表合计。' : `文字高峰约 ${peak} 人，计划表最大阶段合计 ${plan} 人；两者可能包含不同口径。`, '核实是否另含分包、管理或机动人员；统一正文与阶段计划的统计口径。', [...claims, ...plans].map((item) => item.evidence));
}
function inspectMaterial(doc) {
  const claims = paras(doc).flatMap((block) => [...block.text.matchAll(/商品混凝土\s*(?:约)?\s*(\d[\d,]*(?:\.\d+)?)\s*m[³3]/g)].map((match) => ({ value: number(match[1]), evidence: E(block) })));
  const plans = [];
  for (const table of tables(doc)) for (const row of table.rows) {
    const label = row.find((cell) => /^商品混凝土$/.test(cell.text));
    if (!label) continue;
    const unit = row.find((cell) => /^m[³3]$/.test(cell.text));
    const qty = unit && row[row.indexOf(unit) + 1];
    if (qty && Number.isFinite(number(qty.text))) plans.push({ value: number(qty.text), evidence: E(table, `${label.text} ${qty.text}${unit.text}`, `${label.location} + ${qty.location}`) });
  }
  const vals = [...claims, ...plans];
  const status = vals.length < 2 ? '证据不足' : new Set(vals.map((x) => x.value)).size > 1 ? '疑似不一致' : '无问题';
  return finding('material-quantity', '商品混凝土数量口径', status, vals.length < 2 ? '未找到两处可比数量。' : `记录数量为 ${vals.map((x) => x.value).join('、')} m³；总量、采购量或结构范围可能不同。`, '对照工程量清单和供货计划，标注每个数量的范围、损耗和统计口径。', vals.map((item) => item.evidence));
}
function inspectUtilities(doc) {
  const connection = paras(doc).filter((block) => /(?:临时|施工)(?:用水|用电)|水电接入/.test(block.text) && /接入|开户|费用|水费|电费/.test(block.text));
  const ownership = connection.filter((block) => /承包人|建设单位|招标人/.test(block.text));
  const status = ownership.length < 2 ? '证据不足' : /指定(?:点|接入点)/.test(ownership.map((x) => x.text).join('')) && /自行.*(?:开户|费用|水费|电费)/.test(ownership.map((x) => x.text).join('')) ? '疑似不一致' : '无问题';
  return finding('temporary-utilities', '临时水电接入及费用责任', status, status === '疑似不一致' ? '指定接入点与承包人自行开户、承担费用可以并存，但界面与手续未在同一处说明。' : '现有文字不足以确认接入点、开户及费用的完整边界。', '核实招标文件、合同及现场条件；分开写明接入点提供、开户、场内布设、计量和费用承担。', ownership.slice(0, 4).map((x) => E(x)));
}
function inspectDewatering(doc) {
  const wells = [], closures = [];
  for (const block of doc.blocks) {
    const units = block.kind === 'table' ? block.rows.flat().map((cell) => ({ text: cell.text, location: cell.location })) : [{ text: block.text, location: block.location }];
    for (const unit of units) {
      for (const match of unit.text.matchAll(/降水井\s*(\d+)\s*座/g)) wells.push({ value: Number(match[1]), evidence: E(block, unit.text, unit.location) });
      for (const match of unit.text.matchAll(/封堵\s*(\d+)\s*座/g)) closures.push({ value: Number(match[1]), evidence: E(block, unit.text, unit.location) });
    }
    if (block.kind === 'table') for (const row of block.rows) {
      const label = row.find((cell) => /降水井/.test(cell.text));
      const unitIndex = row.findIndex((cell) => /^座$/.test(cell.text));
      const qty = label && unitIndex >= 0 ? row[unitIndex + 1] : null;
      if (label && qty) wells.push({ value: number(qty.text), evidence: E(block, `${label.text} ${qty.text}座`, `${label.location} + ${qty.location}`) });
    }
  }
  const closure = closures.filter((x) => /^P/.test(x.evidence.location)).at(-1) || closures[0];
  const closureIndex = Number(closure?.evidence.location.match(/^P(\d+)$/)?.[1] || Infinity);
  const well = wells.filter((x) => /^P/.test(x.evidence.location) && Number(x.evidence.location.slice(1)) <= closureIndex).at(-1) || wells[0];
  const status = !wells.length || !closures.length ? '证据不足' : Math.max(...closures.map((x) => x.value)) !== Math.max(...wells.map((x) => x.value)) ? '证据不足' : '无问题';
  return finding('dewatering-closure', '降水井及封堵数量', status, well && closure ? `降水井 ${well.value} 座与封堵 ${closure.value} 座可能对应不同工作量，不能直接视为同一数量。` : '缺少数量或对应范围。', '核对清单项、备用井和设计图纸，明确封堵数量包含范围。', [well?.evidence, closure?.evidence]);
}
function inspectSlip(doc) {
  const refs = [];
  for (const block of doc.blocks) {
    const units = block.kind === 'table' ? block.rows.flat().map((cell) => ({ text: cell.text, location: cell.location })) : [{ text: block.text, location: block.location }];
    for (const unit of units) if (/潮湿状态|湿态/.test(unit.text)) {
      for (const match of unit.text.matchAll(/(?:潮湿状态摩擦系数|湿态\s*COF)\s*(?:（COF）)?\s*[≥>＝=]?\s*(0\.\d+)/g)) refs.push({ value: Number(match[1]), evidence: E(block, unit.text, unit.location) });
    }
  }
  const status = refs.length < 2 ? '证据不足' : new Set(refs.map((x) => x.value)).size > 1 ? '疑似不一致' : '无问题';
  return finding('anti-slip', '适老化地面防滑指标', status, refs.length < 2 ? '湿态摩擦系数可比证据不足。' : `湿态/潮湿状态 COF 记录为 ${refs.map((x) => x.value).join('、')}；适用区域或测试方法可能不同。`, '按设计图纸、招标要求及产品检测方法核实适用区域，再统一指标表达。', refs.map((x) => x.evidence));
}
function inspectHazards(doc) {
  const list = tables(doc).find((table) => table.rows.some((row) => row.some((cell) => /工程名称/.test(cell.text))) && table.rows.some((row) => row.some((cell) => /基坑支护工程/.test(cell.text))));
  const listed = list ? list.rows.slice(1).map((row) => row[1]).filter(Boolean) : [];
  const earlier = doc.headings.filter((heading) => heading.chapter === '第四章' && /危大工程/.test(heading.text));
  const normalize = (text) => /基坑/.test(text) ? '基坑' : /模板/.test(text) ? '模板' : /脚手架/.test(text) ? '脚手架' : /起重/.test(text) ? '起重' : /拆除/.test(text) ? '拆除' : '';
  const earlierTypes = new Set(earlier.map((x) => normalize(x.text)).filter(Boolean));
  const unmatched = listed.filter((cell) => !earlierTypes.has(normalize(cell.text)));
  return finding('hazard-list', '危大工程清单与前文分类', !list || !earlier.length ? '证据不足' : unmatched.length ? '疑似不一致' : '无问题', unmatched.length ? `清单中的 ${unmatched.map((x) => x.text).join('、')} 未在第四章危大工程标题中对应；可能在其他段落说明。` : '清单类别与第四章标明的危大工程标题相对应。', '按设计规模和危大工程法规逐项核验，并将缺少的专项方案或交叉引用补齐。', [...earlier.map((x) => ({ location: x.location, chapter: x.chapter, section: x.text, text: x.text })), ...unmatched.map((x) => E(list, x.text, x.location))]);
}
function inspectAnnexes(doc) {
  const siteRef = paras(doc).find((x) => /总平面图详见.*图\s*\d+-\d+/.test(x.text));
  const siteImage = doc.images.some((image) => {
    const block = doc.blocks.find((x) => x.location === image.location);
    return block?.chapter === '第十二章' || block?.chapter === '第十六章';
  });
  const networkRef = paras(doc).find((x) => /进度网络图.*表\s*\d+-\d+/.test(x.text));
  const schedule = tables(doc).find((x) => x.chapter === '第十六章' && x.rows.length > 5 && x.rows[0].length > 10);
  return [
    finding('site-plan', '施工总平面图附件', siteRef && !siteImage ? '证据不足' : siteImage ? '无问题' : '证据不足', siteRef && !siteImage ? '正文指向图纸，但本 DOCX 相应章节未见内嵌图片；另附文件可能未随文提供。' : '需核对图纸附件及清晰度。', '检查实际投标包内的独立图纸、文件名、格式及打印可读性。', [siteRef && E(siteRef)]),
    finding('schedule-network', '进度网络图与附表格式', !networkRef || !schedule ? '证据不足' : '疑似不一致', schedule ? '已找到可读取的阶段横道表；“网络图”表述是否要求节点和逻辑关系，需对照招标要求。' : '未找到可读取的进度表。', '核对招标文件要求的网络图形式，确认附表打印/导出后仍可读。', [networkRef && E(networkRef), schedule && E(schedule, `可读取表格 ${schedule.rows.length} 行，首行 ${schedule.rows[0].length} 列`)]),
  ];
}
function auditDocument(doc) {
  return [inspectStaff(doc), inspectWorkforce(doc), inspectMaterial(doc), inspectUtilities(doc), inspectDewatering(doc), inspectSlip(doc), inspectHazards(doc), ...inspectAnnexes(doc)];
}
module.exports = { auditDocument };
