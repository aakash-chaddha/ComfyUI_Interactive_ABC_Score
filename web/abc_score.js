import { app } from "../../scripts/api.js";
import { edit, locate, noteMidi, tuneStarts } from "./edit_model.js";

const ABCJS_GLOBAL = "ABCJS";
let abcjsReady = null;

function loadAbcjs() {
	if (window[ABCJS_GLOBAL]) return Promise.resolve(window[ABCJS_GLOBAL]);
	if (!abcjsReady) {
		abcjsReady = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = new URL("./vendor/abcjs/abcjs-basic-min.js", import.meta.url).href;
			script.onload = () => resolve(window[ABCJS_GLOBAL]);
			script.onerror = () => reject(new Error("failed to load vendored abcjs"));
			document.head.appendChild(script);
		});
	}
	return abcjsReady;
}

function soundFontUrl() {
	return localStorage.getItem("AbcScore.soundFontUrl") || new URL("./soundfont/", import.meta.url).href;
}

const CURSOR_COLOR = "#e04040";
const UNDO_LIMIT = 100;

const CSS = `
.abcs-root { font-family: sans-serif; font-size: 12px; color: #ddd; display: flex; flex-direction: column; gap: 4px; height: 100%; width: 100%; overflow: hidden; box-sizing: border-box; }
.abcs-root * { box-sizing: border-box; }
.abcs-header { display: flex; align-items: center; gap: 6px; flex: none; }
.abcs-source { opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.abcs-hint { color: #e8a04f; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.abcs-root button { background: #353535; color: #ddd; border: 1px solid #555; border-radius: 3px; padding: 2px 6px; cursor: pointer; }
.abcs-root button:hover { background: #484848; }
.abcs-root button.abcs-on { background: #4a7a4a; border-color: #6a9a6a; }
.abcs-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.abcs-pane.abcs-hidden { display: none; }
.abcs-scroll { flex: 1 1 auto; overflow-y: auto; }
.abcs-warnings { color: #c96; font-size: 11px; white-space: pre-wrap; flex: none; }
.abcs-notune { color: #888; padding: 8px; }
.abcs-paper svg { display: block; }
.abcs-pane-text textarea { flex: 1 1 auto; width: 100%; background: #1e1e1e; color: #cde; border: 1px solid #444; font-family: monospace; font-size: 12px; resize: none; }
.abcs-player { display: flex; align-items: center; gap: 6px; flex: none; }
.abcs-player input[type=range] { flex: 1 1 auto; }
.abcs-tempo { width: 90px; flex: none; }
.abcs-tempo-label { width: 34px; text-align: right; flex: none; }
.abcs-audio-hint { color: #888; }
`;

let cssInjected = false;
function injectCss() {
	if (cssInjected) return;
	cssInjected = true;
	const style = document.createElement("style");
	style.textContent = CSS;
	document.head.appendChild(style);
}

