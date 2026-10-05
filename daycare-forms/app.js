/* Daycare Forms — screens, saving, and downloads. The form filling itself is in forms.js. */
(function () {
  'use strict';
  const VERSION = '1.4';
  const STORE_KEY = 'daycareForms.v1';
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const clone = o => JSON.parse(JSON.stringify(o));
  const DAY_LETTERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  // ---------- data ----------

  const DEFAULT_SETTINGS = {
    rsge: { first: '', last: '', street: '', apt: '', city: '', postal: '', phone: '', cell: '', other: '' },
    bcName: 'BC du Parc', division: '10586', rate: '9.65',
    hours: [0, 1, 2, 3, 4].map(() => ({ open: '9:30', close: '14:30' })).concat([{ open: 'Fermé', close: '' }, { open: 'Fermé', close: '' }]),
    vacation: '', claimClosure: false, overtimeRate: '', overtimeUnit: '',
    payFrequency: 'biweekly', payMethod: 'cash',
    snackAM: '', lunch: '', snackPM: '',
  };
  const emptyParent = relation => ({ first: '', last: '', relation, street: '', apt: '', city: '', postal: '', homeTel: '', workTel: '', cell: '', email: '', sin: '' });

  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  function newChild(S) {
    const mon = (S.hours && S.hours[0]) || {};
    return {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      child: { first: '', last: '', dob: '', sex: '' },
      parentA: emptyParent('Mère'), parentB: emptyParent('Père'),
      noParentB: false, sameAddr: true,
      payer: 'A', citizen: true, status: '', benefits: false, prevContribution: false,
      days: [true, true, true, true, true, false, false],
      arrive: /ferm/i.test(mon.open || '') ? '' : (mon.open || ''), depart: mon.close || '',
      startDate: '', endDate: '', contribution: 'reduced', includeMinistere: false,
      signDate: today(), signPlace: (S.rsge && S.rsge.city) || '', decisionDate: today(), leftDate: '', attestDate: '', created: new Date().toISOString(),
    };
  }

  // Children saved by an older version get any fields added since (e.g. the signing date).
  function upgradeChild(c) {
    const base = newChild(DEFAULT_SETTINGS);
    delete base.id; delete base.created;
    base.endDate = '';
    const out = Object.assign(base, c);
    if (!out.decisionDate) out.decisionDate = out.signDate;
    return out;
  }

  let db = { settings: clone(DEFAULT_SETTINGS), children: [] };
  let storageOK = true;

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        db.settings = Object.assign(clone(DEFAULT_SETTINGS), d.settings || {});
        db.settings.rsge = Object.assign(clone(DEFAULT_SETTINGS.rsge), (d.settings || {}).rsge || {});
        db.children = Array.isArray(d.children) ? d.children.map(upgradeChild) : [];
      }
    } catch (e) { storageOK = false; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); storageOK = true; }
    catch (e) { storageOK = false; }
    return storageOK;
  }

  // ---------- helpers ----------

  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const set = (obj, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => (o[k] = o[k] || {}), obj)[last] = v; };
  const childName = c => [c.child.first, c.child.last].filter(Boolean).join(' ') || '(no name yet)';
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const fileSafe = t => String(t).replace(/[\\/:*?"<>|]+/g, '').trim();

  // Clean-ups run when you leave a box, never while typing (Android keyboards double letters otherwise).
  const FORMAT = {
    phone(v) {
      const d = v.replace(/\D/g, '');
      if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
      if (d.length === 11 && d[0] === '1') return d.slice(1, 4) + '-' + d.slice(4, 7) + '-' + d.slice(7);
      return v.trim();
    },
    postal(v) {
      const t = v.replace(/\s+/g, '').toUpperCase();
      return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(t) ? t.slice(0, 3) + ' ' + t.slice(3) : v.trim().toUpperCase();
    },
    sin(v) {
      const d = v.replace(/\D/g, '');
      return d.length === 9 ? d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6) : v.trim();
    },
    // Only fixes text typed all in lowercase, so "McGill" or "de l'Épée" typed by hand stay as they are.
    name(v) { return titleCase(v); },
    city(v) {
      const t = titleCase(v);
      return ({ 'Montreal': 'Montréal', 'Quebec': 'Québec', 'Cote-Saint-Luc': 'Côte-Saint-Luc', 'Saint-Laurent': 'Saint-Laurent' })[t] || t;
    },
  };

  function titleCase(v) {
    v = v.trim().replace(/\s+/g, ' ');
    if (v !== v.toLowerCase()) return v;
    const small = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'à', 'au', 'aux', 'sur']);
    const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
    return v.split(' ').map((word, i) => {
      if (i > 0 && small.has(word)) return word;
      return word.split('-').map(part => {
        const m = /^([dl]')(.+)$/.exec(part);          // l'épée -> l'Épée, d'iberville -> d'Iberville
        return m ? m[1] + cap(m[2]) : cap(part);
      }).join('-');
    }).join(' ');
  }

  function download(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const templateCache = {};
  async function loadTemplate(path) {
    if (!templateCache[path]) {
      const r = await fetch(path);
      if (!r.ok) throw new Error('Could not load ' + path);
      templateCache[path] = new Uint8Array(await r.arrayBuffer());
    }
    return templateCache[path];
  }

  function showStatus(el, msg, warn) {
    el.textContent = msg; el.classList.toggle('warn', !!warn); el.classList.remove('hidden');
  }

  // ---------- navigation ----------

  const VIEWS = ['home', 'child', 'settings', 'attendance', 'left'];
  function go(view) {
    VIEWS.forEach(v => $('#v-' + v).classList.toggle('hidden', v !== view));
    if (view === 'home') renderHome();
    if (view === 'settings') renderSettings();
    if (view === 'attendance') renderAttendance();
    window.scrollTo(0, 0);
  }
  $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

  // ---------- home ----------

  function settingsComplete() {
    const r = db.settings.rsge;
    return !!(r.first && r.last && r.street && r.city);
  }

  function renderHome() {
    $('#setupBanner').classList.toggle('hidden', settingsComplete());
    const current = db.children.filter(c => !c.leftDate).sort((a, b) => childName(a).localeCompare(childName(b)));
    const past = db.children.filter(c => c.leftDate).sort((a, b) => (b.leftDate || '').localeCompare(a.leftDate || ''));
    $('#listCurrent').innerHTML = current.length ? current.map(c => `
      <div class="card">
        <div class="name">${esc(childName(c))}</div>
        <div class="meta">${c.attendanceOnly ? 'Attendance only · tap Edit to add the rest' : (c.startDate ? 'Started ' + esc(c.startDate) : 'No start date yet') + (c.child.dob ? ' · born ' + esc(c.child.dob) : '')}</div>
        <div class="row">
          <button class="primary" data-act="make" data-id="${c.id}">Make forms</button>
          <button data-act="edit" data-id="${c.id}">Edit</button>
          <button data-act="left" data-id="${c.id}">Child left</button>
        </div>
      </div>`).join('') : '<div class="empty">No children yet. Tap "+ New child" to add the first one.</div>';
    $('#pastCount').textContent = past.length;
    $('#pastWrap').classList.toggle('hidden', !past.length);
    $('#listPast').innerHTML = past.map(c => `
      <div class="card">
        <div class="name">${esc(childName(c))}</div>
        <div class="meta">Left ${esc(c.leftDate)}</div>
        <div class="row">
          <button data-act="attest" data-id="${c.id}">Attestation again</button>
          <button data-act="make" data-id="${c.id}">Registration forms</button>
          <button data-act="edit" data-id="${c.id}">Edit</button>
          <button data-act="back" data-id="${c.id}">Still attending</button>
        </div>
      </div>`).join('');
    if (!storageOK) showStatus($('#homeStatus'), 'Warning: Chrome is not letting this page save. Your children will be lost when you close it. Save a backup before leaving.', true);
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const c = db.children.find(x => x.id === b.dataset.id); if (!c) return;
    const act = b.dataset.act;
    if (act === 'edit') openChild(c);
    if (act === 'make') await makePackage(c, b);
    if (act === 'left') openLeft(c);
    if (act === 'attest') await makeAttestation(c, b);
    if (act === 'back') { c.leftDate = ''; save(); renderHome(); }
  });

  // ---------- child editor ----------

  let editing = null;   // a working copy; only saved on Save

  const PARENT_FIELDS = [
    ['first', 'First name', 'text', 'name'], ['last', 'Last name', 'text', 'name'],
    ['street', 'Street address', 'text', 'name', 'wide addr'], ['apt', 'Apt', 'text', '', 'addr'],
    ['city', 'City', 'text', 'city', 'addr'], ['postal', 'Postal code', 'text', 'postal', 'addr'],
    ['homeTel', 'Home phone', 'tel', 'phone', 'addr'], ['cell', 'Cell', 'tel', 'phone'],
    ['workTel', 'Work phone', 'tel', 'phone'], ['email', 'Email', 'email', ''],
    ['sin', 'Social insurance number (SIN)', 'text', 'sin'],
  ];
  function parentHTML(key) {
    return `<div class="q"><div class="qt">This parent is the…</div>
      <div class="seg" data-seg="${key}.relation"><button type="button" data-v="Père">Father</button><button type="button" data-v="Mère">Mother</button><button type="button" data-v="Tuteur">Guardian</button></div></div>
      <div class="grid">` + PARENT_FIELDS.map(([k, label, type, fmt, cls]) =>
      `<label class="f ${cls && cls.includes('wide') ? 'wide' : ''}" data-addr="${cls && cls.includes('addr') ? 1 : ''}">${label}<input type="${type}" data-k="${key}.${k}" ${fmt ? 'data-fmt="' + fmt + '"' : ''} autocomplete="off" ${type === 'tel' ? 'inputmode="tel"' : ''}></label>`).join('') + '</div>';
  }
  $('#parentA').innerHTML = parentHTML('parentA');
  $('#parentB').innerHTML = parentHTML('parentB');
  $('#daysSeg').innerHTML = DAY_LETTERS.map((d, i) => `<button type="button" data-day="${i}">${d}</button>`).join('');

  function openChild(c) {
    editing = c ? clone(c) : newChild(db.settings);
    $('#childTitle').textContent = c ? childName(c) : 'New child';
    $('#btnChildDelete').classList.toggle('hidden', !c);
    $('#childStatus').classList.add('hidden');
    fillChildForm();
    go('child');
  }

  function fillChildForm() {
    const c = editing;
    $$('#v-child [data-k]').forEach(el => {
      const v = get(c, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v;
    });
    $$('#v-child [data-seg]').forEach(seg => {
      const v = String(get(c, seg.dataset.seg));
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    });
    $$('#daysSeg button').forEach(b => b.classList.toggle('on', !!c.days[+b.dataset.day]));
    $('#noParentB').checked = !!c.noParentB;
    $('#sameAddr').checked = c.sameAddr !== false;
    refreshChildVisibility();
  }

  function refreshChildVisibility() {
    const c = editing;
    $('#parentBWrap').classList.toggle('hidden', !!c.noParentB);
    $$('#parentB [data-addr="1"]').forEach(el => el.classList.toggle('hidden', c.sameAddr !== false));
    $('#statusQ').classList.toggle('hidden', c.citizen !== false);
    $$('[data-seg="payer"] button[data-v="B"]').forEach(b => { b.disabled = !!c.noParentB; });
  }

  $('#v-child').addEventListener('input', e => {
    const el = e.target; if (!el.dataset.k || !editing) return;
    set(editing, el.dataset.k, el.type === 'checkbox' ? el.checked : el.value);
  });
  // The office-page date follows the signing date until it is changed on its own.
  let lastSign = null;
  $('#v-child').addEventListener('focusin', e => { if (e.target.dataset.k === 'signDate') lastSign = editing.signDate; });
  $('#v-child').addEventListener('input', e => {
    if (e.target.dataset.k !== 'signDate' || !editing) return;
    if (!editing.decisionDate || editing.decisionDate === lastSign) {
      editing.decisionDate = editing.signDate;
      $('#v-child [data-k="decisionDate"]').value = editing.decisionDate;
    }
    lastSign = editing.signDate;
  });
  $('#v-child').addEventListener('change', e => {
    const el = e.target; if (!editing) return;
    if (el.dataset.k && el.type === 'checkbox') set(editing, el.dataset.k, el.checked);
  });
  // Tidy on blur only.
  document.addEventListener('blur', e => {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.fmt || !FORMAT[el.dataset.fmt]) return;
    const v = FORMAT[el.dataset.fmt](el.value);
    if (v !== el.value) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, true);

  $('#v-child').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !editing) return;
    const seg = b.closest('[data-seg]');
    if (seg) {
      let v = b.dataset.v;
      if (v === 'true') v = true; else if (v === 'false') v = false;
      set(editing, seg.dataset.seg, v);
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      // Picking Mother for one parent makes the other one Father, and the other way round.
      const other = { 'parentA.relation': 'parentB', 'parentB.relation': 'parentA' }[seg.dataset.seg];
      const flip = { 'Père': 'Mère', 'Mère': 'Père' }[v];
      if (other && flip) {
        editing[other].relation = flip;
        $$('[data-seg="' + other + '.relation"] button').forEach(x => x.classList.toggle('on', x.dataset.v === flip));
      }
      refreshChildVisibility();
    }
    if (b.dataset.day != null) {
      const i = +b.dataset.day;
      editing.days[i] = !editing.days[i];
      b.classList.toggle('on', editing.days[i]);
    }
  });
  $('#noParentB').addEventListener('change', e => {
    editing.noParentB = e.target.checked;
    if (editing.noParentB) { editing.payer = 'A'; fillChildForm(); }
    refreshChildVisibility();
  });
  $('#sameAddr').addEventListener('change', e => { editing.sameAddr = e.target.checked; refreshChildVisibility(); });

  // What the forms will actually use (Parent B borrowing Parent A's address, etc.).
  function forForms(c) {
    const out = clone(c);
    if (!out.signPlace) out.signPlace = db.settings.rsge.city || '';
    if (c.noParentB) out.parentB = emptyParent('');
    else if (c.sameAddr !== false) ['street', 'apt', 'city', 'postal', 'homeTel'].forEach(k => { out.parentB[k] = c.parentA[k]; });
    return out;
  }

  // Blank answers are allowed, but never silent: list what will print empty.
  function missing(c) {
    const m = [];
    if (!c.child.first || !c.child.last) m.push("child's name");
    if (!c.child.dob) m.push("child's date of birth");
    if (!c.child.sex) m.push("child's sex");
    if (!c.parentA.first || !c.parentA.last) m.push("Parent A's name");
    if (!c.parentA.street) m.push("Parent A's address");
    const payer = c.payer === 'B' ? c.parentB : c.parentA;
    if (!payer.sin) m.push('SIN of the parent who signs');
    if (!c.startDate) m.push('first day');
    if (!c.days.some(Boolean)) m.push('days the child comes');
    return m;
  }

  function saveEditing() {
    if (editing.attendanceOnly && (editing.child.dob || editing.startDate)) delete editing.attendanceOnly;
    const i = db.children.findIndex(x => x.id === editing.id);
    if (i >= 0) db.children[i] = clone(editing); else db.children.push(clone(editing));
    return save();
  }

  $('#btnChildCancel').addEventListener('click', () => { editing = null; go('home'); });
  $('#btnChildSave').addEventListener('click', () => {
    const ok = saveEditing();
    go('home');
    showStatus($('#homeStatus'), ok ? 'Saved: ' + childName(editing) + '.' : 'Could not save. Chrome is blocking storage. Use "Save backup".', !ok);
  });
  $('#btnChildSaveMake').addEventListener('click', async e => {
    saveEditing();
    const c = db.children.find(x => x.id === editing.id);
    await makePackage(c, e.currentTarget, $('#childStatus'));
  });
  $('#btnChildDelete').addEventListener('click', () => {
    if (!confirm('Delete ' + childName(editing) + ' and everything typed for them? This cannot be undone.')) return;
    db.children = db.children.filter(x => x.id !== editing.id);
    save(); editing = null; go('home');
  });

  async function makePackage(c, btn, statusEl) {
    statusEl = statusEl || $('#homeStatus');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Making…';
    try {
      const bytes = await DaycareForms.registrationPackage(loadTemplate, db.settings, forForms(c));
      download(bytes, fileSafe('Forms - ' + childName(c)) + '.pdf');
      const m = missing(c);
      const extra = c.includeMinistere ? ' (with the Ministère contract)' : '';
      showStatus(statusEl, 'Downloaded "Forms - ' + childName(c) + '.pdf"' + extra + '. Print it double-sided.' +
        (m.length ? ' Left blank because it wasn\'t filled in: ' + m.join(', ') + '.' : ''), m.length > 0);
    } catch (err) {
      showStatus(statusEl, 'Something went wrong making the forms: ' + err.message, true);
    } finally { btn.disabled = false; btn.textContent = label; }
  }

  // ---------- settings ----------

  let editingS = null;
  function renderSettings() {
    editingS = clone(db.settings);
    $$('#v-settings [data-s]').forEach(el => { el.value = get(editingS, el.dataset.s) || ''; });
    $$('#v-settings [data-sseg]').forEach(seg => {
      const v = String(get(editingS, seg.dataset.sseg));
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    });
    $('#hoursTable').innerHTML = DAY_FR.map((d, i) => `<tr><td>${d}</td>
      <td><input type="text" data-h="${i}.open" value="${esc(editingS.hours[i].open)}" aria-label="${d} opening"></td>
      <td><input type="text" data-h="${i}.close" value="${esc(editingS.hours[i].close)}" aria-label="${d} closing"></td></tr>`).join('');
    const T = DaycareForms.TEMPLATES;
    $('#versionsList').innerHTML = Object.keys(T).map(k => esc(T[k].replace('templates/', ''))).join('<br>');
  }
  $('#v-settings').addEventListener('input', e => {
    const el = e.target; if (!editingS) return;
    if (el.dataset.s) set(editingS, el.dataset.s, el.value);
    if (el.dataset.h) { const [i, k] = el.dataset.h.split('.'); editingS.hours[+i][k] = el.value; }
  });
  $('#v-settings').addEventListener('click', e => {
    const b = e.target.closest('button'); const seg = b && b.closest('[data-sseg]');
    if (!seg) return;
    const v = b.dataset.v; set(editingS, seg.dataset.sseg, v === 'true' ? true : v === 'false' ? false : v);
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('#btnSettingsCancel').addEventListener('click', () => go('home'));
  $('#btnSettingsSave').addEventListener('click', () => {
    db.settings = editingS; const ok = save(); go('home');
    showStatus($('#homeStatus'), ok ? 'Daycare settings saved.' : 'Could not save. Chrome is blocking storage.', !ok);
  });

  // ---------- attendance ----------

  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  }
  let attChosen = null;
  function renderAttendance() {
    if (!$('#attStart').value) $('#attStart').value = mondayOf(new Date());
    const start = $('#attStart').value;
    const end = DaycareForms.addDays(start, 13);
    // Current children, plus anyone who left during these two weeks.
    const list = db.children.filter(c => !c.leftDate || c.leftDate >= start)
      .filter(c => !c.startDate || c.startDate <= end)
      .sort((a, b) => childName(a).localeCompare(childName(b)));
    attChosen = attChosen || new Set(list.map(c => c.id));
    $('#attList').innerHTML = list.length ? list.map(c =>
      `<label class="check"><input type="checkbox" data-att="${c.id}" ${attChosen.has(c.id) ? 'checked' : ''}> ${esc(childName(c))}${c.leftDate ? ' <span style="color:var(--muted)">(left ' + esc(c.leftDate) + ')</span>' : ''}</label>`).join('')
      : '<div class="empty">No children attending in these two weeks.</div>';
    const day = new Date(start + 'T12:00').getDay();
    const note = $('#attStartNote');
    if (day !== 1) showStatus(note, 'Heads-up: that date is a ' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] + ', not a Monday.', true);
    else showStatus(note, 'Weeks starting ' + start + ' and ' + DaycareForms.addDays(start, 7) + '.');
  }
  $('#attStart').addEventListener('change', () => { attChosen = null; renderAttendance(); });

  // Quick add: just the names an attendance sheet needs. The parent is entered as
  // Parent A, so the full forms can still be made later after filling in the rest.
  $('#btnQuickAdd').addEventListener('click', () => {
    const v = id => FORMAT.name($('#' + id).value);
    const first = v('qChildFirst'), last = v('qChildLast');
    if (!first && !last) { showStatus($('#qStatus'), "Type the child's name.", true); return; }
    // The parent's name goes on the sheet (the parent signs it), so it can't be skipped.
    if (!v('qParentFirst') && !v('qParentLast')) { showStatus($('#qStatus'), "Type the parent's name too. It goes on the attendance sheet.", true); return; }
    const c = newChild(db.settings);
    c.child.first = first; c.child.last = last;
    c.parentA.first = v('qParentFirst'); c.parentA.last = v('qParentLast');
    c.noParentB = true; c.attendanceOnly = true;
    db.children.push(c);
    const ok = save();
    if (attChosen) attChosen.add(c.id);
    ['qChildFirst', 'qChildLast', 'qParentFirst', 'qParentLast'].forEach(id => { $('#' + id).value = ''; });
    renderAttendance();
    showStatus($('#qStatus'), ok ? 'Added ' + childName(c) + '. It is ticked in the list above.' : 'Added, but Chrome is blocking saving. Use "Save backup".', !ok);
    $('#qChildFirst').focus();
  });
  ['qChildFirst', 'qChildLast', 'qParentFirst', 'qParentLast'].forEach(id =>
    $('#' + id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); $('#btnQuickAdd').click(); } }));
  $('#attList').addEventListener('change', e => {
    const id = e.target.dataset.att; if (!id) return;
    if (e.target.checked) attChosen.add(id); else attChosen.delete(id);
  });
  $('#btnAttMake').addEventListener('click', async e => {
    const btn = e.currentTarget;
    const start = $('#attStart').value;
    const kids = db.children.filter(c => attChosen && attChosen.has(c.id)).sort((a, b) => childName(a).localeCompare(childName(b)));
    if (!start || !kids.length) { showStatus($('#attStatus'), 'Pick the date and at least one child.', true); return; }
    btn.disabled = true;
    try {
      const bytes = await DaycareForms.attendanceSheets(loadTemplate, db.settings, kids.map(forForms), start);
      download(bytes, 'Attendance ' + start + '.pdf');
      showStatus($('#attStatus'), 'Downloaded "Attendance ' + start + '.pdf": ' + (kids.length > 1 ? kids.length + ' sheets, each on its own sheet of paper when printed double-sided.' : '1 sheet.'));
    } catch (err) { showStatus($('#attStatus'), 'Something went wrong: ' + err.message, true); }
    finally { btn.disabled = false; }
  });

  // ---------- child left / attestation ----------

  let leaving = null;
  function openLeft(c) {
    leaving = c;
    $('#leftTitle').textContent = childName(c) + ' left';
    $('#leftDate').value = c.leftDate || today();
    $('#attestDate').value = today();
    $('#leftStatus').classList.add('hidden');
    go('left');
  }
  $('#btnLeftMake').addEventListener('click', async e => {
    if (!$('#leftDate').value) { showStatus($('#leftStatus'), 'Pick the last day first.', true); return; }
    leaving.leftDate = $('#leftDate').value;
    leaving.attestDate = $('#attestDate').value; save();
    await makeAttestation(leaving, e.currentTarget, $('#leftStatus'));
  });
  async function makeAttestation(c, btn, statusEl) {
    statusEl = statusEl || $('#homeStatus');
    btn.disabled = true;
    try {
      if (!c.attestDate) { c.attestDate = today(); save(); }
      const bytes = await DaycareForms.attestation(loadTemplate, db.settings, forForms(c));
      download(bytes, fileSafe('Attestation - ' + childName(c)) + '.pdf');
      showStatus(statusEl, 'Downloaded "Attestation - ' + childName(c) + '.pdf". ' + childName(c) + ' is now under "Past children". Remember: one copy to the parent, one to the office.');
    } catch (err) { showStatus(statusEl, 'Something went wrong: ' + err.message, true); }
    finally { btn.disabled = false; }
  }

  // ---------- backup ----------

  $('#btnBackup').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'daycare-forms', version: VERSION, saved: new Date().toISOString(), ...db }, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Daycare backup ' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showStatus($('#homeStatus'), 'Backup downloaded. It holds SIN numbers, so keep it somewhere private.');
  });
  $('#btnRestore').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'daycare-forms' || !Array.isArray(d.children)) throw new Error('That file is not a Daycare Forms backup.');
      const n = d.children.length;
      if (!confirm('Replace what is on this tablet with the backup from ' + (d.saved || '').slice(0, 10) + ' (' + n + ' children)?')) return;
      db = { settings: Object.assign(clone(DEFAULT_SETTINGS), d.settings || {}), children: d.children.map(upgradeChild) };
      save(); renderHome();
      showStatus($('#homeStatus'), 'Backup loaded: ' + n + ' children.');
    } catch (err) { showStatus($('#homeStatus'), err.message, true); }
  });

  // ---------- start ----------

  $('#btnNew').addEventListener('click', () => openChild(null));
  load();
  go('home');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
