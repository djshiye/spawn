// TileLabel: the name under a tile's icon (pinned tiles, All apps tiles, folder tiles).
//
// With `multi-lined-labels` the label always takes exactly two lines of height, so the tiles of a row
// stay the same height and a long name wraps once before its ellipsis. Clutter.Text measures a wrapped
// AND ellipsized text as one line, so a fixed em height (which depends on the font and the scale) cannot
// be right everywhere; TwoLineLabel doubles the measured line height instead.
//
// Public API:
//   makeTileLabel(text, multiLine): St.Label   a TwoLineLabel when multiLine, else a plain one-line St.Label
//   styleTileLabel(label, multiLine)           ellipsis, and the wrapping setup when multiLine

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

class TwoLineLabel extends St.Label {
    static {
        GObject.registerClass(this);
    }

    override vfunc_get_preferred_height(forWidth: number): [number, number] {
        const [, nat] = super.vfunc_get_preferred_height(forWidth);
        let pad = 0;
        try {
            const node = this.get_theme_node();
            pad = node.get_vertical_padding() + node.get_border_width(St.Side.TOP) + node.get_border_width(St.Side.BOTTOM);
        } catch {
            // no theme node yet (not on the stage): measure without padding
        }
        const height = Math.ceil(2 * Math.max(0, nat - pad) + pad);
        return [height, height];
    }
}

/**
 * One ellipsized line, or (multiLine) up to two wrapped lines, then an ellipsis.
 */
export function styleTileLabel(label: St.Label, multiLine: boolean): void {
    const ct = label.clutter_text;
    ct.ellipsize = Pango.EllipsizeMode.END;
    if (multiLine) {
        ct.line_alignment = Pango.Alignment.CENTER;
        ct.line_wrap = true;
        ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    }
}

export function makeTileLabel(text: string, multiLine: boolean): St.Label {
    const props = {
        text,
        style_class: 'spawn-tile-label',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    };
    const label = multiLine ? new TwoLineLabel(props) : new St.Label(props);
    styleTileLabel(label, multiLine);
    return label;
}
