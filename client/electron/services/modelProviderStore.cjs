const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TASKS = ['general', 'tender-parse', 'technical-plan', 'section-rewrite', 'construction-check', 'knowledge-base', 'agent', 'image'];
const ENCRYPTED_PREFIX = 'safeStorage:v1:';
const DEFAULT_TIMEOUT_MS = 60000;

function validateBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Base URL 格式无效'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('远程模型地址必须使用 HTTPS；本机 localhost 可使用 HTTP');
  if (url.username || url.password || url.search || url.hash) throw new Error('Base URL 不得包含用户名、密码、查询参数或片段');
  if (/\/(?:\.\.|%2e)/i.test(url.pathname)) throw new Error('Base URL 路径无效');
  return url.toString().replace(/\/+$/, '');
}

function publicConnection(connection) {
  const { encryptedKey, ...visible } = connection;
  return { ...visible, hasApiKey: Boolean(encryptedKey) };
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, value, { mode: 0o600 }); fs.renameSync(temp, file); }
  catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
}

function createModelProviderStore({ app, safeStorage, fetchImpl = fetch }) {
  const file = path.join(app.getPath('userData'), 'model-providers.json');
  let migrationWarning = '';
  const empty = () => ({ version: 1, connections: [], defaultTextId: '', defaultImageId: '', taskModels: {} });
  const secure = () => Boolean(safeStorage?.isEncryptionAvailable?.());
  const encrypt = (secret) => {
    if (!secret) return '';
    if (!secure()) throw new Error('系统安全存储不可用；API Key 未保存。请检查 Windows 安全存储环境');
    return ENCRYPTED_PREFIX + safeStorage.encryptString(secret).toString('base64');
  };
  const decrypt = (stored) => {
    if (!stored) return '';
    if (!stored.startsWith(ENCRYPTED_PREFIX) || !secure()) throw new Error('API Key 无法由当前系统安全存储解密');
    return safeStorage.decryptString(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64'));
  };
  const read = () => {
    if (!fs.existsSync(file)) return empty();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.connections)) throw new Error('模型配置版本不受支持，原文件未修改');
    return data;
  };
  const write = (value) => atomicWrite(file, JSON.stringify(value, null, 2));
  const list = () => {
    const state = read();
    return { secureStorageAvailable: secure(), migrationWarning, connections: state.connections.map(publicConnection), defaultTextId: state.defaultTextId, defaultImageId: state.defaultImageId, taskModels: state.taskModels, tasks: TASKS };
  };
  function upsert(input) {
    const state = read();
    const id = String(input?.id || '').trim() || crypto.randomUUID();
    const previous = state.connections.find((item) => item.id === id);
    if (input?.id && !previous) throw new Error('模型配置不存在');
    const name = String(input?.name || '').trim();
    const modelId = String(input?.modelId || '').trim();
    if (!name || name.length > 80 || !modelId || modelId.length > 160 || /[\r\n]/.test(name + modelId)) throw new Error('请填写有效的 Provider 名称和模型 ID');
    const capability = input?.capability === 'image' ? 'image' : 'text';
    const protocol = input?.protocol === 'ollama' ? 'ollama' : 'openai-compatible';
    const baseUrl = validateBaseUrl(input?.baseUrl);
    const timeoutMs = Math.max(1000, Math.min(600000, Math.floor(Number(input?.timeoutMs) || DEFAULT_TIMEOUT_MS)));
    const maxOutputTokens = Math.max(1, Math.min(131072, Math.floor(Number(input?.maxOutputTokens) || 4096)));
    const temperature = input?.temperature === '' || input?.temperature === undefined ? null : Number(input.temperature);
    if (temperature !== null && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) throw new Error('温度参数应在 0–2 之间');
    const key = String(input?.apiKey || '').trim();
    const encryptedKey = key ? encrypt(key) : previous?.encryptedKey || '';
    const connection = { id, name, protocol, capability, baseUrl, modelId, timeoutMs, maxOutputTokens, temperature, reasoningEffort: String(input?.reasoningEffort || '').trim().slice(0, 40), encryptedKey, testStatus: 'untested' };
    state.connections = previous ? state.connections.map((item) => item.id === id ? connection : item) : [...state.connections, connection];
    if (capability === 'text' && !state.defaultTextId) state.defaultTextId = id;
    if (capability === 'image' && !state.defaultImageId) state.defaultImageId = id;
    write(state);
    return list();
  }
  function remove(id) {
    const state = read();
    state.connections = state.connections.filter((item) => item.id !== id);
    if (state.defaultTextId === id) state.defaultTextId = '';
    if (state.defaultImageId === id) state.defaultImageId = '';
    for (const [task, selected] of Object.entries(state.taskModels)) if (selected === id) delete state.taskModels[task];
    write(state);
    return list();
  }
  function removeKey(id) {
    const state = read();
    const connection = state.connections.find((item) => item.id === id);
    if (!connection) throw new Error('模型配置不存在');
    connection.encryptedKey = '';
    connection.testStatus = 'untested';
    write(state);
    return list();
  }
  function select(task, id) {
    const state = read();
    if (!TASKS.includes(task)) throw new Error('未知的业务任务');
    const connection = id ? state.connections.find((item) => item.id === id) : null;
    if (id && !connection) throw new Error('模型配置不存在');
    if (connection && connection.capability !== (task === 'image' ? 'image' : 'text')) throw new Error('模型能力与任务不匹配');
    if (task === 'general') state.defaultTextId = id || '';
    else if (task === 'image') state.defaultImageId = id || '';
    else if (id) state.taskModels[task] = id;
    else delete state.taskModels[task];
    write(state);
    return list();
  }
  function resolved(task = 'general', capability = 'text') {
    const state = read();
    const id = capability === 'image' ? state.defaultImageId : (state.taskModels[task] || state.defaultTextId);
    const connection = state.connections.find((item) => item.id === id && item.capability === capability);
    return connection ? { ...connection, apiKey: decrypt(connection.encryptedKey) } : null;
  }
  function applyToConfig(config, task = 'general') {
    const text = resolved(task, 'text');
    const image = resolved('image', 'image');
    return {
      ...config,
      text_model_provider: 'custom',
      api_key: text?.apiKey || '', base_url: text?.baseUrl || '', model_name: text?.modelId || '',
      output_token_limit: text?.maxOutputTokens || config.output_token_limit,
      reasoning_effort: text?.reasoningEffort || '',
      temperature_enabled: text?.temperature !== null && text?.temperature !== undefined,
      temperature: text?.temperature ?? config.temperature,
      model_timeout_ms: text?.timeoutMs || DEFAULT_TIMEOUT_MS,
      image_model: image ? { ...config.image_model, provider: 'custom', base_url: image.baseUrl, api_key: image.apiKey, model_name: image.modelId, status: image.testStatus === 'available' ? 'available' : 'untested' } : { ...config.image_model, provider: 'custom', base_url: '', api_key: '', model_name: '', status: 'untested' },
    };
  }
  async function testConnection(id) {
    const connection = resolvedById(id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), connection.timeoutMs);
    try {
      const isImage = connection.capability === 'image';
      const endpoint = `${connection.baseUrl}/${isImage ? 'images/generations' : 'chat/completions'}`;
      const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}) },
        body: JSON.stringify(isImage ? { model: connection.modelId, prompt: 'A plain grey square.', size: '1024x1024' } : { model: connection.modelId, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 1 }),
      });
      if (!response.ok) return { success: false, status: response.status, message: diagnosticMessage(response.status) };
      const body = await response.json().catch(() => null);
      if (!Array.isArray(isImage ? body?.data : body?.choices)) return { success: false, status: response.status, message: `服务已响应，但返回格式不是 OpenAI-compatible ${isImage ? 'Images' : 'Chat Completions'}` };
      const state = read();
      const selected = state.connections.find((item) => item.id === id);
      if (selected) { selected.testStatus = 'available'; write(state); }
      return { success: true, status: response.status, message: '连接成功：服务接受了当前模型 ID 的最小请求' };
    } catch (error) {
      return { success: false, status: 0, message: error?.name === 'AbortError' ? '连接超时，请检查服务地址或增大超时时间' : '网络连接失败，请检查服务地址和本机网络' };
    } finally { clearTimeout(timer); }
  }
  function resolvedById(id) {
    const connection = read().connections.find((item) => item.id === id);
    if (!connection) throw new Error('模型配置不存在');
    return { ...connection, apiKey: decrypt(connection.encryptedKey) };
  }
  async function listModels(id) {
    const connection = resolvedById(id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), connection.timeoutMs);
    try {
      const response = await fetchImpl(`${connection.baseUrl}/models`, { method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {} });
      if (!response.ok) return { success: false, models: [], message: diagnosticMessage(response.status) };
      const body = await response.json();
      return { success: true, models: Array.isArray(body?.data) ? body.data.map((item) => String(item?.id || '')).filter(Boolean) : [], message: '可继续手动填写任意模型 ID' };
    } catch { return { success: false, models: [], message: '模型目录不可用；仍可手动填写模型 ID' }; }
    finally { clearTimeout(timer); }
  }
  function migrateLegacy(configFile, { scrubSource = true } = {}) {
    if (fs.existsSync(file) || !fs.existsSync(configFile)) return { migrated: false, reason: '无需迁移' };
    const raw = fs.readFileSync(configFile, 'utf8');
    const old = JSON.parse(raw);
    const candidates = [];
    const profiles = old.text_model_profiles && typeof old.text_model_profiles === 'object' ? old.text_model_profiles : {};
    const selected = String(old.text_model_provider || 'custom');
    if (old.base_url && old.model_name) profiles[selected] = { ...profiles[selected], base_url: old.base_url, model_name: old.model_name, api_key: old.api_key || profiles[selected]?.api_key || '' };
    for (const [name, profile] of Object.entries(profiles)) {
      if (!profile?.base_url || !profile?.model_name) continue;
      try { candidates.push({ name: name === 'official' ? '原有服务（待人工选择）' : name, capability: 'text', protocol: 'openai-compatible', baseUrl: validateBaseUrl(profile.base_url), modelId: profile.model_name, apiKey: profile.api_key || '' }); } catch {}
    }
    const image = old.image_model || {};
    const imageProfiles = old.image_model_profiles && typeof old.image_model_profiles === 'object' ? old.image_model_profiles : {};
    if (image.provider && image.base_url && image.model_name) imageProfiles[image.provider] = { ...imageProfiles[image.provider], ...image };
    for (const [name, profile] of Object.entries(imageProfiles)) {
      if (!profile?.base_url || !profile?.model_name) continue;
      try { candidates.push({ name: `原有图片模型 ${name}`, legacyName: name, capability: 'image', protocol: 'openai-compatible', baseUrl: validateBaseUrl(profile.base_url), modelId: profile.model_name, apiKey: profile.api_key || '' }); } catch {}
    }
    const legacySecrets = new Set();
    const collectSecrets = (object) => {
      if (!object || typeof object !== 'object') return;
      for (const [key, value] of Object.entries(object)) {
        if (key === 'api_key' && value) legacySecrets.add(String(value));
        else collectSecrets(value);
      }
    };
    collectSecrets(old);
    const importedSecrets = new Set(candidates.map((item) => String(item.apiKey || '')).filter(Boolean));
    if ([...legacySecrets].some((secret) => !importedSecrets.has(secret))) {
      migrationWarning = '原模型配置含无法安全迁入的密钥；原文件保持不变，请检查服务地址和模型 ID';
      return { migrated: false, reason: migrationWarning };
    }
    if (candidates.some((item) => item.apiKey) && !secure()) {
      migrationWarning = '系统安全存储不可用，原配置未修改；模型调用已暂停';
      return { migrated: false, reason: migrationWarning };
    }
    const state = empty();
    for (const candidate of candidates) {
      const id = crypto.randomUUID();
      state.connections.push({ id, name: candidate.name, capability: candidate.capability, protocol: candidate.protocol, baseUrl: candidate.baseUrl, modelId: candidate.modelId, timeoutMs: DEFAULT_TIMEOUT_MS, maxOutputTokens: 4096, temperature: null, reasoningEffort: '', encryptedKey: encrypt(candidate.apiKey) });
      if (candidate.capability === 'text' && candidate.name === selected && selected !== 'official') state.defaultTextId = id;
      if (candidate.capability === 'image' && candidate.legacyName === image.provider) state.defaultImageId = id;
    }
    const scrub = (object) => { if (!object || typeof object !== 'object') return; for (const [key, value] of Object.entries(object)) { if (key === 'api_key') object[key] = ''; else scrub(value); } };
    const cleaned = JSON.parse(raw); scrub(cleaned);
    if (scrubSource && raw !== JSON.stringify(cleaned) && secure()) atomicWrite(`${configFile}.pre-byok.enc`, safeStorage.encryptString(raw));
    write(state);
    const newConfigFile = scrubSource ? configFile : path.join(app.getPath('userData'), 'user_config.json');
    if (!scrubSource && fs.existsSync(newConfigFile)) {
      fs.rmSync(file, { force: true });
      throw new Error('新配置已存在；未覆盖任何文件，请先核对迁移来源');
    }
    try { atomicWrite(newConfigFile, JSON.stringify(cleaned, null, 2)); }
    catch (error) { fs.rmSync(file, { force: true }); throw error; }
    return { migrated: true, imported: state.connections.length, legacyOfficialInactive: selected === 'official' };
  }
  return { file, list, upsert, remove, removeKey, select, resolved, applyToConfig, testConnection, listModels, migrateLegacy };
}

function diagnosticMessage(status) {
  if (status === 401) return '认证失败（401）：请检查 API Key 或认证方式';
  if (status === 403) return '权限不足（403）：请检查模型访问权限';
  if (status === 404) return '未找到接口或模型（404）：请检查 Base URL、API 路径和模型 ID';
  if (status === 429) return '服务限流或额度限制（429）：请稍后重试或检查当前服务额度';
  if (status >= 300 && status < 400) return '服务返回重定向；为防止密钥泄露，已拒绝自动转发';
  return `服务返回 HTTP ${status}；请检查所选 Provider`;
}

module.exports = { createModelProviderStore, validateBaseUrl, diagnosticMessage, TASKS };
