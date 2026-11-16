// parse.js — dependency-free Markdown renderer, byte-identical to marked 18.1.3
// (default options, GFM on). Written from scratch.
//
// Layout: a line-based block parser (CommonMark block structure + GFM tables
// and task lists) builds a small block tree and collects link reference
// definitions; a single-pass inline scanner with a delimiter stack renders
// inline HTML directly into chunk arrays.

// ------------------------------------------------------------------ helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// "noEncode" escape: & is escaped only when it is NOT part of an entity-like
// sequence &#digits; / &#xhex; / &word;  (this is what marked does in text,
// hrefs, titles and fence info strings).
const NOENC_RE = /[<>"']|&(?!(?:#\d{1,7}|#[Xx][0-9A-Fa-f]{1,6}|\w+);)/g;
function esc(s) {
  return NOENC_RE.test(s) ? s.replace(NOENC_RE, (c) => ESC[c]) : s;
}
const ENC_RE = /[&<>"']/g;
function escFull(s) {
  return ENC_RE.test(s) ? s.replace(ENC_RE, (c) => ESC[c]) : s;
}
// Numeric character references: &#123; &#x1F600; -> the character
// (0, surrogates and > 0x10FFFF become U+FFFD). Named entities are NOT
// decoded; they pass through verbatim via esc().
const NUMDEC_RE = /&(?:#([0-9]{1,7})|#[Xx]([0-9A-Fa-f]{1,6}));/g;
function decodeNumeric(s) {
  if (s.indexOf('&#') < 0) return s;
  return s.replace(NUMDEC_RE, (m, dec, hex) => {
    let cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
    return String.fromCodePoint(cp);
  });
}

function isSpaceCode(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 ||
    c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x202f || c === 0x205f || c === 0x3000;
}
function isPunctCode(c) {
  if (c < 128) {
    return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
      (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
  }
  return (c >= 0x2000 && c <= 0x206f) || (c >= 0x2e00 && c <= 0x2e7f) ||
    (c >= 0x3000 && c <= 0x303f) || (c >= 0xfe10 && c <= 0xfe19) ||
    (c >= 0xfe30 && c <= 0xfe52) || (c >= 0xfe54 && c <= 0xfe61) ||
    (c >= 0xfe68 && c <= 0xfe6b) || (c >= 0xff01 && c <= 0xff0f) ||
    (c >= 0xff1a && c <= 0xff20) || (c >= 0xff3b && c <= 0xff40) ||
    (c >= 0xff5b && c <= 0xff65) ||
    // Unicode general category S (symbols) also counts as punctuation:
    // currency, math, modifier and other symbols
    (c >= 0x00a2 && c <= 0x00a5) || c === 0x00a6 || c === 0x00a8 ||
    c === 0x00a9 || c === 0x00ac || c === 0x00ae || c === 0x00af ||
    c === 0x00b0 || c === 0x00b1 || c === 0x00b4 || c === 0x00b8 ||
    c === 0x00d7 || c === 0x00f7 || (c >= 0x02c2 && c <= 0x02c5) ||
    (c >= 0x02d2 && c <= 0x02df) || (c >= 0x02e5 && c <= 0x02eb) ||
    c === 0x02ed || (c >= 0x02ef && c <= 0x02ff) || c === 0x0375 ||
    (c >= 0x0384 && c <= 0x0385) || (c >= 0x20a0 && c <= 0x20bf) ||
    (c >= 0x2100 && c <= 0x214f) || (c >= 0x2190 && c <= 0x21ff) ||
    (c >= 0x2200 && c <= 0x22ff) || (c >= 0x2300 && c <= 0x23ff) ||
    (c >= 0x24b6 && c <= 0x24ff) || (c >= 0x2500 && c <= 0x25ff) ||
    (c >= 0x2600 && c <= 0x27bf) || (c >= 0x27c0 && c <= 0x27c4) ||
    (c >= 0x27c6 && c <= 0x27ca) || c === 0x27cc ||
    (c >= 0x27d0 && c <= 0x27e5) || (c >= 0x27f0 && c <= 0x27ff) ||
    (c >= 0x2900 && c <= 0x2aff) || (c >= 0x2b00 && c <= 0x2bff) ||
    c === 0xfe69 || c === 0xff04 || c === 0xffe0 || c === 0xffe1 ||
    c === 0xffe5 || c === 0xffe6 || c === 0x00a1 || c === 0x00a7 ||
    c === 0x00ab || c === 0x00b6 || c === 0x00b7 || c === 0x00bb ||
    c === 0x00bf || c === 0x037e || c === 0x0387 ||
    (c >= 0x055a && c <= 0x055f) || c === 0x0589 || c === 0x058a ||
    c === 0x05be || c === 0x05c0 || c === 0x05c3 || c === 0x05c6 ||
    c === 0x05f3 || c === 0x05f4 || c === 0x0609 || c === 0x060a ||
    c === 0x060c || c === 0x060d || c === 0x061b || c === 0x061e ||
    c === 0x061f || (c >= 0x066a && c <= 0x066d) || c === 0x06d4 ||
    c === 0x06dd || c === 0x06de || c === 0x06e9 || c === 0x06fd ||
    c === 0x06fe || (c >= 0x07f7 && c <= 0x07f9) || c === 0x085e ||
    c === 0x08e2 || c === 0x0964 || c === 0x0965 || c === 0x0970 ||
    c === 0x09fd || c === 0x0a76 || c === 0x0af0 || c === 0x0df4 ||
    c === 0x0e4f || c === 0x0e5a || c === 0x0e5b ||
    (c >= 0x0f01 && c <= 0x0f17) || (c >= 0x0f3a && c <= 0x0f3d) ||
    c === 0x0f85 || (c >= 0x0fbe && c <= 0x0fc5) ||
    (c >= 0x104a && c <= 0x104f) || c === 0x10fb ||
    (c >= 0x1360 && c <= 0x1368) || (c >= 0x1390 && c <= 0x1399) ||
    c === 0x166d || c === 0x166e || c === 0x169b || c === 0x169c ||
    (c >= 0x16eb && c <= 0x16ed) || c === 0x1735 || c === 0x1736 ||
    (c >= 0x17d4 && c <= 0x17d6) || (c >= 0x17d8 && c <= 0x17da) ||
    (c >= 0x1800 && c <= 0x180a) || c === 0x1944 || c === 0x1945 ||
    c === 0x1a1e || c === 0x1a1f || (c >= 0x1aa0 && c <= 0x1aa6) ||
    (c >= 0x1aa8 && c <= 0x1aad);
}
function isAlphaCode(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function isAlnumCode(c) {
  return (c >= 48 && c <= 57) || isAlphaCode(c);
}
function isDigitCode(c) {
  return c >= 48 && c <= 57;
}
function isHexCode(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}
// ASCII punctuation that can be backslash-escaped (CommonMark 2.1).
function isEscapable(c) {
  return c < 128 && isPunctCode(c);
}

// ------------------------------------------------- link labels / references

function normalizeLabel(label) {
  // strip leading/trailing whitespace, collapse internal whitespace runs
  // to a single space, case-fold (Unicode: ß/ẞ fold to "ss", cm-540)
  return label.replace(/[\s]+/g, ' ').trim().toLowerCase().replace(/\u00df/g, 'ss');
}

// Parse a link label starting at s[i] === '['. Returns {label, end} where
// end is the index just past ']', or null. Labels may not contain an
// unescaped '[' and are at most 999 characters.
function parseLabel(s, i) {
  const n = s.length;
  let j = i + 1;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 92) { // backslash: skip next char
      j += 2;
      continue;
    }
    if (c === 91) return null; // '[' inside a label is not allowed
    if (c === 93) { // ']'
      const raw = s.slice(i + 1, j);
      if (raw.length === 0 || raw.length > 999) return null;
      const label = normalizeLabel(raw);
      if (label.length === 0) return null;
      return { label, end: j + 1 };
    }
    j++;
  }
  return null;
}

// Resolve backslash escapes in a destination/title: \ + ASCII punctuation
// -> the punctuation; anything else stays as-is.
function unescapeStr(s) {
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < n && isEscapable(s.charCodeAt(i + 1))) {
      out += s[i + 1];
      i += 2;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}

// Parse a link destination at s[i]. Returns {dest, end} or null.
// dest is the unescaped destination string; end is the index just past it.
function parseDestination(s, i) {
  const n = s.length;
  if (i >= n) return null;
  if (s.charCodeAt(i) === 60) { // '<...>'
    let j = i + 1;
    let raw = '';
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === 10) return null;
      if (c === 60) return null; // unescaped '<' not allowed
      if (c === 62) return { dest: unescapeStr(raw), end: j + 1 };
      if (c === 92 && j + 1 < n && isEscapable(s.charCodeAt(j + 1))) {
        raw += s[j + 1];
        j += 2;
      } else {
        raw += s[j];
        j++;
      }
    }
    return null;
  }
  // bare destination: no spaces/control chars; parens must balance
  let j = i;
  let depth = 0;
  let raw = '';
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c < 32 || c === 127) break;
    if (c === 92 && j + 1 < n && isEscapable(s.charCodeAt(j + 1))) {
      raw += s[j + 1];
      j += 2;
      continue;
    }
    if (c === 40) depth++;
    else if (c === 41) {
      if (depth === 0) break;
      depth--;
    }
    raw += s[j];
    j++;
  }
  if (raw.length === 0) {
    // an empty destination is valid only as "()" (cm-485/487)
    if (j < n && s.charCodeAt(j) === 41) return { dest: '', end: j };
    return null;
  }
  if (depth !== 0) return null; // unbalanced '('
  return { dest: raw, end: j };
}

