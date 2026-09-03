/* Form Filler v1.0 — turn a flat PDF or Word document into a fillable form.
   Runs entirely on this device. Nothing is uploaded, ever. */

(() => {
  'use strict';

  const VERSION = '1.0';
  const A4 = { w: 595.28, h: 841.89 };
  const $ = s => document.querySelector(s);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

  const state = {
    kind: null,          // 'pdf' | 'docx'
    srcBytes: null,      // original PDF bytes, when the source was a PDF
    pages: [],           // { w, h, canvas, imgBytes? }
    fields: [],          // { id, page, type, x, y, w, h }
    order: [],           // field ids, in tab order
    orderMode: 'auto',   // 'auto' | 'down' | 'across'
    tool: 'select',      // 'select' | 'addtext' | 'addcheck' | 'renumber'
    selected: null,
    nextId: 1,
    fileName: 'form',
  };

  // ============================ loading a file ============================

  async function loadFile(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    state.fileName = name || 'form';
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.pdf$/i.test(file.name)) return loadPdf(bytes);
    if (/\.docx?$/i.test(file.name)) {
      if (/\.doc$/i.test(file.name)) throw new Error('Old .doc files are not supported — open it in Word and save as .docx or PDF first.');
      return loadDocx(bytes);
    }
    throw new Error('Please choose a .pdf or .docx file.');
  }

  async function loadPdf(bytes) {
    state.kind = 'pdf';
    state.srcBytes = bytes.slice();
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const OPS = pdfjsLib.OPS;
    state.pages = []; state.fields = [];

    for (let p = 1; p <= doc.numPages; p++) {
      setStatus(`Reading page ${p} of ${doc.numPages}…`);
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 2 });
      const canvas = el('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

      const base = page.getViewport({ scale: 1 });
      const [textContent, opList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      const geom = FF.collectGeometry(opList, OPS, base.width, base.height);
      const found = FF.detectOnPage(textContent, geom, base.width, base.height);

      state.pages.push({ w: base.width, h: base.height, canvas, rotate: page.rotate || 0 });
      for (const f of found) state.fields.push({ ...f, id: state.nextId++, page: p - 1 });
    }
    if (!state.fields.length) noFieldsWarning(doc);
  }

  function noFieldsWarning() {
    setStatus('No blank lines found automatically — this may be a scanned page. ' +
              'You can still add every field by hand with “+ Text box”.', true);
  }

  // Word documents: lay the content out in the page, measure where the blanks
  // land, then photograph each page. Layout is close, not identical — exporting
  // the Word file to PDF first always gives a better result.
  async function loadDocx(bytes) {
    state.kind = 'docx';
    state.srcBytes = null;
    setStatus('Laying out the Word document…');
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });

    const stage = $('#stage');
    stage.innerHTML = '';
    const sheet = el('div', 'docx-sheet');
    sheet.innerHTML = html;
    stage.appendChild(sheet);

    markBlanks(sheet);
    const sheetRect = sheet.getBoundingClientRect();
    const PX_PER_PT = sheetRect.width / A4.w;
    const pageHpx = A4.h * PX_PER_PT;

    const raw = [];
    for (const node of sheet.querySelectorAll('.ff-blank, .ff-cell')) {
      const r = node.getBoundingClientRect();
      if (r.width < 8 || r.height < 5) continue;
      raw.push({
        left: r.left - sheetRect.left, top: r.top - sheetRect.top,
        w: r.width, h: r.height,
        type: node.classList.contains('ff-cell') && r.width < 20 && r.height < 20 ? 'check' : 'text',
      });
    }

    const shot = await html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff', logging: false });
    const nPages = Math.max(1, Math.ceil(shot.height / (pageHpx * 2)));
    state.pages = []; state.fields = [];

    for (let p = 0; p < nPages; p++) {
      const c = el('canvas');
      c.width = A4.w * 2; c.height = A4.h * 2;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(shot, 0, p * pageHpx * 2, shot.width, pageHpx * 2, 0, 0, c.width, c.height);
      state.pages.push({ w: A4.w, h: A4.h, canvas: c, rotate: 0 });
    }
    for (const r of raw) {
      const p = Math.floor(r.top / pageHpx);
      if (p >= nPages) continue;
      state.fields.push({
        id: state.nextId++, page: p, type: r.type,
        x: r.left / PX_PER_PT,
        y: A4.h - ((r.top - p * pageHpx) + r.h) / PX_PER_PT,
        w: r.w / PX_PER_PT, h: r.h / PX_PER_PT,
      });
    }
    stage.innerHTML = '';
    if (!state.fields.length) noFieldsWarning();
  }

  function markBlanks(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    let n;
    while ((n = walker.nextNode())) if (/_{3,}/.test(n.nodeValue)) hits.push(n);
    for (const node of hits) {
      const frag = document.createDocumentFragment();
      let last = 0;
      const re = /_{3,}/g; let m;
      while ((m = re.exec(node.nodeValue)) !== null) {
        frag.appendChild(document.createTextNode(node.nodeValue.slice(last, m.index)));
        const s = el('span', 'ff-blank', m[0]);
        frag.appendChild(s);
        last = m.index + m[0].length;
      }
      frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
    for (const td of root.querySelectorAll('td, th')) {
      if (!td.textContent.trim() && !td.querySelector('img')) td.classList.add('ff-cell');
    }
  }

  // ============================ the preview editor ============================

  function reorder() {
    const ids = [];
    for (let p = 0; p < state.pages.length; p++) {
      const onPage = state.fields.filter(f => f.page === p);
      ids.push(...FF.orderFields(onPage, state.pages[p].w, state.orderMode).map(f => f.id));
    }
    state.order = ids;
  }

  function orderIndex(id) { return state.order.indexOf(id) + 1; }

  function render() {
    const stage = $('#stage');
    stage.innerHTML = '';
    const wrapW = Math.min(stage.clientWidth || 900, 900);

    state.pages.forEach((pg, pi) => {
      const scale = wrapW / pg.w;
      const holder = el('div', 'page');
      holder.style.width = pg.w * scale + 'px';
      holder.style.height = pg.h * scale + 'px';
      holder.dataset.page = pi;

      const img = pg.canvas;
      img.className = 'page-img';
      img.style.width = '100%'; img.style.height = '100%';
      holder.appendChild(img);

      const layer = el('div', 'layer');
      layer.dataset.page = pi;
      holder.appendChild(layer);

      for (const f of state.fields.filter(x => x.page === pi)) {
        const box = el('div', 'fld' + (f.type === 'check' ? ' check' : '') + (state.selected === f.id ? ' sel' : ''));
        box.style.left = f.x * scale + 'px';
        box.style.top = (pg.h - f.y - f.h) * scale + 'px';
        box.style.width = f.w * scale + 'px';
        box.style.height = f.h * scale + 'px';
        box.dataset.id = f.id;
        box.appendChild(el('span', 'num', orderIndex(f.id)));
        if (state.selected === f.id) {
          box.appendChild(el('span', 'grip'));
          const del = el('button', 'del', '×');
          del.title = 'Delete this field';
          box.appendChild(del);
        }
        layer.appendChild(box);
      }
      const cap = el('div', 'page-cap', `Page ${pi + 1} of ${state.pages.length}`);
      const wrap = el('div', 'page-wrap');
      wrap.appendChild(cap); wrap.appendChild(holder);
      stage.appendChild(wrap);
      holder._scale = scale;
    });

    $('#count').textContent = `${state.fields.length} field${state.fields.length === 1 ? '' : 's'}`;
  }

  // ---------- pointer handling: drag to move, grip to resize, drag to draw ----------
  let drag = null;

  function pageFromEvent(e) {
    const holder = e.target.closest('.page');
    if (!holder) return null;
    const rect = holder.getBoundingClientRect();
    const pi = +holder.dataset.page;
    const pg = state.pages[pi];
    const scale = holder._scale;
    return {
      pi, pg, scale,
      x: (e.clientX - rect.left) / scale,
      yTop: (e.clientY - rect.top) / scale,
    };
  }

  function onDown(e) {
    const hit = pageFromEvent(e);
    if (!hit) return;

    if (e.target.classList.contains('del')) {
      const id = +e.target.closest('.fld').dataset.id;
      state.fields = state.fields.filter(f => f.id !== id);
      state.selected = null; reorder(); render();
      return;
    }

    const box = e.target.closest('.fld');

    if (state.tool === 'renumber') {
      if (!box) return;
      const id = +box.dataset.id;
      const i = state.order.indexOf(id);
      if (i > -1) state.order.splice(i, 1);
      const placed = state.order.length - state.fields.length;
      state.order.splice(state._renumberAt ?? 0, 0, id);
      state._renumberAt = (state._renumberAt ?? 0) + 1;
      render();
      return;
    }

    if (state.tool === 'addtext' || state.tool === 'addcheck') {
      e.preventDefault();
      drag = { mode: 'draw', pi: hit.pi, x0: hit.x, y0: hit.yTop, scale: hit.scale };
      return;
    }

    if (box) {
      e.preventDefault();
      const id = +box.dataset.id;
      state.selected = id;
      const f = state.fields.find(x => x.id === id);
      const mode = e.target.classList.contains('grip') ? 'resize' : 'move';
      drag = { mode, id, startX: hit.x, startY: hit.yTop, f0: { ...f }, pg: hit.pg, scale: hit.scale };
      render();
    } else {
      state.selected = null; render();
    }
  }

  function onMove(e) {
    if (!drag) return;
    const hit = pageFromEvent(e);
    if (!hit) return;
    e.preventDefault();

    if (drag.mode === 'draw') {
      let ghost = $('#ghost');
      if (!ghost) {
        ghost = el('div', 'ghost'); ghost.id = 'ghost';
        e.target.closest('.page').querySelector('.layer').appendChild(ghost);
      }
      const x = Math.min(drag.x0, hit.x), y = Math.min(drag.y0, hit.yTop);
      ghost.style.left = x * drag.scale + 'px';
      ghost.style.top = y * drag.scale + 'px';
      ghost.style.width = Math.abs(hit.x - drag.x0) * drag.scale + 'px';
      ghost.style.height = Math.abs(hit.yTop - drag.y0) * drag.scale + 'px';
      return;
    }

    const f = state.fields.find(x => x.id === drag.id);
    if (!f) return;
    const dx = hit.x - drag.startX, dy = hit.yTop - drag.startY;
    if (drag.mode === 'move') {
      f.x = drag.f0.x + dx;
      f.y = drag.f0.y - dy;
    } else {
      f.w = Math.max(10, drag.f0.w + dx);
      f.h = Math.max(8, drag.f0.h - dy);
      f.y = drag.f0.y + drag.f0.h - f.h;
    }
    renderLive(f);
  }

  function renderLive(f) {
    const box = document.querySelector(`.fld[data-id="${f.id}"]`);
    if (!box) return;
    const holder = box.closest('.page');
    const pg = state.pages[+holder.dataset.page];
    const s = holder._scale;
    box.style.left = f.x * s + 'px';
    box.style.top = (pg.h - f.y - f.h) * s + 'px';
    box.style.width = f.w * s + 'px';
    box.style.height = f.h * s + 'px';
  }

  function onUp(e) {
    if (!drag) return;
    if (drag.mode === 'draw') {
      const ghost = $('#ghost');
      const hit = pageFromEvent(e) || { x: drag.x0, yTop: drag.y0 };
      if (ghost) ghost.remove();
      const pg = state.pages[drag.pi];
      let x = Math.min(drag.x0, hit.x), yTop = Math.min(drag.y0, hit.yTop);
      let w = Math.abs(hit.x - drag.x0), h = Math.abs(hit.yTop - drag.y0);
      if (state.tool === 'addcheck' && (w < 6 || h < 6)) { w = 12; h = 12; }
      if (w < 6 || h < 6) { drag = null; return; }
      const f = {
        id: state.nextId++, page: drag.pi, type: state.tool === 'addcheck' ? 'check' : 'text',
        x, y: pg.h - yTop - h, w, h,
      };
      state.fields.push(f);
      state.selected = f.id;
      reorder();
    } else {
      reorder();
    }
    drag = null;
    render();
  }

  // ============================ writing the fillable PDF ============================

  async function buildPdf() {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    let doc;

    if (state.kind === 'pdf') {
      doc = await PDFDocument.load(state.srcBytes, { ignoreEncryption: true });
      // A source that already has fields would collide with ours.
      try {
        const existing = doc.getForm().getFields();
        if (existing.length) doc.getForm().flatten();
      } catch (_) { /* no form present — fine */ }
    } else {
      doc = await PDFDocument.create();
      for (const pg of state.pages) {
        const blob = await new Promise(r => pg.canvas.toBlob(r, 'image/png'));
        const png = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
        const page = doc.addPage([pg.w, pg.h]);
        page.drawImage(png, { x: 0, y: 0, width: pg.w, height: pg.h });
      }
    }

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.getForm();
    const pages = doc.getPages();
    const border = rgb(0.42, 0.42, 0.42);
    const used = new Set();

    // Fields are created in tab order, so the tab order is the creation order.
    for (const id of state.order) {
      const f = state.fields.find(x => x.id === id);
      if (!f || !pages[f.page]) continue;
      let name = `${f.type === 'check' ? 'check' : 'field'}_${String(orderIndex(id)).padStart(3, '0')}`;
      while (used.has(name)) name += '_';
      used.add(name);

      const opts = { x: f.x, y: f.y, width: f.w, height: f.h, borderWidth: 1, borderColor: border };
      if (f.type === 'check') {
        const cb = form.createCheckBox(name);
        const side = Math.min(f.w, f.h);
        cb.addToPage(pages[f.page], { ...opts, width: side, height: side });
      } else {
        const tf = form.createTextField(name);
        // addToPage writes the default appearance; the size can only be set after that.
        tf.addToPage(pages[f.page], { ...opts, font });
        tf.setFontSize(Math.max(7, Math.min(12, f.h * 0.62)));
      }
    }

    // Ask viewers to draw the fields themselves — keeps them looking native.
    try {
      const { PDFName, PDFBool } = PDFLib;
      form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
    } catch (_) { /* older pdf-lib — appearances are already generated */ }

    return await doc.save({ useObjectStreams: false });
  }

  // ============================ wiring ============================

  function setStatus(msg, warn) {
    const s = $('#status');
    s.textContent = msg || '';
    s.className = 'status' + (warn ? ' warn' : '') + (msg ? '' : ' hidden');
  }

  function show(screen) {
    for (const id of ['drop', 'editor', 'done']) $('#' + id).classList.toggle('hidden', id !== screen);
  }

  function setTool(t) {
    state.tool = t;
    if (t === 'renumber') { state._renumberAt = 0; state.order = []; }
    for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    $('#hint').textContent = {
      select: 'Tap a field to select it. Drag to move, drag the corner to resize, ✕ to delete.',
      addtext: 'Drag across a blank line to add a typing box.',
      addcheck: 'Tap where you want a tick box.',
      renumber: 'Tap the fields one by one in the order you want Tab to follow.',
    }[t];
    if (t !== 'renumber' && !state.order.length) reorder();
    render();
  }

  function download(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = el('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return blob;
  }

  function init() {
    document.querySelectorAll('.ver').forEach(n => { n.textContent = 'v' + VERSION; });

    const fileInput = $('#file');
    $('#pick').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) start(fileInput.files[0]); });

    const dz = $('#dropzone');
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) start(e.dataTransfer.files[0]); });

    for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
    for (const b of document.querySelectorAll('[data-order]')) {
      b.addEventListener('click', () => {
        state.orderMode = b.dataset.order;
        for (const o of document.querySelectorAll('[data-order]')) o.classList.toggle('on', o === b);
        reorder(); render();
      });
    }

    $('#restart').addEventListener('click', () => location.reload());
    $('#again').addEventListener('click', () => location.reload());

    $('#make').addEventListener('click', async () => {
      $('#make').disabled = true;
      setStatus('Building the fillable PDF…');
      try {
        const bytes = await buildPdf();
        const name = `${state.fileName}_fillable.pdf`;
        const blob = download(bytes, name);
        $('#tryit').href = URL.createObjectURL(blob);
        $('#doneName').textContent = name;
        $('#doneCount').textContent = state.order.length;
        setStatus('');
        show('done');
      } catch (err) {
        setStatus('Could not build the PDF: ' + err.message, true);
      } finally {
        $('#make').disabled = false;
      }
    });

    const stage = $('#stage');
    stage.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('resize', () => { if (state.pages.length) render(); });

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  async function start(file) {
    show('editor');
    setStatus('Opening the file…');
    try {
      await loadFile(file);
      reorder();
      setTool('select');
      if (state.fields.length) setStatus('');
      $('#srcName').textContent = file.name;
    } catch (err) {
      show('drop');
      setStatus(err.message || String(err), true);
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
