// Pango markup with the matched query terms in <b>, for ResultList titles.
//
// Works per code point (emoji and other non-BMP characters are never split), compares
// case- and diacritics-insensitively like the ranking does, and keeps indices aligned with
// the original text: a character whose folded form has a different length (e.g. "İ"
// lower-cases to two code units, Hangul syllables decompose) is compared as itself, so it
// can never shift the marks of the characters after it.
//
// Public API:
//   highlightMarkup(text, query): string   markup-escaped `text`; matched runs wrapped in <b>

import GLib from 'gi://GLib';

const MARKS = /\p{M}/gu;

function escape(s: string): string {
    return s === '' ? '' : GLib.markup_escape_text(s, -1);
}

/** Case/diacritics fold of ONE code point, guaranteed to keep its UTF-16 length. */
function foldChar(ch: string): string {
    if (ch < '\x80')
        return ch.toLowerCase();
    const stripped = ch.normalize('NFD').replace(MARKS, '').toLowerCase();
    if (stripped.length === ch.length)
        return stripped;
    const lower = ch.toLowerCase();
    return lower.length === ch.length ? lower : ch;
}

function foldAligned(s: string): string {
    let out = '';
    for (const ch of s)
        out += foldChar(ch);
    return out;
}

export function highlightMarkup(text: string, query: string): string {
    const terms = query.trim().split(/\s+/).filter(t => t.length > 0).map(foldAligned).sort((a, b) => b.length - a.length);
    if (terms.length === 0 || text.length === 0)
        return escape(text);

    const lower = foldAligned(text);
    const marks: boolean[] = new Array(text.length).fill(false);
    for (const t of terms) {
        let from = 0;
        for (;;) {
            const at = lower.indexOf(t, from);
            if (at < 0)
                break;
            for (let i = at; i < at + t.length && i < marks.length; i++)
                marks[i] = true;
            from = at + t.length;
        }
    }

    // Walk code points; a code point is marked when any of its units is. Escape whole runs.
    let out = '';
    let run = '';
    let open = false;
    let i = 0;
    for (const ch of text) {
        let marked = false;
        for (let k = 0; k < ch.length; k++)
            marked ||= marks[i + k];
        i += ch.length;
        if (marked !== open) {
            out += open ? `${escape(run)}</b>` : escape(run);
            if (marked)
                out += '<b>';
            run = '';
            open = marked;
        }
        run += ch;
    }
    return open ? `${out}${escape(run)}</b>` : out + escape(run);
}