// Parse a link title at s[i] ('"', "'" or '('). Returns {title, end} or null.
function parseTitle(s, i) {
  const n = s.length;
  if (i >= n) return null;
  const c = s.charCodeAt(i);
  if (c === 34 || c === 39) { // " or '
    const q = s[i];
    let j = i + 1;
    let raw = '';
    while (j < n) {
      const ch = s.charCodeAt(j);
      if (ch === 92 && j + 1 < n && (isEscapable(s.charCodeAt(j + 1)) || s.charCodeAt(j + 1) === 10)) {
        if (s.charCodeAt(j + 1) === 10) { raw += '\n'; j += 2; continue; }
        raw += s[j + 1];
        j += 2;
        continue;
      }
      if (s[j] === q) return { title: raw, end: j + 1 };
      raw += s[j];
      j++;
    }
    return null;
  }
  if (c === 40) { // (...)
    let j = i + 1;
    let raw = '';
    while (j < n) {
      const ch = s.charCodeAt(j);
      if (ch === 92 && j + 1 < n && isEscapable(s.charCodeAt(j + 1))) {
        raw += s[j + 1];
        j += 2;
        continue;
      }
      if (ch === 40) return null; // unescaped '(' not allowed inside
      if (ch === 41) return { title: raw, end: j + 1 };
      raw += s[j];
      j++;
    }
    return null;
  }
  return null;
}

// Try to parse a link reference definition starting at s[pos] (pos is at the
// start of a line, allowing up to 3 spaces of indent). Returns
// {label, dest, title, end} where end is the index just past the definition
// (at a newline or EOF), or null.
function parseDef(s, pos) {
  const n = s.length;
  let i = pos;
  // up to 3 spaces of indent (a tab counts as advancing to the next tab stop)
  let col = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 32) { col++; i++; }
    else if (c === 9) { col += 4 - (col % 4); i++; }
    else break;
    if (col > 3) return null;
  }
  if (i >= n || s.charCodeAt(i) !== 91) return null; // '['
  const lab = parseLabel(s, i);
  if (!lab) return null;
  i = lab.end;
  if (i >= n || s.charCodeAt(i) !== 58) return null; // ':'
  i++;
  // skip spaces/tabs, then at most one newline, then spaces/tabs
  let j = i;
  while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
  if (j < n && s.charCodeAt(j) === 10) {
    j++;
    while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
  }
  const dest = parseDestination(s, j);
  if (!dest) return null;
  i = dest.end;
  // skip spaces/tabs on the same line
  j = i;
  while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
  if (j >= n) return { label: lab.label, dest: dest.dest, title: null, end: j };
  if (s.charCodeAt(j) === 10) {
    // the destination's line ends here. A title may follow on the next
    // line; if it does not parse cleanly, the definition still stands
    // without it and the title line stays as paragraph text.
    let k = j + 1;
    while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
    if (k < n && s.charCodeAt(k) !== 10) {
      const qc = s.charCodeAt(k);
      if (qc === 34 || qc === 39 || qc === 40) {
        const t = parseTitle(s, k);
        if (t) {
          let e = t.end;
          while (e < n && (s.charCodeAt(e) === 32 || s.charCodeAt(e) === 9)) e++;
          if (e >= n) return { label: lab.label, dest: dest.dest, title: t.title, end: e };
          if (s.charCodeAt(e) === 10) return { label: lab.label, dest: dest.dest, title: t.title, end: e };
        }
      }
    }
    return { label: lab.label, dest: dest.dest, title: null, end: j };
  }
  // same line: a title must follow (separated by whitespace) and end the
  // line cleanly, otherwise the definition is invalid.
  if (j === i) return null; // no whitespace between destination and title
  const qc = s.charCodeAt(j);
  if (qc !== 34 && qc !== 39 && qc !== 40) return null;
  const t = parseTitle(s, j);
  if (!t) return null;
  let e = t.end;
  while (e < n && (s.charCodeAt(e) === 32 || s.charCodeAt(e) === 9)) e++;
  if (e >= n) return { label: lab.label, dest: dest.dest, title: t.title, end: e };
  if (s.charCodeAt(e) === 10) return { label: lab.label, dest: dest.dest, title: t.title, end: e };
  return null;
}

// ------------------------------------------------------------ block parser

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param section source summary table tbody td tfoot th thead title tr track ul').split(' '));

