// Pure ABC edit model: (abc, selection, op) -> { abc, selection }.
// No DOM, no abcjs. All offsets are absolute character offsets into `abc`.

const MIN_NATURAL_MIDI = 21; // A0
const MAX_NATURAL_MIDI = 108; // C8
const LETTER_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const INDEX_LETTER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// fifths of each natural letter in the circle of fifths
const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5];
// semitone of each natural letter above its octave C
const LETTER_SEMITONE = [0, 2, 4, 5, 7, 9, 11];
// semitone within an octave -> [letter index, written alteration] (sharp-side spelling)
const SEMITONE_SPELL = [
	[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1],
	[4, 0], [4, 1], [5, 0], [5, 1], [6, 0],
];
const MODE_OFFSET = {
	ion: 0, maj: 0, ionian: 0, major: 0,
	mix: 1, mixolydian: 1,
	dor: 2, dorian: 2,
	min: 3, mino: 3, aeo: 3, aeolian: 3, minor: 3,
	phr: 4, phrygian: 4,
	lyd: -1, lydian: -1,
	loc: 5, locrian: 5,
};

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

// --- length grammar (mirrors abcjs tokenizer.getFraction) ---

function parseLen(text) {
	if (!text) return 1;
	const m = /^(\d*)(\.*)?(\/+)(\d+)?$/.exec(text) || /^(\d*)(\.*)$/.exec(text);
	if (!m) return 1;
	let num = m[1] ? parseInt(m[1], 10) : 1;
	let dots = m[2] ? m[2].length : 0;
	let value = num;
	let add = num;
	for (let i = 0; i < dots; i++) { add /= 2; value += add; }
	if (m[3]) {
		const div = m[4] ? parseInt(m[4], 10) : Math.pow(2, m[3].length);
		value /= div;
	}
	return value;
}

function lenText(value) {
	// canonical rewrite as exact fraction num/den of one eighth
	let den = 1;
	while (Math.round(value * den) !== value * den) den *= 2;
	let num = Math.round(value * den);
	const g = gcd(num, den);
	num /= g; den /= g;
	if (den === 1) return num === 1 ? '' : String(num);
	if (num === 1) return `/${den}`;
	if (den === 2 && num % 2 === 1) {
		const whole = (num - 1) / 2;
		return whole === 1 ? '.' : `${whole}.`;
	}
	return `${num}/${den}`;
}

// --- diatonic position: d = octave * 7 + letterIdx (C=0) ---

function naturalMidi(d) {
	const oct = Math.floor(d / 7);
	return 12 * (oct + 1) + LETTER_SEMITONE[d % 7];
}

// --- masking (positions preserved; masked chars become spaces) ---

function maskTune(chars, start, end) {
	// Blank field lines and any line before the first K: line; strip comments,
	// quoted strings, [brackets], and !deco!/``+deco+`` spans.
	let i = start;
	let seenKey = false;
	while (i < end) {
		let lineEnd = chars.indexOf('\n', i);
		if (lineEnd === -1 || lineEnd > end) lineEnd = end;
		const head = chars[i] + chars[i + 1];
		const isField = /^[A-Za-z]:/.test(head);
		if (!seenKey || isField) {
			for (let j = i; j < lineEnd; j++) chars[j] = ' ';
			if (head === 'K:') seenKey = true;
		} else {
			for (let j = i; j < lineEnd; j++) {
				const ch = chars[j];
				if (ch === '%') {
					for (let k = j; k < lineEnd; k++) chars[k] = ' ';
					break;
				}
				if (ch === '"') {
					let close = chars.indexOf('"', j + 1);
					if (close !== -1 && close < lineEnd) {
						for (let k = j; k <= close; k++) chars[k] = ' ';
						j = close;
					}
				} else if (ch === '[') {
					let close = chars.indexOf(']', j + 1);
					if (close !== -1 && close < lineEnd) {
						for (let k = j; k <= close; k++) chars[k] = ' ';
						j = close;
					}
				} else if (ch === '!' || ch === '+') {
					let close = chars.indexOf(ch, j + 1);
					if (close !== -1 && close < lineEnd && close - j <= 12) {
						for (let k = j; k <= close; k++) chars[k] = ' ';
						j = close;
					}
				}
			}
		}
		i = lineEnd + 1;
	}
}

// --- token scanning on masked text ---

