/**
 * Pipeline: parse → wrapUnhostedVisibleText → stampEditorIds → serialize → re-parse.
 * Verifies mixed inline runs are not flattened; whitespace preserved.
 *
 * Note: Loose text is wrapped in span.plainstack-edit-run (data-editor-id), so the trailing
 * segment is usually an ELEMENT sibling of .accent, not a raw TEXT_NODE — that still satisfies
 * “distinct runs” and “leading space preserved” in the tail run.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { stampEditorIds, serializeHtmlDocument } = require('./support/wrap-stamp-serialize.cjs');

const normPath = path.join(__dirname, '../public/normalize-inline.js');
const normCode = fs.readFileSync(normPath, 'utf8');
const jsdomOpts = { runScripts: 'dangerously' };

function loadNormalize(window) {
  const doc = window.document;
  const s = doc.createElement('script');
  s.textContent = normCode;
  (doc.head || doc.body).appendChild(s);
  return window.plainstackNormalize;
}

/** Direct children that are elements or non-whitespace-only text (ignores indentation newlines). */
function meaningfulChildNodes(parent) {
  return Array.from(parent.childNodes).filter((n) => {
    if (n.nodeType === 3) return /\S/.test(n.nodeValue || '');
    return n.nodeType === 1;
  });
}

function structuralDump(root, maxDepth = 8) {
  const lines = [];
  function walk(node, depth) {
    if (depth > maxDepth) return;
    const ind = '  '.repeat(depth);
    if (node.nodeType === 1) {
      const el = /** @type {Element} */ (node);
      const tag = el.tagName.toLowerCase();
      const id = el.getAttribute('data-editor-id');
      const cls = el.getAttribute('class');
      const hint = [id ? `#${id}` : '', cls ? `.${cls.split(/\s+/).join('.')}` : ''].join('');
      lines.push(`${ind}<${tag}${hint}>`);
      for (const c of el.childNodes) walk(c, depth + 1);
      lines.push(`${ind}</${tag}>`);
    } else if (node.nodeType === 3) {
      const t = node.nodeValue ?? '';
      const vis = JSON.stringify(t.length > 60 ? t.slice(0, 60) + '…' : t);
      lines.push(`${ind}#text ${vis}`);
    } else if (node.nodeType === 8) {
      lines.push(`${ind}<!--comment-->`);
    }
  }
  walk(root, 0);
  return lines.join('\n');
}

/**
 * @param {string} htmlFragment inner HTML for body
 */
function runPipeline(htmlFragment) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', jsdomOpts);
  const doc = dom.window.document;
  doc.body.innerHTML = htmlFragment.trim();

  const pn = loadNormalize(dom.window);
  pn.wrapUnhostedVisibleText(doc);
  stampEditorIds(doc, pn);

  const serialized = serializeHtmlDocument(doc);
  const dom2 = new JSDOM(serialized, jsdomOpts);
  const docReparsed = dom2.window.document;

  return { doc, docReparsed, serialized };
}

function fail(msg, extra) {
  console.error(`FAIL: ${msg}`);
  if (extra != null) console.error(extra);
  return false;
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
  return true;
}

// —— Case A: highlight + accent + tail ——
function testHighlightDiv() {
  const html = `<div class="highlight">
  <span class="accent">One number.</span> One place for your health.
</div>`;

  let ok = true;
  try {
    const { doc, docReparsed } = runPipeline(html);
    const h = doc.querySelector('.highlight');
    const h2 = docReparsed.querySelector('.highlight');
    if (!h || !h2) {
      return fail('missing .highlight after pipeline', structuralDump(doc.body));
    }

    const fullText = h.textContent;
    if (!fullText.includes('One number.') || !fullText.includes('One place')) {
      ok = fail('expected full text content lost', fullText) && ok;
    }

    // Must not collapse to a single text node under .highlight
    if (h.childNodes.length === 1 && h.firstChild.nodeType === 3) {
      ok = fail('entire block flattened to one text node', structuralDump(h)) && ok;
    }

    const accent = h.querySelector('span.accent');
    if (!accent) {
      ok = fail('span.accent removed', structuralDump(h)) && ok;
    } else {
      if (accent.textContent.includes('One place')) {
        ok = fail('accent span incorrectly contains trailing sentence (wrapped/merged)', structuralDump(accent)) && ok;
      }
    }

    const meaningful = meaningfulChildNodes(h);
    if (meaningful.length < 2) {
      ok = fail(`.highlight should have >= 2 meaningful child nodes, got ${meaningful.length}`, structuralDump(h)) && ok;
    }

    const m0 = meaningful[0];
    if (!(m0 && m0.nodeType === 1 && m0.tagName.toLowerCase() === 'span' && m0.classList.contains('accent'))) {
      ok = fail(
        `first meaningful child should be span.accent, got ${m0?.nodeName}`,
        structuralDump(h)
      ) && ok;
    }

    const m1 = meaningful[1];
    let tailLeadingOk = false;
    if (m1.nodeType === 3) {
      tailLeadingOk = /^\s/.test(/** @type {Text} */ (m1).nodeValue ?? '');
    } else if (m1.nodeType === 1) {
      const t = /** @type {Element} */ (m1).textContent ?? '';
      tailLeadingOk = /^\s/.test(t);
    }
    if (!tailLeadingOk) {
      ok = fail('leading space before "One place" not preserved on tail run', structuralDump(h)) && ok;
    }

    // Re-parse stability: same logical invariant on second doc
    const hr = docReparsed.querySelector('.highlight');
    if (hr && hr.textContent !== h.textContent) {
      ok = fail('textContent changed after serialize/reparse', {
        before: h.textContent,
        after: hr.textContent,
      }) && ok;
    }

    console.log('\n--- [Case A] .highlight structure (workingDom) ---');
    console.log(structuralDump(h, 10));
    if (ok) return pass('Case A (.highlight + .accent + tail): structure and whitespace OK');
    return false;
  } catch (e) {
    console.error('FAIL: Case A threw', e);
    return false;
  }
}

