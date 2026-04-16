/**
 * applyPlainTextToEditorHost — preserve single-level strong/em/span wrappers on commit.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const syncPath = path.join(__dirname, '../public/editor-host-sync.js');
const syncCode = fs.readFileSync(syncPath, 'utf8');

const jsdomOpts = { runScripts: 'dangerously' };

function loadSync(window) {
  const doc = window.document;
  const s = doc.createElement('script');
  s.textContent = syncCode;
  (doc.head || doc.body).appendChild(s);
  return window.plainstackEditorHostSync;
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function test(name, fn) {
  try {
    fn();
    console.log('ok:', name);
  } catch (e) {
    failed++;
    console.error('FAIL:', name, e.message);
  }
}

test('apply: leaf host replaces one text node (spaces preserved)', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', jsdomOpts);
  const doc = dom.window.document;
  const api = loadSync(dom.window);
  const host = doc.createElement('span');
  host.setAttribute('data-editor-id', 'ed-0');
  host.appendChild(doc.createTextNode(' One place.'));
  doc.body.appendChild(host);
  api.applyPlainTextToEditorHost(host, '  x ');
  assert(host.textContent === '  x ');
  assert(host.childNodes.length === 1 && host.firstChild.nodeType === 3);
});

test('apply: strong wrapper keeps strong, updates text child only', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', jsdomOpts);
  const doc = dom.window.document;
  const api = loadSync(dom.window);
  const host = doc.createElement('span');
  host.setAttribute('data-editor-id', 'ed-0');
  const strong = doc.createElement('strong');
  strong.appendChild(doc.createTextNode('Important:'));
  host.appendChild(strong);
  doc.body.appendChild(host);
  api.applyPlainTextToEditorHost(host, 'Note:');
  assert(host.querySelector('strong'), 'strong preserved');
  assert(host.querySelector('strong').textContent === 'Note:');
  assert(host.querySelectorAll('strong').length === 1);
});

test('apply: single text node descendant under nested spans', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', jsdomOpts);
  const doc = dom.window.document;
  const api = loadSync(dom.window);
  const host = doc.createElement('span');
  host.setAttribute('data-editor-id', 'ed-0');
  const outer = doc.createElement('span');
  outer.className = 'accent';
  outer.appendChild(doc.createTextNode('number'));
  host.appendChild(outer);
  doc.body.appendChild(host);
  api.applyPlainTextToEditorHost(host, 'n');
  assert(outer.className === 'accent');
  assert(outer.textContent === 'n');
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll editor-host-sync tests passed.');
process.exit(failed ? 1 : 0);