const TOKEN_RE = /([_^=]{0,2})([A-Ga-gxzZyY])([,']*)([\d./]*)?/g;

function parseToken(m, absStart) {
	const acc = m[1];
	const letter = m[2];
	const marks = m[3];
	const lenStr = m[4] || '';
	const isRest = 'xzZyY'.includes(letter);
	let d = null;
	if (!isRest) {
		const upper = letter === letter.toUpperCase();
		let oct = upper ? 3 : 4;
		for (const m of marks) oct += m === ',' ? -1 : 1;
		d = oct * 7 + LETTER_INDEX[letter.toUpperCase()];
	}
	return {
		start: absStart,
		end: absStart + m[0].length,
		text: m[0],
		acc, letter, marks, lenStr,
		len: parseLen(lenStr),
		isRest,
		d,
	};
}

function scanTokens(chars, start, end) {
	const text = chars.slice(start, end).join('');
	const tokens = [];
	TOKEN_RE.lastIndex = 0;
	let m;
	while ((m = TOKEN_RE.exec(text))) {
		const tok = parseToken(m, start + m.index);
		// a bare length run right after letters is part of the previous token only
		// when contiguous — the regex already handles that.
		tokens.push(tok);
	}
	return tokens;
}

// --- key signature ---

function accAlter(acc) {
	if (!acc) return null;
	let n = 0;
	for (const c of acc) {
		if (c === '^') n += 1;
		else if (c === '_') n -= 1;
		else if (c === '=') n = 0;
	}
	return n;
}

function findKeyBody(abc, start, before) {
	let body = '';
	let pos = start;
	while (pos <= before && pos < abc.length) {
		const nl = abc.indexOf('\n', pos);
		const lineEnd = nl === -1 ? abc.length : nl;
		if (abc.startsWith('K:', pos)) body = abc.slice(pos + 2, lineEnd).trim().split(/\s+/)[0] || '';
		if (nl === -1) break;
		pos = nl + 1;
	}
	return body;
}

function keyTonic(abc, start, before) {
	const m = /^([A-G])/.exec(findKeyBody(abc, start, before));
	return m ? m[1] : 'C';
}

// returns Map letter -> alteration (+1 sharp, -1 flat), read from the original
// (unmasked) text: last K: line starting at or before `before`.
function keySignature(abc, start, before) {
	const map = new Map();
	const body = findKeyBody(abc, start, before);
	if (!body || /^(none|nokeysig|clear)/i.test(body)) return map;
	const m = /^([A-G])([#b]{0,2})(.*)$/.exec(body);
	if (!m) return map;
	let fifths = LETTER_FIFTHS[LETTER_INDEX[m[1]]];
	fifths += m[2].split('').reduce((n, c) => n + (c === '#' ? 1 : -1), 0);
	const mode = (m[3] || '').toLowerCase().replace(/[^a-z]/g, '');
	const offset = Object.prototype.hasOwnProperty.call(MODE_OFFSET, mode) ? MODE_OFFSET[mode] : 0;
	const sharps = Math.max(-7, Math.min(7, fifths - offset));
	const order = sharps >= 0 ? 'FCGDAEB' : 'BEADGCF';
	for (let n = 0; n < Math.abs(sharps); n++) {
		map.set(order[n], sharps >= 0 ? 1 : -1);
	}
	return map;
}

// --- tune boundaries ---

export function tuneStarts(abc) {
	const starts = [];
	let at = 0;
	for (const line of abc.split('\n')) {
		if (line.startsWith('X:')) starts.push(at);
		at += line.length + 1;
	}
	return starts;
}

function tuneRange(abc, offset) {
	const starts = tuneStarts(abc);
	let s = 0;
	for (const st of starts) if (st <= offset) s = st; else break;
	const next = starts.find((st) => st > offset);
	return { start: s, end: next === undefined ? abc.length : next };
}

// --- selection/target resolution ---

function normalizeSelection(selection) {
	if (!selection || typeof selection.startChar !== 'number' || typeof selection.endChar !== 'number') return null;
	return { startChar: Math.max(0, Math.min(selection.startChar, selection.endChar)), endChar: Math.max(selection.startChar, selection.endChar) };
}

function findToken(tokens, selStart, selEnd) {
	const mid = selStart;
	for (const t of tokens) if (t.start <= mid && mid < t.end) return t;
	for (const t of tokens) {
		if (t.start < selEnd && selStart < t.end) return t;
	}
	let best = null;
	let bestDist = Infinity;
	for (const t of tokens) {
		const d = t.end <= selStart ? selStart - t.end : t.start - selEnd;
		if (d < bestDist) { bestDist = d; best = t; }
	}
	return bestDist <= 3 ? best : null;
}

function buildTokens(abc, selStart) {
	const chars = abc.split('');
	const range = tuneRange(abc, selStart);
	maskTune(chars, range.start, range.end);
	return { chars, tokens: scanTokens(chars, range.start, range.end), range };
}

// --- public API ---

export function locate(abc, selection) {
	const sel = normalizeSelection(selection);
	if (!sel) return null;
	const { tokens } = buildTokens(abc, sel.startChar);
	return findToken(tokens, sel.startChar, sel.endChar);
}

export function noteMidi(abc, selection) {
	const sel = normalizeSelection(selection);
	if (!sel) return null;
	const { tokens } = buildTokens(abc, sel.startChar);
	const tok = findToken(tokens, sel.startChar, sel.endChar);
	if (!tok || tok.isRest) return null;
	const keysig = keySignature(abc, 0, tok.start);
	const explicit = accAlter(tok.acc);
	const alt = explicit !== null ? explicit : keysig.get(tok.letter.toUpperCase()) || 0;
	return naturalMidi(tok.d) + alt;
}

export function edit(abc, selection, op) {
	try {
		const sel = normalizeSelection(selection);
		if (!sel && op.kind !== 'transpose') return { abc, selection: sel };
		if (op.kind === 'transpose') return transpose(abc, sel, op);

		const { tokens, range } = buildTokens(abc, sel.startChar);
		const tok = findToken(tokens, sel.startChar, sel.endChar);
		if (!tok) return { abc, selection: sel };

		if (op.kind === 'pitch' || op.kind === 'drag') {
			if (tok.isRest) return { abc, selection: sel };
			const newD = tok.d + op.steps;
			if (naturalMidi(newD) < MIN_NATURAL_MIDI || naturalMidi(newD) > MAX_NATURAL_MIDI) {
				return { abc, selection: sel };
			}
			const oct = Math.floor(newD / 7);
			const letter = INDEX_LETTER[newD % 7];
			const upper = oct < 4;
			const marks = upper ? ','.repeat(3 - oct) : "'".repeat(oct - 4);
			const newText = tok.acc + (upper ? letter : letter.toLowerCase()) + marks + tok.lenStr;
			const out = abc.slice(0, tok.start) + newText + abc.slice(tok.end);
			return { abc: out, selection: { startChar: tok.start, endChar: tok.start + newText.length } };
		}

		if (op.kind === 'accidental') {
			if (tok.isRest) return { abc, selection: sel };
			const char = { sharp: '^', flat: '_', natural: '=', none: '' }[op.accidental];
			if (char === undefined || char === tok.acc) return { abc, selection: sel };
			const newText = char + tok.letter + tok.marks + tok.lenStr;
			const out = abc.slice(0, tok.start) + newText + abc.slice(tok.end);
			return { abc: out, selection: { startChar: tok.start, endChar: tok.start + newText.length } };
		}

		if (op.kind === 'to-rest') {
			const newText = tok.isRest
				? (op.letter || keyTonic(abc, range.start, tok.start)) + tok.lenStr
				: 'z' + tok.lenStr;
			const out = abc.slice(0, tok.start) + newText + abc.slice(tok.end);
			return { abc: out, selection: { startChar: tok.start, endChar: tok.start + newText.length } };
		}

		if (op.kind === 'delete') {
			return { abc: abc.slice(0, tok.start) + abc.slice(tok.end), selection: null };
		}

		if (op.kind === 'insert') {
			const ins = op.what === 'rest' ? 'z' + tok.lenStr : tok.text;
			return { abc: abc.slice(0, tok.end) + ins + abc.slice(tok.end), selection: sel };
		}

		if (op.kind === 'duration') {
			const newLen = op.direction > 0 ? tok.len * 2 : tok.len / 2;
			if (newLen < 1 / 32) return { abc, selection: sel };
			const newText = tok.acc + tok.letter + tok.marks + lenText(newLen);
			const out = abc.slice(0, tok.start) + newText + abc.slice(tok.end);
			return { abc: out, selection: { startChar: tok.start, endChar: tok.start + newText.length } };
		}

		return { abc, selection: sel };
	} catch {
		return { abc, selection: selection };
	}
}

function transpose(abc, sel, op) {
	const ranges = [];
	if (sel) {
		ranges.push(tuneRange(abc, sel.startChar));
	} else {
		const starts = tuneStarts(abc);
		if (!starts.length) ranges.push({ start: 0, end: abc.length });
		else starts.forEach((st, i) => ranges.push({ start: st, end: starts[i + 1] ?? abc.length }));
	}
	const chars = abc.split('');
	const edits = [];
	for (const range of ranges) {
		maskTune(chars, range.start, range.end);
		for (const tok of scanTokens(chars, range.start, range.end)) {
			if (tok.isRest) continue;
			const keysig = keySignature(abc, range.start, tok.start);
			const explicit = accAlter(tok.acc);
			const sounding = naturalMidi(tok.d) + (explicit !== null ? explicit : keysig.get(INDEX_LETTER[tok.d % 7]) || 0);
			const newSounding = sounding + op.semitones;
			const [letter, alt] = SEMITONE_SPELL[((newSounding % 12) + 12) % 12];
			const newD = (Math.floor(newSounding / 12) - 1) * 7 + letter;
			if (naturalMidi(newD) < MIN_NATURAL_MIDI || naturalMidi(newD) > MAX_NATURAL_MIDI) continue;
			const oct = Math.floor(newD / 7);
			const upper = oct < 4;
			const marks = upper ? ','.repeat(3 - oct) : "'".repeat(oct - 4);
			const ks = keysig.get(INDEX_LETTER[newD % 7]) || 0;
			let acc = '';
			if (alt !== ks) acc = alt > 0 ? '^'.repeat(alt) : alt < 0 ? '_'.repeat(-alt) : '=';
			const newText = acc + (upper ? INDEX_LETTER[newD % 7] : INDEX_LETTER[newD % 7].toLowerCase()) + marks + tok.lenStr;
			if (newText !== tok.text) edits.push({ start: tok.start, end: tok.end, text: newText });
		}
	}
	edits.sort((a, b) => b.start - a.start);
	let out = abc;
	for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
	return { abc: out, selection: sel };
}
