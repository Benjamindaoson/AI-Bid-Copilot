const { ipcMain } = require('electron');

function registerConstructionCheckIpc({ service }) {
  ipcMain.handle('construction-check:load', () => service.load());
  ipcMain.handle('construction-check:import', (_event, filePath) => service.importFile(filePath));
  ipcMain.handle('construction-check:confirm-finding', (_event, id, confirmed) => service.confirmFinding(id, confirmed));
  ipcMain.handle('construction-check:confirm-edit', (_event, location, text, confirmed) => service.confirmEdit(location, text, confirmed));
  ipcMain.handle('construction-check:semantic-review', (_event, authorization) => service.semanticReview(authorization));
  ipcMain.handle('construction-check:decide-semantic-finding', (_event, id, decision) => service.decideSemanticFinding(id, decision));
  ipcMain.handle('construction-check:export-audit', (_event, outputPath) => service.exportAudit(outputPath));
  ipcMain.handle('construction-check:export-revision', (_event, outputPath) => service.exportRevision(outputPath));
}
module.exports = { registerConstructionCheckIpc };
