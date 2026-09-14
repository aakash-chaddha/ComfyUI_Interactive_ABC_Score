import test from 'node:test';
import assert from 'node:assert/strict';
import { edit, locate, noteMidi, tuneStarts } from '../../web/edit_model.js';

// Selection covering the last occurrence of `token` (the music line comes after
// headers, so lastIndexOf lands on the note we mean).
function sel(abc, token) {
	const at = abc.lastIndexOf(token);
	assert.notEqual(at, -1, `token ${JSON.stringify(token)} not found`);
	return { startChar: at, endChar: at + token.length };
}

const TUNE = 'X:1\nT:Tune\nK:C\nCDEF GABc\n';

test('pitch up one diatonic step raises the letter', () => {
	const out = edit(TUNE, sel(TUNE, 'C'), { kind: 'pitch', steps: 1 });
	assert.equal(out.abc, 'X:1\nT:Tune\nK:C\nDDEF GABc\n');
	assert.equal(locate(out.abc, out.selection).letter, 'D');
});

test('pitch down one diatonic step lowers the letter', () => {
	const out = edit(TUNE, sel(TUNE, 'D'), { kind: 'pitch', steps: -1 });
	assert.equal(out.abc, 'X:1\nT:Tune\nK:C\nCCEF GABc\n');
});

test('pitch up crosses the octave boundary B -> c', () => {
	const out = edit(TUNE, sel(TUNE, 'B'), { kind: 'pitch', steps: 1 });
	assert.equal(out.abc, 'X:1\nT:Tune\nK:C\nCDEF GAcc\n');
});

test('pitch down crosses the octave boundary c -> B', () => {
	const abc = 'X:1\nK:C\ncd ef\n';
	const out = edit(abc, sel(abc, 'c'), { kind: 'pitch', steps: -1 });
	assert.equal(out.abc, 'X:1\nK:C\nBd ef\n');
});

test('pitch keeps explicit accidentals unchanged on the target letter', () => {
	const abc = 'X:1\nK:G\n^FGA B\n';
	const out = edit(abc, sel(abc, '^F'), { kind: 'pitch', steps: 1 });
	assert.equal(out.abc, 'X:1\nK:G\n^GGA B\n');
});

test('pitch in K:G: G down 1 writes F (keysig covers the sharp)', () => {
	const abc = 'X:1\nK:G\nGA B\n';
	const out = edit(abc, sel(abc, 'G'), { kind: 'pitch', steps: -1 });
	assert.equal(out.abc, 'X:1\nK:G\nFA B\n');
});

test('pitch clamps at A0 (lowest usable note)', () => {
	const abc = 'X:1\nK:C\nA,,, B,, C\n';
	const before = sel(abc, 'A,,,');
	const out = edit(abc, before, { kind: 'pitch', steps: -1 });
	assert.equal(out.abc, abc);
	assert.deepEqual(out.selection, before);
});

test('pitch clamps at C8 (highest usable note)', () => {
	const abc = "X:1\nK:C\nc'''' d\n";
	const before = sel(abc, "c''''");
	const out = edit(abc, before, { kind: 'pitch', steps: 1 });
	assert.equal(out.abc, abc);
});

const LEN = 'X:1\nK:C\n';

test('duration lengthen doubles a plain note length', () => {
	const abc = LEN + 'A2 B c\n';
	const out = edit(abc, sel(abc, 'B'), { kind: 'duration', direction: 1 });
	assert.equal(out.abc, LEN + 'A2 B2 c\n');
});

test('duration shorten halves a plain note into an explicit fraction', () => {
	const abc = LEN + 'A B c\n';
	const out = edit(abc, sel(abc, 'B'), { kind: 'duration', direction: -1 });
	assert.equal(out.abc, LEN + 'A B/2 c\n');
});

test('duration lengthen turns a dotted note into a triple', () => {
	const abc = LEN + 'A B. C\n';
	const out = edit(abc, sel(abc, 'B.'), { kind: 'duration', direction: 1 });
	assert.equal(out.abc, LEN + 'A B3 C\n');
});

test('duration shorten turns a dotted note into a 3/4 fraction', () => {
	const abc = LEN + 'A. B\n';
	const out = edit(abc, sel(abc, 'A.'), { kind: 'duration', direction: -1 });
	assert.equal(out.abc, LEN + 'A3/4 B\n');
});

test('duration shorten collapses explicit length back to bare note', () => {
	const abc = LEN + 'A2 B\n';
	const out = edit(abc, sel(abc, 'A2'), { kind: 'duration', direction: -1 });
	assert.equal(out.abc, LEN + 'A B\n');
});