class AbcScorePane {
	constructor(node) {
		this.node = node;
		this.selection = null;
		this.undoStack = [];
		this.redoStack = [];
		this.tempo = 1.0;
		this.loop = false;
		this.playing = false;
		this.tuneIdx = 0;
		this.synth = null;
		this.tc = null;
		this.pollTimer = null;
		this.mirrorCache = null;
		this.renderPending = false;
		this.editor = null;
		this.selectableMaps = [];
		this.prevCursor = null;

		injectCss();
		this.#buildDom();
		this.#bindKeys();
		this.refreshLink();
		loadAbcjs().then(() => this.#createEditor()).catch((e) => { this.setHint(e.message); });
		this.mirrorTimer = setInterval(() => this.#mirrorTick(), 500);
		this.idleTimer = setInterval(() => { if (this.renderPending && !this.#isIdle()) { this.renderPending = false; this.editor?.fireChanged(); } }, 1000);
	}

	// --- DOM ---

	#buildDom() {
		const root = document.createElement("div");
		root.className = "abcs-root";
		root.innerHTML = `
			<div class="abcs-header">
				<span class="abcs-source"></span>
				<button class="abcs-detach" style="display:none">Detach &amp; edit</button>
				<span class="abcs-hint"></span>
				<button class="abcs-toggle" data-pane="score">score</button>
				<button class="abcs-toggle" data-pane="text">text</button>
				<button class="abcs-toggle" data-pane="player">player</button>
			</div>
			<div class="abcs-pane abcs-pane-score">
				<div class="abcs-scroll">
					<div class="abcs-paper"></div>
					<div class="abcs-notune" style="display:none">no tune found</div>
				</div>
				<div class="abcs-warnings"></div>
			</div>
			<div class="abcs-pane abcs-pane-text abcs-hidden"><textarea spellcheck="false"></textarea></div>
			<div class="abcs-pane abcs-pane-player abcs-hidden">
				<div class="abcs-player">
					<button class="abcs-play">&#9654;</button>
					<button class="abcs-restart" title="restart">&#9198;</button>
					<button class="abcs-loop" title="loop">&#10227;</button>
					<input class="abcs-progress" type="range" min="0" max="100" value="0" step="0.1">
					<span class="abcs-audio-hint"></span>
				</div>
				<div class="abcs-player">
					<span>tempo</span>
					<input class="abcs-tempo" type="range" min="25" max="400" value="100">
					<span class="abcs-tempo-label">100%</span>
					<span>transpose</span>
					<button class="abcs-transpose-down" title="transpose down a semitone">−1</button>
					<button class="abcs-transpose-up" title="transpose up a semitone">+1</button>
				</div>
			</div>
		`;
		this.root = root;

		this.el = (name) => root.querySelector(name);
		this.textarea = this.el(".abcs-pane-text textarea");
		this.paper = this.el(".abcs-paper");

		root.querySelectorAll(".abcs-toggle").forEach((btn) => {
			const pane = btn.dataset.pane;
			btn.classList.add("abcs-on");
			btn.onclick = () => {
				const paneEl = this.el(`.abcs-pane-${pane}`);
				paneEl.classList.toggle("abcs-hidden");
				btn.classList.toggle("abcs-on");
				if (pane === "text") this.#syncTextarea();
				this.scheduleRender();
			};
		});

		this.el(".abcs-detach").onclick = () => this.detach();
		this.el(".abcs-play").onclick = () => this.playToggle();
		this.el(".abcs-restart").onclick = () => this.stopPlayer().then(() => this.playFrom(0));
		this.el(".abcs-loop").onclick = (e) => {
			this.loop = !this.loop;
			e.target.classList.toggle("abcs-on", this.loop);
		};
		this.el(".abcs-progress").oninput = (e) => this.seek(e.target.value / 100);
		this.el(".abcs-tempo").oninput = (e) => {
			this.tempo = e.target.value / 100;
			this.el(".abcs-tempo-label").textContent = `${e.target.value}%`;
			if (this.playing) {
				const pct = this.tc?.lastMoment ? this.tc.currentMillisecond() / this.tc.lastMoment : 0;
				this.#startTune(this.tuneIdx, pct);
			}
		};
		this.el(".abcs-transpose-down").onclick = () => this.applyEdit({ kind: "transpose", semitones: -1 });
		this.el(".abcs-transpose-up").onclick = () => this.applyEdit({ kind: "transpose", semitones: 1 });
		this.el(".abcs-audio-hint").textContent = "click play to enable audio";

		this.textarea.addEventListener("input", () => {
			if (this.isLinked()) return;
			this.#setWidgetValue(this.textarea.value);
			this.selection = null; // char-offset selections do not survive raw typing
			this.scheduleRender();
		});

		this.node.addDOMWidget("abc-score", "abcscore", root, { serialize: false, hideOnZoom: false });
		const domWidget = this.node.widgets.find((w) => w.name === "abc-score");
		domWidget.computeSize = () => [this.node.size[0] - 22, Math.max(120, this.node.size[1] - 52)];
	}

	setHint(text) {
		this.el(".abcs-hint").textContent = text || "";
		if (text) setTimeout(() => { if (this.el(".abcs-hint").textContent === text) this.el(".abcs-hint").textContent = ""; }, 4000);
	}

	// --- widget value / linked state ---

	widget() {
		return this.node.widgets?.find((w) => w.name === "abc");
	}

	#widgetValue() {
		const w = this.widget();
		return w ? w.value : this.textarea.value;
	}

	#setWidgetValue(value) {
		const w = this.widget();
		if (w) w.value = value;
	}

	isLinked() {
		return !!this.node.inputs?.find((i) => i.name === "abc")?.link;
	}

	refreshLink() {
		const input = this.node.inputs?.find((i) => i.name === "abc");
		const linked = !!input?.link;
		const label = this.el(".abcs-source");
		if (linked) {
			const link = app.graph?._links?.get(input.link);
			const origin = link ? app.graph.getNodeById(link.origin_id) : null;
			label.textContent = `ABC Score — from: ${origin ? origin.title : "link"}`;
			if (this.undoStack.length || this.redoStack.length) this.invalidateUndoOnNextGesture();
			this.undoStack = [];
			this.redoStack = [];
		} else {
			label.textContent = "ABC Score — self";
		}
		this.el(".abcs-detach").style.display = linked ? "" : "none";
		this.textarea.readOnly = linked;
		if (!linked) {
			this.#syncTextarea();
			const w = this.widget();
			if (w) w.computeSize = () => [0, -4]; // the pane owns the visible text
		}
		this.mirrorCache = null;
	}

	upstreamValue() {
		const input = this.node.inputs?.find((i) => i.name === "abc");
		const link = input?.link ? app.graph?._links?.get(input.link) : null;
		if (!link) return null;
		const origin = app.graph.getNodeById(link.origin_id);
		const w = origin?.widgets?.[link.origin_slot] ?? origin?.widgets?.[0];
		return typeof w?.value === "string" ? w.value : null;
	}

	#mirrorTick() {
		if (!this.isLinked()) return;
		const v = this.upstreamValue();
		if (v === null || v === this.mirrorCache) return;
		this.mirrorCache = v;
		this.setAbc(v);
	}

	adopt(text) {
		if (typeof text === "string" && text !== this.#widgetValue()) this.setAbc(text);
	}

	setAbc(text) {
		this.#writeText(text, null);
	}

	#syncTextarea() {
		const v = this.#widgetValue();
		if (v !== undefined && this.textarea.value !== v) this.textarea.value = v ?? "";
	}

	detach() {
		const input = this.node.inputs?.find((i) => i.name === "abc");
		if (!input?.link) return;
		const text = this.#widgetValue() || this.textarea.value;
		app.graph.removeLink(input.link);
		if (!this.widget() && this.node.convertInputToWidget) this.node.convertInputToWidget("abc", "STRING");
		this.refreshLink();
		this.setAbc(text);
	}

	// --- rendering ---

	scheduleRender() {
		if (this.#isIdle()) {
			this.renderPending = true;
			return;
		}
		this.renderPending = false;
		this.editor?.fireChanged();
	}

	#isIdle() {
		if (this.node.collapsed) return true;
		if (!this.root.isConnected) return true;
		const scale = app.canvas?.scale?.[0] ?? 1;
		if (scale < 0.3) return true;
		return false;
	}

