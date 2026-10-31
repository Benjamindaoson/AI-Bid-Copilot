const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { replaceParagraphText } = require('./constructionCheckService.cjs');
const { isPlainTextParagraph } = require('./constructionDocx.cjs');

const xml = (body) => new DOMParser().parseFromString(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:p>`, 'text/xml').documentElement;
const text = (p) => Array.from(p.getElementsByTagName('w:t')).map((node) => node.textContent).join('');

test('single-run revision retains paragraph and run formatting', () => {
  const p = xml('<w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="123456"/></w:rPr><w:t>original text</w:t></w:r>');
  const before = new XMLSerializer().serializeToString(p.getElementsByTagName('w:rPr')[0]);
  assert.equal(isPlainTextParagraph(p), true);
  replaceParagraphText(p, 'revised text');
  assert.equal(text(p), 'revised text');
  assert.equal(new XMLSerializer().serializeToString(p.getElementsByTagName('w:rPr')[0]), before);
  assert.equal(p.getElementsByTagName('w:pStyle')[0].getAttribute('w:val'), 'Body');
});

test('multi-run revision keeps unchanged text in its original styled runs', () => {
  const p = xml('<w:r><w:rPr><w:b/></w:rPr><w:t>abc</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>def</w:t></w:r>');
  replaceParagraphText(p, 'abXef');
  assert.equal(text(p), 'abXef');
  assert.deepEqual(Array.from(p.getElementsByTagName('w:t')).map((node) => node.textContent), ['abX', 'ef']);
  assert.equal(p.getElementsByTagName('w:b').length, 1);
  assert.equal(p.getElementsByTagName('w:i').length, 1);
});

test('complex paragraph is rejected without mutating its XML', () => {
  const p = xml('<w:r><w:t>before</w:t><w:drawing/></w:r>');
  const before = new XMLSerializer().serializeToString(p);
  assert.equal(isPlainTextParagraph(p), false);
  assert.throws(() => replaceParagraphText(p, 'after'), /复杂元素/);
  assert.equal(new XMLSerializer().serializeToString(p), before);
});