// —— Case B: p with interleaved text and span.accent ——
function testParagraphMixed() {
  const html = '<p>One <span class="accent">number</span>. One place.</p>';

  let ok = true;
  try {
    const { doc } = runPipeline(html);
    const p = doc.body.querySelector('p');
    if (!p) return fail('missing <p>', structuralDump(doc.body));

    if (p.childNodes.length === 1 && p.firstChild.nodeType === 3) {
      ok = fail('<p> flattened to single text node', structuralDump(p)) && ok;
    }

    const accent = p.querySelector('span.accent');
    if (!accent) {
      ok = fail('span.accent removed from <p>', structuralDump(p)) && ok;
    } else {
      if (!accent.textContent.includes('number')) {
        ok = fail('.accent lost "number"', accent.textContent) && ok;
      }
      if (accent.textContent.includes('One place') || accent.textContent.includes('One ')) {
        ok = fail('accent span incorrectly contains text outside styled word', structuralDump(accent)) && ok;
      }
    }

    // Three logical runs: "One " | accent "number" | ". One place."
    const textFull = p.textContent.replace(/\s+/g, ' ').trim();
    if (!/^One number\. One place\.$/.test(textFull)) {
      ok = fail('concatenated <p> text missing segment', textFull) && ok;
    }

    const meaningfulP = meaningfulChildNodes(p);
    if (meaningfulP.length < 3) {
      ok = fail(`expected 3 meaningful runs on <p>, got ${meaningfulP.length}`, structuralDump(p)) && ok;
    }

    // Walk direct children: must include span.accent as its own node among siblings (not only one span)
    const directSpans = Array.from(p.children);
    const hasAccent = directSpans.some((el) => el.classList && el.classList.contains('accent'));
    if (!hasAccent) {
      ok = fail('<p> should still have direct (or traceable) .accent span for middle run', structuralDump(p)) && ok;
    }

    // Explicit 3-run shape: TEXT "One " / SPAN "number" / TEXT ". One place." per spec — we allow wrapped spans instead of raw TEXT
    const runSignatures = meaningfulP
      .map((n) => {
        if (n.nodeType === 3) return `TEXT:${JSON.stringify(n.nodeValue)}`;
        if (n.nodeType === 1) {
          const el = /** @type {Element} */ (n);
          return `${el.tagName.toLowerCase()}${el.classList.contains('accent') ? '.accent' : ''}:${JSON.stringify(el.textContent)}`;
        }
        return '?';
      })
      .join(' | ');
    console.log('\n--- [Case B] <p> direct child run summary ---');
    console.log(runSignatures);

    // Leading space before "One place" in tail: inside last run's text
    const tailMatch = textFull.match(/(\. One place\.)$/);
    if (!tailMatch) {
      ok = fail('tail segment ". One place." not found in <p> text', textFull) && ok;
    }

    if (ok) return pass('Case B (<p> mixed): distinct runs, accent preserved');
    return false;
  } catch (e) {
    console.error('FAIL: Case B threw', e);
    return false;
  }
}

const a = testHighlightDiv();
const b = testParagraphMixed();

const all = a && b;
console.log(`\n${'='.repeat(60)}`);
console.log(all ? 'RESULT: all pipeline-inline-preservation checks PASSED' : 'RESULT: one or more checks FAILED');
process.exit(all ? 0 : 1);