// Split a table row into cells (unescaped '|' separates). Returns null when
// the row contains no '|' at all.
function splitRow(line) {
  if (line.indexOf('|') < 0) return null;
  const cells = [];
  let cur = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (c === 92 && i + 1 < n && isEscapable(line.charCodeAt(i + 1))) {
      // an escaped pipe is a literal pipe in the cell (gfm-200: a code
      // span containing "\|" must render "|", so drop the backslash here)
      if (line.charCodeAt(i + 1) === 124) { cur += '|'; i += 2; continue; }
      cur += line[i] + line[i + 1];
      i += 2;
      continue;
    }
    if (c === 124) {
      cells.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += line[i];
    i++;
  }
  cells.push(cur.trim());
  // drop a leading empty cell when the row starts with '|' (possibly
  // after leading whitespace, doc-02 " | import public | ...") and a
  // trailing empty cell when it ends with '|' (possibly before trailing
  // whitespace)
  let start = 0;
  while (start < n && (line.charCodeAt(start) === 32 || line.charCodeAt(start) === 9)) start++;
  if (start < n && line.charCodeAt(start) === 124 && cells.length > 0 && cells[0] === '') cells.shift();
  let end = n - 1;
  while (end >= 0 && (line.charCodeAt(end) === 32 || line.charCodeAt(end) === 9)) end--;
  if (end >= 0 && line.charCodeAt(end) === 124 && cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

// Parse a table delimiter row. Returns the alignment array or null.
function parseDelimiterRow(line) {
  const cells = splitRow(line);
  if (cells === null) return null;
  const aligns = [];
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    let m = /^(:?)-+(:?)$/.exec(c);
    if (!m) return null;
    aligns.push(m[1] === ':' && m[2] === ':' ? 'center' : m[1] === ':' ? 'left' : m[2] === ':' ? 'right' : null);
  }
  return aligns;
}

function parseBlocks(src) {
  const refs = new Map();
  const doc = { t: 'doc', ch: [] };
  const stack = [doc];
  const lines = src.split('\n');
  if (src.length > 0 && src.charCodeAt(src.length - 1) === 10) lines.pop();
  // true when the previous line was a structural blank line (used to
  // mark the previous list item loose when a new item follows, cm-326)
  let blankBefore = false;

  const L = { s: '', off: 0, col: 0, ptab: false, nn: -1, nnOff: 0, nnCol: 0, ind: 0, bqCol: 0 };

  function peek() { return L.off < L.s.length ? L.s.charCodeAt(L.off) : -1; }
  function adv(n) {
    while (n > 0 && L.off < L.s.length) {
      if (L.ptab) { L.col += 4 - (L.col % 4); L.off++; L.ptab = false; }
      else if (L.s.charCodeAt(L.off) === 9) { L.col += 4 - (L.col % 4); L.off++; }
      else { L.col++; L.off++; }
      n--;
    }
  }
  function advCols(n) {
    const target = L.col + n;
    while (L.col < target && L.off < L.s.length) {
      if (L.ptab) {
        const rem = 4 - (L.col % 4);
        if (L.col + rem > target) { L.col = target; }
        else { L.col += rem; L.off++; L.ptab = false; }
      } else if (L.s.charCodeAt(L.off) === 9) {
        const w = 4 - (L.col % 4);
        if (L.col + w > target) { L.col = target; L.ptab = true; }
        else { L.col += w; L.off++; }
      } else { L.col++; L.off++; }
    }
  }
  // Advance up to n columns, but only over whitespace (for fenced-code
  // dedent: a content line with less indent than the fence keeps its text).
  function dedentCols(n) {
    const target = L.col + n;
    while (L.col < target && L.off < L.s.length) {
      if (L.ptab) {
        const rem = 4 - (L.col % 4);
        if (L.col + rem > target) { L.col = target; }
        else { L.col += rem; L.off++; L.ptab = false; }
      } else if (L.s.charCodeAt(L.off) === 9) {
        const w = 4 - (L.col % 4);
        if (L.col + w > target) { L.col = target; L.ptab = true; }
        else { L.col += w; L.off++; }
      } else if (L.s.charCodeAt(L.off) === 32) { L.col++; L.off++; }
      else break;
    }
  }
  // Measure the indent to the next non-space character (no advancing).
  function measure() {
    let off = L.off, col = L.col;
    if (L.ptab) { col += 4 - (col % 4); off++; }
    while (off < L.s.length) {
      const c = L.s.charCodeAt(off);
      if (c === 32) { col++; off++; }
      else if (c === 9) { col += 4 - (col % 4); off++; }
      else break;
    }
    L.nn = off < L.s.length ? L.s.charCodeAt(off) : -1;
    L.nnOff = off;
    L.nnCol = col;
    L.ind = col - L.col;
  }
  // noExpand: for indented code content, a fresh tab after the 4-space
  // dedent stays a literal tab (doc-02/doc-06); fenced code expands it.
  function lineContent(noExpand) {
    if (L.ptab) return ' '.repeat(4 - (L.col % 4)) + L.s.slice(L.off + 1);
    // a tab at the current position expands to the next tab stop, except
    // when it is the very first character of the source line (a tab at
    // col 0 in a top-level fenced code block stays a literal tab, doc-01
    // toml; a tab after some indent expands, doc-02/doc-06 fenced).
    // The tab-stop column is measured from the innermost '>' marker
    // (L.bqCol), so a tab inside a blockquote expands relative to it.
    if (!noExpand && L.off < L.s.length && L.s.charCodeAt(L.off) === 9 && L.off > 0) {
      const ecol = L.col - L.bqCol;
      return ' '.repeat(4 - (ecol % 4)) + L.s.slice(L.off + 1);
    }
    return L.s.slice(L.off);
  }
  function tip() { return stack[stack.length - 1]; }
  function openNode(node) { tip().ch.push(node); stack.push(node); }

  // Parse link reference definitions from the start of a paragraph's text,
  // registering them in refs and removing them from the node's lines.
  // Returns true if any definition was consumed.
  function stripDefsFromPara(node) {
    const str = node.lines.join('\n');
    let pos = 0, consumed = false;
    while (true) {
      const d = parseDef(str, pos);
      if (!d) break;
      if (!refs.has(d.label)) refs.set(d.label, { href: d.dest, title: d.title });
      pos = d.end;
      if (pos < str.length && str.charCodeAt(pos) === 10) pos++;
      consumed = true;
    }
    if (consumed) {
      const rest = str.slice(pos);
      if (rest.replace(/[\s]+/g, '') === '') node.lines = [];
      else node.lines = rest.split('\n');
    }
    return consumed;
  }

  function finalize(node) {
    if (node.t === 'para') {
      stripDefsFromPara(node);
      if (node.lines.length === 0) { node.t = 'none'; return; }
      // GFM table?
      const ls = node.lines;
      if (ls.length >= 2) {
        const hdr = splitRow(ls[0]);
        if (hdr !== null) {
          const al = parseDelimiterRow(ls[1]);
          if (al !== null && al.length === hdr.length) {
            node.t = 'table';
            node.header = hdr;
            node.align = al;
            node.rows = [];
            for (let k = 2; k < ls.length; k++) {
              let row = splitRow(ls[k]);
              if (row === null) row = [ls[k].trim()];
              while (row.length < hdr.length) row.push('');
              if (row.length > hdr.length) row.length = hdr.length;
              node.rows.push(row);
            }
            node.lines = null;
            return;
          }
        }
      }
    } else if (node.t === 'list') {
      let tight = true;
      const items = node.ch;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.lastBlank && i !== items.length - 1) { tight = false; break; }
        const ch = item.ch;
        for (let j = 0; j < ch.length - 1; j++) {
          if (ch[j].lastBlank) { tight = false; break; }
        }
        if (!tight) break;
      }
      node.tight = tight;
    }
  }
  function closeTo(depth) {
    while (stack.length > depth) {
      const node = stack.pop();
      finalize(node);
    }
  }

  // ---- block-start matchers (use L, do not advance it) ----
  function matchAtx() {
    measure();
    if (L.ind >= 4 || L.nn !== 35) return null;
    let i = L.nnOff, n = 0;
    while (i < L.s.length && L.s.charCodeAt(i) === 35) { n++; i++; }
    if (n > 6) return null;
    if (i < L.s.length) {
      const c = L.s.charCodeAt(i);
      if (c !== 32 && c !== 9) return null;
    }
    // content: skip spaces/tabs, strip trailing spaces and closing #'s
    let j = i;
    while (j < L.s.length && (L.s.charCodeAt(j) === 32 || L.s.charCodeAt(j) === 9)) j++;
    let end = L.s.length;
    while (end > j && (L.s.charCodeAt(end - 1) === 32 || L.s.charCodeAt(end - 1) === 9)) end--;
    if (end > j && L.s.charCodeAt(end - 1) === 35) {
      let k = end;
      while (k > j && L.s.charCodeAt(k - 1) === 35) k--;
      if (k >= j && (L.s.charCodeAt(k - 1) === 32 || L.s.charCodeAt(k - 1) === 9)) {
        end = k;
        while (end > j && (L.s.charCodeAt(end - 1) === 32 || L.s.charCodeAt(end - 1) === 9)) end--;
      }
    }
    return { level: n, content: L.s.slice(j, end) };
  }
  function matchFence() {
    measure();
    if (L.ind >= 4 || (L.nn !== 96 && L.nn !== 126)) return null;
    const ch = L.s[L.nnOff];
    let i = L.nnOff, n = 0;
    while (i < L.s.length && L.s[i] === ch) { n++; i++; }
    if (n < 3) return null;
    let info = L.s.slice(i);
    if (ch === '`' && info.indexOf('`') >= 0) return null;
    info = info.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    return { ch, len: n, info, indent: L.ind };
  }
  function matchHtmlStart() {
    measure();
    if (L.ind >= 4 || L.nn !== 60) return 0;
    const s = L.s, i = L.nnOff;
    const sub = s.slice(i, i + 12).toLowerCase();
    // type 1
    if (sub.startsWith('<script') || sub.startsWith('<pre') || sub.startsWith('<style') || sub.startsWith('<textarea')) {
      const name = sub.startsWith('<textarea') ? 9 : sub.startsWith('<script') ? 7 : sub.startsWith('<style') ? 6 : 4;
      const after = s.charCodeAt(i + name);
      if (Number.isNaN(after) || after === 32 || after === 9 || after === 62 || after === 47) return 1;
      return 0;
    }
    if (sub.startsWith('<!--')) return 2;
    if (sub.startsWith('<?')) return 3;
    if (sub.startsWith('<![cdata[')) return 5;
    if (sub.startsWith('<!')) {
      const c = s.charCodeAt(i + 2);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return 4;
      return 0;
    }
    // type 6 / 7: a tag (open or close)
    let j = i + 1, close = false;
    if (s.charCodeAt(j) === 47) { close = true; j++; }
    const c0 = s.charCodeAt(j);
    if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return 0;
    let k = j;
    while (k < s.length) {
      const c = s.charCodeAt(k);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) k++;
      else break;
    }
    const name = s.slice(j, k).toLowerCase();
    const after = s.charCodeAt(k);
    if (!(after === 32 || after === 9 || after === 62 || after === 47 || k >= s.length)) return 0;
    if (BLOCK_TAGS.has(name)) return 6;
    // type 7: complete tag alone on the line, validated by the strict
    // inline tag parser (cm-619: <a h*#ref="hi"> is not a tag)
    const tagEnd = matchHtmlTag(s, i);
    if (tagEnd < 0) return 0;
    let f = tagEnd;
    while (f < s.length && (s.charCodeAt(f) === 32 || s.charCodeAt(f) === 9)) f++;
    if (f < s.length) return 0; // more content after the tag
    return 7;
  }
  function matchThematicBreak() {
    measure();
    if (L.ind >= 4) return false;
    const s = L.s;
    let i = L.nnOff;
    const c = s.charCodeAt(i);
    if (c !== 42 && c !== 45 && c !== 95) return false;
    let n = 0;
    while (i < s.length) {
      const ch = s.charCodeAt(i);
      if (ch === c) { n++; i++; }
      else if (ch === 32 || ch === 9) i++;
      else return false;
    }
    return n >= 3;
  }
  function matchSetext() {
    measure();
    if (L.ind >= 4) return 0;
    const s = L.s;
    let i = L.nnOff;
    const c = s.charCodeAt(i);
    if (c !== 61 && c !== 45) return 0;
    while (i < s.length && s.charCodeAt(i) === c) i++;
    while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
    if (i < s.length) return 0;
    return c === 61 ? 1 : 2;
  }
  // List marker. Returns null or {bullet, delim, start, ci, empty}.
  function matchListMarker() {
    measure();
    if (L.ind >= 4 || L.nn === -1) return null;
    const s = L.s;
    let i = L.nnOff;
    const c = s.charCodeAt(i);
    let bullet = false, delim = '', start = 0, markerLen = 0, marker = '';
    if (c === 45 || c === 43 || c === 42) {
      bullet = true;
      marker = String.fromCharCode(c);
      markerLen = 1;
      i++;
    } else if (c >= 48 && c <= 57) {
      let j = i, num = 0, digits = 0;
      while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) {
        num = num * 10 + (s.charCodeAt(j) - 48);
        digits++;
        j++;
        if (digits > 9) return null;
      }
      if (j >= s.length) return null;
      const d = s.charCodeAt(j);
      if (d !== 46 && d !== 41) return null;
      delim = d === 46 ? '.' : ')';
      marker = delim;
      start = num;
      markerLen = digits + 1;
      i = j + 1;
    } else return null;
    // char after the marker must be space/tab/EOL
    if (i < s.length) {
      const a = s.charCodeAt(i);
      if (a !== 32 && a !== 9) return null;
    }
    // spaces after the marker, in columns
    let col = L.nnCol + markerLen;
    let j = i, spaces = 0, empty = false;
    if (j >= s.length) {
      empty = true;
    } else {
      while (j < s.length) {
        const ch = s.charCodeAt(j);
        if (ch === 32) { spaces++; col++; j++; }
        else if (ch === 9) { const w = 4 - (col % 4); spaces += w; col += w; j++; }
        else break;
      }
      if (j >= s.length) empty = true;
    }
    let ci;
    if (empty) ci = L.nnCol + markerLen + 1;
    else if (spaces >= 1 && spaces <= 4) ci = L.nnCol + markerLen + spaces;
    else ci = L.nnCol + markerLen + 1;
    return { bullet, delim, marker, start, ci, empty };
  }
  // Can this line start a block that interrupts a paragraph?
  function interruptsParagraph() {
    if (matchAtx()) return true;
    if (matchFence()) return true;
    const h = matchHtmlStart();
    if (h >= 1 && h <= 6) return true;
    if (matchThematicBreak()) return true;
    const m = matchListMarker();
    if (m) {
      if (m.empty) return false;
      if (m.bullet) return true;
      return m.start === 1;
    }
    measure();
    if (L.ind < 4 && L.nn === 62) return true;
    return false;
  }
  function tryLazy() {
    // Called when a container failed to match. If the tip is a paragraph and
    // this line is a plain paragraph-continuation line, add it and return true.
    // A line that starts a block which can interrupt a paragraph is not lazy.
    // A setext-looking lazy line is added indented by 4 spaces, so it stays
    // paragraph text instead of becoming a setext underline.
    const t = tip();
    if (t.t !== 'para') return false;
    measure();
    if (L.nn === -1) return false;
    if (interruptsParagraph()) return false;
    // Leading whitespace is stripped only when the lazy line's indent
    // is 4+ columns (the indented-code threshold: cm-238/291/312 and
    // doc-22's '19.' lines). With a smaller indent the spaces are
    // paragraph content and are kept (doc-22's '17.' line keeps 3,
    // doc-25 keeps 1, doc-38 keeps 1).
    let content = lineContent();
    if (L.nnCol - L.col >= 4) content = content.replace(/^[ \t]+/, '');
    if (/^[ \t]*[=-]+[ \t]*$/.test(content)) {
      t.lines.push('    ' + content);
    } else {
      t.lines.push(content);
    }
    t.lastBlank = false;
    return true;
  }
  function htmlEndReached(node, content) {
    const low = content.toLowerCase();
    if (node.htype === 1) {
      return low.indexOf('</script>') >= 0 || low.indexOf('</pre>') >= 0 ||
        low.indexOf('</style>') >= 0 || low.indexOf('</textarea>') >= 0;
    }
    if (node.htype === 2) return low.indexOf('-->') >= 0;
    if (node.htype === 3) return low.indexOf('?>') >= 0;
    if (node.htype === 4) return low.indexOf('>') >= 0;
    if (node.htype === 5) return low.indexOf(']]>') >= 0;
    return false;
  }
  // Close an open paragraph (and then a list) so a new block that interrupts
  // a paragraph / cannot live inside a list becomes a sibling, not a child.
  function closeOpenBlocks() {
    let t = tip();
    if (t.t === 'para') { stack.pop(); finalize(t); t = tip(); }
    if (t.t === 'list') { stack.pop(); finalize(t); }
  }

  // ---- main line loop ----
  for (let li = 0; li < lines.length; li++) {
    L.s = lines[li];
    L.off = 0;
    L.col = 0;
    L.ptab = false;
    L.bqCol = 0;
    const wasBlank = blankBefore;
    blankBefore = false;

    // Phase 1: check open containers
    let depth = 1;
    let failed = false;
    // When the tip is a fenced code block, a LIST ITEM's indent check is
    // ignored for content lines (doc-02: an unindented "function f(a, b) {"
    // inside a ```css fence in a list item stays code content). A
    // BLOCKQUOTE's ">" marker is still required (cm-128/cm-237: a line
    // without ">" is outside the quote, not code content).
    const tipFenced = stack.length > 1 && stack[stack.length - 1].t === 'code' && stack[stack.length - 1].fenced;
    while (depth < stack.length) {
      const b = stack[depth];
      if (b.t === 'bq') {
        measure();
        if (L.ind < 4 && L.nn === 62) {
          // the tab-stop column is measured from the innermost '>'
          // marker (doc-05/08/09: a tab after '> > ' or '  > ' expands
          // as if at col 2, giving 2 spaces; doc-02: '>' at col 0
          // expands as if at col 4, giving 4 spaces)
          L.bqCol = L.col + L.ind;
          advCols(L.ind);
          adv(1);
          if (peek() === 32) adv(1);
          else if (peek() === 9) advCols(1);
          depth++;
          continue;
        }
        failed = true;
        break;
      }
      if (b.t === 'item') {
        measure();
        if (L.nn === -1) { depth++; continue; }
        // the item's content indent is stored relative to the column where
        // the item was opened (after the enclosing containers); compare the
        // line's indent relative to the current position the same way.
        if (L.nnCol - L.col >= b.ci) { advCols(b.ci); depth++; continue; }
        // the fenced-code bypass applies only once the fence already
        // has content (doc-02); a col-0 line right after the fence
        // closes it empty instead (doc-38/17)
        if (tipFenced && stack[stack.length - 1].lines.length > 0) { depth++; continue; }
        failed = true;
        break;
      }
      if (b.t === 'list') { depth++; continue; }
      break;
    }
    if (failed) {
      // A list-marker line is never a lazy continuation of a paragraph
      // inside a list item: it starts a sibling item or a new list.
      let skipLazy = false;
      if (depth < stack.length && stack[depth].t === 'item') {
        measure();
        if (matchListMarker()) skipLazy = true;
      }
      if (!skipLazy && tryLazy()) continue;
      closeTo(depth);
    }

    // Phase 2: open new blocks
    let opened = false; // a container was opened on this line already
    while (true) {
      let t = tip();
      measure();
      // A line is blank when the remainder after the containers is empty,
      // or when the source line itself is whitespace-only. A line such as
      // ">  " (a blockquote marker plus two spaces) is NOT blank: its
      // remainder is a single space, which belongs to the paragraph.
      const lineIsBlank = L.off >= L.s.length || /^[ \t]*$/.test(L.s);
      if (lineIsBlank && !opened) {
        // blank line. A "structural" blank line (the source line itself is
        // whitespace-only) separates blocks; a line such as "  >" whose
        // remainder is empty after the containers is a container line with
        // empty content and does NOT separate outer items (cm-320).
        const srcBlank = /^[ \t]*$/.test(L.s);
        // doc-02/doc-03: a whitespace-only line CONTAINING A TAB (e.g. a
        // lone tab) inside a table paragraph is a body row (empty cells),
        // not a paragraph break; a spaces-only or truly empty line ends
        // the table.
        if (t.t === 'para' && L.s.indexOf('\t') >= 0 && t.lines.length >= 2) {
          const hdr0 = splitRow(t.lines[0]);
          const al0 = hdr0 !== null ? parseDelimiterRow(t.lines[1]) : null;
          if (al0 !== null && al0.length === hdr0.length) {
            t.lines.push(lineContent());
            break;
          }
        }
        if (t.t === 'para') {
          t.lastBlank = true;
          stack.pop();
          finalize(t);
          if (srcBlank) blankBefore = true;
          const nt = tip();
          nt.lastBlank = true;
          // cm-325: a blank line inside an item also marks the item's
          // parent list, so a list whose item holds two blocks separated
          // by a blank line is loose
          if (nt.t === 'item') {
            const p = stack[stack.length - 2];
            if (p && p.t === 'list') p.lastBlank = true;
          }
        } else if (t.t === 'item' && t.ch.length === 0) {
          // an empty list item is closed by a blank line
          t.lastBlank = true;
          stack.pop();
          finalize(t);
          if (srcBlank) blankBefore = true;
          tip().lastBlank = true;
        } else if (t.t === 'code') {
          advCols(t.fenced ? t.findent : 4);
          t.lines.push(lineContent());
        } else if (t.t === 'html') {
          if (t.htype === 6 || t.htype === 7) {
            stack.pop();
            finalize(t);
            if (srcBlank) blankBefore = true;
            tip().lastBlank = true;
          } else {
            t.lines.push(lineContent());
            t.lastLine = li;
          }
        } else {
          // a blank line after a container: mark the container and its
          // last child, so a list whose item holds two blocks separated
          // by a blank line is loose
          if (srcBlank) blankBefore = true;
          t.lastBlank = true;
          const ch = t.ch;
          if (ch.length > 0) ch[ch.length - 1].lastBlank = true;
          if (t.t === 'item') {
            const p = stack[stack.length - 2];
            if (p && p.t === 'list') p.lastBlank = true;
          }
        }
        break;
      }
      // a fenced code block: check for the closing fence
      if (t.t === 'code' && t.fenced) {
        measure();
        if (L.ind < 4 && L.nn === t.fch) {
          let i = L.nnOff, n = 0;
          while (i < L.s.length && L.s.charCodeAt(i) === t.fch) { n++; i++; }
          let ok = n >= t.flen;
          while (ok && i < L.s.length) {
            const c = L.s.charCodeAt(i);
            if (c === 32 || c === 9) i++;
            else ok = false;
          }
          if (ok) {
            stack.pop();
            finalize(t);
            break;
          }
        }
        // otherwise this line is code content (handled below)
        dedentCols(t.findent);
        t.lines.push(lineContent());
        break;
      }
      // an indented code block: a non-blank line with indent < 4 ends it
      if (t.t === 'code' && !t.fenced) {
        measure();
        if (L.ind < 4) {
          stack.pop();
          finalize(t);
          continue;
        }
        advCols(4);
        t.lines.push(lineContent(true));
        break;
      }
      // an html block (types 1-5 continue until their end marker)
      if (t.t === 'html') {
        const content = lineContent();
        t.lines.push(content);
        t.lastLine = li;
        if (htmlEndReached(t, content)) {
          stack.pop();
          finalize(t);
        }
        break;
      }
      // setext heading (paragraph -> heading). Link reference definitions
      // are stripped from the paragraph first; if nothing remains, the
      // underline line is just a paragraph line.
      if (t.t === 'para') {
        const se = matchSetext();
        if (se) {
          stripDefsFromPara(t);
          if (t.lines.length > 0) {
            t.t = 'head';
            t.level = se;
            stack.pop();
            finalize(t);
            break;
          }
        }
      }
      // fenced code start
      const fence = matchFence();
      if (fence) {
        closeOpenBlocks();
        // a fence inside a blockquote is not dedented when its indent
        // after the '>' is 2+ (doc-29/22: the spaces are content); an
        // indent of 1 is dedented normally (doc-38)
        const inBq = stack.some(b => b.t === 'bq');
        const node = { t: 'code', ch: [], fenced: true, fch: fence.ch.charCodeAt(0), flen: fence.len, findent: (inBq && fence.indent >= 2) ? 0 : fence.indent, info: fence.info, lines: [], lastBlank: false };
        openNode(node);
        break;
      }
      // ATX heading
      const atx = matchAtx();
      if (atx) {
        closeOpenBlocks();
        const node = { t: 'head', ch: [], level: atx.level, lines: [atx.content], lastBlank: false };
        openNode(node);
        stack.pop();
        finalize(node);
        break;
      }
      // html block start (type 7 never interrupts a paragraph)
      const ht = matchHtmlStart();
      if (ht && !(t.t === 'para' && ht === 7)) {
        closeOpenBlocks();
        const node = { t: 'html', ch: [], htype: ht, lines: [], lastBlank: false, lastLine: li };
        openNode(node);
        const content = lineContent();
        node.lines.push(content);
        if (ht >= 1 && ht <= 5 && htmlEndReached(node, content)) {
          stack.pop();
          finalize(node);
        }
        break;
      }
      // thematic break
      if (matchThematicBreak()) {
        closeOpenBlocks();
        const node = { t: 'hr', ch: [], lastBlank: false };
        openNode(node);
        stack.pop();
        finalize(node);
        break;
      }
      // list item
      const lm = matchListMarker();
      if (lm) {
        // an ordered list may interrupt a paragraph when the paragraph is
        // a direct child of a list item (a nested list, doc-01); at the
        // top level it must start with 1 (cm-300)
        const inItem = stack.length >= 2 && stack[stack.length - 2].t === 'item';
        const canInterrupt = !lm.empty && (lm.bullet || lm.start === 1 || (t.t === 'para' && inItem));
        if (t.t === 'para' && !canInterrupt) {
          // not a list start: fall through to paragraph continuation
        } else {
          if (t.t === 'para') { stack.pop(); finalize(t); t = tip(); }
          // a list cannot contain another list: close a list of a
          // different kind before opening a new one
          if (t.t === 'list' && t.marker !== lm.marker) {
            stack.pop(); finalize(t); t = tip();
          }
          // open (or reuse) the list
          let list = null;
          if (t.t === 'list' && t.marker === lm.marker) list = t;
          else {
            list = { t: 'list', ch: [], bullet: lm.bullet, delim: lm.delim, marker: lm.marker, start: lm.start, tight: true, lastBlank: false };
            openNode(list);
          }
          const item = { t: 'item', ch: [], ci: lm.ci - L.col, markerCol: L.nnCol, lastBlank: false };
          // cm-326: a blank line before this item marks the previous item
          if (wasBlank && list.ch.length > 0) list.ch[list.ch.length - 1].lastBlank = true;
          list.ch.push(item);
          stack.push(item);
          advCols(lm.ci - L.col);
          opened = true;
          continue;
        }
      }
      // blockquote
      measure();
      if (L.ind < 4 && L.nn === 62) {
        closeOpenBlocks();
        const node = { t: 'bq', ch: [], lastBlank: false };
        openNode(node);
        L.bqCol = L.col + L.ind;
        advCols(L.ind);
        adv(1);
        if (peek() === 32) adv(1);
        else if (peek() === 9) advCols(1);
        opened = true;
        continue;
      }
      // indented code
      measure();
      if (L.ind >= 4 && t.t !== 'para') {
        closeOpenBlocks();
        const node = { t: 'code', ch: [], fenced: false, lines: [], lastBlank: false };
        openNode(node);
        advCols(4);
        node.lines.push(lineContent(true));
        break;
      }
      // paragraph
      if (t.t === 'para') {
        t.lines.push(lineContent());
        t.lastBlank = false;
        break;
      }
      {
        // a paragraph cannot live inside a list; close the list first
        closeOpenBlocks();
        const content = lineContent();
        // a line that is only whitespace (e.g. an empty blockquote line)
        // does not start a paragraph
        if (/^[ \t]*$/.test(content)) break;
        const node = { t: 'para', ch: [], lines: [content], lastBlank: false };
        openNode(node);
      }
      break;
    }
  }

  closeTo(1);
  // html blocks: a trailing '\n' is emitted when the block's last line is
  // followed by a non-blank line (types 1-5, which end at their end marker)
  // or when the block is the document's last block and the source ends with
  // '\n'. Types 6-7 end at a blank line, so a following blank line absorbs
  // the newline and no trailing '\n' is emitted.
  const srcEndsNl = src.length > 0 && src.charCodeAt(src.length - 1) === 10;
  (function markHtml(node) {
    if (node.t === 'html') {
      const next = node.lastLine + 1;
      const isLast = node.lastLine === lines.length - 1;
      if (node.htype >= 1 && node.htype <= 5) {
        // a trailing '\n' when the immediately following line is not
        // truly empty (a whitespace-only line such as a lone tab does
        // NOT suppress it, doc-15; only a truly empty line does,
        // cm-183/308/309), or when the block is the document's last
        // block and the source ends with '\n'
        node.trailingNl = (next < lines.length && lines[next] !== '') || (isLast && srcEndsNl);
      } else {
        node.trailingNl = isLast && srcEndsNl;
      }
    }
    for (const c of node.ch) markHtml(c);
  })(doc);
  // strip trailing blank lines from indented code blocks
  (function stripCode(node) {
    if (node.t === 'code' && !node.fenced) {
      while (node.lines.length > 0 && /^[ \t]*$/.test(node.lines[node.lines.length - 1])) node.lines.pop();
    }
    for (const c of node.ch) stripCode(c);
  })(doc);
  return { doc, refs };
}

