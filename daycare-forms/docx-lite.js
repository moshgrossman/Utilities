/* Docx-lite: writes and reads a tiny Word (.docx) file that holds one table of "label | value" rows.
   No libraries, works offline. Used by the parent page (to write) and by the app (to read). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DocxLite = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const MAX_ZIP = 8 * 1024 * 1024, MAX_XML = 8 * 1024 * 1024;

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const concat = parts => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; }); return out;
  };

  // ---- zip (stored, no compression: the file is tiny) ----
  function zipStore(files) {
    const parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    return concat([...parts, ...central, new Uint8Array(e.buffer)]);
  }

  async function inflateRaw(raw) {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    if (buf.byteLength > MAX_XML) throw new Error('File is too big');
    return new Uint8Array(buf);
  }

  // Finds one file inside a zip and returns its bytes (handles stored and deflated, like Word saves).
  async function zipGet(bytes, wanted) {
    if (bytes.length > MAX_ZIP) throw new Error('File is too big');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let e = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Not a Word file');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    for (let k = 0; k < n; k++) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged file');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      if (name === wanted) {
        const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
        const start = lho + 30 + lnl + lel;
        const raw = bytes.subarray(start, start + csize);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error('Unsupported file');
      }
      p += 46 + nlen + elen + clen;
    }
    return null;
  }

  // ---- writing ----
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const para = (text, o = {}) => '<w:p><w:r><w:rPr>' + (o.bold ? '<w:b/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') +
    '<w:sz w:val="' + (o.size || 22) + '"/></w:rPr><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:p>';
  const cell = (text, w, o = {}) => '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (o.span ? '<w:gridSpan w:val="2"/>' : '') +
    (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="E6E6E6"/>' : '') + '</w:tcPr>' + para(text, o) + '</w:tc>';

  // spec: { title, intro: [text...], rows: [[label, value] | [heading]] }
  function makeDocx(spec) {
    const border = side => '<w:' + side + ' w:val="single" w:sz="4" w:space="0" w:color="999999"/>';
    const rows = spec.rows.map(r => r.length === 1
      ? '<w:tr>' + cell(r[0], 9360, { span: true, bold: true, shade: true }) + '</w:tr>'
      : '<w:tr>' + cell(r[0], 4000, { bold: true }) + cell(r[1], 5360) + '</w:tr>').join('');
    const body = para(spec.title, { bold: true, size: 32 }) + (spec.intro || []).map(t => para(t, { color: '555555' })).join('') +
      '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') +
      '</w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="5360"/></w:tblGrid>' + rows + '</w:tbl>' +
      para('Send this file to your daycare as it is.', { color: '777777', size: 18 }) +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    return zipStore([
      { name: '[Content_Types].xml', data: enc.encode(X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
      { name: '_rels/.rels', data: enc.encode(X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
      { name: 'word/document.xml', data: enc.encode(X + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>') },
    ]);
  }

  // ---- reading ----
  const unesc = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  function cellText(tc) {
    return (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(p =>
      unesc((p.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>|<w:tab\/>/g) || []).map(t => t === '<w:tab/>' ? ' ' : t.replace(/<[^>]*>/g, '')).join('')).trim()
    ).filter(Boolean).join(' ').trim();
  }
  // Returns the table rows as arrays of cell texts.
  async function readDocxRows(bytes) {
    const xmlBytes = await zipGet(bytes, 'word/document.xml');
    if (!xmlBytes) throw new Error('Not a Word file');
    const xml = dec.decode(xmlBytes);
    return (xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map(tr => (tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || []).map(cellText));
  }

  return { makeDocx, readDocxRows };
});
