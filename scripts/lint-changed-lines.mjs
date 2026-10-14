#!/usr/bin/env node
// Lint gate for CI: fail only on ESLint ERRORS that sit on lines this change added
// or modified. The codebase carries pre-existing errors (≈293 in src/); failing on
// every error in a touched file would make an unrelated one-line fix to a large
// page (MillFinanceDashboard, DocumentCenter…) red and block the deploy. New code
// must be clean; old code is cleaned as the backlog reaches it.
//
// Usage: node scripts/lint-changed-lines.mjs <git-diff-range>   e.g. origin/main...HEAD
import { execFileSync } from 'node:child_process';

const range = process.argv[2];
if (!range) {
  console.error('usage: lint-changed-lines.mjs <git-diff-range>');
  process.exit(2);
}

const diff = execFileSync('git', ['diff', '-U0', '--diff-filter=ACMR', range, '--', '*.js', '*.jsx'], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});

// file → Set of added/changed line numbers (new side of the diff)
const touched = new Map();
let file = null;
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) {
    const p = line.slice(4).replace(/^b\//, '');
    file = /^(src|backend\/src)\//.test(p) ? p : null;
    if (file && !touched.has(file)) touched.set(file, new Set());
    continue;
  }
  const m = file && line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
  if (m) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i += 1) touched.get(file).add(start + i);
  }
}

const files = [...touched.entries()].filter(([, lines]) => lines.size > 0).map(([f]) => f);
if (!files.length) {
  console.log('No changed JS/JSX lines under src/ or backend/src/ — nothing to lint.');
  process.exit(0);
}
console.log(`Linting changed lines in ${files.length} file(s).`);

let out;
try {
  out = execFileSync('npx', ['eslint', '--no-warn-ignored', '--format', 'json', ...files], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // eslint exits 1 when it finds errors; its JSON is still on stdout.
  out = err.stdout;
  if (!out) throw err;
}

const results = JSON.parse(out);
const root = process.cwd() + '/';
let errors = 0;
let legacy = 0;
for (const r of results) {
  const rel = r.filePath.startsWith(root) ? r.filePath.slice(root.length) : r.filePath;
  const lines = touched.get(rel) || new Set();
  for (const m of r.messages) {
    if (m.severity !== 2) continue;
    if (lines.has(m.line)) {
      errors += 1;
      console.log(`${rel}:${m.line}:${m.column}  error  ${m.message}  ${m.ruleId || ''}`);
    } else {
      legacy += 1;
    }
  }
}
console.log(`${errors} error(s) on changed lines; ${legacy} pre-existing error(s) elsewhere in these files (not blocking).`);
process.exit(errors ? 1 : 0);
