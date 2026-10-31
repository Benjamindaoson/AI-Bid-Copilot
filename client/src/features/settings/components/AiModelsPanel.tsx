import { useEffect, useState } from 'react';
import type { ModelConnection, ModelConnectionDraft, ModelProviderState } from '../../../shared/types/config';

const emptyDraft = (): ModelConnectionDraft => ({ name: '', protocol: 'openai-compatible', capability: 'text', baseUrl: '', modelId: '', timeoutMs: 60000, maxOutputTokens: 4096, temperature: null, reasoningEffort: '', apiKey: '' });
const taskLabels: Record<string, string> = {
  'tender-parse': '招标文件解析', 'technical-plan': '技术标生成', 'section-rewrite': '章节扩写与修改',
  'construction-check': '施工标书体检', 'knowledge-base': '企业知识库', agent: '智能体任务',
};

export default function AiModelsPanel() {
  const api = window.yibiao.modelProviders;
  const [data, setData] = useState<ModelProviderState | null>(null);
  const [draft, setDraft] = useState<ModelConnectionDraft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => { void api.list().then(setData).catch((error) => setMessage(String(error))); }, []);
  async function run(action: () => Promise<ModelProviderState>, success: string) {
    setBusy(true); setMessage('');
    try { setData(await action()); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  function edit(item: ModelConnection) { setEditing(true); setModels([]); setDraft({ ...item, apiKey: '' }); }
  async function save() {
    setBusy(true); setMessage('');
    try { setData(await api.save(draft)); setEditing(false); setDraft(emptyDraft()); setMessage('模型配置已安全保存'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function diagnose(id: string) {
    setBusy(true); setMessage('');
    try { const result = await api.test(id); setData(await api.list()); setMessage(`${result.success ? 'PASS' : 'FAIL'} · ${result.message}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function fetchModels(id: string) {
    setBusy(true); setMessage('');
    try { const result = await api.models(id); setModels(result.models); setMessage(result.message); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const text = data?.connections.filter((item) => item.capability === 'text') || [];
  const images = data?.connections.filter((item) => item.capability === 'image') || [];
  return <section className="settings-page-section">
    <div className="settings-group-title">AI 模型</div>
    <p>自行配置 OpenAI-compatible 服务或本地模型。模型 ID 可手动填写，模型目录不可用也能保存配置。文本与图片模型分别选择。</p>
    {!data?.connections.length && <p role="status">尚未配置 AI 模型。请添加自己的 API Key 或连接本地模型。</p>}
    {!data?.secureStorageAvailable && <p role="alert">系统安全存储不可用。可以配置无密钥本地模型；远程 API Key 不会以明文保存。</p>}
    {data?.migrationWarning && <p role="alert">{data.migrationWarning}</p>}
    {message && <p role="status">{message}</p>}
    <div className="settings-list">
      {data?.connections.map((item) => <article className="settings-row" key={item.id}>
        <div className="settings-row-copy"><strong>{item.name} · {item.modelId}</strong><span>{item.capability === 'image' ? '图片模型' : '文本模型'} · {item.baseUrl} · 密钥{item.hasApiKey ? '已安全保存' : '未设置'} · {item.testStatus === 'available' ? '连接已验证' : '连接待测试'}</span></div>
        <div>
          <button type="button" disabled={busy} onClick={() => edit(item)}>编辑</button>
          <button type="button" disabled={busy} onClick={() => void run(() => api.select(item.capability === 'image' ? 'image' : 'general', item.id), '已设为默认模型')}>设为默认</button>
          <button type="button" disabled={busy} onClick={() => void diagnose(item.id)}>测试连接</button>
          <button type="button" disabled={busy} onClick={() => void fetchModels(item.id)}>读取模型列表</button>
          {item.hasApiKey && <button type="button" disabled={busy} onClick={() => void run(() => api.removeKey(item.id), '密钥已删除')}>删除密钥</button>}
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(`删除模型配置“${item.name}”？`)) void run(() => api.remove(item.id), '模型配置已删除'); }}>删除配置</button>
        </div>
      </article>)}
    </div>
    {models.length > 0 && <p>服务端模型列表：{models.slice(0, 30).join('、')}{models.length > 30 ? '…' : ''}。仍可手动输入其他模型 ID。</p>}
    <p>连接测试会发送一句不含业务资料的最小请求，服务商可能收取少量费用。请先确认所选服务及资费。</p>
    <button type="button" disabled={busy} onClick={() => { setDraft(emptyDraft()); setEditing(true); setModels([]); }}>添加模型配置</button>
    {editing && <div className="settings-list" style={{ marginTop: 16 }}>
      <label className="settings-row"><span>Provider 名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：我的模型服务" /></label>
      <label className="settings-row"><span>能力</span><select value={draft.capability} onChange={(event) => setDraft({ ...draft, capability: event.target.value as 'text' | 'image' })}><option value="text">文本</option><option value="image">图片</option></select></label>
      <label className="settings-row"><span>协议</span><select value={draft.protocol} onChange={(event) => setDraft({ ...draft, protocol: event.target.value as ModelConnectionDraft['protocol'] })}><option value="openai-compatible">OpenAI-compatible</option><option value="ollama">Ollama（OpenAI 兼容端点）</option></select></label>
      <label className="settings-row"><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://服务地址/v1；本地可用 http://127.0.0.1:11434/v1" /></label>
      <label className="settings-row"><span>API Key</span><input type="password" autoComplete="new-password" value={draft.apiKey || ''} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={draft.id ? '留空表示保留原密钥' : '本地服务可留空'} /></label>
      <label className="settings-row"><span>Model ID</span><input value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} placeholder="手动填写任意模型 ID" /></label>
      <label className="settings-row"><span>超时（毫秒）</span><input type="number" min="1000" max="600000" value={draft.timeoutMs} onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) })} /></label>
      <label className="settings-row"><span>最大输出 Token</span><input type="number" min="1" max="131072" value={draft.maxOutputTokens} onChange={(event) => setDraft({ ...draft, maxOutputTokens: Number(event.target.value) })} /></label>
      <label className="settings-row"><span>温度（可留空）</span><input type="number" min="0" max="2" step="0.1" value={draft.temperature ?? ''} onChange={(event) => setDraft({ ...draft, temperature: event.target.value === '' ? null : Number(event.target.value) })} /></label>
      <label className="settings-row"><span>推理参数（可留空）</span><input value={draft.reasoningEffort} onChange={(event) => setDraft({ ...draft, reasoningEffort: event.target.value })} placeholder="例如 high" /></label>
      <div><button type="button" disabled={busy} onClick={() => void save()}>保存模型配置</button><button type="button" onClick={() => setEditing(false)}>取消</button></div>
    </div>}
    <h3>任务模型选择</h3><p>未指定任务模型时使用默认文本模型。</p>
    {data && Object.entries(taskLabels).map(([task, label]) => <label className="settings-row" key={task}><span>{label}</span><select value={data.taskModels[task] || ''} onChange={(event) => void run(() => api.select(task, event.target.value), '任务模型已更新')}><option value="">默认文本模型</option>{text.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.modelId}</option>)}</select></label>)}
    <p>默认文本模型：{text.find((item) => item.id === data?.defaultTextId)?.name || '未选择'}；默认图片模型：{images.find((item) => item.id === data?.defaultImageId)?.name || '未选择'}。</p>
  </section>;
}
