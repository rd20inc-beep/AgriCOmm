/**
 * Structural check of a model-generated SQL query before it reaches the
 * read-only AI role (P1-05). The DB role is the hard boundary — it can read
 * only the ai_ro views — this guard is the second line and the source of the
 * user-facing reasons:
 *
 *  - tokenises the text properly (string / dollar / quoted-identifier literals,
 *    line and nested block comments), so nothing hides inside a literal or a
 *    comment and a keyword inside a string is not mistaken for SQL;
 *  - exactly one statement, starting with SELECT or WITH;
 *  - no write / DDL / session / locking keywords anywhere;
 *  - no dangerous function: dynamic SQL (query_to_xml & co., ts_stat), file /
 *    server access (pg_*), large objects (lo_*), dblink, set_config,
 *    current_setting, sequence writers, privilege / catalog probes;
 *  - no catalog access: pg_* relations, information_schema, any schema
 *    qualifier other than ai_ro, reg* casts;
 *  - every relation in a FROM / JOIN must be an allowed view or a CTE of the
 *    same query.
 *
 * Pure (no db/config) so it can be tested directly.
 */

const KEYWORDS_FORBIDDEN = new Set([
  'insert', 'update', 'delete', 'merge', 'upsert', 'drop', 'alter', 'truncate', 'create', 'grant', 'revoke',
  'comment', 'copy', 'call', 'do', 'execute', 'prepare', 'deallocate', 'listen', 'notify', 'unlisten', 'vacuum',
  'analyze', 'analyse', 'cluster', 'reindex', 'lock', 'set', 'reset', 'show', 'begin', 'commit', 'rollback',
  'savepoint', 'release', 'discard', 'load', 'refresh', 'into', 'table', 'import', 'explain', 'checkpoint',
  'share', 'nowait', 'returning', 'security', 'reassign', 'declare',
]);

const FUNCTION_DENY = [
  /^pg_/, /^lo_/, /^dblink/, /_to_xml/, /^query_to_/, /^xpath/, /^xmlexists$/, /^ts_stat$/, /^ts_rewrite$/,
  /^set_config$/, /^current_setting$/, /^nextval$/, /^setval$/, /^currval$/, /^lastval$/, /^txid_/,
  /^has_.*privilege$/, /^to_reg/, /^current_schemas?$/, /^current_database$/, /^current_user$/,
  /^session_user$/, /^current_role$/, /^inet_(client|server)_/, /^version$/, /^row_security_active$/,
  /^binary_upgrade/, /^brin_/, /^gin_clean/, /^format_type$/, /^obj_description$/,
  /^col_description$/, /^shobj_description$/,
];

const CAST_DENY = /^reg(class|proc|procedure|oper|operator|type|role|namespace|config|dictionary|collation)$/;
const SCHEMA_DENY = /^(pg_|information_schema$|public$)/;

// Keywords that end a FROM list (or a FROM item).
const FROM_LIST_END = new Set(['where', 'group', 'having', 'order', 'limit', 'offset', 'union', 'intersect',
  'except', 'window', 'on', 'using', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'lateral',
  'select', 'returning']);
const AFTER_FROM_SKIP = new Set(['lateral', 'only']);

class SqlGuardError extends Error {
  constructor(message) { super(message); this.name = 'SqlGuardError'; }
}

function tokenize(sql) {
  const s = String(sql || '');
  const out = [];
  let i = 0;
  const n = s.length;
  const isIdStart = (c) => /[A-Za-z_\u0080-￿]/.test(c);
  const isId = (c) => /[A-Za-z0-9_$\u0080-￿]/.test(c);
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '-' && s[i + 1] === '-') { while (i < n && s[i] !== '\n') i += 1; continue; }
    if (c === '/' && s[i + 1] === '*') {
      let depth = 1; i += 2;
      while (i < n && depth) {
        if (s[i] === '/' && s[i + 1] === '*') { depth += 1; i += 2; } else if (s[i] === '*' && s[i + 1] === '/') { depth -= 1; i += 2; } else i += 1;
      }
      if (depth) throw new SqlGuardError('Unterminated comment.');
      continue;
    }
    if (c === "'") {
      const prev = out[out.length - 1];
      const escapes = prev && prev.type === 'ident' && prev.end === i && /^e$/i.test(prev.raw);
      let j = i + 1; let val = '';
      for (;;) {
        if (j >= n) throw new SqlGuardError('Unterminated string.');
        if (escapes && s[j] === '\\') { val += s[j + 1] || ''; j += 2; continue; }
        if (s[j] === "'") { if (s[j + 1] === "'") { val += "'"; j += 2; continue; } break; }
        val += s[j]; j += 1;
      }
      if (prev && prev.type === 'ident' && prev.end === i && /^(e|b|x|n|u&?)$/i.test(prev.raw)) out.pop();
      out.push({ type: 'string', value: val, end: j + 1 });
      i = j + 1; continue;
    }
    if (c === '$') {
      const m = s.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        const tag = m[0];
        const close = s.indexOf(tag, i + tag.length);
        if (close === -1) throw new SqlGuardError('Unterminated string.');
        out.push({ type: 'string', value: s.slice(i + tag.length, close), end: close + tag.length });
        i = close + tag.length; continue;
      }
      throw new SqlGuardError('Query parameters are not allowed.');
    }
    if (c === '"') {
      let j = i + 1; let val = '';
      for (;;) {
        if (j >= n) throw new SqlGuardError('Unterminated identifier.');
        if (s[j] === '"') { if (s[j + 1] === '"') { val += '"'; j += 2; continue; } break; }
        val += s[j]; j += 1;
      }
      out.push({ type: 'ident', value: val.toLowerCase(), raw: val, quoted: true, end: j + 1 });
      i = j + 1; continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isId(s[j])) j += 1;
      const raw = s.slice(i, j);
      out.push({ type: 'ident', value: raw.toLowerCase(), raw, quoted: false, end: j });
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && /[0-9.eE]/.test(s[j])) j += 1;
      out.push({ type: 'number', value: s.slice(i, j), end: j });
      i = j; continue;
    }
    if (c === ':' && s[i + 1] === ':') { out.push({ type: 'op', value: '::', end: i + 2 }); i += 2; continue; }
    out.push({ type: c === '(' || c === ')' || c === ',' || c === ';' || c === '.' ? c : 'op', value: c, end: i + 1 });
    i += 1;
  }
  return out;
}

