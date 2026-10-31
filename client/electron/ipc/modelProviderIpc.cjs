const { ipcMain } = require('electron');

function registerModelProviderIpc({ store }) {
  ipcMain.handle('model-provider:list', () => store.list());
  ipcMain.handle('model-provider:save', (_event, config) => store.upsert(config));
  ipcMain.handle('model-provider:remove', (_event, id) => store.remove(id));
  ipcMain.handle('model-provider:remove-key', (_event, id) => store.removeKey(id));
  ipcMain.handle('model-provider:select', (_event, task, id) => store.select(task, id));
  ipcMain.handle('model-provider:test', (_event, id) => store.testConnection(id));
  ipcMain.handle('model-provider:models', (_event, id) => store.listModels(id));
}

module.exports = { registerModelProviderIpc };