// ----------------------------------------------------------- inline parser

// Clean a URL the way marked does: encodeURI, keeping existing %XX sequences.
function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch (e) {
    return null;
  }
}

// Match a raw HTML tag starting at s[i] === '<'. Returns the end index
// (just past '>') or -1.
function matchHtmlTag(s, i) {
  const n = s.length;
  if (i >= n || s.charCodeAt(i) !== 60) return -1;
  let j = i + 1;
  if (j < n && s.charCodeAt(j) === 33) { // <!--, <?, <!, <![CDATA[
    if (s.slice(j, j + 3) === '!--') {
      // "<!-->" is a complete (empty) comment (cm-626); "<!--->" ends
      // with a "-->" that overlaps the "<!--", so scan from j+2
      if (s.charCodeAt(j + 3) === 62) return j + 4;
      const e = s.indexOf('-->', j + 2);
      return e < 0 ? -1 : e + 3;
    }
    if (s.slice(j + 1, j + 8) === '[CDATA[') {
      const e = s.indexOf(']]>', j + 8);
      return e < 0 ? -1 : e + 3;
    }
    // <!A-Z ...> or <? ...>
    if (j + 1 < n && s.charCodeAt(j + 1) === 63) {
      const e = s.indexOf('?>', j + 2);
      return e < 0 ? -1 : e + 2;
    }
    const c = s.charCodeAt(j + 1);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      const e = s.indexOf('>', j + 2);
      return e < 0 ? -1 : e + 1;
    }
    return -1;
  }
  if (j < n && s.charCodeAt(j) === 63) { // <? ... ?>
    const e = s.indexOf('?>', j + 1);
    return e < 0 ? -1 : e + 2;
  }
  let close = false;
  if (j < n && s.charCodeAt(j) === 47) { close = true; j++; } // close tag
  const c0 = j < n ? s.charCodeAt(j) : -1;
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return -1;
  while (j < n) {
    const c = s.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) j++;
    else break;
  }
  // a closing tag has no attributes: only whitespace then '>' (cm-624)
  if (close) {
    while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9 || s.charCodeAt(j) === 10 || s.charCodeAt(j) === 13)) j++;
    return j < n && s.charCodeAt(j) === 62 ? j + 1 : -1;
  }
  // attributes: each attribute name must be preceded by whitespace
  // (cm-609, cm-622); a '/' must be immediately followed by '>' (cm-621)
  while (j < n) {
    let hadWs = false;
    while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9 || s.charCodeAt(j) === 10 || s.charCodeAt(j) === 13 || s.charCodeAt(j) === 12)) { j++; hadWs = true; }
    if (j >= n) return -1;
    const c = s.charCodeAt(j);
    if (c === 62) return j + 1;
    if (c === 47) return j + 1 < n && s.charCodeAt(j + 1) === 62 ? j + 2 : -1;
    if (!hadWs) return -1;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58)) return -1;
    while (j < n) {
      const d = s.charCodeAt(j);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 95 || d === 58 || d === 46 || d === 45) j++;
      else break;
    }
    const attrEnd = j;
    while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9 || s.charCodeAt(j) === 10 || s.charCodeAt(j) === 13)) j++;
    if (j < n && s.charCodeAt(j) === 61) { // '='
      j++;
      while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9 || s.charCodeAt(j) === 10 || s.charCodeAt(j) === 13)) j++;
      if (j >= n) return -1;
      const q = s.charCodeAt(j);
      if (q === 34 || q === 39) {
        j++;
        while (j < n && s.charCodeAt(j) !== q) j++;
        if (j >= n) return -1;
        j++;
      } else {
        if (q === 32 || q === 9 || q === 10 || q === 13 || q === 34 || q === 39 || q === 61 || q === 60 || q === 62 || q === 96) return -1;
        while (j < n) {
          const d = s.charCodeAt(j);
          if (d === 32 || d === 9 || d === 10 || d === 13 || d === 34 || d === 39 || d === 61 || d === 60 || d === 62 || d === 96) break;
          j++;
        }
      }
    } else {
      // no '=': restore the position so the whitespace just skipped still
      // counts as the separator before the next attribute (cm-616)
      j = attrEnd;
    }
  }
  return -1;
}

