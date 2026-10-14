// P1-09 — upload allowlist and safe serving of stored uploads.
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const request = require('supertest');
const { uploadRejection, uploadFileFilter, setSafeFileHeaders } = require('../middleware/uploadFilter');
const errorHandler = require('../middleware/errorHandler');

const f = (originalname, mimetype) => ({ originalname, mimetype });

describe('uploadRejection', () => {
  test.each([
    ['scan.JPG', 'image/jpeg'], ['photo.heic', 'application/octet-stream'], ['invoice.pdf', 'application/pdf'],
    ['bl.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sheet.xlsx', ''], ['statement.csv', 'application/vnd.ms-excel'], ['notes.txt', 'text/plain'],
  ])('documents accepts %s (%s)', (n, m) => expect(uploadRejection(f(n, m), 'documents')).toBeNull());

  test.each([
    ['x.html', 'text/html'], ['x.htm', 'text/html'], ['logo.svg', 'image/svg+xml'], ['a.js', 'text/javascript'],
    ['setup.exe', 'application/octet-stream'], ['noext', 'application/pdf'], ['page.xhtml', 'application/xhtml+xml'],
    ['voice.mp3', 'audio/mpeg'],
  ])('documents rejects %s', (n, m) => expect(uploadRejection(f(n, m), 'documents')).toMatch(/not allowed/));

  test('a disguised HTML file (.pdf claiming text/html) is rejected', () => {
    expect(uploadRejection(f('evil.pdf', 'text/html'), 'documents')).toMatch(/does not match/);
  });

  test('chat additionally takes voice notes, clips and zips — but never HTML/SVG', () => {
    expect(uploadRejection(f('voice.m4a', 'audio/mp4'), 'chat')).toBeNull();
    expect(uploadRejection(f('clip.mp4', 'video/mp4'), 'chat')).toBeNull();
    expect(uploadRejection(f('docs.zip', 'application/zip'), 'chat')).toBeNull();
    expect(uploadRejection(f('x.html', 'text/html'), 'chat')).toMatch(/not allowed/);
    expect(uploadRejection(f('x.svg', 'image/svg+xml'), 'chat')).toMatch(/not allowed/);
  });
});

describe('setSafeFileHeaders', () => {
  const hdrs = (stored, name) => {
    const h = {};
    setSafeFileHeaders({ setHeader: (k, v) => { h[k] = v; } }, stored, name);
    return h;
  };
  test('raster image renders inline, typed from the extension', () => {
    const h = hdrs('/u/chat/1-2.png', 'pic.png');
    expect(h['Content-Type']).toBe('image/png');
    expect(h['Content-Disposition']).toMatch(/^inline;/);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
  });
  test('PDF and everything else download as attachments', () => {
    expect(hdrs('1-2.pdf', 'Invoice.pdf')['Content-Disposition']).toMatch(/^attachment;/);
    expect(hdrs('1-2.docx')['Content-Disposition']).toMatch(/^attachment;/);
  });
  test('a legacy .html upload is served as an inert octet-stream attachment', () => {
    const h = hdrs('1-2.html', 'x.html');
    expect(h['Content-Type']).toBe('application/octet-stream');
    expect(h['Content-Disposition']).toMatch(/^attachment;/);
  });
  test('quotes / non-ASCII in the display name cannot break the header', () => {
    const h = hdrs('1.pdf', 'a"bé.pdf');
    expect(h['Content-Disposition']).toBe('attachment; filename="a_b_.pdf"; filename*=UTF-8\'\'a%22b%C3%A9.pdf');
  });
});

describe('multer integration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = express();
  const upload = multer({ dest: dir, fileFilter: uploadFileFilter('documents') });
  app.post('/up', upload.single('file'), (req, res) => res.json({ ok: true, name: req.file.originalname }));
  app.use(errorHandler);

  test('an .html upload is rejected with 400 and nothing is stored', async () => {
    const r = await request(app).post('/up').attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.html', contentType: 'text/html' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not allowed/);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
  test('a PDF upload is accepted', async () => {
    const r = await request(app).post('/up').attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(200);
  });
});
