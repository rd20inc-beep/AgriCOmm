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
const ROOT = '/home/aly/Downloads/AgriCOmm/backend/src';
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
function bodyFields(text) {
  const f = new Set();
  for (const m of text.matchAll(/req\.body\.([A-Za-z_$][\w$]*)/g)) f.add(m[1]);
  for (const m of text.matchAll(/\{([\s\S]*?)\}\s*=\s*req\.body/g)) {
    for (const part of m[1].split(',')) {
      const k = part.trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(k)) f.add(k);
    }
  }
  // const data = req.body  →  data.field
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*req\.body\s*[;,\n]/g)) {
    const alias = m[1];
    for (const u of text.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, 'g'))) f.add(u[1]);
    for (const u of text.matchAll(new RegExp(`\\{([\\s\\S]*?)\\}\\s*=\\s*${alias}\\b`, 'g'))) {
      for (const part of u[1].split(',')) {
        const k = part.trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(k)) f.add(k);
      }
    }
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
      for (const d of chosen) for (const f of bodyFields(d.body)) reads.add(f);
    }
    const missing = [...reads].filter((f) => keys && !keys.includes(f));
    if (missing.length) findings.push({ file: path.relative(ROOT, file), routePath, schema, missing });
    if (!reads.size) blind.push(`${schema}  ${routePath}  [${path.relative(ROOT, file)}]  handlers: ${hits.join(', ') || 'NONE'}${ambiguous.length ? '  AMBIGUOUS: ' + ambiguous.join(', ') : ''}`);
  }
}
console.log('validated write-routes examined:', examined);
console.log('\n=== POSSIBLE STRIPPED FIELDS (need manual confirmation) ===');
if (!findings.length) console.log('  none');
for (const f of findings) console.log(`  !! ${f.schema}  ${f.routePath}  [${f.file}]\n     ${f.missing.join(', ')}`);
console.log(`\n=== still blind (handler body not located): ${blind.length} ===`);
blind.forEach((b) => console.log('  ' + b));
