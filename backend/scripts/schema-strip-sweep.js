/**
 * Find body fields a controller reads that its Joi schema does not declare.
 *
 * middleware/validate.js validates with stripUnknown: true, so any field missing
 * from schemas.js is deleted before the controller runs. The code looks correct,
 * the request carries the field, and it silently does nothing. That has now
 * happened three times in this codebase: the container rows (P4c), the document
 * bundle's merge order and contents flag, and 17 fields of the Shipment form.
 *
 *   node backend/scripts/schema-strip-sweep.js
 *
 * Output is a starting point, NOT a verdict — name collisions across modules and
 * handlers it cannot locate both produce noise. Confirm each hit by reading the
 * handler. To check the tool still detects the class, point it at a schema file
 * from before a known fix and make sure that fix reappears:
 *
 *   git show <commit>:backend/src/middleware/schemas.js > /tmp/old.js
 *   SCHEMAS=/tmp/old.js node backend/scripts/schema-strip-sweep.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'src');
const schemaSrc = fs.readFileSync(process.env.SCHEMAS || path.join(ROOT, 'middleware/schemas.js'), 'utf8');

const balanced = (src, i) => {
  let d = 0;
  for (let j = i; j < src.length; j += 1) {
    const c = src[j];
    if ('{(['.includes(c)) d += 1;
    else if ('})]'.includes(c)) { d -= 1; if (d === 0) return j; }
  }
  return -1;
};
function schemaKeys(name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*Joi\\.object\\(\\{`).exec(schemaSrc);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const body = schemaSrc.slice(open + 1, balanced(schemaSrc, open));
  const keys = []; let d = 0;
  for (const raw of body.split('\n')) {
    const s = raw.replace(/\/\/.*$/, '');
    if (d === 0) { const km = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(s); if (km) keys.push(km[1]); }
    for (const c of s) { if ('{(['.includes(c)) d += 1; else if ('})]'.includes(c)) d -= 1; }
  }
  return keys;
}
const allFiles = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') allFiles(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
};
const FILES = allFiles(ROOT);
const SRC = new Map(FILES.map((f) => [f, fs.readFileSync(f, 'utf8')]));

// ---- global index: handler name -> [bodies] ----------------------------
const INDEX = new Map();
const add = (name, body, file) => { if (!INDEX.has(name)) INDEX.set(name, []); INDEX.get(name).push({ body, file }); };
for (const [srcFile, src] of SRC) {
  const pats = [
    /(?:^|\s)async\s+([A-Za-z_$][\w$]*)\s*\(\s*req\b/g,
    /([A-Za-z_$][\w$]*)\s*:\s*async\s*\(\s*req\b/g,
    /([A-Za-z_$][\w$]*)\s*:\s*\(\s*req\b/g,
    /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(\s*req\b/g,
    /exports\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(\s*req\b/g,
    /([A-Za-z_$][\w$]*)\s*=\s*async\s*\(\s*req\b/g,
  ];
  for (const re of pats) {
    for (const m of src.matchAll(re)) {
      const open = src.indexOf('{', m.index + m[0].length);
      if (open < 0) continue;
      const end = balanced(src, open);
      if (end > 0) add(m[1], src.slice(open, end + 1), srcFile);
    }
  }
}

// ---- body fields, following `const x = req.body` aliases ---------------
// Fields a handler reads off the request body.
//
// Finding the destructure with a forward regex does not work. `{([\s\S]*?)}\s*=\s*req.body`
// happily starts at the function's own opening brace and runs across anything in
// between — including `res.status(404).json({ message: '...' })` — so `message`
// was reported as a stripped body field on seven different routes. Restricting it
// to `[^{}]*` fixes that but then silently skips any destructure containing a
// nested brace. So: find each `= req.body`, then walk LEFT from the `}` before it
// to its matching `{`. That reads the pattern exactly, nesting and all.
function destructuredKeys(text, rhs) {
  const out = [];
  const re = new RegExp(`\\}\\s*=\\s*${rhs}\\b`, 'g');
  for (const m of text.matchAll(re)) {
    const closeIdx = text.indexOf('}', m.index);
    let d = 0, open = -1;
    for (let j = closeIdx; j >= 0; j -= 1) {
      const c = text[j];
      if ('}])'.includes(c)) d += 1;
      else if ('{[('.includes(c)) { d -= 1; if (d === 0) { open = j; break; } }
    }
    if (open < 0) continue;
    const inner = text.slice(open + 1, closeIdx);
    // top-level names only — a nested pattern's inner names are not body keys
    let depth = 0, token = '';
    const push = () => {
      const k = token.trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(k)) out.push(k);
      token = '';
    };
    for (const c of inner) {
      if ('{[('.includes(c)) depth += 1;
      else if ('}])'.includes(c)) depth -= 1;
      if (c === ',' && depth === 0) push(); else token += c;
    }
    push();
  }
  return out;
}

function bodyFields(text) {
  const f = new Set();
  for (const m of text.matchAll(/req\.body\.([A-Za-z_$][\w$]*)/g)) f.add(m[1]);
  for (const k of destructuredKeys(text, 'req\\.body')) f.add(k);
  // const data = req.body  →  data.field / { a, b } = data
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*req\.body\s*[;,\n]/g)) {
    const alias = m[1];
    for (const u of text.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, 'g'))) f.add(u[1]);
    for (const k of destructuredKeys(text, alias)) f.add(k);
  }
  return [...f];
}

let examined = 0;
const findings = [];
const blind = [];
for (const file of FILES.filter((f) => f.endsWith('.routes.js'))) {
  const src = SRC.get(file);
  for (const m of src.matchAll(/router\.(post|put|patch|delete)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const end = balanced(src, open);
    if (end < 0) continue;
    const call = src.slice(open, end + 1);
    const sm = /validate\(schemas\.([A-Za-z0-9_]+)\)/.exec(call);
    if (!sm) continue;
    examined += 1;
    const schema = sm[1];
    const keys = schemaKeys(schema);
    const routePath = (/^\(\s*'([^']*)'/.exec(call) || [])[1] || '?';
    const tail = call.slice(sm.index);

    const reads = new Set(bodyFields(call));
    const provenance = new Map();
    for (const f of reads) provenance.set(f, new Set(['the route file itself']));
    const hits = [];
    const ambiguous = [];
    // A handler name alone is not unique — 'create' is defined in a dozen
    // controllers. Prefer a definition from the route's OWN module, then a
    // globally unique one; anything else is reported rather than guessed at.
    const moduleDir = path.dirname(file);
    for (const h of tail.matchAll(/(?:([A-Za-z_$][\w$]*)\.)?([A-Za-z_$][\w$]*)/g)) {
      const name = h[2];
      if (['validate', 'schemas', 'auditAction', 'authorize', 'req', 'res', 'params', 'body', 'id', 'data'].includes(name)) continue;
      const defs = INDEX.get(name);
      if (!defs) continue;
      let chosen = defs.filter((d) => path.dirname(d.file) === moduleDir);
      if (!chosen.length) chosen = defs.filter((d) => d.file.startsWith(moduleDir));
      if (!chosen.length && defs.length === 1) chosen = defs;
      if (!chosen.length) { ambiguous.push(`${name}(${defs.length} defs)`); continue; }
      hits.push(`${name}`);
      for (const d of chosen) {
        for (const f of bodyFields(d.body)) {
          reads.add(f);
          if (!provenance.has(f)) provenance.set(f, new Set());
          provenance.get(f).add(`${name}() in ${path.relative(ROOT, d.file)}`);
        }
      }
    }
    const missing = [...reads].filter((f) => keys && !keys.includes(f));
    if (missing.length) findings.push({ file: path.relative(ROOT, file), routePath, schema, missing, provenance });
    if (!reads.size) blind.push(`${schema}  ${routePath}  [${path.relative(ROOT, file)}]  handlers: ${hits.join(', ') || 'NONE'}${ambiguous.length ? '  AMBIGUOUS: ' + ambiguous.join(', ') : ''}`);
  }
}
console.log('validated write-routes examined:', examined);
console.log('\n=== POSSIBLE STRIPPED FIELDS (need manual confirmation) ===');
if (!findings.length) console.log('  none');
for (const f of findings) {
  console.log(`  !! ${f.schema}  ${f.routePath}  [${f.file}]`);
  for (const m of f.missing) console.log(`       ${m}  <-- read by ${[...(f.provenance.get(m) || [])].join(' / ')}`);
}
console.log(`\n=== still blind (handler body not located): ${blind.length} ===`);
blind.forEach((b) => console.log('  ' + b));

// ── Exit code, so CI can gate on this ──
// A finding means a controller reads a body field its Joi schema does not
// declare, and validate() runs with stripUnknown — so the field is deleted
// before the handler sees it and the feature ships INERT. Nothing fails, no test
// breaks, and it surfaces weeks later as "that setting doesn't save".
//
// `blind` is NOT a failure: those are routes whose handler body this script
// cannot locate (an inline handler, or a name defined twice). It reports them so
// the gap is visible rather than silently counted as clean.
//
// ALLOWED is for a field a reviewer has confirmed is a false positive — the
// handler-name index matches by function name, so an unrelated `create()` in
// another module can be attributed to the wrong schema. Each entry needs the
// reason it is safe, or it is just a way of hiding a real bug.
const ALLOWED = new Set([
  // printedBags.controller create() reads order_id; the sweep attributes it to
  // createExportOrder because both handlers are named `create`. The printed-bag
  // route has its own schema and takes order_id from the URL.
  'createExportOrder:order_id',
]);
const real = findings.flatMap((f) => f.missing
  .filter((m) => !ALLOWED.has(`${f.schema}:${m}`))
  .map((m) => `${f.schema}:${m}`));
if (real.length) {
  console.error(`\nFAIL: ${real.length} field(s) a controller reads but Joi strips: ${real.join(', ')}`);
  console.error('Declare each in backend/src/middleware/schemas.js, or add it to ALLOWED in this script with the reason it is safe.');
  process.exit(1);
}
console.log('\nOK: every field a validated handler reads is declared in its schema.');