// Try to match a <...> autolink at s[i]. Returns {href, text, end} or null.
function matchAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
  while (j < n && s.charCodeAt(j) !== 62) {
    const c = s.charCodeAt(j);
    if (c === 32 || c === 9 || c === 10 || c === 60 || c < 32) return null;
    j++;
  }
  if (j >= n) return null;
  const inner = s.slice(i + 1, j);
  if (inner.length === 0) return null;
  // scheme: 2-32 chars then ':'
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):/.exec(inner);
  if (m) {
    return { href: inner, text: inner, end: j + 1, email: false };
  }
  // email
  if (/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(inner)) {
    return { href: 'mailto:' + inner, text: inner, end: j + 1, email: true };
  }
  return null;
}

// GFM extended autolink helpers -------------------------------------------
// Domain labels: start/end with alnum, middle may have - or _.
function matchDomain(s, i) {
  const n = s.length;
  let j = i, labels = 0, lastEnd = -1;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (!isAlnumCode(c)) break;
    let k = j;
    while (k < n) {
      const c2 = s.charCodeAt(k);
      if (isAlnumCode(c2) || c2 === 45 || c2 === 95) k++;
      else break;
    }
    // label must end with alnum
    while (k > j && !isAlnumCode(s.charCodeAt(k - 1))) k--;
    if (k === j) break;
    labels++;
    lastEnd = k;
    j = k;
    if (j < n && s.charCodeAt(j) === 46) { j++; continue; }
    break;
  }
  if (labels < 2) return -1; // a domain needs at least one dot
  return lastEnd;
}
// Apply the GFM trailing rules to an autolink candidate ending at `end`.
// Returns the trimmed end index.
function trimAutolink(s, start, end) {
  // rule 1: trailing &...; (entity-like) is dropped entirely
  if (end > start && s.charCodeAt(end - 1) === 59) {
    let k = end - 2;
    while (k >= start && isAlnumCode(s.charCodeAt(k))) k--;
    if (k >= start && s.charCodeAt(k) === 38) end = k;
  }
  // rules 2 and 3 interleave: stripping trailing punctuation can expose
  // a ')' that is now trailing and unbalanced ('(https://.../down):'
  // must lose both ':' and ')', doc-09/10), so loop until stable
  for (;;) {
    // rule 2: unbalanced trailing ')'. A ')' immediately followed by
    // ']' is a link-destination closer, not URL content, so it does
    // not count toward the balance (doc-12: the ')' after 'page=4'
    // is balanced by the '(' before './docs', so the final ')' stays)
    let opens = 0, closes = 0;
    for (let k = start; k < end; k++) {
      if (s.charCodeAt(k) === 40) opens++;
      else if (s.charCodeAt(k) === 41 && !(k + 1 < end && s.charCodeAt(k + 1) === 93)) closes++;
    }
    let changed = false;
    while (end > start && s.charCodeAt(end - 1) === 41 && closes > opens) {
      end--;
      closes--;
      changed = true;
    }
    // rule 3: trailing punctuation — the GFM set is exactly
    // ! " ' ( * , . : ; ? _ ~  (']' '[' '=' '+' '-' '/' '&' '#' '%'
    // '@' '$' '\' '^' '`' '{' '|' '}' are KEPT; ')' is rule 2's job)
    while (end > start) {
      const c = s.charCodeAt(end - 1);
      if (c === 33 || c === 34 || c === 39 || c === 40 || c === 42 || c === 44 || c === 46 || c === 58 || c === 59 || c === 63 || c === 95 || c === 126) { end--; changed = true; }
      else break;
    }
    if (!changed) break;
  }
  return end;
}
function isAutolinkPunct(c) {
  return c < 128 && isPunctCode(c) && c !== 41;
}

