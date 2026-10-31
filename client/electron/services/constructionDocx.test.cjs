const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { DOMParser } = require('@xmldom/xmldom');
const { validateDocxSize, validateDocxArchive, safeXml } = require('./constructionDocx.cjs');

test('normal local Word archive passes bounded preflight', () => {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'));
  assert.doesNotThrow(() => validateDocxArchive(new AdmZip(zip.toBuffer())));
  assert.doesNotThrow(() => validateDocxSize(zip.toBuffer().length));
});

test('high compression ratio and unsafe archive paths are rejected', () => {
  const bomb = new AdmZip();
  bomb.addFile('word/document.xml', Buffer.from('A'.repeat(1024 * 1024)));
  assert.throws(() => validateDocxArchive(new AdmZip(bomb.toBuffer())), /压缩比异常/);
  const fakeEntry = (entryName) => ({ entryName, isDirectory: false, header: { size: 1, compressedSize: 1, encrypted: false }, getData: () => Buffer.from('x') });
  assert.throws(() => validateDocxArchive({ getEntries: () => [fakeEntry('word/document.xml'), fakeEntry('../outside.txt')] }), /内部路径/);
});

test('oversized input and XML entity declarations are rejected', () => {
  assert.throws(() => validateDocxSize(101 * 1048576), /上限 100 MiB/);
  const entry = { getData: () => Buffer.from('<!DOCTYPE x [<!ENTITY e "bad">]><x>&e;</x>') };
  assert.throws(() => safeXml(entry, new DOMParser()), /实体声明/);
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from('<x/>'));
  zip.addFile('word/styles.xml', entry.getData());
  assert.throws(() => validateDocxArchive(new AdmZip(zip.toBuffer())), /实体声明：word\/styles.xml/);
});
