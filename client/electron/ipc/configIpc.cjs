const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, shell } = require('electron');

function registerConfigIpc({ configStore, aiService, onDeveloperModeChange, onConfigChanged }) {
  ipcMain.handle('config:load', () => {
    const config = configStore.load();
    return {
      ...config, api_key: '',
      text_model_profiles: Object.fromEntries(Object.entries(config.text_model_profiles || {}).map(([name, profile]) => [name, { ...profile, api_key: '' }])),
      image_model: { ...config.image_model, api_key: '' },
      image_model_profiles: Object.fromEntries(Object.entries(config.image_model_profiles || {}).map(([name, profile]) => [name, { ...profile, api_key: '' }])),
    };
  });
  ipcMain.handle('config:save', (_event, config) => {
    const containsKey = (value) => value && typeof value === 'object' && Object.entries(value).some(([key, entry]) => key === 'api_key' && Boolean(entry) || containsKey(entry));
    if (containsKey(config)) throw new Error('请通过“设置 → AI 模型”安全保存 API Key');
    const previousConfig = configStore.load();
    const result = configStore.save(config);
    const nextConfig = configStore.load();
    onDeveloperModeChange?.(Boolean(nextConfig?.developer_mode));
    onConfigChanged?.(nextConfig, previousConfig);
    return result;
  });
  ipcMain.handle('config:list-models', () => aiService.listModels());
  ipcMain.handle('config:get-model-info', (_event, modelName) => aiService.getModelInfo(modelName));
  ipcMain.handle('config:open-config-folder', async () => {
    const configFolder = path.dirname(configStore.getConfigFilePath());
    fs.mkdirSync(configFolder, { recursive: true });
    const errorMessage = await shell.openPath(configFolder);

    if (errorMessage) {
      throw new Error(`打开配置文件夹失败：${errorMessage}`);
    }

    return { success: true, path: configFolder };
  });
}

module.exports = {
  registerConfigIpc,
};
