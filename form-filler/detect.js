/* Form Filler — blank detection engine.
   Everything here works in PDF user space: origin bottom-left, y up, units = points.
   No network, no uploads: the file never leaves the device. */

const FF = (() => {
  'use strict';

  const TOL = 2.2;            // how far apart two lines can be and still be "the same" line
  const MIN_RUN = 3;          // underscores in a row before it counts as a blank
  const CB_MIN = 5, CB_MAX = 20;   // a box this size square is a checkbox, not a text field

  // ---------- small matrix helpers (row-vector convention, same as pdf.js) ----------
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  // ---------- geometry gathered from the page's drawing operators ----------
  // Only strokes count as borders. A filled grey rectangle is shading behind a
  // heading, not a table edge — counting it invents lines that split real cells.
  function collectGeometry(opList, OPS, pageW, pageH) {
    const boxes = [], hLines = [], vLines = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];

    const PAINT_STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke,
                                  OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const PAINT_FILL = new Set([OPS.fill, OPS.eoFill]);

    const addSeg = (out, x1, y1, x2, y2) => {
      if (Math.abs(y1 - y2) < 1.2 && Math.abs(x1 - x2) > 4) {
        out.h.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y: (y1 + y2) / 2 });
      } else if (Math.abs(x1 - x2) < 1.2 && Math.abs(y1 - y2) > 4) {
        out.v.push({ y1: Math.min(y1, y2), y2: Math.max(y1, y2), x: (x1 + x2) / 2 });
      }
    };

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i], args = opList.argsArray[i];
      if (fn === OPS.save) { stack.push(ctm.slice()); continue; }
      if (fn === OPS.restore) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
      if (fn === OPS.transform) { ctm = mul(ctm, args.slice(0, 6)); continue; }
      if (fn !== OPS.constructPath) continue;

      const out = { h: [], v: [], rects: [] };
      const ops = args[0], nums = args[1];
      let k = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      for (const op of ops) {
        if (op === OPS.moveTo) { [cx, cy] = apply(ctm, nums[k], nums[k + 1]); sx = cx; sy = cy; k += 2; }
        else if (op === OPS.lineTo) { const [nx, ny] = apply(ctm, nums[k], nums[k + 1]); addSeg(out, cx, cy, nx, ny); cx = nx; cy = ny; k += 2; }
        else if (op === OPS.curveTo) { [cx, cy] = apply(ctm, nums[k + 4], nums[k + 5]); k += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { [cx, cy] = apply(ctm, nums[k + 2], nums[k + 3]); k += 4; }
        else if (op === OPS.closePath) { addSeg(out, cx, cy, sx, sy); cx = sx; cy = sy; }
        else if (op === OPS.rectangle) {
          const x = nums[k], y = nums[k + 1], w = nums[k + 2], h = nums[k + 3]; k += 4;
          const c = [apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + h), apply(ctm, x, y + h)];
          const xs = c.map(q => q[0]), ys = c.map(q => q[1]);
          const rx = Math.min(...xs), ry = Math.min(...ys);
          out.rects.push({ x: rx, y: ry, w: Math.max(...xs) - rx, h: Math.max(...ys) - ry });
        }
      }

      // What was actually painted decides whether this counts as a border.
      let paint = null;
      for (let j = i + 1; j < Math.min(i + 4, opList.fnArray.length); j++) {
        if (PAINT_STROKE.has(opList.fnArray[j])) { paint = 'stroke'; break; }
        if (PAINT_FILL.has(opList.fnArray[j])) { paint = 'fill'; break; }
        if (opList.fnArray[j] === OPS.constructPath) break;
      }
      if (!paint) continue;

      for (const r of out.rects) {
        if (pageW && r.w > pageW * 0.9 && r.h > pageH * 0.9) continue;   // background wash
        if (r.h < 2 && r.w > 4) hLines.push({ x1: r.x, x2: r.x + r.w, y: r.y + r.h / 2 });
        else if (r.w < 2 && r.h > 4) vLines.push({ y1: r.y, y2: r.y + r.h, x: r.x + r.w / 2 });
        else if (paint === 'stroke' && r.w > 4 && r.h > 4) {
          boxes.push(r);
          hLines.push({ x1: r.x, x2: r.x + r.w, y: r.y });
          hLines.push({ x1: r.x, x2: r.x + r.w, y: r.y + r.h });
          vLines.push({ y1: r.y, y2: r.y + r.h, x: r.x });
          vLines.push({ y1: r.y, y2: r.y + r.h, x: r.x + r.w });
        }
      }
      if (paint === 'stroke') { hLines.push(...out.h); vLines.push(...out.v); }
    }
    return { boxes, hLines, vLines };
  }

  // ---------- text: where the words are, and where the underscore blanks are ----------
  function collectText(textContent) {
    const items = [], blanks = [];
    for (const it of textContent.items) {
      if (!it.str || !it.transform) continue;
      const t = it.transform;
      const size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 10;
      const x = t[4], y = t[5], w = it.width || 0;
      if (it.str.trim()) items.push({ x, y, w, h: size, str: it.str });

      // Underscore runs become text fields. Width is apportioned by character
      // count — close enough to land on the line, and the preview lets you nudge.
      const re = /_{3,}/g;
      let m;
      while ((m = re.exec(it.str)) !== null) {
        if (!w || !it.str.length) continue;
        const per = w / it.str.length;
        const bx = x + per * m.index;
        const bw = per * m[0].length;
        if (bw > 8) blanks.push({ x: bx, y: y - size * 0.28, w: bw, h: size * 1.25, src: 'underscores' });
      }
    }
    // pdf.js often chops one long line of underscores into several items.
    // Anything sitting on the same baseline with barely a gap is one blank.
    blanks.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const merged = [];
    for (const b of blanks) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(prev.y - b.y) < 2 && b.x - (prev.x + prev.w) < 4 && b.x >= prev.x) {
        prev.w = Math.max(prev.w + 0, b.x + b.w - prev.x);
        prev.h = Math.max(prev.h, b.h);
      } else merged.push({ ...b });
    }
    return { items, blanks: merged };
  }

  // ---------- table cells: rebuild the grid from the lines we found ----------
  // Group nearby coordinates into one line. Gap-based, so a long chain of
  // slightly-different values can't drift a cluster away from its own members.
  function cluster(values, tol) {
    const sorted = [...values].sort((a, b) => a - b);
    const groups = [];
    for (const v of sorted) {
      const g = groups[groups.length - 1];
      if (g && v - g[g.length - 1] <= tol) g.push(v);
      else groups.push([v]);
    }
    return groups.map(g => g.reduce((a, b) => a + b, 0) / g.length);
  }

  const snap = (centers, v, tol) => {
    let best, bd = Infinity;
    for (const c of centers) { const d = Math.abs(c - v); if (d < bd) { bd = d; best = c; } }
    return bd <= tol ? best : undefined;
  };

  const MIN_RULE = 13;   // shorter than this and it is a letter stroke, not a table border

  function findCells(geom) {
    const hL = geom.hLines.filter(l => l.x2 - l.x1 >= MIN_RULE);
    const vL = geom.vLines.filter(l => l.y2 - l.y1 >= MIN_RULE);
    const ys = cluster(hL.map(l => l.y), TOL);
    const xs = cluster(vL.map(l => l.x), TOL);
    if (ys.length < 2 || xs.length < 2) return [];

    // Merge every segment sitting on the same line into one set of intervals,
    // so a border drawn cell-by-cell still reads as one continuous rule.
    const bandH = new Map(), bandV = new Map();
    const push = (map, key, a, b) => { if (!map.has(key)) map.set(key, []); map.get(key).push([a, b]); };
    for (const l of hL) {
      const y = snap(ys, l.y, TOL);
      if (y !== undefined) push(bandH, y, l.x1, l.x2);
    }
    for (const l of vL) {
      const x = snap(xs, l.x, TOL);
      if (x !== undefined) push(bandV, x, l.y1, l.y2);
    }
    const merge = list => {
      list.sort((a, b) => a[0] - b[0]);
      const out = [];
      for (const iv of list) {
        const last = out[out.length - 1];
        if (last && iv[0] <= last[1] + TOL) last[1] = Math.max(last[1], iv[1]);
        else out.push([iv[0], iv[1]]);
      }
      return out;
    };
    for (const [k, v] of bandH) bandH.set(k, merge(v));
    for (const [k, v] of bandV) bandV.set(k, merge(v));
    const covers = (map, key, a, b) =>
      (map.get(key) || []).some(iv => iv[0] <= a + TOL && iv[1] >= b - TOL);

    const cells = [];
    for (let r = 0; r < ys.length - 1; r++) {
      const yb = ys[r], yt = ys[r + 1];
      if (yt - yb < 6) continue;
      for (let c = 0; c < xs.length - 1; c++) {
        const xl = xs[c], xr = xs[c + 1];
        if (xr - xl < 6) continue;
        if (covers(bandH, yb, xl, xr) && covers(bandH, yt, xl, xr) &&
            covers(bandV, xl, yb, yt) && covers(bandV, xr, yb, yt)) {
          cells.push({ x: xl, y: yb, w: xr - xl, h: yt - yb });
        }
      }
    }
    return cells;
  }

  // ---------- put it together for one page ----------
  const overlaps = (a, b) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return inter / Math.min(a.w * a.h, b.w * b.h);
  };

  function detectOnPage(textContent, geom, pageW, pageH) {
    const { items, blanks } = collectText(textContent);
    const cells = findCells(geom);
    const out = [];

    for (const b of blanks) out.push({ ...b, type: 'text' });

    const textInside = (c) => items.some(t => {
      const cx = t.x + t.w / 2;
      const tTop = t.y + t.h * 0.75, tBot = t.y - t.h * 0.2;
      const overlap = Math.min(tTop, c.y + c.h) - Math.max(tBot, c.y);
      return cx > c.x - 1 && cx < c.x + c.w + 1 && overlap > Math.min(t.h, c.h) * 0.35;
    });

    for (const b of geom.boxes) {
      const square = Math.abs(b.w - b.h) < Math.max(b.w, b.h) * 0.45;
      if (square && b.w >= CB_MIN && b.w <= CB_MAX && b.h >= CB_MIN && b.h <= CB_MAX && !textInside(b)) {
        out.push({ x: b.x, y: b.y, w: b.w, h: b.h, type: 'check', src: 'checkbox' });
      }
    }

    for (const c of cells) {
      if (textInside(c)) continue;                                   // a label, not a blank
      if (c.w > pageW * 0.92 && c.h > pageH * 0.5) continue;         // the page border itself
      const square = Math.abs(c.w - c.h) < Math.max(c.w, c.h) * 0.45;
      const isCheck = square && c.w >= CB_MIN && c.w <= CB_MAX && c.h >= CB_MIN && c.h <= CB_MAX;
      out.push({
        x: c.x + 1, y: c.y + 1, w: c.w - 2, h: c.h - 2,
        type: isCheck ? 'check' : 'text', src: isCheck ? 'checkbox' : 'cell',
      });
    }

    // A bare rule with a label to its left is a fill-in line (a signature line, say).
    // Anything that is really a table border or a box edge is left alone.
    const gridY = new Set(), gridX = new Set();
    for (const c of cells) {
      gridY.add(Math.round(c.y)); gridY.add(Math.round(c.y + c.h));
      gridX.add(Math.round(c.x)); gridX.add(Math.round(c.x + c.w));
    }
    const nearGridY = y => [...gridY].some(v => Math.abs(v - y) <= TOL + 1);
    const boxEdge = l => geom.boxes.some(b =>
      (Math.abs(b.y - l.y) <= TOL || Math.abs(b.y + b.h - l.y) <= TOL) &&
      b.x <= l.x1 + TOL && b.x + b.w >= l.x2 - TOL);

    // A rule with a vertical line standing on either end is the edge of a box or
    // a table, not somewhere to write. A real fill-in line has open ends.
    const cornered = l => geom.vLines.some(v =>
      (Math.abs(v.x - l.x1) <= TOL || Math.abs(v.x - l.x2) <= TOL) &&
      v.y1 - TOL <= l.y && v.y2 + TOL >= l.y && v.y2 - v.y1 > 4);

    for (const l of geom.hLines) {
      const w = l.x2 - l.x1;
      if (w < 40 || w > pageW * 0.6) continue;
      if (nearGridY(l.y) || boxEdge(l) || cornered(l)) continue;
      const cand = { x: l.x1, y: l.y, w, h: 13, type: 'text', src: 'rule' };
      if (out.some(f => overlaps(f, cand) > 0.2)) continue;
      if (cells.some(c => overlaps(c, cand) > 0.2)) continue;
      // must not have words already sitting on it
      if (items.some(t => Math.abs(t.y - l.y) < 4 && t.x < l.x2 - 2 && t.x + t.w > l.x1 + 2)) continue;
      out.push(cand);
    }

    // Drop near-duplicates, keeping the larger one.
    const keep = [];
    out.sort((a, b) => b.w * b.h - a.w * a.h);
    for (const f of out) {
      if (keep.some(k => overlaps(k, f) > 0.5)) continue;
      if (f.w < 8 || f.h < 6) continue;
      keep.push(f);
    }
    return keep;
  }

  // ---------- reading order ----------
  // Rows first. Then, inside a run of rows that clearly sits in two columns,
  // the WHOLE left column is filled before the right one — Moshe's rule.
  function orderFields(fields, pageW, mode) {
    if (!fields.length) return fields;
    const f = fields.map((x, i) => ({ ...x, _i: i }));
    f.sort((a, b) => (b.y + b.h / 2) - (a.y + a.h / 2));

    const rows = [];
    for (const fld of f) {
      const cy = fld.y + fld.h / 2;
      const row = rows.find(r => Math.abs(r.cy - cy) < Math.max(8, fld.h * 0.7));
      if (row) { row.items.push(fld); row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length; }
      else rows.push({ cy, items: [fld] });
    }
    rows.sort((a, b) => b.cy - a.cy);
    for (const r of rows) r.items.sort((a, b) => a.x - b.x);

    if (mode === 'across') return rows.flatMap(r => r.items);

    // A row with a handful of fields is a table row: it spans the whole width and
    // would hide the gap between two columns, so it is left out of the reckoning.
    const wide = r => r.items.length >= 4;
    const narrow = rows.filter(r => !wide(r)).flatMap(r => r.items);
    const split = findSplit(narrow, pageW);

    const twoCol = r => !wide(r) && r.items.length >= 2 && r.items.length <= 3 &&
      r.items.some(i => i.x + i.w <= split) && r.items.some(i => i.x >= split) &&
      !r.items.some(i => i.x < split && i.x + i.w > split);

    const out = [];
    let i = 0;
    while (i < rows.length) {
      const forced = mode === 'down';
      const joins = r => twoCol(r) || (forced && !wide(r) && r.items.length >= 2 &&
        !r.items.some(x => x.x < split && x.x + x.w > split));
      if (split && joins(rows[i])) {
        let j = i + 1;
        // Keep taking rows while they belong to the same block. A gap much bigger
        // than the block's own line spacing means a new section has started.
        const gaps = [];
        while (j < rows.length && joins(rows[j])) {
          const gap = rows[j - 1].cy - rows[j].cy;
          const typical = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : gap;
          if (gaps.length && gap > typical * 1.8) break;
          gaps.push(gap);
          j++;
        }
        const block = rows.slice(i, j);
        // The whole left column first, then the whole right column.
        for (const it of block) out.push(...it.items.filter(x => x.x + x.w / 2 < split));
        for (const it of block) out.push(...it.items.filter(x => x.x + x.w / 2 >= split));
        i = j;
      } else {
        out.push(...rows[i].items);
        i++;
      }
    }
    return out;
  }

  function findSplit(fields, pageW) {
    const lo = pageW * 0.3, hi = pageW * 0.7;
    let best = null, bestGap = 0;
    for (let x = lo; x <= hi; x += 2) {
      if (fields.some(f => f.x < x && f.x + f.w > x)) continue;
      let g = 2;
      while (x + g <= hi && !fields.some(f => f.x < x + g && f.x + f.w > x + g)) g += 2;
      if (g > bestGap) { bestGap = g; best = x + g / 2; }
      x += g;
    }
    const leftCount = fields.filter(f => f.x + f.w / 2 < best).length;
    const rightCount = fields.length - leftCount;
    if (bestGap < 12 || leftCount < 2 || rightCount < 2) return null;
    return best;
  }

  return { collectGeometry, collectText, detectOnPage, orderFields, findSplit };
})();
