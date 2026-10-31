import { useEffect, useMemo, useState } from 'react';
import type { ConstructionBlock, ConstructionCheckState } from '../../shared/types/ipc';
import './constructionCheck.css';

type Tab = 'document' | 'audit' | 'revision';
const tabs: Record<Tab, string> = { document: '文档结构', audit: '全文体检', revision: '4.17 节优化' };
const statusClass = (status: string) => status === '明确矛盾' ? 'critical' : status === '疑似不一致' ? 'suspect' : status === '证据不足' ? 'uncertain' : 'okay';

export default function ConstructionCheckPage() {
  const api = window.yibiao.constructionCheck;
  const [state, setState] = useState<ConstructionCheckState | null>(null);
  const [tab, setTab] = useState<Tab>('document');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState('');
  const [modelConsent, setModelConsent] = useState(false);
  useEffect(() => { void api.load().then(setState).catch((error) => setMessage(String(error))); }, []);
  async function run(action: () => Promise<ConstructionCheckState | null>, success: string) {
    setBusy(true); setMessage('');
    try { const next = await action(); if (next) setState(next); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const editable = useMemo(() => state?.sectionBlocks.filter((block) => block.kind === 'paragraph' && !block.isHeading && block.editable && block.text) || [], [state]);
  const selectedBlock = editable.find((block) => block.location === selected);
  function selectBlock(block: ConstructionBlock) { setSelected(block.location); setDraft(block.editedText || block.text || ''); }
  async function exportFile(kind: 'audit' | 'revision') {
    setBusy(true); setMessage('');
    try {
      const result = kind === 'audit' ? await api.exportAudit() : await api.exportRevision();
      if (!result.success) throw new Error(result.message || '已取消导出');
      setState(await api.load());
      setMessage(`Word 已导出：${result.filePath}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <main className="construction-check">
    <header><h1>施工技术文件体检与章节优化</h1><p>本地解析和可复核规则。模型分析需另行确认资料对外传输范围与授权。</p></header>
    <div className="construction-actions">
      <button disabled={busy} onClick={() => run(async () => { const result = await api.importFile(); if (!result.success) throw new Error(result.message || '导入失败'); setTab('document'); setSelected(''); setModelConsent(false); return result.state || api.load(); }, 'DOCX 已导入并建立结构索引')}>导入 DOCX 副本</button>
      <button disabled={busy || !state?.sourcePath} onClick={() => run(() => api.load(), '已按本地规则完成全文体检')}>重新体检</button>
      <button disabled={busy || !state?.sourcePath} onClick={() => exportFile('audit')}>导出体检报告 Word</button>
      <button disabled={busy || !state?.sourcePath} onClick={() => exportFile('revision')}>导出局部修订 Word</button>
    </div>
    {message && <p className="construction-message" role="status">{message}</p>}
    {!state && <p>正在读取本地文档…</p>}
    {state?.sourcePath && <p className="construction-summary">文件：{state.originalName}　SHA-256：{state.sourceHash}<br />
      段落 {state.counts?.paragraphs} · 表格 {state.counts?.tables} · 媒体 {state.counts?.media} · 已放置图片 {state.counts?.placedImages} · 本地解析文本 {state.sourceMarkdownLength} 字符<br />{state.pageMapping}</p>}
    {state?.stale && <p className="construction-alert">源副本已变更，既有判断与人工确认失效，请重新导入。</p>}
    <nav className="construction-tabs" aria-label="体检步骤">{(Object.keys(tabs) as Tab[]).map((name) => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{tabs[name]}</button>)}</nav>
    {!state?.sourcePath && <p>请导入已经完成的施工技术文件。原件不修改；程序在本机工作区保存副本。</p>}
    {state && tab === 'document' && state.sourcePath && <section>
      <h2>目录与定位</h2><p>以下是正文标题层级；目录页项目未混入正文。位置采用 Word 段落 P、表格 T 坐标，未推测固定页码。</p>
      <div className="construction-outline">{state.outline.map((item) => <div key={item.location}><small>{item.location}</small> {item.text}</div>)}</div>
      <h2>图片与图表关系</h2>{state.images.map((item) => <p key={`${item.location}-${item.relationshipId}`}>{item.location} → {item.relationshipId} → {item.target}</p>)}
      <p>媒体文件：{state.media.map((item) => `${item.target}（${item.bytes} 字节）`).join('；') || '未找到'}。表格的完整行列结构在 4.17 节预览中保留。</p>
    </section>}
    {state && tab === 'audit' && state.sourcePath && <section><h2>全文体检</h2><p>已检查 {state.findings.length} 个主题。统计口径不同、附件未随文提供或缺少外部资料时保留不确定性。</p>
      <div className="construction-card"><h3>可选：模型语义复核</h3><p>程序先抽取带位置的数值事实与候选对，只向当前配置的文本模型发送候选原文片段。模型负责建议关联，数量和单位由本地程序复核。真实投标资料默认保持本地；仅在资料对外传输范围已获授权时使用。</p>
        <p>接收地址：{state.modelDestination || '尚未配置文本模型地址'}；文件 SHA-256：{state.sourceHash}</p>
        <label><input type="checkbox" checked={modelConsent} onChange={(event) => setModelConsent(event.target.checked)} /> 我已核实本文件可向上述地址传送候选原文片段</label><br />
        <button disabled={busy || state.stale || !state.modelDestination || !modelConsent} onClick={() => run(() => api.semanticReview({ approved: true, sourceHash: state.sourceHash, destination: state.modelDestination }), '模型建议已完成本地证据及数值复核')}>运行模型语义复核</button>
        {!state.semanticReview && <p>尚未调用模型；以下主题判断仅来自本地规则。</p>}
        {state.semanticReview && <div><p>模型复核时间：{state.semanticReview.analyzedAt}；候选对 {state.semanticReview.candidateCount}；返回 {state.semanticReview.results.length} 项。模型建议不等于人工确认。</p>
          {state.semanticReview.results.map((item) => <article key={item.id} className="construction-card"><strong className={statusClass(item.status)}>{item.status}</strong><p>{item.reason}{item.distinction ? `（${item.distinction}）` : ''}</p>
            {item.evidence.map((ev) => <blockquote key={ev.id}><small>{ev.id} · {ev.chapter || '章节未定位'} · {ev.location}</small><br />{ev.quote}</blockquote>)}
            <p>人工决定：{state.semanticReview?.decisions?.[item.id] === 'accepted' ? '接受此判断' : state.semanticReview?.decisions?.[item.id] === 'rejected' ? '排除此建议' : '待确认'}</p>
            <button disabled={busy || state.stale} onClick={() => run(() => api.decideSemanticFinding(item.id, 'accepted'), '已记录接受此判断')}>接受判断</button>
            <button disabled={busy || state.stale} onClick={() => run(() => api.decideSemanticFinding(item.id, 'rejected'), '已排除此建议')}>排除建议</button>
            <button disabled={busy || state.stale || !state.semanticReview?.decisions?.[item.id]} onClick={() => run(() => api.decideSemanticFinding(item.id, 'pending'), '已撤销人工决定')}>撤销决定</button>
          </article>)}
        </div>}
      </div>
      {state.findings.map((item) => <article className="construction-card" key={item.id}><div className="construction-card-head"><h3>{item.title}</h3><strong className={statusClass(item.status)}>{item.status}</strong></div>
        <p>{item.explanation}</p><p><b>处理建议：</b>{item.advice}</p>
        <details open={item.status !== '无问题'}><summary>原文证据（{item.evidence.length} 处）</summary>{item.evidence.map((ev, i) => <blockquote key={`${ev.location}-${i}`}><small>{state.originalName} · {ev.chapter || '章节未定位'} · {ev.location}</small><br />{ev.text}</blockquote>)}</details>
        <button disabled={busy || state.stale} onClick={() => run(() => api.confirmFinding(item.id, !item.confirmed), '人工确认状态已保存')}>人工确认：{item.confirmed ? '已确认（点击撤销）' : '待确认（点击确认）'}</button>
      </article>)}
    </section>}
    {state && tab === 'revision' && state.sourcePath && <section><h2>4.17 适老化专项工程</h2>
      <p>原文与表格保持可见。只有人工确认的段落修改才写入导出的原 DOCX 副本；未确认的建议不会成为项目事实。</p>
      {state.suggestions.map((suggestion) => <article className="construction-card" key={suggestion.id}><h3>{suggestion.title} · {suggestion.status}</h3><p>{suggestion.text}</p><small>依据：{suggestion.evidence.map((ev) => ev.location).join('、') || '需要外部资料'}</small></article>)}
      <h3>章节原文与表格</h3><div className="construction-section">{state.sectionBlocks.map((block) => block.kind === 'table' ? <div key={block.location} className="construction-table-wrap"><small>{block.location}</small><table><tbody>{block.rows?.map((row, r) => <tr key={r}>{row.map((cell) => <td key={cell.location} colSpan={cell.gridSpan || 1} title={cell.location}>{cell.text}</td>)}</tr>)}</tbody></table></div> : <div className={block.isHeading ? 'construction-heading' : 'construction-paragraph'} key={block.location}><small>{block.location}</small> {block.text} {block.editedText && <em>{block.editConfirmed ? '已确认修订' : '修订待确认'}</em>}{!block.isHeading && (block.editable ? <button onClick={() => selectBlock(block)}>局部修改</button> : <small title="包含图片、域、链接或其他复杂 Word 元素">需在 Word 中修改</small>)}</div>)}</div>
      {selectedBlock && <div className="construction-editor"><h3>修改 {selectedBlock.location}</h3><p><b>原文：</b>{selectedBlock.text}</p><label>修订文字<textarea value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
        <button disabled={busy || state.stale} onClick={() => run(() => api.confirmEdit(selected, draft, false), '修订已暂存，尚未确认')}>暂存修改</button>
        <button disabled={busy || state.stale || draft === selectedBlock.text} onClick={() => run(() => api.confirmEdit(selected, draft, true), '已人工确认此段修订')}>确认此段修订</button>
      </div>}
      <h3>章节数值事实</h3><p>{state.facts.length} 条可定位数值（页面仅显示前 160 条）；逐项须结合设计与产品资料核实。</p>
    </section>}
  </main>;
}
