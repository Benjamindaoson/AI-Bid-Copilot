// Local evidence index and deterministic quantity comparison. No model or network dependency.
const QUANTITY = /(?<![\d.])(?<value>\d[\d,]*(?:\.\d+)?)\s*(?<unit>立方米|平方米|万元|毫米|厘米|千米|千克|公斤|吨|m³|m3|m²|m2|㎡|mm|cm|km|MPa|kW|kg|m|t|人|名|座|台|天|日|元|%|‰)(?![\w])/giu;
const COF = /(?:湿态|潮湿状态|防滑)?\s*(?:摩擦系数|COF)\s*(?:[（(]COF[）)])?\s*(?:≥|>|＝|=|不低于)?\s*(?<value>0\.\d+)/giu;
const UNIT = {
  '立方米': ['m3', 1], 'm³': ['m3', 1], m3: ['m3', 1],
  '平方米': ['m2', 1], 'm²': ['m2', 1], m2: ['m2', 1], '㎡': ['m2', 1],
  '毫米': ['mm', 1], mm: ['mm', 1], '厘米': ['mm', 10], cm: ['mm', 10], m: ['mm', 1000], '千米': ['mm', 1000000], km: ['mm', 1000000],
  MPa: ['MPa', 1], kW: ['kW', 1], '人': ['person', 1], '名': ['person', 1], '座': ['site', 1], '台': ['machine', 1],
  '天': ['day', 1], '日': ['day', 1], '万元': ['CNY', 10000], '元': ['CNY', 1], '%': ['ratio', 0.01], '‰': ['ratio', 0.001],
  '千克': ['kg', 1], '公斤': ['kg', 1], kg: ['kg', 1], '吨': ['kg', 1000], t: ['kg', 1000],
};
const PHASE = /(基础|主体|装饰|装修|安装|收尾|竣工|高峰|初期|后期)(?:施工)?(?:阶段|期)/g;
const BASIS = /(采购|设计|计划|结算|估算|实际|总)(?:量|数|价|费用)/g;
const AREA = /(室内|室外|卫生间|走廊|楼梯间|屋面|地下室)/g;
const CONTEXT_VERBS = /(?:配备|配置|安排|计划|预计|采用|供应|需要|要求|投入|达到|为|共计|合计)(?!.*(?:配备|配置|安排|计划|预计|采用|供应|需要|要求|投入|达到|为|共计|合计))/;