// Try a GFM extended autolink at s[i]. Returns {href, text, end} or null.
// `prev` is the char code before i (-1 at the start).
// `hasUnderscoreOpener` is true when an unmatched '_' delimiter that can
// open emphasis precedes i (so a '_' after an email may be its closer,
// doc-38, not a trailing '_' that invalidates the email, gfm-632).
// `hasOpenBracket` is true when an ACTIVE bracket is open: the URL scan
// stops (inclusive) at a ']' that closes it, so the ']' stays in the
// autolink and the '(' of the bracket's destination is not swallowed
// (doc-08: 'https://sub.domain.example.io)]' then '(https://...)').
function matchGfmAutolink(s, i, prev, inLink, hasUnderscoreOpener, hasOpenBracket) {
  if (inLink) return null;
  if (prev !== -1 && isAlnumCode(prev)) return null;
  // a preceding '_' blocks an autolink only when the '_' is itself
  // intraword (preceded by an alphanumeric); a standalone '_' (e.g. an
  // emphasis delimiter, doc-38) does not block it
  if (prev === 95 && i >= 2 && isAlnumCode(s.charCodeAt(i - 2))) return null;
  const n = s.length;
  // www. / http:// / https:// / ftp://
  let j = i, prefix = null;
  const low = s.slice(i, i + 8).toLowerCase();
  // "www." is case-sensitive (Www. is not a link, doc-01); the schemes
  // http/https/ftp are case-insensitive
  if (s.slice(i, i + 4) === 'www.') { prefix = 'http://'; j = i + 4; }
  else if (low.startsWith('https://')) { prefix = ''; j = i + 8; }
  else if (low.startsWith('http://')) { prefix = ''; j = i + 7; }
  else if (low.startsWith('ftp://')) { prefix = ''; j = i + 6; }
  if (prefix !== null) {
    const dEnd = matchDomain(s, j);
    if (dEnd < 0) return null;
    let end = dEnd;
    while (end < n) {
      const c = s.charCodeAt(end);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 60 || c === 62 || c < 32) break;
      // a ']' that closes an open bracket ends the URL (inclusive),
      // but only when the '(' after it starts a URL (doc-08:
      // '](https://...)' is a separate autolink); a relative
      // destination such as '](./docs/create.md)' stays part of the
      // URL (doc-12)
      if (c === 93 && hasOpenBracket) {
        let stopHere = true;
        if (end + 1 < n && s.charCodeAt(end + 1) === 40) {
          const after = s.slice(end + 2, end + 10).toLowerCase();
          if (!(after.startsWith('http://') || after.startsWith('https://') || after.startsWith('ftp://') || after.startsWith('www.'))) stopHere = false;
        }
        if (stopHere) { end++; break; }
      }
      end++;
    }
    end = trimAutolink(s, i, end);
    if (end <= dEnd && end === i) return null;
    const text = s.slice(i, end);
    return { href: prefix + text, text, end };
  }
  // scheme: mailto: / xmpp: / ...  (2-32 char scheme, email-or-domain, one path segment)
  const sm = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):/.exec(s.slice(i, i + 34));
  if (sm) {
    let k = i + sm[0].length;
    // email or domain
    const em = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/.exec(s.slice(k));
    let dEnd = -1;
    if (em) dEnd = k + em[0].length;
    else dEnd = matchDomain(s, k);
    if (dEnd < 0) return null;
    // an email followed by '-' or '_' is not a link (gfm-633), unless
    // the '_' is an emphasis closer (an unmatched '_' opener precedes,
    // doc-38: "...example.com_,") — a '-' is never a closer
    if (em && dEnd < n) {
      const nx = s.charCodeAt(dEnd);
      if (nx === 45) return null;
      if (nx === 95 && !hasUnderscoreOpener) return null;
    }
    let end = dEnd;
    // optional single path segment: '/' + chars without '/'; a bare
    // trailing '/' with nothing after it is not part of the link
    // (gfm-633: 'mailto:a.b-c_d@a.b/' links without the '/')
    if (end < n && s.charCodeAt(end) === 47) {
      let p = end + 1;
      while (p < n) {
        const c = s.charCodeAt(p);
        if (c === 32 || c === 9 || c === 10 || c === 13 || c === 60 || c === 62 || c === 47 || c < 32) break;
        p++;
      }
      if (p > end + 1) end = p;
    }
    end = trimAutolink(s, i, end);
    const text = s.slice(i, end);
    if (text.length === 0) return null;
    return { href: text, text, end };
  }
  // email
  if (isAlnumCode(s.charCodeAt(i)) || '._%+-'.indexOf(s[i]) >= 0) {
    const em = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/.exec(s.slice(i));
    if (em) {
      const end = i + em[0].length;
      const next = end < n ? s.charCodeAt(end) : -1;
      // an email followed by '-' or '_' is not a link (gfm-632), unless
      // the '_' is an emphasis closer (an unmatched '_' opener precedes,
      // doc-38) — a '-' is never a closer
      if (next === 45) return null;
      if (next === 95 && !hasUnderscoreOpener) return null;
      return { href: 'mailto:' + em[0], text: em[0], end };
    }
  }
  return null;
}

// Parse an inline link "(...)" starting at s[i] === '('. Returns null or
// {href, title, end}.
function parseInlineLink(s, i, refs) {
  const n = s.length;
  let p = i + 1;
  while (p < n && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9 || s.charCodeAt(p) === 10)) p++;
  if (p >= n) return null;
  const dest = parseDestination(s, p);
  if (!dest) return null;
  p = dest.end;
  while (p < n && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9 || s.charCodeAt(p) === 10)) p++;
  let title = null;
  if (p < n) {
    const c = s.charCodeAt(p);
    if (c === 34 || c === 39 || c === 40) {
      const t = parseTitle(s, p);
      if (!t) return null;
      title = t.title;
      p = t.end;
      while (p < n && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9 || s.charCodeAt(p) === 10)) p++;
    }
  }
  if (p >= n || s.charCodeAt(p) !== 41) return null;
  return { href: dest.dest, title, end: p + 1 };
}

