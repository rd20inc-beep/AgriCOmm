// Employee self-service portal API. Separate light auth (CNIC + PIN → a
// portal-scoped JWT) so mill workers — who aren't in the `users` table — can
// view ONLY their own payslips, tax certificate and advance balance.
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../../config/database');
let cfg = require('../../config'); cfg = cfg.default || cfg;

const num = (v) => parseFloat(v) || 0;

// Company profile for document headers — the same system_settings override the
// staff app uses, with a safe default.
async function companyProfile() {
  try {
    const row = await db('system_settings').where({ key: 'companyProfile' }).first();
    if (row && row.value) return typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  } catch { /* fall through */ }
  return { name: 'Agri Commodities' };
}

// Verify a portal-scoped token and pin the worker on the request. Staff tokens
// (no `portal` claim) are rejected; portal tokens carry no role_id so they also
// can't satisfy staff `authorize()` elsewhere.
function portalAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'No token provided.' });
  try {
    const d = jwt.verify(h.split(' ')[1], cfg.jwt.secret);
    if (!d.portal || !d.workerId) return res.status(401).json({ success: false, message: 'Not a portal session.' });
    req.workerId = d.workerId;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

// POST /api/portal/login — CNIC + PIN.
router.post('/login', async (req, res) => {
  try {
    const cnic = String(req.body && req.body.cnic || '').trim();
    const pin = String(req.body && req.body.pin || '');
    if (!cnic || !pin) return res.status(400).json({ success: false, message: 'CNIC and PIN are required.' });
    const w = await db('mill_workers').where('cnic', cnic).where('is_active', true).first();
    if (!w || !w.portal_enabled || !w.portal_pin_hash) return res.status(401).json({ success: false, message: 'Invalid credentials, or self-service is not enabled for you.' });
    const ok = await bcrypt.compare(pin, w.portal_pin_hash);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid CNIC or PIN.' });
    const token = jwt.sign({ portal: true, workerId: w.id, name: w.name }, cfg.jwt.secret, { expiresIn: '12h' });
    return res.json({ success: true, data: { token, worker: { id: w.id, name: w.name, role: w.role } } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/portal/me — profile + advance balance + company.
router.get('/me', portalAuth, async (req, res) => {
  try {
    const w = await db('mill_workers').where('id', req.workerId).first();
    if (!w) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const adv = await db('mill_worker_advances').where('worker_id', w.id).where('status', 'outstanding')
      .select(db.raw('COALESCE(SUM(amount - recovered_amount),0) as o')).first();
    return res.json({
      success: true,
      data: {
        worker: {
          id: w.id, name: w.name, role: w.role, cnic: w.cnic, phone: w.phone, payType: w.pay_type,
          joinedDate: w.joined_date, bankName: w.bank_name, bankAccountNumber: w.bank_account_number, iban: w.iban,
        },
        advanceOutstanding: Math.round(num(adv.o)),
        company: await companyProfile(),
      },
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/portal/payslips — the worker's PAID payslip lines (run + line shape).
router.get('/payslips', portalAuth, async (req, res) => {
  try {
    const w = await db('mill_workers').where('id', req.workerId).first();
    const advOut = await db('mill_worker_advances').where('worker_id', req.workerId).where('status', 'outstanding')
      .select(db.raw('COALESCE(SUM(amount - recovered_amount),0) as o')).first();
    const rows = await db('mill_payroll_lines as l')
      .join('mill_payroll_runs as r', 'r.id', 'l.run_id')
      .leftJoin('bank_accounts as ba', 'ba.id', 'r.bank_account_id')
      .where('l.worker_id', req.workerId)
      .where(function () { this.whereNotNull('l.paid_at').orWhereIn('r.status', ['paid', 'posted']); })
      .orderBy('r.period', 'desc').orderBy('l.id', 'desc')
      .select('l.*', 'r.period', 'r.pay_date', 'r.pay_method', 'r.status as run_status', 'ba.name as bank_name');
    const data = rows.map((l) => ({
      run: { id: l.run_id, period: l.period, payDate: l.pay_date, payMethod: l.pay_method, bankName: l.bank_name, status: l.run_status },
      line: {
        id: l.id, workerName: l.worker_name, role: l.role, payType: l.pay_type,
        cnic: w ? w.cnic : null, phone: w ? w.phone : null,
        effectiveDays: num(l.effective_days), otHours: num(l.ot_hours),
        basicPay: num(l.basic_pay), otPay: num(l.ot_pay), grossPay: num(l.gross_pay),
        bonusTotal: num(l.bonus_total), deductionTotal: num(l.deduction_total),
        statutoryTotal: num(l.statutory_total), statutoryJson: l.statutory_json,
        advanceDeducted: num(l.advance_deducted), advanceOutstanding: Math.round(num(advOut.o)),
        netPay: num(l.net_pay), employedDays: l.employed_days, daysInMonth: l.days_in_month,
      },
    }));
    return res.json({ success: true, data });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/portal/advances — advance balance + recovery history.
router.get('/advances', portalAuth, async (req, res) => {
  try {
    const advances = await db('mill_worker_advances').where('worker_id', req.workerId).orderBy('advance_date', 'desc');
    const outstanding = advances.reduce((s, a) => s + Math.max(0, num(a.amount) - num(a.recovered_amount)), 0);
    return res.json({
      success: true,
      data: {
        outstanding: Math.round(outstanding),
        advances: advances.map((a) => ({
          id: a.id, amount: Math.round(num(a.amount)), recovered: Math.round(num(a.recovered_amount)),
          remaining: Math.round(Math.max(0, num(a.amount) - num(a.recovered_amount))),
          date: a.advance_date, status: a.status, method: a.payment_method, recoveryMethod: a.recovery_method,
        })),
      },
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/portal/tax-statement?tax_year — the worker's own annual summary.
router.get('/tax-statement', portalAuth, async (req, res) => {
  try {
    let startYear;
    const m = String(req.query.tax_year || '').match(/(\d{4})/);
    if (m) startYear = parseInt(m[1], 10);
    else { const now = new Date(); startYear = (now.getUTCMonth() + 1) >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; }
    const periodFrom = `${startYear}-07`; const periodTo = `${startYear + 1}-06`;
    const taxYear = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
    const w = await db('mill_workers').where('id', req.workerId).first();
    const lines = await db('mill_payroll_lines as l').join('mill_payroll_runs as r', 'r.id', 'l.run_id')
      .where('l.worker_id', req.workerId)
      .where(function () { this.whereNotNull('l.paid_at').orWhereIn('r.status', ['paid', 'posted']); })
      .where('r.period', '>=', periodFrom).where('r.period', '<=', periodTo)
      .orderBy('r.period', 'asc')
      .select('l.*', 'r.period');
    const months = []; const totals = { gross: 0, statutory: 0, advance: 0, net: 0, byStatutory: {} };
    for (const l of lines) {
      const gross = num(l.gross_pay) + num(l.bonus_total); const stat = num(l.statutory_total);
      let sj = l.statutory_json; if (typeof sj === 'string') { try { sj = JSON.parse(sj); } catch { sj = []; } } if (!Array.isArray(sj)) sj = [];
      const mBreak = {}; for (const s of sj) { const nm = s.name || 'Statutory'; mBreak[nm] = (mBreak[nm] || 0) + num(s.amount); totals.byStatutory[nm] = (totals.byStatutory[nm] || 0) + num(s.amount); }
      months.push({ period: l.period, gross: Math.round(gross), statutory: Math.round(stat), statutoryBreakdown: mBreak, advance: Math.round(num(l.advance_deducted)), net: Math.round(num(l.net_pay)) });
      totals.gross += gross; totals.statutory += stat; totals.advance += num(l.advance_deducted); totals.net += num(l.net_pay);
    }
    ['gross', 'statutory', 'advance', 'net'].forEach((k) => { totals[k] = Math.round(totals[k]); });
    Object.keys(totals.byStatutory).forEach((k) => { totals.byStatutory[k] = Math.round(totals.byStatutory[k]); });
    totals.monthsPaid = months.length;
    const employee = { workerId: w.id, name: w.name, cnic: w.cnic, role: w.role, payType: w.pay_type, months, totals };
    return res.json({ success: true, data: { taxYear, periodFrom, periodTo, employee, company: await companyProfile() } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/portal/change-pin — worker changes their own PIN.
router.post('/change-pin', portalAuth, async (req, res) => {
  try {
    const current = String(req.body && req.body.current_pin || '');
    const next = String(req.body && req.body.new_pin || '').trim();
    if (!/^\d{4,8}$/.test(next)) return res.status(400).json({ success: false, message: 'New PIN must be 4–8 digits.' });
    const w = await db('mill_workers').where('id', req.workerId).first();
    if (!w || !w.portal_pin_hash) return res.status(404).json({ success: false, message: 'Worker not found.' });
    const ok = await bcrypt.compare(current, w.portal_pin_hash);
    if (!ok) return res.status(401).json({ success: false, message: 'Current PIN is incorrect.' });
    await db('mill_workers').where('id', w.id).update({ portal_pin_hash: await bcrypt.hash(next, 10), updated_at: db.fn.now() });
    return res.json({ success: true, data: { changed: true } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/portal/requests — the worker's own requests.
router.get('/requests', portalAuth, async (req, res) => {
  try {
    const rows = await db('mill_worker_requests').where('worker_id', req.workerId).orderBy('created_at', 'desc');
    return res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id, type: r.type, subject: r.subject, message: r.message,
        fromDate: r.from_date, toDate: r.to_date, status: r.status,
        response: r.response, createdAt: r.created_at, handledAt: r.handled_at,
      })),
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/portal/requests — worker raises a request.
router.post('/requests', portalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const type = ['leave', 'advance', 'correction', 'query'].includes(b.type) ? b.type : 'query';
    const message = String(b.message || '').trim();
    if (!message) return res.status(400).json({ success: false, message: 'Please describe your request.' });
    const [row] = await db('mill_worker_requests').insert({
      worker_id: req.workerId, type, subject: (b.subject || '').slice(0, 160) || null,
      message, from_date: b.from_date || null, to_date: b.to_date || null, status: 'pending',
    }).returning('*');
    return res.status(201).json({ success: true, data: { id: row.id } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/portal/leave-types — active types the worker can apply for.
router.get('/leave-types', portalAuth, async (req, res) => {
  try {
    const types = await db('mill_leave_types').where('is_active', true).orderBy('sort_order').orderBy('id')
      .select('id', 'name', 'code', 'paid', 'annual_quota');
    return res.json({ success: true, data: types.map((t) => ({ id: t.id, name: t.name, code: t.code, paid: t.paid, quota: t.annual_quota != null ? parseFloat(t.annual_quota) : null })) });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/portal/leave — the worker's leave requests + derived balances (this year).
router.get('/leave', portalAuth, async (req, res) => {
  try {
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : new Date().getUTCFullYear();
    const types = await db('mill_leave_types').where('is_active', true).orderBy('sort_order').orderBy('id');
    const takenRows = await db('mill_leave_requests').where('worker_id', req.workerId).where('status', 'approved')
      .whereRaw("TO_CHAR(from_date, 'YYYY') = ?", [String(year)])
      .groupBy('leave_type_id').select('leave_type_id', db.raw('COALESCE(SUM(days),0) as d'));
    const takenMap = new Map(takenRows.map((t) => [t.leave_type_id, parseFloat(t.d) || 0]));
    const balances = types.map((t) => {
      const used = takenMap.get(t.id) || 0; const quota = t.annual_quota != null ? parseFloat(t.annual_quota) : null;
      return { id: t.id, name: t.name, paid: t.paid, quota, taken: used, remaining: quota != null ? Math.max(0, quota - used) : null };
    });
    const requests = await db('mill_leave_requests as lr').leftJoin('mill_leave_types as t', 't.id', 'lr.leave_type_id')
      .where('lr.worker_id', req.workerId).orderBy('lr.created_at', 'desc')
      .select('lr.id', 'lr.from_date', 'lr.to_date', 'lr.days', 'lr.paid', 'lr.reason', 'lr.status', 't.name as type_name');
    return res.json({ success: true, data: { year: Number(year), balances, requests: requests.map((r) => ({ id: r.id, type: r.type_name, fromDate: r.from_date, toDate: r.to_date, days: parseFloat(r.days), paid: r.paid, reason: r.reason, status: r.status })) } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/portal/leave — worker applies for leave.
router.post('/leave', portalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.from_date || !b.to_date) return res.status(400).json({ success: false, message: 'From and to dates are required.' });
    const a = Date.parse(String(b.from_date).slice(0, 10)); const z = Date.parse(String(b.to_date).slice(0, 10));
    if (Number.isNaN(a) || Number.isNaN(z) || z < a) return res.status(400).json({ success: false, message: 'Invalid date range.' });
    const days = Math.round((z - a) / 86400000) + 1;
    const type = b.leave_type_id ? await db('mill_leave_types').where('id', b.leave_type_id).first() : null;
    const [row] = await db('mill_leave_requests').insert({
      worker_id: req.workerId, leave_type_id: b.leave_type_id || null, from_date: b.from_date, to_date: b.to_date,
      days, paid: type ? !!type.paid : true, reason: b.reason || null, status: 'pending',
    }).returning('id');
    return res.status(201).json({ success: true, data: { id: row.id || row } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
