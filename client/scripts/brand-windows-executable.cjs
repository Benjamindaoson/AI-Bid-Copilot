const fs = require('node:fs');
const path = require('node:path');
const resedit = require('resedit');
const branding = require('../product-branding.json');

// Keep the unsigned local build neutral. resedit is already an MIT-licensed dependency.
module.exports = async function brandWindowsExecutable(context) {
  if (context.electronPlatformName !== 'win32') return;
  const executableName = context.packager.appInfo.productFilename;
  const exe = path.join(context.appOutDir, `${executableName}.exe`);
  const icon = path.join(__dirname, '..', 'assets', 'icon.ico');
  if (!fs.existsSync(exe) || !fs.existsSync(icon)) {
    throw new Error('缺少 Windows 可执行文件或中性图标，拒绝生成带旧资源的安装包');
  }
  const binary = resedit.NtExecutable.from(fs.readFileSync(exe));
  const resources = resedit.NtExecutableResource.from(binary);
  const iconGroup = resedit.Resource.IconGroupEntry.fromEntries(resources.entries)[0];
  const version = resedit.Resource.VersionInfo.fromEntries(resources.entries)[0];
  if (!iconGroup || !version) throw new Error('Windows 可执行文件缺少图标或版本资源');
  const icons = resedit.Data.IconFile.from(fs.readFileSync(icon)).icons.map((item) => item.data);
  resedit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, iconGroup.id, iconGroup.lang, icons);
  version.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: branding.productName,
    ProductName: branding.productName,
    CompanyName: branding.publisher,
    OriginalFilename: `${executableName}.exe`,
  });
  version.outputToResourceEntries(resources.entries);
  resources.outputResource(binary);
  const temp = `${exe}.branding.tmp`;
  try {
    fs.writeFileSync(temp, Buffer.from(binary.generate()));
    fs.renameSync(temp, exe);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
};
