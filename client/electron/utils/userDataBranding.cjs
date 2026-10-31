const fs = require('node:fs');
const path = require('node:path');

// Keep an existing workspace in place when the displayed product name changes.
// In particular, safeStorage ciphertext and SQLite paths must not be copied or reset.
const LEGACY_DATA_FOLDERS = ['头标智能体', '易标投标工具箱', 'yibiao-client'];

function hasUserData(directory) {
  return ['model-providers.json', 'user_config.json', 'workspace'].some((entry) => fs.existsSync(path.join(directory, entry)));
}

function chooseUserDataPath(appDataDirectory, productName) {
  const current = path.join(appDataDirectory, productName);
  if (hasUserData(current)) return current;
  return LEGACY_DATA_FOLDERS
    .map((folder) => path.join(appDataDirectory, folder))
    .find(hasUserData) || current;
}

module.exports = { chooseUserDataPath };
