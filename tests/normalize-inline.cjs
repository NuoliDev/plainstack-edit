/**
 * Normalization idempotency + fixture cases (run: npm test).
 * Loads public/normalize-inline.js in jsdom.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const normPath = path.join(__dirname, '../public/normalize-inline.js');
const normCode = fs.readFileSync(normPath, 'utf8');

/** JSDOM runs inline scripts only with runScripts: 'dangerously'; window.eval has no window/document. */
const jsdomOpts = { runScripts: 'dangerously' };

function loadNormalize(window) {
  const doc = window.document;
  const s = doc.createElement('script');
  s.textContent = normCode;
  (doc.head || doc.body).appendChild(s);
  return window.plainstackNormalize;
}

function fullShell(html) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', jsdomOpts);
  const doc = dom.window.document;
  doc.body.innerHTML = html;
  const pn = loadNormalize(dom.window);
  const audit = pn.wrapUnhostedVisibleText(doc);
  const merged = pn.mergeAdjacentPlainEditorSpans(doc);
  const cov = pn.verifyAllVisibleTextUnderEditorHost(doc);
  return {
    doc,
    audit,
    merged,
    cov,
    htmlOut: doc.body.innerHTML,
    serialize: doc.documentElement.outerHTML,
  };
}

function runTwice(html) {
  const a = fullShell(html);
  const dom2 = new JSDOM(
    '<!DOCTYPE html><html><head></head><body>' + a.htmlOut + '</body></html>',
    jsdomOpts
  );
  const doc2 = dom2.window.document;
  const pn2 = loadNormalize(dom2.window);
  const audit2 = pn2.wrapUnhostedVisibleText(doc2);
  pn2.mergeAdjacentPlainEditorSpans(doc2);
  const cov2 = pn2.verifyAllVisibleTextUnderEditorHost(doc2);
  return {
    first: a,
    secondAudit: audit2,
    secondHtml: doc2.body.innerHTML,
    cov2,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('ok:', name);
  } catch (e) {
    failed++;
    console.error('FAIL:', name, e.message);
  }
}

// —— Cases 1–6 ——
test('Case 1: mixed p + span.accent + tail text', () => {
  const h =
    '<p>One <span class="accent">number</span>. One place for your health.</p>';
  const { cov, htmlOut } = fullShell(h);
  assert(cov.ok, 'coverage: ' + JSON.stringify(cov.failures));
  assert(htmlOut.includes('accent'), 'preserves class');
  assert(htmlOut.includes('plainstack-edit-run'), 'wrapped loose runs use plainstack-edit-run');
  assert(
    (htmlOut.match(/data-editor-id/g) || []).length >= 3,
    'at least three editor hosts for visible runs'
  );
});

test('Case 2: strong + following text', () => {
  const h = '<p><strong>Important:</strong> refill needed today.</p>';
  const { cov } = fullShell(h);
  assert(cov.ok);
});

test('Case 3: em inline', () => {
  const h = '<p>I need <em>help</em> with my appointment.</p>';
  const { cov, htmlOut } = fullShell(h);
  assert(cov.ok);
  assert(htmlOut.includes('<em>'));
});

test('Case 4: li with span.accent', () => {
  const h = '<ul><li>Call <span class="accent">today</span> if symptoms worsen.</li></ul>';
  const { cov, htmlOut } = fullShell(h);
  assert(cov.ok);
  assert(htmlOut.includes('accent'));
});

test('Case 5: existing ed-3 + loose tail', () => {
  const h =
    '<div class="highlight"><span data-editor-id="ed-3">One number.</span> One place for your health.</div>';
  const { cov, audit, htmlOut } = fullShell(h);
  assert(cov.ok);
  assert(htmlOut.includes('data-editor-id="ed-3"'));
  assert(audit.length >= 1, 'audit should record new wrap for tail');
  assert(/ed-[0-9]+/.test(htmlOut), 'new numeric id present');
});

test('Case 6: idempotent — second pass adds no wraps', () => {
  const h =
    '<div class="highlight"><span data-editor-id="ed-3">One number.</span> One place for your health.</div>';
  const { secondAudit, first, secondHtml } = runTwice(h);
  assert(secondAudit.length === 0, 'second wrap audit should be empty, got ' + secondAudit.length);
  assert(
    first.htmlOut.replace(/\s+/g, ' ') === secondHtml.replace(/\s+/g, ' '),
    'HTML stable across re-normalize'
  );
});

test('Merge: adjacent plain spans collapse when both only have data-editor-id', () => {
  const h = '<p>x</p>';
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', jsdomOpts);
  const doc = dom.window.document;
  doc.body.innerHTML = '<p><span data-editor-id="ed-0">a</span><span data-editor-id="ed-1">b</span></p>';
  const pn = loadNormalize(dom.window);
  const m = pn.mergeAdjacentPlainEditorSpans(doc);
  assert(m === 1);
  const spans = doc.body.querySelectorAll('span[data-editor-id]');
  assert(spans.length === 1, 'merged to one span');
});

test('Merge: adjacent spans with plainstack-edit-run + data-editor-id still merge', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', jsdomOpts);
  const doc = dom.window.document;
  doc.body.innerHTML =
    '<p><span class="plainstack-edit-run" data-editor-id="ed-0">a</span><span class="plainstack-edit-run" data-editor-id="ed-1">b</span></p>';
  const pn = loadNormalize(dom.window);
  const m = pn.mergeAdjacentPlainEditorSpans(doc);
  assert(m === 1);
  const spans = doc.body.querySelectorAll('span[data-editor-id]');
  assert(spans.length === 1);
  assert(doc.body.textContent.includes('ab'));
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll tests passed.');
process.exit(failed ? 1 : 0);
