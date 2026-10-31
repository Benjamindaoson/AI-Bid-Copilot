const { ipcMain } = require('electron');

function registerManufacturingIpc({ service }) {
  ipcMain.handle('manufacturing:load', () => service.load());
  ipcMain.handle('manufacturing:analyze', () => service.analyze());
  ipcMain.handle('manufacturing:import-enterprise', (_event, paths) => service.importEnterprise(paths));
  ipcMain.handle('manufacturing:update', (_event, patch) => service.update(patch));
  ipcMain.handle('manufacturing:draft', () => service.generateChapterDraft());
  ipcMain.handle('manufacturing:confirm-risk', (_event, issue, reason, confirmed) => service.confirmRisk(issue, reason, confirmed));
  ipcMain.handle('manufacturing:export-word', () => service.exportWord());
}
module.exports = { registerManufacturingIpc };