const kw = (t, word) => t && t.type === 'ident' && !t.quoted && t.value === word;

/**
 * Validate `sql`; allowed = iterable of view names the caller may read.
 * Returns { relations } (the relations read) or throws SqlGuardError.
 */
function checkSql(sql, allowed) {
  const allow = new Set([...allowed].map((x) => String(x).toLowerCase()));
  let toks = tokenize(sql);
  while (toks.length && toks[toks.length - 1].type === ';') toks = toks.slice(0, -1);
  if (!toks.length) throw new SqlGuardError('Empty query.');
  if (toks.some((t) => t.type === ';')) throw new SqlGuardError('Only a single statement is allowed.');
  if (!(kw(toks[0], 'select') || kw(toks[0], 'with'))) throw new SqlGuardError('Only SELECT / WITH queries are allowed.');

  // CTE names: <name> [ ( cols ) ] AS [ [NOT] MATERIALIZED ] (
  const ctes = new Set();
  for (let i = 0; i < toks.length; i += 1) {
    if (toks[i].type !== 'ident') continue;
    let j = i + 1;
    if (toks[j] && toks[j].type === '(') {
      let depth = 0;
      for (; j < toks.length; j += 1) {
        if (toks[j].type === '(') depth += 1;
        else if (toks[j].type === ')') { depth -= 1; if (!depth) { j += 1; break; } }
      }
    }
    if (!kw(toks[j], 'as')) continue;
    let k = j + 1;
    if (kw(toks[k], 'not')) k += 1;
    if (kw(toks[k], 'materialized')) k += 1;
    if (toks[k] && toks[k].type === '(' && (kw(toks[k + 1], 'select') || kw(toks[k + 1], 'with') || kw(toks[k + 1], 'values'))) {
      ctes.add(toks[i].value);
    }
  }

  const relations = [];
  // Paren contexts: 'query' (top level / subquery) or 'expr' (function args, grouping).
  const ctx = ['query'];
  const fromList = [false]; // per depth: inside a FROM list?
  const expectRelation = (idx) => {
    let i = idx;
    while (AFTER_FROM_SKIP.has(toks[i] && !toks[i].quoted ? toks[i].value : '')) i += 1;
    const t = toks[i];
    if (!t || t.type === '(') return; // derived table / parenthesised join — scanned as we go
    if (t.type !== 'ident') throw new SqlGuardError('Could not read the FROM clause.');
    let name = t.value; let schema = null;
    if (toks[i + 1] && toks[i + 1].type === '.' && toks[i + 2] && toks[i + 2].type === 'ident') {
      schema = name; name = toks[i + 2].value; i += 2;
    }
    if (toks[i + 1] && toks[i + 1].type === '(') return; // set-returning function — checked as a function call
    if (schema && schema !== 'ai_ro') throw new SqlGuardError(`Schema "${schema}" is not available.`);
    if (!allow.has(name) && !(schema === null && ctes.has(name))) throw new SqlGuardError(`"${name}" is not an available table.`);
    relations.push(name);
  };

  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.type === '(') {
      const prev = toks[i - 1];
      const isQuery = kw(next, 'select') || kw(next, 'with') || kw(next, 'values');
      ctx.push(isQuery ? 'query' : 'expr');
      // "FROM (a JOIN b ...)" — a parenthesised join is still a FROM list.
      fromList.push(!isQuery && prev && (kw(prev, 'from') || kw(prev, 'join')));
      continue;
    }
    if (t.type === ')') {
      if (ctx.length === 1) throw new SqlGuardError('Unbalanced parentheses.');
      ctx.pop(); fromList.pop();
      continue;
    }
    const depth = ctx.length - 1;
    if (t.type === ',' && fromList[depth]) { expectRelation(i + 1); continue; }
    if (t.type !== 'ident') continue;

    const v = t.value;
    if (!t.quoted && KEYWORDS_FORBIDDEN.has(v)) throw new SqlGuardError(`"${t.raw.toUpperCase()}" is not allowed in a read-only query.`);
    if (v === 'information_schema' || v.startsWith('pg_')) throw new SqlGuardError('System catalogs are not available.');
    if (next && next.type === '.' && SCHEMA_DENY.test(v)) throw new SqlGuardError(`Schema "${v}" is not available.`);
    if (next && next.type === '(' && FUNCTION_DENY.some((re) => re.test(v))) throw new SqlGuardError(`Function ${v}() is not allowed.`);
    if (!t.quoted && CAST_DENY.test(v)) throw new SqlGuardError('Catalog casts are not allowed.');

    if (ctx[depth] === 'query' || fromList[depth]) {
      if (kw(t, 'from') || kw(t, 'join')) {
        fromList[depth] = true;
        expectRelation(i + 1);
        continue;
      }
      if (!t.quoted && FROM_LIST_END.has(v)) fromList[depth] = false;
    }
  }
  if (ctx.length !== 1) throw new SqlGuardError('Unbalanced parentheses.');
  return { relations };
}

module.exports = { checkSql, tokenize, SqlGuardError };