test('duration lengthen on a half-length note returns to bare', () => {
	const abc = LEN + 'A/2 B\n';
	const out = edit(abc, sel(abc, 'A/2'), { kind: 'duration', direction: 1 });
	assert.equal(out.abc, LEN + 'A B\n');
});

test('duration keeps dotted multiplier when doubling', () => {
	const abc = LEN + 'A3. B\n';
	const out = edit(abc, sel(abc, 'A3.'), { kind: 'duration', direction: 1 });
	assert.equal(out.abc, LEN + 'A9 B\n');
});

test('duration floors at 1/32 (shortening below is a no-op)', () => {
	const abc = LEN + 'A/16 B\n';
	const once = edit(abc, sel(abc, 'A/16'), { kind: 'duration', direction: -1 });
	assert.equal(once.abc, LEN + 'A/32 B\n');
	const twice = edit(once.abc, once.selection, { kind: 'duration', direction: -1 });
	assert.equal(twice.abc, once.abc);
});

test('duration lengthens a rest too', () => {
	const abc = LEN + 'z A\n';
	const out = edit(abc, sel(abc, 'z'), { kind: 'duration', direction: 1 });
	assert.equal(out.abc, LEN + 'z2 A\n');
});

test('duration inside a tuplet is best-effort, not a crash', () => {
	const abc = LEN + '(3CDE A\n';
	const out = edit(abc, sel(abc, 'C'), { kind: 'duration', direction: 1 });
	assert.equal(out.abc, LEN + '(3C2DE A\n');
});

// --- accidental ---

test('accidental sharp adds ^ before a bare note', () => {
	const abc = LEN + 'A B c\n';
	const out = edit(abc, sel(abc, 'B'), { kind: 'accidental', accidental: 'sharp' });
	assert.equal(out.abc, LEN + 'A ^B c\n');
});

test('accidental sharp replaces an existing flat', () => {
	const abc = LEN + 'A _B c\n';
	const out = edit(abc, sel(abc, '_B'), { kind: 'accidental', accidental: 'sharp' });
	assert.equal(out.abc, LEN + 'A ^B c\n');
});

test('accidental natural replaces a sharp', () => {
	const abc = LEN + 'A ^B c\n';
	const out = edit(abc, sel(abc, '^B'), { kind: 'accidental', accidental: 'natural' });
	assert.equal(out.abc, LEN + 'A =B c\n');
});

test('accidental none strips the explicit accidental', () => {
	const abc = LEN + 'A ^B c\n';
	const out = edit(abc, sel(abc, '^B'), { kind: 'accidental', accidental: 'none' });
	assert.equal(out.abc, LEN + 'A B c\n');
});

test('accidental is a no-op when already in that state', () => {
	const abc = LEN + 'A ^B c\n';
	const out = edit(abc, sel(abc, '^B'), { kind: 'accidental', accidental: 'sharp' });
	assert.equal(out.abc, abc);
});

test('accidental keeps the note length', () => {
	const abc = LEN + 'A _B/2 c\n';
	const out = edit(abc, sel(abc, '_B/2'), { kind: 'accidental', accidental: 'flat' });
	assert.equal(out.abc, LEN + 'A _B/2 c\n');
	const out2 = edit(abc, sel(abc, '_B/2'), { kind: 'accidental', accidental: 'sharp' });
	assert.equal(out2.abc, LEN + 'A ^B/2 c\n');
});

test('accidental on a rest is a no-op', () => {
	const abc = LEN + 'A z c\n';
	const out = edit(abc, sel(abc, 'z'), { kind: 'accidental', accidental: 'sharp' });
	assert.equal(out.abc, abc);
});

// --- to-rest ---

test('to-rest turns a note into a rest keeping its length', () => {
	const abc = LEN + 'A2 B c\n';
	const out = edit(abc, sel(abc, 'A2'), { kind: 'to-rest' });
	assert.equal(out.abc, LEN + 'z2 B c\n');
});

test('to-rest turns a rest back into the key tonic', () => {
	const abc = 'X:1\nK:G\nA z B\n';
	const out = edit(abc, sel(abc, 'z'), { kind: 'to-rest' });
	assert.equal(out.abc, 'X:1\nK:G\nA G B\n');
});

test('to-rest on a rest honors an explicit letter and keeps length', () => {
	const abc = LEN + 'z3 A\n';
	const out = edit(abc, sel(abc, 'z3'), { kind: 'to-rest', letter: 'e' });
	assert.equal(out.abc, LEN + 'e3 A\n');
});