function scopeOf(text) {
  const scope = [...String(text).matchAll(PHASE), ...String(text).matchAll(BASIS), ...String(text).matchAll(AREA)].map((match) => match[0]);
  return [...new Set(scope)].sort();
}
function entityOf(text, offset, fallback = '') {
  const prefix = String(text).slice(Math.max(0, offset - 48), offset).split(/[。；;，,：:\n]/).at(-1) || '';
  let phrase = prefix.replace(/\s+/g, '').replace(/^(?:本工程|本项目|该项目|本标段|现场|其中|工程)/, '');
  const verb = phrase.match(CONTEXT_VERBS);
  if (verb) {
    const after = phrase.slice(verb.index + verb[0].length);
    phrase = after.length >= 2 ? after : phrase.slice(0, verb.index);
  }
  phrase = phrase.replace(PHASE, '').replace(BASIS, '').replace(AREA, '').replace(/^(?:专职|高峰|拟投入|使用|投入)/, '').replace(/(?:不超过|不低于|不少于|至多|最多|至少|大于|小于|大约|约|左右)$/, '');
  phrase = phrase.replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, '').slice(-16);
  if (phrase.length < 2) phrase = fallback.replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, '').slice(-16);
  return phrase;
}
function normalizeQuantity(rawValue, rawUnit) {
  const definition = UNIT[rawUnit];
  const value = Number(String(rawValue).replace(/,/g, ''));
  if (!definition || !Number.isFinite(value)) return null;
  return { value: value * definition[1], dimension: definition[0] };
}
function constraintOf(text, offset) {
  const before = String(text).slice(Math.max(0, offset - 8), offset);
  if (/(?:不超过|至多|最多|≤|<=|小于)/.test(before)) return 'max';
  if (/(?:不低于|不少于|至少|≥|>=|大于)/.test(before)) return 'min';
  return 'exact';
}
function indexDocumentFacts(doc) {
  const facts = [];
  const addText = (text, location, chapter, section, fallback = '') => {
    const quote = String(text || '').trim();
    if (!quote) return;
    for (const match of quote.matchAll(QUANTITY)) {
      const normalized = normalizeQuantity(match.groups.value, match.groups.unit);
      const entity = entityOf(quote, match.index, fallback);
      if (!normalized || entity.length < 2) continue;
      facts.push({ id: `F${facts.length + 1}`, entity, raw: match[0], ...normalized, scope: scopeOf(quote), approximate: /(?:预计|估计|约|大约|左右)/.test(quote.slice(Math.max(0, match.index - 24), match.index)), constraint: constraintOf(quote, match.index), location, chapter, section, quote });
    }
    for (const match of quote.matchAll(COF)) {
      const value = Number(match.groups.value);
      if (!Number.isFinite(value)) continue;
      facts.push({ id: `F${facts.length + 1}`, entity: '湿态摩擦系数', raw: match[0], value, dimension: 'COF', scope: scopeOf(quote), approximate: false, constraint: constraintOf(quote, match.index), location, chapter, section, quote });
    }
  };
  for (const block of doc.blocks || []) {
    if (block.kind === 'paragraph') addText(block.text, block.location, block.chapter, block.section);
    if (block.kind === 'table') for (const row of block.rows || []) {
      const labels = row.filter((cell) => cell.text && !/^\s*[\d,]+(?:\.\d+)?\s*$/.test(cell.text));
      const rowLabel = labels[0]?.text || block.section || '';
      const rowUnit = labels.find((cell) => UNIT[cell.text.trim()])?.text.trim();
      for (const cell of row) {
        addText(cell.text, cell.location, block.chapter, block.section, rowLabel);
        if (rowUnit && /^\s*\d[\d,]*(?:\.\d+)?\s*$/.test(cell.text || '')) {
          const normalized = normalizeQuantity(cell.text, rowUnit);
          const entity = entityOf(rowLabel, rowLabel.length, block.section);
          if (normalized && entity.length >= 2) facts.push({ id: `F${facts.length + 1}`, entity, raw: `${cell.text}${rowUnit}`, ...normalized, scope: scopeOf(`${block.section || ''} ${rowLabel}`), approximate: false, constraint: 'exact', location: cell.location, chapter: block.chapter, section: block.section, quote: `${rowLabel} | ${cell.text}${rowUnit}` });
        }
      }
    }
  }
  return facts;
}
function compareFactPair(a, b) {
  if (!a || !b || a.entity !== b.entity || a.dimension !== b.dimension) return { status: '证据不足', reason: '事实实体或量纲不可比' };
  const left = a.scope.join('|'), right = b.scope.join('|');
  if (left && right && left !== right) return { status: '无问题', reason: '显式统计范围不同', distinction: '口径差异' };
  if (a.constraint !== 'exact' || b.constraint !== 'exact') {
    const lower = [a, b].filter((fact) => fact.constraint === 'min').map((fact) => fact.value);
    const upper = [a, b].filter((fact) => fact.constraint === 'max').map((fact) => fact.value);
    const exact = [a, b].filter((fact) => fact.constraint === 'exact').map((fact) => fact.value);
    if (a.approximate || b.approximate) return { status: '疑似不一致', reason: '近似数量不能用于严格区间判断' };
    if (lower.length && upper.length) {
      if (Math.max(...lower) > Math.min(...upper)) return { status: '明确矛盾', reason: '同一实体和范围的上下限区间无交集' };
      if (Math.max(...lower) === Math.min(...upper)) return { status: '疑似不一致', reason: '上下限只在边界值相交，约束口径需核实' };
      return { status: '无问题', reason: '上下限区间有交集' };
    }
    if (exact.length) {
      const value = exact[0];
      if (lower.every((bound) => value >= bound) && upper.every((bound) => value <= bound)) return { status: '无问题', reason: '明确数值满足所述上下限' };
      return { status: '疑似不一致', reason: '明确数值超出所述上下限，须核实两处是否指同一对象' };
    }
    return { status: '无问题', reason: '同向上下限没有直接冲突' };
  }
  if (Math.abs(a.value - b.value) <= Math.max(1e-9, Math.abs(a.value) * 1e-9)) {
    return { status: '无问题', reason: '归一单位后的数值一致' };
  }
  if (a.approximate || b.approximate) return { status: '疑似不一致', reason: '至少一处使用近似数量' };
  if (left && left === right) return { status: '明确矛盾', reason: '同一实体、量纲及明确范围的数值冲突' };
  return { status: '疑似不一致', reason: '数值不同，但范围未被双方明确限定' };
}
function verifyModelPairs(rawPairs, facts) {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  if (!Array.isArray(rawPairs)) throw new Error('模型输出缺少 pairs 数组');
  return rawPairs.slice(0, 100).map((pair) => {
    const ids = Array.isArray(pair.factIds) ? pair.factIds : [];
    const cited = ids.length === 2 ? ids.map((id) => byId.get(id)) : [];
    if (cited.length !== 2 || cited.some((fact) => !fact) || cited[0].location === cited[1].location) return { status: '证据不足', reason: '模型证据 ID 无效或重复', evidence: [] };
    const check = cited[0].entity !== cited[1].entity && cited[0].dimension === cited[1].dimension && cited[0].value !== cited[1].value
      ? { status: '疑似不一致', reason: '模型关联了名称近似的实体，实体同一性仍需人工核实' }
      : compareFactPair(cited[0], cited[1]);
    return { id: ids.slice().sort().join('|'), status: check.status, reason: check.reason, distinction: check.distinction || '', evidence: cited.map(({ id, location, chapter, section, quote, raw }) => ({ id, location, chapter, section, quote, raw })), modelExplanation: String(pair.explanation || '').slice(0, 500) };
  });
}