// The inline renderer. `plain` renders to plain text (for image alt text).
function renderInline(s, refs, plain, noLink) {
  const n = s.length;
  const out = [];
  const delims = []; // {ch, n, open, close, pos, active, src}
  const brackets = []; // {pos, image, active, srcPos}
  let buf = '';
  let i = 0;

  function flush() {
    if (buf.length === 0) return;
    out.push(esc(decodeNumeric(buf)));
    buf = '';
  }
  function pushRaw(html) {
    flush();
    out.push(html);
  }
  function addDelim(ch, run, open, close, src) {
    flush();
    out.push(run);
    delims.push({ ch, n: run.length, open, close, pos: out.length - 1, active: true, src });
  }
  // Process emphasis: standard delimiter-stack algorithm. Delimiter chunks
  // are rebuilt from the delimiter's remaining run length plus accumulated
  // tags, so nested matches never slice into an existing tag.
  function processEmphasis() {
    const bottom = { '*': 0, '_': 0, '~': 0 };
    // ranges [openerIdx, closerIdx] of emphasis already formed; a
    // delimiter inside such a range cannot match a closer outside it
    const formed = [];
    // strongs that block a later single-delimiter outer match from
    // spanning them (see the push site below)
    const blocked = [];
    for (let ci = 0; ci < delims.length; ci++) {
      const closer = delims[ci];
      if (!closer.active || !closer.close) continue;
      const ch = closer.ch;
      let oi = ci - 1;
      let found = -1;
      let skipped = false;
      while (oi >= bottom[ch]) {
        const opener = delims[oi];
        if (opener.active && opener.ch === ch && opener.open) {
          // inside a formed emphasis but the closer is outside it: skip
          let inside = false;
          for (let f = 0; f < formed.length; f++) {
            if (formed[f][0] < oi && oi < formed[f][1]) { inside = true; break; }
          }
          if (inside) { oi--; continue; }
          // a single-delimiter match cannot span a blocking strong
          // of the same character
          const useHere = opener.n >= 2 && closer.n >= 2 ? 2 : 1;
          if (useHere === 1) {
            let spansBlocked = false;
            for (let f = 0; f < blocked.length; f++) {
              if (blocked[f][2] === ch && oi < blocked[f][0] && ci > blocked[f][1]) { spansBlocked = true; break; }
            }
            // an opener skipped here still exists below, so the
            // bottom must not be raised for a later closer (doc-11:
            // the outer '**' must still find its opener)
            if (spansBlocked) { skipped = true; oi--; continue; }
          }
          if ((opener.open && opener.close) || (closer.open && closer.close)) {
            if ((opener.n + closer.n) % 3 === 0 && (opener.n % 3 !== 0 || closer.n % 3 !== 0)) {
              skipped = true;
              oi--;
              continue;
            }
          }
          found = oi;
          break;
        }
        oi--;
      }
      if (found < 0) {
        // only raise the bottom when no opener exists below; an opener
        // skipped by the odd rule may still match a later closer (cm-411)
        if (!skipped) bottom[ch] = ci;
        continue;
      }
      const opener = delims[found];
      const use = opener.n >= 2 && closer.n >= 2 ? 2 : 1;
      formed.push([found, ci]);
      // A strong formed from a pure opener (can open, cannot close) and
      // a closer that can also open blocks a later SINGLE '*' from
      // spanning it ('*a **b**c*' stays literal outside), but not a
      // later '**' ('**line **same**private**' does form the outer
      // strong). Recorded for the opener search below (same char only).
      if (use === 2 && opener.open && !opener.close && closer.open && closer.close) {
        blocked.push([found, ci, ch]);
      }
      const openTag = ch === '~' ? '<del>' : use === 2 ? '<strong>' : '<em>';
      const closeTag = ch === '~' ? '</del>' : use === 2 ? '</strong>' : '</em>';
      opener.n -= use;
      closer.n -= use;
      if (plain) {
        out[opener.pos] = ch.repeat(opener.n);
        out[closer.pos] = ch.repeat(closer.n);
      } else {
        // a later match on the same opener is the OUTER emphasis, so its
        // tag goes before the earlier (inner) one
        opener.otag = openTag + (opener.otag || '');
        // a later match on the same closer is the OUTER emphasis, so its
        // tag goes after the earlier (inner) one
        closer.ctag = (closer.ctag || '') + closeTag;
        out[opener.pos] = ch.repeat(opener.n) + opener.otag;
        out[closer.pos] = closer.ctag + ch.repeat(closer.n);
      }
      if (opener.n === 0) {
        opener.active = false;
        // do NOT raise the bottom: later closers may still match openers
        // below this one (e.g. *(*foo*)* needs the outer pair).
      }
      if (closer.n === 0) {
        closer.active = false;
      } else {
        // keep looking for another opener for this closer
        ci--;
      }
    }
  }

  while (i < n) {
    const c = s.charCodeAt(i);
    // backslash escapes
    if (c === 92) {
      if (i + 1 < n) {
        const d = s.charCodeAt(i + 1);
        if (isEscapable(d)) {
          // a literal '&' must not be re-read as an entity start
          if (d === 38) { flush(); out.push('&amp;'); }
          else buf += s[i + 1];
          i += 2;
          continue;
        }
        if (d === 10) { flush(); if (!plain) pushRaw('<br>'); else buf += '\n'; i += 2; while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++; continue; }
      }
      buf += '\\';
      i++;
      continue;
    }
    // code span
    if (c === 96) {
      let j = i, run = 0;
      while (j < n && s.charCodeAt(j) === 96) { run++; j++; }
      // find a matching run of exactly `run` backticks. A ']' that
      // closes an open bracket ends the search when a backtick run of
      // a DIFFERENT length has already intervened, or when an earlier
      // backtick run inside this bracket already failed to form a span
      // (the bracket is 'poisoned'): '[docs each ``url`](...)' forms
      // the link (the `` is literal, and the lone ` after url cannot
      // span the ']' either), while '[foo `bar]baz`](/url)' forms the
      // code span (no intervening run, bracket unpoisoned, so the ']'
      // is inside the span).
      const innerBr = brackets.length > 0 ? brackets[brackets.length - 1] : null;
      let k = j, found = -1, sawOther = false;
      while (k < n) {
        const ck = s.charCodeAt(k);
        if (ck === 93 && brackets.length > 0 && (sawOther || (innerBr && innerBr.poisoned))) break;
        if (ck === 96) {
          let m = k, r2 = 0;
          while (m < n && s.charCodeAt(m) === 96) { r2++; m++; }
          if (r2 === run) { found = k; break; }
          sawOther = true;
          k = m;
        } else k++;
      }
      if (found < 0) {
        // an unmatched backtick run poisons the innermost bracket:
        // no later backtick in it may span its closing ']'
        if (innerBr) innerBr.poisoned = true;
        buf += s.slice(i, j);
        i = j;
        continue;
      }
      let content = s.slice(j, found).replace(/\n/g, ' ');
      if (content.length >= 2 && content.charCodeAt(0) === 32 && content.charCodeAt(content.length - 1) === 32 && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      // a code span whose content contains a backtick blocks the
      // innermost bracket from forming a link (doc-16/18/20) — but
      // only when the span is not the last thing before the ']'
      // (doc-10: '[for table `a ` b`](url)' DOES form the link).
      // It also deactivates emphasis delimiters already seen inside
      // the bracket, so '_node ..._' stays literal too (doc-16/20).
      if (innerBr && content.indexOf('`') >= 0) {
        const afterSpan = found + run;
        if (!(afterSpan < n && s.charCodeAt(afterSpan) === 93)) {
          innerBr.linkBlocked = true;
          for (let d = 0; d < delims.length; d++) {
            if (delims[d].pos > innerBr.pos) delims[d].active = false;
          }
        }
      }
      flush();
      if (plain) out.push(escFull(content));
      else out.push('<code>' + escFull(content) + '</code>');
      i = found + run;
      continue;
    }
    // emphasis / strikethrough delimiters
    if (c === 42 || c === 95 || c === 126) {
      const ch = s[i];
      let j = i, run = 0;
      while (j < n && s.charCodeAt(j) === c) { run++; j++; }
      if (c === 126 && run > 2) {
        buf += s.slice(i, j);
        i = j;
        continue;
      }
      const before = i > 0 ? s.charCodeAt(i - 1) : -1;
      const after = j < n ? s.charCodeAt(j) : -1;
      // the beginning and end of the line count as Unicode whitespace
      const bSpace = before === -1 || isSpaceCode(before);
      const bPunct = before !== -1 && isPunctCode(before);
      const aSpace = after === -1 || isSpaceCode(after);
      const aPunct = after !== -1 && isPunctCode(after);
      const leftFlank = !aSpace && (!aPunct || bSpace || bPunct);
      const rightFlank = !bSpace && (!bPunct || aSpace || aPunct);
      let open, close;
      if (ch === '_') {
        open = leftFlank && (!rightFlank || bPunct);
        close = rightFlank && (!leftFlank || aPunct);
      } else {
        open = leftFlank;
        close = rightFlank;
      }
      if (!open && !close) {
        buf += s.slice(i, j);
      } else {
        addDelim(ch, s.slice(i, j), open, close, i);
      }
      i = j;
      continue;
    }
    // image start
    if (c === 33 && i + 1 < n && s.charCodeAt(i + 1) === 91) {
      flush();
      out.push('!');
      out.push('[');
      brackets.push({ pos: out.length - 2, image: true, active: true, srcPos: i + 2, poisoned: false, linkBlocked: false });
      i += 2;
      continue;
    }
    // link bracket (suppressed inside link text: a link cannot contain
    // a link; images are still pushed so they can form inside a link)
    if (c === 91 && !noLink) {
      flush();
      out.push('[');
      brackets.push({ pos: out.length - 1, image: false, active: true, srcPos: i + 1, poisoned: false, linkBlocked: false });
      i++;
      continue;
    }
    // closing bracket: try to form a link
    if (c === 93) {
      if (brackets.length > 0) {
        const br = brackets[brackets.length - 1];
        if (br.active && !br.linkBlocked) {
          const text = s.slice(br.srcPos, i);
          let href = null, title = null, end = -1;
          if (i + 1 < n && s.charCodeAt(i + 1) === 40) {
            const il = parseInlineLink(s, i + 1, refs);
            if (il) { href = il.href; title = il.title; end = il.end; }
          }
          if (href === null) {
            // full / collapsed reference. If the label syntax parses but
            // the reference is undefined, the shortcut is NOT tried
            // (cm-571); if the label syntax itself fails, it is (cm-568).
            let fullRefAttempted = false;
            if (i + 1 < n && s.charCodeAt(i + 1) === 91) {
              // collapsed reference "[]": the label is the link text
              if (i + 2 < n && s.charCodeAt(i + 2) === 93) {
                fullRefAttempted = true;
                const ref = refs.get(normalizeLabel(text));
                if (ref) { href = ref.href; title = ref.title; end = i + 3; }
              } else {
                const lab = parseLabel(s, i + 1);
                if (lab) {
                  fullRefAttempted = true;
                  const ref = refs.get(lab.label);
                  if (ref) { href = ref.href; title = ref.title; end = lab.end; }
                }
              }
            }
            if (href === null && !fullRefAttempted) {
              const lab = normalizeLabel(text);
              const ref = refs.get(lab);
              if (ref) { href = ref.href; title = ref.title; end = i + 1; }
            }
          }
          if (href !== null) {
            const clean = cleanUrl(href);
            if (clean !== null) {
              flush();
              if (br.image) {
                const alt = renderInline(text, refs, true);
                if (plain) {
                  // in plain mode an image renders as its alt text
                  out[br.pos] = alt;
                } else {
                  const img = '<img src="' + esc(clean) + '" alt="' + alt + '"' +
                    (title !== null && title !== undefined ? ' title="' + esc(title) + '"' : '') + '>';
                  out[br.pos] = img;
                }
                out.length = br.pos + 1;
              } else {
                // render the link text in its own scope so emphasis inside
                // it is resolved there and cannot span the link boundary;
                // noLink suppresses nested links and GFM autolinks
                const inner = renderInline(text, refs, plain, true);
                if (plain) {
                  // in plain mode a link renders as its text
                  out[br.pos] = inner;
                } else {
                  out[br.pos] = '<a href="' + esc(clean) + '"' +
                    (title !== null && title !== undefined ? ' title="' + esc(title) + '"' : '') + '>' +
                    inner + '</a>';
                }
                out.length = br.pos + 1;
              }
              // remove delimiters added after the bracket (they belong to
              // the link text, now rendered recursively)
              for (let d = delims.length - 1; d >= 0; d--) {
                if (delims[d].pos > br.pos) delims[d].active = false;
              }
              // a link inside a bracket prevents any outer LINK bracket
              // from forming a link (a link cannot contain a link,
              // cm-518); an outer IMAGE bracket stays active, since an
              // image may contain links in its alt text (cm-520)
              if (!br.image) {
                for (let b = 0; b < brackets.length; b++) {
                  if (!brackets[b].image) brackets[b].active = false;
                }
              }
              brackets.pop();
              i = end;
              continue;
            }
          }
        }
        // no link formed (or the bracket is inactive): pop it and treat
        // ']' as literal text
        brackets.pop();
        buf += ']';
        i++;
        continue;
      }
      buf += ']';
      i++;
      continue;
    }
    // autolink / raw html
    if (c === 60) {
      const al = matchAutolink(s, i);
      if (al) {
        const clean = cleanUrl(al.href);
        if (clean !== null) {
          flush();
          if (plain) out.push(esc(al.text));
          else out.push('<a href="' + esc(clean) + '">' + esc(al.text) + '</a>');
          i = al.end;
          continue;
        }
      }
      const tagEnd = matchHtmlTag(s, i);
      if (tagEnd > 0) {
        flush();
        if (!plain) out.push(s.slice(i, tagEnd));
        i = tagEnd;
        continue;
      }
      buf += '&lt;';
      i++;
      continue;
    }
    // entity / ampersand
    if (c === 38) {
      // numeric reference: decode it into the text buffer
      const m = /^&(?:#([0-9]{1,7})|#[Xx]([0-9A-Fa-f]{1,6}));/.exec(s.slice(i, i + 12));
      if (m) {
        let cp = m[1] !== undefined ? parseInt(m[1], 10) : parseInt(m[2], 16);
        if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
        // a decoded '&' must not be re-read as an entity start
        if (cp === 38) { flush(); out.push('&amp;'); }
        else buf += String.fromCodePoint(cp);
        i += m[0].length;
        continue;
      }
      // named-entity-like: keep verbatim (esc() preserves it)
      const m2 = /^&[a-zA-Z][a-zA-Z0-9]*;/.exec(s.slice(i, i + 40));
      if (m2) {
        buf += m2[0];
        i += m2[0].length;
        continue;
      }
      buf += '&';
      i++;
      continue;
    }
    // newline: hard or soft break. After a hard break, leading
    // spaces/tabs of the next line are stripped (cm-636/637).
    if (c === 10) {
      let k = buf.length;
      while (k > 0 && buf.charCodeAt(k - 1) === 32) k--;
      if (buf.length - k >= 2) {
        buf = buf.slice(0, k);
        flush();
        if (!plain) pushRaw('<br>');
        else buf += '\n';
        i++;
        while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
      } else {
        buf += '\n';
        i++;
      }
      continue;
    }
    // GFM autolinks (www / scheme / email) at word starts
    if (!plain) {
      const prev = i > 0 ? s.charCodeAt(i - 1) : -1;
      if (c === 119 || c === 104 || c === 102 || isAlnumCode(c) || c === 46 || c === 95 || c === 37 || c === 43) {
        // is there an unmatched '_' delimiter that can open emphasis?
        // (a '_' after an email may be its closer, doc-38)
        let hasUnderscoreOpener = false;
        for (let d = 0; d < delims.length; d++) {
          if (delims[d].ch === '_' && delims[d].open && delims[d].active) { hasUnderscoreOpener = true; break; }
        }
        // GFM autolinks are suppressed inside link text (noLink) and
        // inside an ACTIVE bracket (it may still form a link, whose
        // text must not contain an autolink); a DEACTIVATED bracket
        // (an inner link already formed, doc-08) does not suppress
        let anyActiveBracket = false;
        for (let b = 0; b < brackets.length; b++) {
          if (brackets[b].active) { anyActiveBracket = true; break; }
        }
        const ga = matchGfmAutolink(s, i, prev, noLink || anyActiveBracket, hasUnderscoreOpener, brackets.length > 0);
        if (ga) {
          const clean = cleanUrl(ga.href);
          if (clean !== null) {
            flush();
            out.push('<a href="' + esc(clean) + '">' + esc(ga.text) + '</a>');
            i = ga.end;
            continue;
          }
        }
      }
    }
    // ordinary character
    buf += s[i];
    i++;
  }
  flush();
  processEmphasis();
  return out.join('');
}

// ----------------------------------------------------------- block renderer

// Split a table row line into cells (unescaped pipes only).
function renderInlineText(s, refs) {
  return renderInline(s, refs, false);
}

function renderBlock(node, refs, out, loose) {
  switch (node.t) {
    case 'doc':
      for (const c of node.ch) renderBlock(c, refs, out, false);
      break;
    case 'bq':
      out.push('<blockquote>\n');
      for (const c of node.ch) renderBlock(c, refs, out, false);
      out.push('</blockquote>\n');
      break;
    case 'list': {
      const ordered = node.delim === '.' || node.delim === ')';
      const tag = ordered ? 'ol' : 'ul';
      let attrs = '';
      if (ordered && node.start !== 1) attrs = ' start="' + node.start + '"';
      out.push('<' + tag + attrs + '>\n');
      for (const c of node.ch) renderBlock(c, refs, out, !node.tight);
      out.push('</' + tag + '>\n');
      break;
    }
    case 'item': {
      out.push('<li>');
      const kids = node.ch;
      let first = true;
      for (const c of kids) {
        if (c.t === 'para') {
          let text = c.lines.join('\n');
          let checkbox = null;
          if (first) {
            const m = /^\[( |x|X)\]( |$|\n)/.exec(text);
            if (m) {
              checkbox = m[1] === ' ' ? '<input disabled="" type="checkbox">' : '<input checked="" disabled="" type="checkbox">';
              text = text.slice(m[0].length);
            }
          }
          if (loose) {
            out.push('<p>');
            if (checkbox) out.push(checkbox, ' ');
            out.push(renderInlineText(text, refs));
            out.push('</p>\n');
          } else {
            if (checkbox) out.push(checkbox, ' ');
            out.push(renderInlineText(text, refs));
          }
        } else {
          renderBlock(c, refs, out, false);
        }
        first = false;
      }
      out.push('</li>\n');
      break;
    }
    case 'para':
      out.push('<p>' + renderInlineText(node.lines.join('\n'), refs) + '</p>\n');
      break;
    case 'head': {
      // a heading's raw contents are stripped of leading/trailing spaces
      const text = node.lines.join('\n').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
      out.push('<h' + node.level + '>' + renderInlineText(text, refs) + '</h' + node.level + '>\n');
      break;
    }
    case 'code': {
      let attrs = '';
      if (node.fenced && node.info) {
        const lang = unescapeStr(node.info).split(/[ \t]+/)[0];
        if (lang) attrs = ' class="language-' + esc(lang) + '"';
      }
      let lines = node.lines;
      if (node.fenced) {
        // trailing blank lines: exactly one is stripped (cm-318: 2 empty
        // lines keep 1; doc-03: 1 empty line keeps 0)
        if (lines.length > 0 && lines[lines.length - 1] === '') lines = lines.slice(0, -1);
      }
      const content = lines.length > 0 ? lines.join('\n') + '\n' : '';
      out.push('<pre><code' + attrs + '>' + escFull(content) + '</code></pre>\n');
      break;
    }
    case 'html':
      out.push(node.lines.join('\n'));
      if (node.trailingNl) out.push('\n');
      break;
    case 'hr':
      out.push('<hr>\n');
      break;
    case 'table': {
      out.push('<table>\n<thead>\n<tr>\n');
      for (let i = 0; i < node.header.length; i++) {
        const a = node.align[i];
        out.push('<th' + (a ? ' align="' + a + '"' : '') + '>' + renderInlineText(node.header[i], refs) + '</th>\n');
      }
      out.push('</tr>\n</thead>\n');
      if (node.rows.length > 0) {
        out.push('<tbody>');
        for (const row of node.rows) {
          out.push('<tr>\n');
          for (let i = 0; i < node.header.length; i++) {
            const a = node.align[i];
            out.push('<td' + (a ? ' align="' + a + '"' : '') + '>' + renderInlineText(row[i], refs) + '</td>\n');
          }
          out.push('</tr>\n');
        }
        out.push('</tbody>');
      }
      out.push('</table>\n');
      break;
    }
    case 'none':
      break;
  }
}

export function parse(src) {
  src = src.replace(/\r\n?/g, '\n');
  const { doc, refs } = parseBlocks(src);
  const out = [];
  renderBlock(doc, refs, out, false);
  return out.join('');
}