// --- delete ---

test('delete removes a note', () => {
	const abc = LEN + 'A B c\n';
	const out = edit(abc, sel(abc, 'B'), { kind: 'delete' });
	assert.equal(out.abc, LEN + 'A  c\n');
	assert.equal(out.selection, null);
});

test('delete removes a rest', () => {
	const abc = LEN + 'A z3 c\n';
	const out = edit(abc, sel(abc, 'z3'), { kind: 'delete' });
	assert.equal(out.abc, LEN + 'A  c\n');
});

// --- insert ---

test('insert duplicates the selected note with accidental and length', () => {
	const abc = LEN + '^B/2 c\n';
	const out = edit(abc, sel(abc, '^B/2'), { kind: 'insert', after: true, what: 'note' });
	assert.equal(out.abc, LEN + '^B/2^B/2 c\n');
});

test('insert after a rest copies the rest', () => {
	const abc = LEN + 'A z c\n';
	const out = edit(abc, sel(abc, 'z'), { kind: 'insert', after: true, what: 'note' });
	assert.equal(out.abc, LEN + 'A zz c\n');
});

test('insert a rest after the selected note', () => {
	const abc = LEN + 'A2 B\n';
	const out = edit(abc, sel(abc, 'A2'), { kind: 'insert', after: true, what: 'rest' });
	assert.equal(out.abc, LEN + 'A2z2 B\n');
});

// --- transpose ---

test('transpose rewrites every note token in the tune containing the selection', () => {
	const abc = 'X:1\nK:C\nCD E\n';
	const out = edit(abc, sel(abc, 'E'), { kind: 'transpose', semitones: 2 });
	assert.equal(out.abc, 'X:1\nK:C\nDE ^F\n');
});

test('transpose spelling: sharp F up 2 in K:C is sharp G', () => {
	const abc = 'X:1\nK:C\n^F\n';
	const out = edit(abc, null, { kind: 'transpose', semitones: 2 });
	assert.equal(out.abc, 'X:1\nK:C\n^G\n');
});

test('transpose respects the key signature: F in K:G up 2 is sharp G', () => {
	const abc = 'X:1\nK:G\nF\n';
	const out = edit(abc, null, { kind: 'transpose', semitones: 2 });
	assert.equal(out.abc, 'X:1\nK:G\n^G\n');
});

test('transpose keeps the flat key signature in mind: B in K:F up 1 is natural B', () => {
	const abc = 'X:1\nK:F\nB\n';
	const out = edit(abc, null, { kind: 'transpose', semitones: 1 });
	assert.equal(out.abc, 'X:1\nK:F\n=B\n');
});

test('transpose resolves key-signature sharps correctly (K:G: F up 1 is plain G, G up 1 is sharp G)', () => {
	const abc = 'X:1\nK:G\nF G\n';
	const out = edit(abc, null, { kind: 'transpose', semitones: 1 });
	assert.equal(out.abc, 'X:1\nK:G\nG ^G\n');
});

test('transpose by an octave reuses the same letter', () => {
	const abc = 'X:1\nK:C\nC, c\n';
	const out = edit(abc, null, { kind: 'transpose', semitones: 12 });
	assert.equal(out.abc, "X:1\nK:C\nC c'\n");
});

test('transpose keeps lengths and leaves rests and the K: line alone', () => {
	const abc = 'X:1\nK:C\nC2 z D.\n';
	const out = edit(abc, null, { kind: 'transpose', semitones: 1 });
	assert.equal(out.abc, 'X:1\nK:C\n^C2 z ^D.\n');
});

test('transpose with no X: header edits the whole string', () => {
	const abc = 'K:C\nC D\n';
	const out = edit(abc, null, { kind: 'transpose', semitones: 2 });
	assert.equal(out.abc, 'K:C\nD E\n');
});

test('transpose in a minor key (no sharps) moves F to G', () => {
	const abc = 'X:1\nK:Am\nF\n';
	const out = edit(abc, null, { kind: 'transpose', semitones: 2 });
	assert.equal(out.abc, 'X:1\nK:Am\nG\n');
});

// --- multi-tune safety ---

const TWO_TUNES = 'X:1\nK:C\nAB\n% tail one\nX:2\nK:G\ncd\n% tail two\n';

