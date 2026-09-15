# ComfyUI Interactive ABC Score

One node — **ABC Score** — that renders ABC notation as sheet music inside the
graph, plays it, and lets you edit the music on the staff itself. The ABC text
is a plain ComfyUI string in and out, so any text node can feed the score and
any string consumer can take it away. Everything renders and sounds offline:
abcjs and a General-MIDI piano SoundFont are vendored in this package.

## Usage

Add **text / ABC Score**. It starts with the two-voice demo score in
`input_sample.txt`; edit that file to change the tune a new node starts with.

- **Score pane** (click a note): selects it and hears it. Drag it up/down on
  the staff to change its pitch; the ABC text rewrites itself.
- **Text pane**: the raw ABC, editable. Typing re-renders the score; score
  edits rewrite the pane.
- **Player pane**: play/pause, restart, loop, seek, tempo (25–400%), and
  transpose the current tune by semitones. Audio starts on the first click
  (browser rule).
- The node header says where the text comes from: `ABC Score — self` versus
  `ABC Score — from: <upstream node>`. While linked, editing gestures are
  refused; **Detach & edit** breaks the link and keeps the shown score as the
  node's own text.

## Score keyboard (while the node has focus)

| Key | Action |
| --- | --- |
| Tab / click | move / set the selection |
| Arrow keys, then Enter/Space | drag the selected note (pitch by staff steps) |
| `<` `>` | shorten / lengthen |
| `^` `#` / `_` `b` / `=` / `0` | sharp / flat / natural / clear accidental |
| `r` | toggle note ↔ rest (keeps length) |
| `i` / `I` | insert a copy / a rest after the selection |
| Del / Backspace | delete the selected note or rest |
| Ctrl+Z / Ctrl+Shift+Z | undo / redo score edits |

Parse problems go to the warnings line under the score; the last good score
stays visible. Undo is per node and capped to 100 snapshots.

## SoundFont

The default instrument is a local FluidR3 GM acoustic piano. To use a bigger
local set (e.g. the full `midi-js-soundfonts` layout), set in the browser
console:

```js
localStorage['AbcScore.soundFontUrl'] = 'http://localhost:8000/my-soundfont/'
```

(the URL must end with `/`; folders must be named `{instrument}-mp3/`).

## Tests

```
node --test tests/js/                                   # score-edit model (pure, no DOM)
python -m pytest tests/python                           # node text contract
```

Playback, click-to-hear, drag, mirroring, detach, workflow save/reload, and
offline operation are verified manually against a real ComfyUI, not in CI.

## Known limitations (v1)

- Chord-internal notes (`[CEG]`) and tuplet numerators are not directly
  editable; chords are best-effort for duration/delete.
- ABC accidental carry-over within a measure is not tracked: each token is
  rewritten with only its own explicit accidental plus the key signature.
- Transpose rewrites note tokens concert-pitch style and leaves the `K:` line
  unchanged.
- See `web/VENDOR.md` for vendored asset provenance.