function selectCandidatePairs(facts, limit = 40) {
  const groups = new Map();
  for (const fact of facts) {
    if (/^(?:合计|总计|数量|金额|工程)$/.test(fact.entity)) continue;
    const key = `${fact.entity}|${fact.dimension}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fact);
  }
  const pairs = [];
  const byGroup = [];
  for (const entries of groups.values()) {
    const ranked = [];
    for (let i = 0; i < entries.length; i += 1) for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[i].location === entries[j].location || (entries[i].value === entries[j].value && entries[i].constraint === entries[j].constraint)) continue;
      const status = compareFactPair(entries[i], entries[j]).status;
      if (status === '无问题') continue;
      const score = status === '明确矛盾' ? 2 : 1;
      ranked.push({ pair: [entries[i], entries[j]], score });
    }
    ranked.sort((a, b) => b.score - a.score);
    if (ranked.length) byGroup.push(ranked.slice(0, Math.min(limit, 4)).map((item) => item.pair));
  }
  for (let depth = 0; depth < 4; depth += 1) for (const group of byGroup) {
    if (group[depth]) pairs.push(group[depth]);
    if (pairs.length >= limit) return pairs;
  }
  const bigrams = (value) => new Set([...value.slice(0, -1)].map((_, index) => value.slice(index, index + 2)));
  for (let i = 0; i < facts.length; i += 1) for (let j = i + 1; j < facts.length; j += 1) {
    const a = facts[i], b = facts[j];
    if (a.entity === b.entity || a.dimension !== b.dimension || a.location === b.location || a.value === b.value) continue;
    const left = bigrams(a.entity), right = bigrams(b.entity);
    if (![...left].some((part) => right.has(part))) continue;
    pairs.push([a, b]);
    if (pairs.length >= limit) return pairs;
  }
  return pairs.slice(0, limit);
}

async function runModelSemanticReview({ facts, aiService }) {
  if (!aiService?.requestJson) throw new Error('当前文本模型服务不可用');
  const candidates = selectCandidatePairs(facts);
  if (!candidates.length) return { candidateCount: 0, results: [] };
  const unique = [...new Map(candidates.flat().map((fact) => [fact.id, fact])).values()];
  const allowed = new Set(candidates.map(([a, b]) => [a.id, b.id].sort().join('|')));
  const response = await aiService.requestJson({
    taskType: 'construction-check',
    logTitle: '施工文档语义体检',
    progressLabel: '语义体检',
    failureMessage: '语义体检结果无效',
    messages: [
      { role: 'system', content: '你是施工技术文档审查助手。仅根据提供的事实 ID 和原文判断哪些事实需要交叉核实。不得编造事实、页码、规范、扣分或外部资料。返回 JSON 对象 {"pairs":[{"factIds":["F1","F2"],"explanation":"简短说明"}]}。只选择给定候选对。数值、单位和最终状态由程序复核。' },
      { role: 'user', content: JSON.stringify({ candidates: candidates.map(([a, b]) => [a.id, b.id]), facts: unique.map(({ id, entity, raw, scope, location, chapter, section, quote }) => ({ id, entity, raw, scope, location, chapter, section, quote: quote.slice(0, 300) })) }) },
    ],
    normalizer: (output) => output,
    validator: (output) => {
      if (!Array.isArray(output?.pairs) || output.pairs.length > 100) throw new Error('模型未返回合法 pairs');
      for (const pair of output.pairs) {
        if (!Array.isArray(pair.factIds) || pair.factIds.length !== 2 || pair.factIds.some((id) => typeof id !== 'string') || !allowed.has([...pair.factIds].sort().join('|'))) throw new Error('模型引用了候选集以外的事实');
      }
    },
  });
  return { candidateCount: candidates.length, results: verifyModelPairs(response.pairs, facts) };
}

module.exports = { indexDocumentFacts, normalizeQuantity, compareFactPair, verifyModelPairs, selectCandidatePairs, runModelSemanticReview };
