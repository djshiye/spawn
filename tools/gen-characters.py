#!/usr/bin/env python3
"""Generate data/characters.tsv for the search box (emoji and special characters by name).

Run by developers only, never at runtime. Deterministic: the same inputs give the same file.

Input: the English compact emoji data of the npm package `emojibase-data` (MIT licence, derived from Unicode CLDR):

    cd "$(mktemp -d)" && npm pack emojibase-data && tar xzf emojibase-data-*.tgz
    python3 -I tools/gen-characters.py "$PWD/package/en/compact.json" data/characters.tsv

(run the last command from the repository root, with the temp-dir path adjusted). The second argument defaults
to data/characters.tsv next to this script's repository root.

Output: UTF-8, one entry per line: <glyph> TAB <kind> TAB <name> TAB <keywords>
  kind      e = emoji, c = other character
  name      lower case English name
  keywords  extra search words separated by single spaces (may be empty)
The first line is a comment starting with '#'.

Characters come from Python's unicodedata (assigned, named, non-control, non-combining code points of a fixed
list of blocks) minus anything that is already an emoji.
"""

import json
import os
import sys
import unicodedata

# (first, last) code point ranges of the character blocks.
RANGES = [
    (0x00A1, 0x00BF), (0x00D7, 0x00D7), (0x00F7, 0x00F7),   # Latin-1 punctuation and symbols
    (0x2010, 0x205E),                                       # General Punctuation
    (0x2070, 0x209F),                                       # Superscripts and Subscripts
    (0x20A0, 0x20CF),                                       # Currency Symbols
    (0x2100, 0x214F),                                       # Letterlike Symbols
    (0x2150, 0x218F),                                       # Number Forms
    (0x2190, 0x21FF),                                       # Arrows
    (0x2200, 0x22FF),                                       # Mathematical Operators
    (0x2300, 0x23FF),                                       # Miscellaneous Technical
    (0x2500, 0x257F),                                       # Box Drawing
    (0x2580, 0x259F),                                       # Block Elements
    (0x25A0, 0x25FF),                                       # Geometric Shapes
    (0x2600, 0x26FF),                                       # Miscellaneous Symbols
    (0x2700, 0x27BF),                                       # Dingbats
    (0x0391, 0x03C9),                                       # Greek letters
    (0x00C0, 0x017F),                                       # Latin-1 Supplement + Latin Extended-A letters
]

# Extra search words by glyph.
EXTRA = {
    '©': '(c) copyright', '®': 'registered (r)', '™': 'tm trademark', '°': 'degree degrees',
    '€': 'euro eur', '£': 'pound sterling gbp', '¥': 'yen jpy', '¢': 'cent',
    '×': 'multiply times multiplication', '÷': 'divide division', '≠': 'unequal not equal',
    '≈': 'approx approximately', '∞': 'infinity', '√': 'root sqrt', 'π': 'pi',
    '…': 'ellipsis dots', '•': 'bullet dot', '✓': 'tick check', '✔': 'tick check',
    '✗': 'cross', '✘': 'cross', '—': 'long dash', '–': 'dash', '±': 'plus minus',
    '≤': 'less equal', '≥': 'greater equal', 'µ': 'micro', '§': 'section', '¶': 'paragraph',
    '←': 'left', '→': 'right', '↑': 'up', '↓': 'down', '∑': 'sum sigma',
    '∆': 'delta', 'Ω': 'ohm', 'Ω': 'ohm', '½': 'half', '¼': 'quarter', '¾': 'three quarters',
    '★': 'star', '☆': 'star', '♥': 'heart', '♠': 'spade', '♣': 'club', '♦': 'diamond',
    '♪': 'music note', '♫': 'music notes', '⌘': 'command mac', '⌥': 'option mac',
    '⇧': 'shift', '⏎': 'return enter', '⌫': 'backspace delete', '⌃': 'control ctrl',
}


def tidy(label):
    return ' '.join(label.lower().replace('\t', ' ').split())


def load_emoji(path):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    out = []
    seen = set()
    for e in data:
        group = e.get('group')
        if group is None or group == 2:     # regional indicators have no group; 2 = skin tone / hair components
            continue
        glyph = e['unicode']
        if glyph in seen:
            continue
        seen.add(glyph)
        name = tidy(e['label'])
        words = set(name.replace(':', ' ').replace(',', ' ').split())
        tags = []
        for t in e.get('tags') or []:
            t = tidy(t)
            if not t or t in tags or t in words or t in name:
                continue
            tags.append(t)
            if len(tags) == 6:
                break
        out.append((e.get('order', 0), glyph, name, ' '.join(tags)))
    out.sort(key=lambda x: x[0])
    return [(g, n, k) for _, g, n, k in out]


def load_chars(emoji_glyphs):
    out = []
    seen = set()
    for first, last in RANGES:
        for cp in range(first, last + 1):
            ch = chr(cp)
            if ch in seen or ch in emoji_glyphs:
                continue
            # Miscellaneous Symbols and Dingbats: skip what is listed as an emoji (with or without U+FE0F).
            if 0x2600 <= cp <= 0x27BF and ch + '\ufe0f' in emoji_glyphs:
                continue
            cat = unicodedata.category(ch)
            if cat[0] in 'CZ' or cat[0] == 'M' or cat == 'Cn':
                continue
            name = unicodedata.name(ch, '')
            if not name:
                continue
            if cp in range(0x0391, 0x03CA) and not name.startswith('GREEK'):
                continue
            if 0x00C0 <= cp <= 0x017F and not cat.startswith('L'):
                continue
            seen.add(ch)
            out.append((ch, name.lower(), EXTRA.get(ch, '')))
    return out


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    dest = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, 'data', 'characters.tsv')
    emoji = load_emoji(src)
    glyphs = {g for g, _, _ in emoji}
    chars = load_chars(glyphs)
    lines = ['# glyph<TAB>kind (e emoji, c character)<TAB>name<TAB>keywords. Generated by tools/gen-characters.py '
             '(do not edit). Emoji: emojibase-data (MIT, from Unicode CLDR). Characters: Python unicodedata '
             '(Unicode %s).' % unicodedata.unidata_version]
    for g, n, k in emoji:
        lines.append('%s\te\t%s\t%s' % (g, n, k))
    for g, n, k in chars:
        lines.append('%s\tc\t%s\t%s' % (g, n, k))
    with open(dest, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    print('%d emoji, %d characters -> %s' % (len(emoji), len(chars), dest))


main()
