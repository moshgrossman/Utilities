/* Daycare Forms — fills the French daycare forms from one set of answers.
   Every position below was measured from the 2026 versions the office sent
   (Aug 5, 2026). If the office sends a new version of a form, its section here
   is the only thing that needs re-measuring. Coordinates are PDF points from
   the bottom-left corner of the page. */
(function (root) {
  'use strict';
  const PDFLib = root.PDFLib || (typeof require !== 'undefined' ? require('./vendor/pdf-lib.min.js') : null);
  const { PDFDocument, StandardFonts, PDFName, rgb } = PDFLib;

  const LETTER = [612, 792];
  const INK = rgb(0.05, 0.1, 0.45);   // dark blue, so typed answers stand out from the printed form

  const TEMPLATES = {
    renseignements: 'templates/renseignements-2026.pdf',
    ententeBC: 'templates/entente-bc-2026.pdf',
    ententeMinistere: 'templates/entente-ministere-2026.pdf',
    contribution: 'templates/contribution-reduite-2026.pdf',
    fiche: 'templates/fiche-identification-en.pdf',
    assiduite: 'templates/fiche-assiduite-2026.pdf',
    attestation: 'templates/attestation-2026.pdf',
  };

  // ---------- small helpers ----------

  const s = v => (v == null ? '' : String(v)).trim();
  const join = (...parts) => parts.map(s).filter(Boolean).join(' ');
  const fullName = p => p ? join(p.first, p.last) : '';
  const hasPerson = p => !!(p && (s(p.first) || s(p.last)));

  // Stored dates are always YYYY-MM-DD (what <input type=date> gives).
  function dateParts(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s(iso));
    return m ? { y: m[1], m: m[2], d: m[3] } : { y: '', m: '', d: '' };
  }
  const isoDate = iso => (dateParts(iso).y ? s(iso) : '');

  function addDays(iso, n) {
    const { y, m, d } = dateParts(iso);
    const dt = new Date(Date.UTC(+y, +m - 1, +d + n));
    return dt.toISOString().slice(0, 10);
  }

  // "514-555-1234" -> { area: '514', rest: '555-1234' }
  function splitPhone(p) {
    const digits = s(p).replace(/\D/g, '');
    if (digits.length === 10) return { area: digits.slice(0, 3), rest: digits.slice(3, 6) + '-' + digits.slice(6) };
    if (digits.length === 11 && digits[0] === '1') return splitPhone(digits.slice(1));
    return { area: '', rest: s(p) };
  }

  // "755 Avenue Querbes" -> { no: '755', street: 'Avenue Querbes' }
  function splitStreet(addr) {
    const m = /^\s*(\d+[A-Za-z]?(?:-\d+)?)[\s,]+(.*)$/.exec(s(addr));
    return m ? { no: m[1], street: m[2] } : { no: '', street: s(addr) };
  }

  const money = v => {
    const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.]/g, ''));
    return isFinite(n) ? n.toFixed(2).replace('.', ',') + ' $' : '';
  };

  const DAYS_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  // Which parent pays and signs the contribution form.
  const payerOf = c => (c.payer === 'B' && hasPerson(c.parentB)) ? c.parentB : c.parentA;

  // ---------- drawing on flat (non-fillable) forms ----------

  function writer(page, font) {
    // Text that would overflow its blank line is shrunk until it fits.
    function fit(text, size, maxW) {
      let sz = size;
      while (maxW && sz > 5 && font.widthOfTextAtSize(text, sz) > maxW) sz -= 0.5;
      return sz;
    }
    return {
      at(text, x, y, maxW, size = 10) {
        text = s(text); if (!text) return;
        const sz = fit(text, size, maxW);
        page.drawText(text, { x, y, size: sz, font, color: INK });
      },
      centre(text, x0, x1, y, size = 10) {
        text = s(text); if (!text) return;
        const sz = fit(text, size, x1 - x0 - 2);
        const w = font.widthOfTextAtSize(text, sz);
        page.drawText(text, { x: (x0 + x1) / 2 - w / 2, y, size: sz, font, color: INK });
      },
      tick(cx, cy, size = 12) {
        const w = font.widthOfTextAtSize('X', size);
        page.drawText('X', { x: cx - w / 2, y: cy - size * 0.35, size, font, color: INK });
      },
    };
  }

  // ---------- filling fillable forms ----------

  function formFiller(doc) {
    const form = doc.getForm();
    const fieldOf = name => { try { return form.getField(name); } catch (e) { return null; } };
    return {
      form,
      text(name, value) {
        const v = s(value); if (!v) return;
        const f = fieldOf(name); if (!f || !f.setText) return;
        const max = f.getMaxLength && f.getMaxLength();
        try { f.setText(max ? v.slice(0, max) : v); } catch (e) { /* leave blank rather than fail the whole file */ }
      },
      // Ticks the n-th box of a button field (works for radio groups and for
      // check boxes that share one name). Done at the PDF level because some
      // government forms give their options names pdf-lib cannot decode.
      // n counts boxes in reading order (top to bottom, then left to right),
      // because the order stored inside the file is not always the order on the page.
      pick(name, n) {
        const f = fieldOf(name); if (!f) return;
        const all = f.acroField.getWidgets();
        const pos = w => { const r = w.getRectangle(); return { x: r.x, y: r.y + r.height }; };
        const widgets = all.slice().sort((a, b) => {
          const pa = pos(a), pb = pos(b);
          return Math.abs(pa.y - pb.y) > 3 ? pb.y - pa.y : pa.x - pb.x;
        });
        if (!widgets[n]) return;
        const on = widgets[n].getOnValue();
        if (!on) return;
        f.acroField.dict.set(PDFName.of('V'), on);
        all.forEach(w => w.setAppearanceState(w === widgets[n] ? on : PDFName.of('Off')));
      },
      check(name, yes = true) { if (yes) this.pick(name, 0); },
    };
  }

  async function flatten(doc, filler) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    try { filler.form.updateFieldAppearances(font); } catch (e) { /* appearances already present */ }
    filler.form.flatten();
  }

  // ---------- the forms ----------

  // Formulaire de renseignements MF 2026 — letter, 1 page, flat.
  async function fillRenseignements(doc, S, c) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const w = writer(doc.getPage(0), font);
    w.at(fullName(S.rsge), 326, 655, 185);
    const col = (p, L) => {
      if (!hasPerson(p)) return;
      w.at(p.last, L.nom, 571.5, 165);
      w.at(p.first, L.prenom, 554.5, 150);
      w.at(join(p.street, p.apt ? 'app. ' + p.apt : ''), L.adresse, 538, 150);
      w.at(p.city, L.ville, 521, 172);
      w.at(p.postal, L.postal, 504.5, 125);
      const h = splitPhone(p.homeTel), t = splitPhone(p.workTel);
      w.centre(h.area, L.homeArea[0], L.homeArea[1], 487.5, 9);
      w.at(h.rest, L.home, 487.5, 74);
      w.centre(t.area, L.workArea[0], L.workArea[1], 471, 9);
      w.at(t.rest, L.work, 471, 89);
      w.at(p.email, L.email, 454, 135, 9);
      w.at(p.sin, L.sin, 437.5, 127);
    };
    col(c.parentA, { nom: 103, prenom: 118, adresse: 119, ville: 97, postal: 139, homeArea: [163.7, 184.5], home: 196, workArea: [146.4, 167.1], work: 178.5, email: 133, sin: 141.5 });
    col(c.parentB, { nom: 351, prenom: 366, adresse: 367, ville: 345, postal: 387, homeArea: [411.6, 432.4], home: 444, workArea: [394.3, 415.0], work: 426.5, email: 381, sin: 389.5 });
    w.at(c.child.first, 181, 387.5, 96);
    const dob = dateParts(c.child.dob);
    w.centre(dob.d, 434.9, 457.5, 387.5); w.centre(dob.m, 467.8, 490.4, 387.5); w.centre(dob.y, 500.8, 523.4, 387.5, 9);
    const st = dateParts(c.startDate);
    w.centre(st.d, 282.1, 304.7, 320.5); w.centre(st.m, 315.1, 337.7, 320.5); w.centre(st.y, 348.0, 370.7, 320.5, 9);
    const boxes = [146.5, 182.5, 218.5, 254.5, 283.3, 319.3, 355.3];
    (c.days || []).forEach((on, i) => { if (on) w.tick(boxes[i], 190.3, 14); });
  }

  // Entente pour garde BC 2026 — A4, 2 pages, flat.
  async function fillEntenteBC(doc, S, c) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = writer(doc.getPage(0), font);
    const p2 = writer(doc.getPage(1), font);
    const parent = payerOf(c);
    const block = (p, x) => {
      // x = { nom, prenom, adresse, ville, postal, tel, cell, autre } start positions, right edge per line
      p1.at(p.last, x.nom[0], 681, x.nom[1] - x.nom[0]);
      p1.at(p.first, x.prenom[0], 662, x.prenom[1] - x.prenom[0]);
      p1.at(join(p.street, p.apt ? 'app. ' + p.apt : ''), x.adresse[0], 643, x.adresse[1] - x.adresse[0], 9);
      p1.at(p.city, x.ville[0], 624, x.ville[1] - x.ville[0]);
      p1.at(p.postal, x.postal[0], 605, x.postal[1] - x.postal[0]);
      p1.at(p.homeTel || p.phone, x.tel[0], 586, x.tel[1] - x.tel[0]);
      p1.at(p.cell, x.cell[0], 567, x.cell[1] - x.cell[0]);
      p1.at(p.other || p.workTel, x.autre[0], 548, x.autre[1] - x.autre[0], 9);
    };
    block(S.rsge, { nom: [57, 199], prenom: [69.5, 200], adresse: [70.5, 196], ville: [57, 149], postal: [87.5, 169], tel: [107, 189], cell: [78.5, 176], autre: [60, 174] });
    if (hasPerson(parent)) block(parent, { nom: [332.5, 475], prenom: [345, 476], adresse: [346, 472], ville: [332.5, 425], postal: [363, 444], tel: [383, 464], cell: [354, 452], autre: [336, 450] });

    p1.at(c.child.last, 99, 506, 152);
    p1.at(c.child.first, 346, 506, 147);
    p1.at(isoDate(c.child.dob), 111, 487, 142);
    if (c.child.sex === 'M') p1.tick(419.9, 490.9, 11);
    if (c.child.sex === 'F') p1.tick(463.4, 490.9, 11);

    const cols1 = [107.5, 174.6, 241.6, 308.6, 375.7, 442.7, 509.6, 576.7];
    (S.hours || []).forEach((h, i) => {
      p1.centre(h.open, cols1[i], cols1[i + 1], 354.6, 9);
      p1.centre(h.close, cols1[i], cols1[i + 1], 338.7, 9);
    });
    p1.at(S.vacation, 25, 126, 545, 9);
    if (S.claimClosure === true) p1.tick(51.4, 79.3, 12);
    if (S.claimClosure === false) p1.tick(199.8, 79.4, 12);

    const nDays = (c.days || []).filter(Boolean).length;
    if (nDays) p2.centre(String(nDays), 307, 329, 797.5);
    if (c.contribution === 'exempt') p2.tick(27.4, 771.8, 12);
    else { p2.tick(27.4, 788.8, 12); p2.centre(money(S.rate), 372.5, 411.1, 783.5, 9); }
    p2.centre(S.overtimeRate, 51.3, 89.9, 726.5, 9);
    p2.centre(S.overtimeUnit, 149.4, 182.5, 726.5, 9);

    const cols2 = [112.5, 177.5, 242.4, 307.4, 372.3, 437.4, 502.3, 567.4];
    (c.days || []).forEach((on, i) => {
      if (!on) return;
      p2.centre(c.arrive, cols2[i], cols2[i + 1], 632, 9);
      p2.centre(c.depart, cols2[i], cols2[i + 1], 616, 9);
    });

    if (c.contribution !== 'exempt' && nDays) {
      const rate = parseFloat(String(S.rate).replace(',', '.'));
      if (isFinite(rate)) p2.centre(money(rate * nDays), 53.1, 91.7, 573.7, 8);
    }
    p2.at(S.chequesTo || fullName(S.rsge), 212, 561, 124);
    p2.centre(isoDate(c.startDate), 166.5, 249.1, 212.5, 9);
    p2.centre(isoDate(c.endDate), 262.1, 333.8, 212.5, 9);
  }

  // Entente de services de garde éducatifs subventionnés (Ministère) — legal size, 5 pages, fillable.
  async function fillEntenteMinistere(doc, S, c) {
    const f = formFiller(doc);
    const r = S.rsge;
    const rs = splitStreet(r.street);
    f.text('S1_Nom_Famille', fullName(r));
    f.text('S1_Numero', rs.no); f.text('S1_Rue', rs.street); f.text('S1_Appartement', r.apt);
    f.text('S1_Ville', r.city); f.text('S1_Province', 'Québec'); f.text('S1_Code_Postal', r.postal);
    const person = (p, suffix) => {
      if (!hasPerson(p)) return;
      const st = splitStreet(p.street);
      f.text('S1_Nom_Famille_' + suffix, p.last); f.text('S1_Prenom_' + suffix, p.first);
      f.text('S1_Numero_' + suffix, st.no); f.text('S1_Rue_' + suffix, st.street); f.text('S1_Appartement_' + suffix, p.apt);
      f.text('S1_Ville_' + suffix, p.city); f.text('S1_Province_' + suffix, 'Québec'); f.text('S1_Code_Postal_' + suffix, p.postal);
    };
    person(c.parentA, '02');
    person(c.parentB, '03');
    f.text('S1_Nom_Parent', fullName(payerOf(c)));
    f.text('S1_Nom_Famille_04', c.child.last); f.text('S1_Prenom_04', c.child.first);
    f.text('S1_Date_Naissance', isoDate(c.child.dob));

    f.text('S2_Heure_Collation_Matin', S.snackAM); f.text('S2_Heure_Collation_PM', S.snackPM); f.text('S2_Heure_Repas_Midi', S.lunch);
    (S.hours || []).forEach((h, i) => {
      if (/ferm/i.test(s(h.open))) return;
      f.text('S2.2_Periode_Habituelle_Debut_ligne_' + (i + 1), h.open);
      f.text('S2.2_Periode_Habituelle_Fin_ligne_' + (i + 1), h.close);
    });
    if (S.claimClosure === true) f.check('S2.3_Reclamation');
    const dayKey = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    (c.days || []).forEach((on, i) => {
      if (!on) return;
      f.text('S3.1_Besoin_Garde_' + dayKey[i] + '_De', c.arrive);
      f.text('S3.1_Besoin_Garde_' + dayKey[i] + '_A', c.depart);
    });
    const nDays = (c.days || []).filter(Boolean).length;
    const rate = parseFloat(String(S.rate).replace(',', '.'));
    if (c.contribution === 'exempt') f.check('S4.1_Exemption_Paiement');
    else if (nDays && isFinite(rate)) { f.pick('S4.2_Type_Versement', 0); f.text('S4.2_Montant_Versement', (rate * nDays).toFixed(2).replace('.', ',')); }
    f.text('S4.1_Date-Debut_Prestation', isoDate(c.startDate));
    f.text('S8_Date_Frequentation_1', isoDate(c.startDate));
    f.text('S8_Date_Frequentation_2', isoDate(c.endDate));
    await flatten(doc, f);
  }

  // Demande d'admissibilité à la contribution réduite 2026 (Ministère) — letter, 4 pages, fillable.
  // Note: the government swapped two field names — "Firstname1" sits in the last-name (Nom) box.
  async function fillContribution(doc, S, c) {
    const f = formFiller(doc);
    const p = payerOf(c);
    if (hasPerson(p)) {
      f.text('S1_Parent_Firstname1', p.last);
      f.text('S1_Parent_Lastname1', p.first);
      f.text('S1_Parent_NAS1', p.sin);
      f.text('S1_Address_Street1', p.street); f.text('S1_Address_Apartment1', p.apt);
      f.text('S1_Address_City1', p.city); f.text('S1_Address_Province1', 'Québec'); f.text('S1_Address_Postalcode1', p.postal);
      f.text('S1_Tel_Home_Number1', p.homeTel); f.text('S1_Tel_Work_Number1', p.workTel);
      f.text('S1_Courriel', p.email);
      f.text('S1_Lien_1', p.relation);
    }
    if (c.citizen === true) f.pick('S1_Citoyennete', 0);
    if (c.citizen === false) f.pick('S1_Citoyennete', 1);
    f.text('S1_Nom_1', c.child.last); f.text('S1_Prenom_1', c.child.first);
    f.text('S1_Date_Naissance_1', isoDate(c.child.dob));
    f.text('S2_Date_journee_1', isoDate(c.startDate));
    if (c.benefits === true) f.pick('S3_Prestation', 0);
    if (c.benefits === false) f.pick('S3_Prestation', 1);
    if (c.prevContribution === true) f.pick('S4_Contribution', 0);
    if (c.prevContribution === false) f.pick('S4_Contribution', 1);
    // Page 3 — documents attached (the birth certificates and the agreement always go in).
    f.check('S5_Doc_1'); f.check('S5_Doc_2'); f.check('S5_Doc_6');
    if (c.citizen === false) {
      f.check('S5_Doc_3');
      if (c.status !== '' && c.status != null) f.pick('S5_Status', +c.status);
    }
    if (c.benefits === true) f.check('S5_Doc_4');
    if (c.prevContribution === true) f.check('S5_Doc_5');
    // Page 4 — the coordinating office's box, prefilled the same way the office expects.
    f.text('S4_Nom_Titulaire', S.bcName); f.text('S4_No_Division', S.division);
    f.text('S4_Nom', S.rsge.last); f.text('S4_Prenom', S.rsge.first);
    await flatten(doc, f);
  }

  // Fiche d'identification — Moshe's English translation, letter, 2 pages, fillable.
  // Only the identification part is filled; the parents write the health part by hand.
  async function fillFiche(doc, S, c) {
    const f = formFiller(doc);
    f.text('full_name', join(c.child.first, c.child.last));
    const dob = dateParts(c.child.dob);
    f.text('dob_day', dob.d); f.text('dob_month', dob.m); f.text('dob_year', dob.y);
    const home = c.parentA && c.parentA.street ? c.parentA : c.parentB || {};
    f.text('address', join(home.street, home.apt ? 'apt ' + home.apt + ',' : (home.street ? ',' : ''), home.city, home.postal).replace(' ,', ','));
    f.text('phone', splitPhone(home.homeTel).rest);
    const rows = { 'Mère': 0, 'Père': 1 };
    const used = new Set();
    [c.parentA, c.parentB].forEach(p => {
      if (!hasPerson(p)) return;
      let row = rows[p.relation];
      if (row == null || used.has(row)) row = 2;
      if (used.has(row)) return;
      used.add(row);
      f.text('resp_name_' + row, fullName(p));
      f.text('resp_home_' + row, p.homeTel || p.cell);
      f.text('resp_work_' + row, p.workTel);
    });
    f.text('provider_name_ref', fullName(S.rsge));
    await flatten(doc, f);
  }

  // Fiche d'assiduité 2026 — A4, 1 page, flat. Names and week dates only.
  async function fillAssiduite(doc, S, c, weekStart) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const w = writer(doc.getPage(0), font);
    w.at(join(c.child.first, c.child.last), 150, 644, 400);
    w.at(fullName(payerOf(c)), 150, 626.5, 400);
    w.at(fullName(S.rsge), 150, 609, 400);
    if (c.leftDate && c.leftDate <= addDays(weekStart, 13)) w.at(isoDate(c.leftDate), 150, 591.5, 400);
    w.centre(weekStart, 35.4, 117.6, 325.5, 9);
    w.centre(addDays(weekStart, 7), 35.4, 117.6, 308, 9);
  }

  // Attestation des services de garde fournis 2026 — letter, 3 copies, fillable.
  // The three pages share their boxes, so filling once fills all three. Day counts stay blank.
  async function fillAttestation(doc, S, c) {
    const f = formFiller(doc);
    const comb = iso => isoDate(iso).replace(/-/g, '');   // these date boxes take 8 digits, one per square
    const p = payerOf(c), r = S.rsge;
    if (hasPerson(p)) { f.text('S1_NomFamille1', p.last); f.text('S1_Prenom1', p.first); }
    f.text('S2_1_NomFamille1', c.child.last); f.text('S2_1_Prenom1', c.child.first);
    f.text('S2_1_DateNaissance1', comb(c.child.dob));
    f.text('S3_1_DateDebut1', comb(c.startDate));
    f.text('S3_1_DateFin1', comb(c.leftDate));
    f.text('S4_2_Services1', r.last); f.text('S4_2_DivisionNom1', r.first);
    f.text('S4_2_Address1', join(r.street, r.apt ? 'app. ' + r.apt : ''));
    f.text('S4_2_Adresse3', join(r.city + ',', 'Québec'));
    f.text('S4_2_Telephone1', r.phone); f.text('S4_2_CodePostal1', r.postal);
    f.text('S4_2_Office1', S.bcName);
    f.text('S5_NomFamille1', r.last); f.text('S5_Prenom1', r.first);
    f.check('S4_Case2');
    await flatten(doc, f);
  }

  // ---------- assembling the printable file ----------

  async function loadTemplate(load, key) {
    return PDFDocument.load(await load(TEMPLATES[key]), { ignoreEncryption: true, updateMetadata: false });
  }

  // Copies every page of each filled form onto letter paper (shrinking A4 and
  // legal pages evenly to fit), and adds a blank page after any form that ends
  // on a front side, so double-sided printing never puts two forms on one sheet.
  async function assemble(docs) {
    const out = await PDFDocument.create();
    for (let k = 0; k < docs.length; k++) {
      const src = docs[k];
      // The output is for printing: drop leftover annotations (flattening can
      // leave dangling links to the removed form boxes).
      src.getPages().forEach(p => p.node.delete(PDFName.of('Annots')));
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach(page => {
        out.addPage(page);
        const box = page.getMediaBox();
        const sc = Math.min(LETTER[0] / box.width, LETTER[1] / box.height, 1);
        if (box.x || box.y) page.translateContent(-box.x, -box.y);
        if (sc < 1) page.scaleContent(sc, sc);
        page.translateContent((LETTER[0] - box.width * sc) / 2, (LETTER[1] - box.height * sc) / 2);
        page.setMediaBox(0, 0, LETTER[0], LETTER[1]);
        page.setCropBox(0, 0, LETTER[0], LETTER[1]);
        page.setTrimBox(0, 0, LETTER[0], LETTER[1]);
        page.setBleedBox(0, 0, LETTER[0], LETTER[1]);
        page.setArtBox(0, 0, LETTER[0], LETTER[1]);
      });
      if (copied.length % 2 === 1 && k < docs.length - 1) out.addPage(LETTER);
    }
    return out.save();
  }

  async function registrationPackage(load, S, c) {
    const order = [['ententeBC', fillEntenteBC]];
    if (c.includeMinistere) order.push(['ententeMinistere', fillEntenteMinistere]);
    order.push(['renseignements', fillRenseignements], ['contribution', fillContribution], ['fiche', fillFiche]);
    const docs = [];
    for (const [key, fill] of order) {
      const doc = await loadTemplate(load, key);
      await fill(doc, S, c);
      docs.push(doc);
    }
    return assemble(docs);
  }

  async function attendanceSheets(load, S, children, weekStart) {
    const docs = [];
    for (const c of children) {
      const doc = await loadTemplate(load, 'assiduite');
      await fillAssiduite(doc, S, c, weekStart);
      docs.push(doc);
    }
    return assemble(docs);
  }

  async function attestation(load, S, c) {
    const doc = await loadTemplate(load, 'attestation');
    await fillAttestation(doc, S, c);
    return assemble([doc]);
  }

  const api = { TEMPLATES, registrationPackage, attendanceSheets, attestation, addDays, splitPhone, splitStreet };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DaycareForms = api;
})(typeof window !== 'undefined' ? window : globalThis);
