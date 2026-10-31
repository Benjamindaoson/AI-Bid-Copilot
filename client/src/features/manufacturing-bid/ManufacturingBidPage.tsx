import { useEffect, useState } from 'react';
import type { ManufacturingState } from '../../shared/types/ipc';
import type { SectionId } from '../../shared/types/navigation';
import './manufacturingBid.css';

type Tab = 'requirements' | 'matrix' | 'writing' | 'risks' | 'skills';
const labels: Record<Tab, string> = { requirements: '招标解读', matrix: '响应矩阵', writing: '标书编写', risks: '风险检查', skills: '业务 Skill' };

export default function ManufacturingBidPage({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  const [state, setState] = useState<ManufacturingState | null>(null);
  const [tab, setTab] = useState<Tab>('requirements');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const api = window.yibiao.manufacturing;
  useEffect(() => { void api.load().then(setState).catch((error) => setMessage(String(error))); }, []);
  async function run(action: () => Promise<ManufacturingState | null>, success: string | ((next: ManufacturingState | null) => string)) {
    setBusy(true); setMessage('');
    try { const next = await action(); if (next) setState(next); setMessage(typeof success === 'function' ? success(next) : success); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const uploadTender = () => run(async () => {
    const result = await window.yibiao.technicalPlan.importTenderDocument();
    if (!result.success) throw new Error(result.message || '招标文件导入失败');
    return api.analyze();
  }, '招标文件已解析，请逐条核对清单');
  const uploadEnterprise = () => run(async () => {
    const result = await api.importEnterprise();
    if (!result.success) throw new Error(result.message);
    return result.state || api.load();
  }, '企业资料已导入，响应矩阵已重新计算');
  const saveRequirements = () => state && run(() => api.update({ requirements: state.requirements, deadline: state.deadline }), '要求清单已保存');
  const saveChapter = () => state && run(() => api.update({ chapterDrafts: state.chapterDrafts }), '章节草稿已保存；修改后的章节需重新确认');
  const saveSkills = () => state && run(() => api.update({ skills: state.skills }), '业务 Skill 模板已保存');
  const updateRequirement = (index: number, patch: Partial<ManufacturingState['requirements'][number]>) => setState((current) => current && ({ ...current,
    requirements: current.requirements.map((item, i) => i === index ? { ...item, ...patch } : item) }));

  return <main className="manufacturing-bid">
    <header><div><h1>制造企业投标助手</h1><p>基于当前投标文件项目的招标资料、企业证据和确定性核验规则</p></div>
      <button disabled={busy} onClick={() => onNavigate('technical-plan')}>打开原版投标文件工作台</button></header>
    <div className="manufacturing-toolbar">
      <button disabled={busy} onClick={uploadTender}>上传招标文件（PDF/Word）</button>
      <button disabled={busy} onClick={() => run(() => api.analyze(), '已重新生成要求清单')}>重新解读当前招标文件</button>
      <button disabled={busy} onClick={uploadEnterprise}>上传企业资料</button>
      <button disabled={busy} onClick={() => run(async () => { const result = await api.exportWord(); if (!result.success) throw new Error(result.message || '导出取消'); setMessage(`已导出 ${result.filePath}`); return api.load(); }, '已导出 Word')}>导出 Word</button>
    </div>
    <div className="manufacturing-meta">招标文件：{state?.tenderFiles.join('、') || '尚未上传'}　企业材料：{state?.documents.length || 0} 份　要求：{state?.requirements.length || 0} 条</div>
    {state?.projectInfo.map((info) => <div className="manufacturing-meta" key={info.file}>项目：{info.name}　编号：{info.number || '未定位'}　截止原文：{info.deadlines.join('；') || '未定位'}　来源：{info.file}</div>)}
    {state?.deadlineConflict && <p className="manufacturing-warning">多份招标文件中的截止时间可能冲突，请核对补遗和最终公告。日期比较暂按下方手工确认的日期执行。</p>}
    {state?.tenderStale && <p className="manufacturing-warning">招标文件已变更，当前要求清单与结论失效，请重新解读。</p>}
    {state?.enterpriseStale && <p className="manufacturing-warning">企业资料原文件已变更，响应结论失效，请重新上传资料。</p>}
    {message && <p role="status" className="manufacturing-message">{message}</p>}
    <nav className="manufacturing-tabs" aria-label="投标工作步骤">{(Object.keys(labels) as Tab[]).map((key) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{labels[key]}</button>)}</nav>
    {!state && <p>正在加载本地项目…</p>}
    {state && tab === 'requirements' && <section>
      <div className="manufacturing-section-title"><h2>可编辑招标要求清单</h2><button onClick={saveRequirements}>保存清单</button></div>
      <label>投标截止日期 <input type="date" value={state.deadline} onChange={(event) => setState({ ...state, deadline: event.target.value })} /></label>
      {state.requirements.length === 0 && <p>上传招标文件后自动抽取；请人工检查未提取的表格、扫描页和补遗。</p>}
      {state.requirements.map((item, index) => <article className="manufacturing-card" key={item.id}>
        <div className="manufacturing-card-head"><strong>{item.category}{item.mandatory ? ' · 强制' : ''}</strong><small>{item.file} · {item.section || '章节未定位'} · 第{item.line}行 · {item.page ? `第${item.page}页` : '页码未定位'}</small></div>
        <textarea aria-label={`要求 ${index + 1}`} value={item.text} onChange={(event) => updateRequirement(index, { text: event.target.value })} />
        <small>解析原文：{item.original}</small>
        <label>备注 <input value={item.note} onChange={(event) => updateRequirement(index, { note: event.target.value })} /></label>
      </article>)}
    </section>}
    {state && tab === 'matrix' && <section><h2>投标响应矩阵</h2><p>数值与有效期使用程序规则比较；证据缺失保留待核实。</p>
      <div className="manufacturing-table-wrap"><table><thead><tr><th>招标要求</th><th>企业响应</th><th>证据来源</th><th>判断</th><th>待处理事项</th></tr></thead><tbody>
        {state.matrix.map((row) => <tr key={row.requirement.id}><td>{row.requirement.text}</td><td>{row.response || '未找到'}</td><td>{row.evidence ? `${row.evidence.file} 第${row.evidence.line}行${row.evidence.page ? ` 第${row.evidence.page}页` : ''}` : '缺失'}</td><td data-status={row.status}>{row.status}<small>{row.reason}</small></td><td>{row.action || '—'}</td></tr>)}
      </tbody></table></div></section>}
    {state && tab === 'writing' && <section><div className="manufacturing-section-title"><h2>逐章响应草稿</h2><div><button disabled={busy || state.tenderStale || state.enterpriseStale} onClick={() => run(() => api.draft(), '已根据当前证据重建章节；原有章节修改已替换')}>按证据建立目录及草稿</button> <button disabled={busy} onClick={saveChapter}>保存修改</button></div></div>
      <p>每章显示招标原文、企业证据和待处理事项。人工修订后先保存，再逐章确认。工期、质保、价格与资质承诺必须另行核实；专业正文生成和排版可继续使用原版投标文件工作台。</p>
      {state.chapterDrafts.length === 0 && <p>请先上传招标文件和企业资料，再建立章节草稿。</p>}
      {state.chapterDrafts.map((draft, index) => <article className="manufacturing-card" key={draft.id}><div className="manufacturing-card-head"><h3>{index + 1}. {draft.title}</h3><small>{draft.requirementIds.length} 条要求 · {draft.confirmed ? '已人工确认' : '待人工确认'}</small></div>
        {state.chapterIssues.filter((issue) => issue.chapterId === draft.id).map((issue) => <p className="manufacturing-warning" key={issue.requirementId}>{issue.reason}</p>)}
        <textarea className="manufacturing-chapter" aria-label={`${draft.title}草稿`} value={draft.body} onChange={(event) => setState({ ...state, chapterDrafts: state.chapterDrafts.map((item) => item.id === draft.id ? { ...item, body: event.target.value, confirmed: false } : item) })} />
        <button disabled={busy || state.tenderStale || state.enterpriseStale} onClick={() => run(() => api.update({ chapterDrafts: state.chapterDrafts.map((item) => item.id === draft.id ? { ...item, confirmed: !draft.confirmed } : item) }), (next) => draft.confirmed ? '已撤销确认' : next?.chapterDrafts.find((item) => item.id === draft.id)?.confirmed ? '本章已人工确认' : '未确认：请先保存修订并补全原文及企业证据定位')}>{draft.confirmed ? '撤销确认' : '人工确认本章'}</button>
      </article>)}
    </section>}
    {state && tab === 'risks' && <section><h2>投标风险检查报告</h2><p>共 {state.risks.length} 项，需要人工确认。签字盖章与附件原件需线下核对。</p>
      {state.risks.map((risk, index) => <article key={`${index}-${risk.issue}`} className="manufacturing-card"><strong>{risk.issue}</strong><p>判断依据：{risk.reason}</p><p>招标原文：{risk.tenderEvidence ? `${risk.tenderEvidence.file} 第${risk.tenderEvidence.line}行 · ${risk.tenderEvidence.text}` : '报价算术项'}</p><p>企业证据：{risk.evidence ? `${risk.evidence.file} 第${risk.evidence.line}行 · ${risk.evidence.text}` : '未找到'}</p><p>处理建议：{risk.action}</p><button disabled={busy || state.tenderStale || state.enterpriseStale} onClick={() => run(() => api.confirmRisk(risk.issue, risk.reason, !risk.confirmed), '人工确认状态已保存')}>人工确认：{risk.confirmed ? '已确认（点击撤销）' : '待确认（点击确认）'}</button></article>)}
    </section>}
    {state && tab === 'skills' && <section><div className="manufacturing-section-title"><h2>可编辑业务 Skill 模板</h2><button onClick={saveSkills}>保存 Skill</button></div><p>这些步骤直接服务于本工作台，由员工编辑；不加载外部 Agent Runtime。</p>
      {state.skills.map((skill, index) => <article className="manufacturing-card" key={skill.id}><h3>{skill.name}</h3><textarea aria-label={skill.name} className="manufacturing-skill" value={skill.content} onChange={(event) => setState({ ...state, skills: state.skills.map((item, i) => i === index ? { ...item, content: event.target.value } : item) })} /></article>)}
    </section>}
  </main>;
}