	#createEditor() {
		const ABCJS = window[ABCJS_GLOBAL];
		this.#syncTextarea();
		this.editor = new ABCJS.Editor(this.textarea, {
			canvas_id: this.paper,
			warnings_id: this.el(".abcs-warnings"),
			render_options: {
				responsive: "width",
				dragging: true,
				selectionColor: "#5b7fd4",
				selectTypes: ["note", "bar", "keysig", "timesig", "clef", "title", "subtitle", "tempo", "dynamic", "volume", "part", "annotation", "word", "other"],
			},
			abcjsParams: {
				clickListener: (abcelem, tuneNumber, classesStr, analysis, drag) => this.#onClick(abcelem, tuneNumber, drag),
			},
			redrawCallback: (bLoading) => {
				if (!bLoading) this.#afterRender();
			},
		});
		this.#afterRender();
	}

	#afterRender() {
		// redrawCallback can fire during the Editor constructor, before this.editor is assigned
		if (!this.editor) return;
		const tunes = this.editor.getTunes();
		this.el(".abcs-notune").style.display = tunes.length ? "none" : "";
		this.selectableMaps = tunes.map((tune) => {
			const map = new Map();
			for (const sel of tune.getSelectableArray()) {
				const abs = sel.absEl;
				if (abs?.abcelem?.startChar != null && !map.has(abs.abcelem.startChar)) map.set(abs.abcelem.startChar, abs);
			}
			return map;
		});
		this.prevCursor = null;
		if (this.playing) this.#startTune(this.tuneIdx); // re-prime audio only when the text actually changed
	}

	// --- score interaction ---

	#onClick(abcelem, tuneNumber, drag) {
		if (drag && drag.step) {
			this.selection = this.#absSelection(abcelem, tuneNumber);
			this.applyEdit({ kind: "drag", steps: -drag.step });
			return;
		}
		this.selection = this.#absSelection(abcelem, tuneNumber);
		const abc = this.#widgetValue() || "";
		const midi = noteMidi(abc, this.selection);
		if (midi === null) return;
		const tok = locate(abc, this.selection);
		const meter = this.editor.getTunes()[tuneNumber]?.getMeterFraction?.() ?? { num: 4, den: 4 };
		const eighthsPerMeasure = ((meter.num ?? 4) * 8) / (meter.den ?? 4);
		this.playNote(midi, Math.min(1, (tok?.len ?? 1) / eighthsPerMeasure));
	}

	#absSelection(abcelem, tuneNumber) {
		const starts = tuneStarts(this.#widgetValue() || "");
		const offset = starts[tuneNumber] ?? 0;
		return { startChar: (abcelem.startChar ?? 0) + offset, endChar: (abcelem.endChar ?? abcelem.startChar ?? 0) + offset };
	}

	applyEdit(op) {
		if (this.isLinked()) {
			this.setHint("score comes from a linked text node — use Detach & edit to change it");
			return;
		}
		const abc = this.#widgetValue() || "";
		const out = edit(abc, this.selection, op);
		if (out.abc === abc) return;
		this.undoStack.push(abc);
		if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
		this.redoStack = [];
		this.#writeText(out.abc, out.selection);
	}

	undoEdit() {
		const current = this.#widgetValue() || "";
		const prev = this.undoStack.pop();
		if (prev === undefined) return;
		this.redoStack.push(current);
		this.#writeText(prev, null);
	}

	redoEdit() {
		const current = this.#widgetValue() || "";
		const next = this.redoStack.pop();
		if (next === undefined) return;
		this.undoStack.push(current);
		this.#writeText(next, null);
	}

	#writeText(text, selection) {
		this.textarea.value = text;
		this.#setWidgetValue(text);
		this.selection = selection;
		this.scheduleRender();
	}

	#bindKeys() {
		// Bound on the node root; abcjs owns arrow/Enter keys on focused selectables.
		this.root.addEventListener("keydown", (e) => {
			if (e.target === this.textarea || !e.key) return;
			const ctrl = e.ctrlKey || e.metaKey;
			if (ctrl && e.key.toLowerCase() === "z") {
				e.preventDefault();
				e.stopPropagation();
				e.shiftKey ? this.redoEdit() : this.undoEdit();
				return;
			}
			if (ctrl && e.key.toLowerCase() === "y") {
				e.preventDefault();
				this.redoEdit();
				return;
			}
			if (ctrl) return;
			let op = null;
			switch (e.key) {
				case "<": op = { kind: "duration", direction: -1 }; break;
				case ">": op = { kind: "duration", direction: 1 }; break;
				case "^": case "#": op = { kind: "accidental", accidental: "sharp" }; break;
				case "_": case "b": op = { kind: "accidental", accidental: "flat" }; break;
				case "=": op = { kind: "accidental", accidental: "natural" }; break;
				case "0": op = { kind: "accidental", accidental: "none" }; break;
				case "r": op = { kind: "to-rest" }; break;
				case "i": op = { kind: "insert", after: true, what: "note" }; break;
				case "I": op = { kind: "insert", after: true, what: "rest" }; break;
				case "Delete": case "Backspace": op = { kind: "delete" }; break;
				default: return;
			}
			e.preventDefault();
			e.stopPropagation();
			this.applyEdit(op);
		});
	}

	// --- playback ---

	abcjs() {
		return window[ABCJS_GLOBAL];
	}

	soundFont() {
		return soundFontUrl();
	}

	playNote(midi, durationLen) {
		const ABCJS = this.abcjs();
		if (!ABCJS?.synth?.playEvent) return;
		const tunes = this.editor?.getTunes();
		const mpm = tunes?.[0]?.millisecondsPerMeasure() ?? 2000;
		ABCJS.synth.playEvent(
			[{ pitch: midi, duration: durationLen, volume: 7, instrument: 0 }],
			null,
			mpm,
			this.soundFont(),
		);
	}

	async playToggle() {
		if (this.playing) {
			await this.stopPlayer();
			this.setPlayButton(false);
		} else {
			await this.playFrom(this.tuneIdx || 0);
		}
	}

	async playFrom(tuneIdx) {
		if (!this.editor) return;
		this.stopPlayer();
		if (!this.editor.getTunes().length) return;
		this.el(".abcs-audio-hint").textContent = "";
		this.tuneIdx = tuneIdx;
		this.playing = true;
		this.setPlayButton(true);
		await this.#startTune(tuneIdx);
	}

	async #startTune(tuneIdx, startPercent = 0) {
		const ABCJS = this.abcjs();
		const tunes = this.editor.getTunes();
		if (!tunes.length) { await this.stopPlayer(); return; }
		if (tuneIdx >= tunes.length) {
			if (this.loop) return this.#startTune(0);
			await this.stopPlayer();
			this.setPlayButton(false);
			return;
		}
		if (this.synth) { try { this.synth.stop(); } catch { /* already gone */ } }
		if (this.tc) { this.tc.stop(); this.tc = null; }
		this.prevCursor = null;
		const tune = tunes[tuneIdx];
		const bpm = tune.getBpm?.() ?? 120;
		const synth = new ABCJS.synth.CreateSynth();
		this.synth = synth;
		try {
			await synth.init({
				visualObj: tune,
				millisecondsPerMeasure: tune.millisecondsPerMeasure() / this.tempo,
				options: { soundFontUrl: this.soundFont() },
			});
			await synth.prime();
		} catch (err) {
			this.setHint(`audio unavailable: ${err?.status || err?.message || err}`);
			await this.stopPlayer();
			this.setPlayButton(false);
			return;
		}
		if (this.synth !== synth) return; // superseded while priming
		this.tc = new ABCJS.TimingCallbacks(tune, {
			qpm: bpm * this.tempo,
			eventCallback: (e) => this.#onCursorEvent(tuneIdx, e),
		});
		this.tc.start(startPercent);
		if (startPercent > 0) synth.seek(startPercent);
		synth.start();
		this.#startPolling();
	}

	#startPolling() {
		if (this.pollTimer) return;
		this.pollTimer = setInterval(() => {
			if (!this.tc || !this.playing) return;
			const last = this.tc.lastMoment || 1;
			const now = this.tc.currentMillisecond();
			const progress = this.el(".abcs-progress");
			progress.value = Math.min(100, (now / last) * 100);
			if (now >= last) {
				const next = this.tuneIdx + 1;
				if (next < this.editor.getTunes().length || this.loop) this.#startTune(next % this.editor.getTunes().length);
				else { this.stopPlayer(); this.setPlayButton(false); }
			}
		}, 200);
	}

	#onCursorEvent(tuneIdx, e) {
		if (!e) return;
		const map = this.selectableMaps[tuneIdx];
		if (!map) return;
		const target = map.get(e.startChar);
		if (!target || target === this.prevCursor) return;
		if (this.prevCursor?.unhighlight) { try { this.prevCursor.unhighlight(undefined, CURSOR_COLOR); } catch { /* repainted */ } }
		this.prevCursor = target;
		if (target.highlight) { try { target.highlight(undefined, CURSOR_COLOR); } catch { /* repainted */ } }
	}

	async stopPlayer() {
		this.playing = false;
		if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
		if (this.synth) { try { this.synth.stop(); } catch { /* idle */ } this.synth = null; }
		if (this.tc) { try { this.tc.stop(); } catch { /* idle */ } this.tc = null; }
		if (this.prevCursor?.unhighlight) { try { this.prevCursor.unhighlight(undefined, CURSOR_COLOR); } catch { /* repainted */ } }
		this.prevCursor = null;
	}

	seek(percent) {
		if (!this.tc) return;
		this.synth?.seek(percent);
		this.tc.setProgress(percent);
	}

	setPlayButton(on) {
		this.el(".abcs-play").innerHTML = on ? "&#10074;&#10074;" : "&#9654;";
	}

	destroy() {
		this.stopPlayer();
		clearInterval(this.mirrorTimer);
		clearInterval(this.idleTimer);
	}
}

app.registerExtension({
	name: "Comfy.ABCScore",
	beforeRegisterNodeDef(nodeType, nodeData) {
		if (nodeData.name !== "AbcScore") return;
		const origCreated = nodeType.prototype.onNodeCreated;
		nodeType.prototype.onNodeCreated = function () {
			const r = origCreated?.apply(this, arguments);
			this.setSize?.([720, 520]);
			const w = this.widgets?.find((x) => x.name === "abc");
			if (w) w.computeSize = () => [0, -4];
			this.abcPane = new AbcScorePane(this);
			return r;
		};
		nodeType.prototype.onExecuted = function (message) {
			this.abcPane?.adopt(message?.text?.[0]);
		};
		const origConnChange = nodeType.prototype.onConnectionsChange;
		nodeType.prototype.onConnectionsChange = function (...args) {
			const r = origConnChange?.apply(this, args);
			this.abcPane?.refreshLink();
			return r;
		};
		const origDestroy = nodeType.prototype.onDestroy;
		nodeType.prototype.onDestroy = function () {
			this.abcPane?.destroy();
			return origDestroy?.apply(this, arguments);
		};
	},
});