test('an edit in tune two leaves tune one byte-identical', () => {
	const at = TWO_TUNES.indexOf('X:2');
	const sel2 = { startChar: at + 'X:2\nK:G\n'.length, endChar: at + 'X:2\nK:G\nc'.length };
	const out = edit(TWO_TUNES, sel2, { kind: 'pitch', steps: 1 });
	const [first, second] = out.abc.split('X:2');
	assert.equal(first, 'X:1\nK:C\nAB\n% tail one\n');
	assert.equal(second, '\nK:G\ndd\n% tail two\n');
});

test('transpose with a selection only touches its own tune', () => {
	const at = TWO_TUNES.indexOf('X:2');
	const sel2 = { startChar: at + 'X:2\nK:G\n'.length, endChar: at + 'X:2\nK:G\nc'.length };
	const out = edit(TWO_TUNES, sel2, { kind: 'transpose', semitones: 2 });
	assert.ok(out.abc.startsWith('X:1\nK:C\nAB\n% tail one\n'));
	assert.equal(out.abc.slice(out.abc.indexOf('X:2')), 'X:2\nK:G\nde\n% tail two\n');
});

test('tuneStarts reports byte offsets of each X: line', () => {
	assert.deepEqual(tuneStarts(TWO_TUNES), [0, TWO_TUNES.indexOf('X:2')]);
	assert.deepEqual(tuneStarts('K:C\nAB\n'), []);
});

// --- masking: never disturb non-note text ---

test('comments, lyrics, fields, and trailing text are untouched by an edit', () => {
	const abc = 'X:1\nT:T\nR:jig\n% a comment with C D E in it\nK:C\n"A chord" C !upbow!D |] % C\nw: la la C\n';
	const out = edit(abc, sel(abc, 'C !'), { kind: 'pitch', steps: 1 });
	assert.equal(out.abc, 'X:1\nT:T\nR:jig\n% a comment with C D E in it\nK:C\n"A chord" D !upbow!D |] % C\nw: la la C\n');
});

test('chord-symbol strings and inline [chords] are not editable', () => {
	const abc = LEN + '"Dm" [CEA] A\n';
	assert.equal(locate(abc, sel(abc, 'Dm')), null);
	const inBracket = { startChar: abc.indexOf('[') + 1, endChar: abc.indexOf('[') + 2 };
	assert.equal(locate(abc, inBracket), null);
});

test('headers before K: are not editable', () => {
	const abc = 'X:1\nT:C D E\nK:C\nc2 d\n';
	const inHeader = { startChar: abc.indexOf('T:') + 2, endChar: abc.indexOf('T:') + 3 };
	assert.equal(locate(abc, inHeader), null);
});

// --- selection snapping ---

test('selection pointing at whitespace snaps to the nearest token start', () => {
	const abc = LEN + 'A2 B c\n';
	// point between A2 and B
	const gap = { startChar: abc.indexOf(' B'), endChar: abc.indexOf(' B') + 2 };
	assert.equal(locate(abc, gap).letter, 'B');
});

test('selection far from any token locates nothing', () => {
	const abc = LEN + 'A\n\n\n\n\n\n\n\n\nB\n';
	const far = { startChar: abc.indexOf('\n\n') + 4, endChar: abc.indexOf('\n\n') + 4 };
	assert.equal(locate(abc, far), null);
});

test('a reversed selection is normalized, not rejected', () => {
	const abc = LEN + 'A B c\n';
	const out = edit(abc, { startChar: sel(abc, 'B').endChar, endChar: sel(abc, 'B').startChar }, { kind: 'pitch', steps: 1 });
	assert.equal(out.abc, LEN + 'A c c\n');
});

test('drag with zero steps leaves the text unchanged but keeps a selection', () => {
	const abc = LEN + 'A B c\n';
	const out = edit(abc, sel(abc, 'B'), { kind: 'drag', steps: 0 });
	assert.equal(out.abc, abc);
	assert.deepEqual(out.selection, sel(abc, 'B'));
});

// --- noteMidi ---

test('noteMidi reports sounding pitch with keysig and accidentals', () => {
	const abc = 'X:1\nK:G\nC A ^c F d\n';
	assert.equal(noteMidi(abc, sel(abc, 'C')), 48);
	assert.equal(noteMidi(abc, sel(abc, 'd')), 62);
	assert.equal(noteMidi(abc, sel(abc, '^c')), 61);
	assert.equal(noteMidi(abc, sel(abc, 'F')), 54);
	assert.equal(noteMidi(abc, sel(abc, 'A')), 57);
});

test('noteMidi returns null for rests and misses', () => {
	const abc = LEN + 'z A\n';
	assert.equal(noteMidi(abc, sel(abc, 'z')), null);
	assert.equal(noteMidi(abc, { startChar: 0, endChar: 1 }), null);
});
