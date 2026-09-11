// @ts-check
'use strict';

// A small hand-rolled RFC-4180 CSV parser (M19 F1 Leg 1 / DD7). No CSV parser
// exists in tree and Node has none built in; this is treated as
// security-adjacent code (its own corpus test exercises embedded commas,
// embedded quotes, and embedded newlines) because it is the first thing that
// touches an operator-supplied file before any of that content becomes a
// vault item.
//
// CONTRACT (leg ruling 2): UTF-8 input, optional leading BOM stripped; CRLF
// and a bare LF both terminate a record (a bare CR — not followed by LF — is
// ALSO treated as a terminator here, a deliberate lenient superset: the
// grammar explicitly accepts a closing quote followed by CR as legal, and
// giving CR a single consistent meaning everywhere keeps the state machine
// simple and never contradicts the CRLF/LF rule). A trailing final newline
// emits no empty record; a zero-length line between records is skipped (not
// malformed, not returned at all). Quoted fields may contain `,`, an escaped
// `""`, CR, and LF verbatim — every one of those bytes round-trips exactly.
//
// STRUCTURAL ERRORS — a record becomes `{ line, malformed: true, reason }`
// (no `fields`) on: an unescaped `"` appearing inside an UNQUOTED field, or a
// closing `"` followed by anything other than `,` / CR / LF / EOF. Once
// either is hit, the parser abandons quote-aware scanning and
// RESYNCHRONIZES AT THE NEXT RAW `\n` BYTE, regardless of quote state — this
// can mis-split a following quoted-newline field into further malformed
// records; each one is still accounted for (never silently lost), which the
// leg's DD8 taxonomy accepts. An unterminated quoted field at EOF yields a
// final malformed record (reason 'unterminated-quote'), no resync needed.
//
// Field-count / content validation (5 columns, non-empty url, etc.) is NOT
// this module's job — that is `browser-import.js`'s adapter layer. This
// parser only ever returns `{ line, fields: string[] }` or
// `{ line, malformed: true, reason }`, and never throws on file content.

/**
 * @typedef {{ line: number, fields: string[] }} CsvRecord
 * @typedef {{ line: number, malformed: true, reason: string }} CsvMalformedRecord
 */

/**
 * @param {string} text
 * @returns {{ records: Array<CsvRecord | CsvMalformedRecord> }}
 */
function parseCsv(text) {
  let s = typeof text === 'string' ? text : String(text ?? '');
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1); // strip a leading BOM.
  }
  const len = s.length;
  /** @type {Array<CsvRecord | CsvMalformedRecord>} */
  const records = [];
  let i = 0;
  let line = 1;

  while (i < len) {
    const startLine = line;
    /** @type {string[]} */
    const fields = [];
    let field = '';
    /** @type {'start' | 'unquoted' | 'quoted' | 'quote-seen'} */
    let state = 'start';
    let touched = false;
    let hitTerminator = false;
    /** @type {{ reason: string } | null} */
    let structuralError = null;

    scan: while (i < len) {
      const ch = s[i];

      if (state === 'quoted') {
        if (ch === '"') {
          state = 'quote-seen';
          i++;
          continue;
        }
        field += ch;
        if (ch === '\n') line++;
        i++;
        continue;
      }

      // Outside an open quote, CR/LF always end the record — CRLF, a bare
      // LF, or (the lenient superset documented above) a bare CR.
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && s[i + 1] === '\n') {
          i += 2;
        } else {
          i += 1;
        }
        line++;
        if (state === 'unquoted' || state === 'quote-seen' || touched) {
          fields.push(field);
        }
        hitTerminator = true;
        break scan;
      }

      if (state === 'start') {
        if (ch === '"') {
          state = 'quoted';
          touched = true;
          i++;
          continue;
        }
        if (ch === ',') {
          fields.push(field);
          field = '';
          touched = true;
          i++;
          continue;
        }
        field += ch;
        state = 'unquoted';
        touched = true;
        i++;
        continue;
      }

      if (state === 'unquoted') {
        if (ch === '"') {
          structuralError = { reason: 'unexpected-quote' };
          break scan;
        }
        if (ch === ',') {
          fields.push(field);
          field = '';
          state = 'start';
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }

      // state === 'quote-seen': just saw a closing quote inside a quoted field.
      if (ch === '"') {
        field += '"'; // escaped quote.
        state = 'quoted';
        i++;
        continue;
      }
      if (ch === ',') {
        fields.push(field);
        field = '';
        state = 'start';
        i++;
        continue;
      }
      structuralError = { reason: 'quote-not-followed-by-delimiter' };
      break scan;
    }

    if (structuralError) {
      // Resynchronize at the next raw LF, ignoring quote state entirely.
      let j = i;
      while (j < len && s[j] !== '\n') j++;
      if (j < len) {
        j++; // consume the LF itself.
        line++;
      }
      i = j;
      records.push({ line: startLine, malformed: true, reason: structuralError.reason });
      continue;
    }

    if (hitTerminator) {
      if (!touched && fields.length === 0) {
        // A genuinely zero-length line between records — skipped, not a record.
        continue;
      }
      records.push({ line: startLine, fields });
      continue;
    }

    // The scan loop fell off the end of the string (i >= len) without ever
    // hitting a terminator or a structural error — EOF mid-record.
    if (state === 'quoted') {
      records.push({ line: startLine, malformed: true, reason: 'unterminated-quote' });
      continue;
    }
    if (state === 'unquoted' || state === 'quote-seen') {
      fields.push(field);
      records.push({ line: startLine, fields });
      continue;
    }
    // state === 'start': only reachable here if something was already
    // touched this record (e.g. a trailing comma leaving one final empty
    // field) — a fully untouched 'start' can never fall off the end, since
    // the outer loop only enters when i < len (there is always a first char
    // to process).
    if (touched) {
      fields.push(field);
      records.push({ line: startLine, fields });
    }
  }

  return { records };
}

module.exports = { parseCsv };
