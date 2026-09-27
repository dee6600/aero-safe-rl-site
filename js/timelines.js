// Timelines under a replay: the focus flight's four motor outputs and its
// detector's fault probability, then every shown flight's speed and
// altitude commands, all on the replay's clock. Drawn once per change of
// flights; only the cursor moves while playing.
import * as Plot from "@observablehq/plot";
import { ROTOR_NAMES, conditionColour, conditionLabel, escapeHtml, token } from "./common.js";

const HEIGHT = 92;
const MARGIN = { marginLeft: 44, marginRight: 12, marginTop: 8, marginBottom: 22 };

function series(f, values, every = 1) {
  const out = [];
  for (let i = 0; i < f.n; i += every) out.push({ t: f.t[i] - f.offset, v: values[i] });
  return out;
}

export class Timelines {
  constructor(el, replay) {
    this.el = el;
    this.replay = replay;
    el.classList.add("timelines");
    replay.on("load", () => this.render());
    replay.on("state", () => { if (this._shownKey() !== this.drawnKey) this.render(); });
    replay.on("time", (t) => this.moveCursor(t));
    window.addEventListener("themechange", () => this.render());
    new ResizeObserver(() => {
      if (Math.abs(this.el.clientWidth - (this.drawnWidth ?? 0)) > 4) this.render();
    }).observe(el);
  }

  _shownKey() {
    return this.replay.flights.filter((f) => f.shown).map((f) => f.key).join("|") + "#" + this.replay.focus;
  }

  render() {
    const r = this.replay;
    if (!r.flights?.length || !this.el.clientWidth) return;
    this.drawnKey = this._shownKey();
    this.drawnWidth = this.el.clientWidth;
    const width = this.el.clientWidth;
    const shown = r.flights.filter((f) => f.shown);
    const focus = r.flights.find((f) => f.key === r.focus) ?? shown[0];
    const x = { domain: r.domain, label: null, tickFormat: (d) => `${d > 0 ? "+" : ""}${d}s` };
    const onset = r.align === "onset" ? [Plot.ruleX([0], { stroke: token("--weak-rotor"), strokeDasharray: "4 3" })] : [];
    const grid = Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 });
    const common = { width, height: HEIGHT, ...MARGIN, x, style: { background: "transparent", color: token("--muted"), fontSize: "11px" } };
    const weak = focus?.rotor ?? -1;
    this.el.innerHTML = "";
    const tracks = [];

    if (focus) {
      const motors = [0, 1, 2, 3].flatMap((k) => series(focus, focus.m[k]).map((d) => ({ ...d, k })));
      tracks.push({
        title: `<b>Motor outputs</b> · ${escapeHtml(conditionLabel(r.site, focus.condition))}
          ${weak >= 0 ? `<span class="key" style="--c:${token("--weak-rotor")}"><i></i>${ROTOR_NAMES[weak]} (weak) rotor</span>` : ""}
          <span class="key" style="--c:${token("--muted")}"><i></i>${weak >= 0 ? "other three" : "four rotors"}</span>`,
        plot: Plot.plot({
          ...common, y: { domain: [0, 1], ticks: 3, label: null },
          marks: [grid, ...onset,
            Plot.line(motors.filter((d) => d.k !== weak), { x: "t", y: "v", z: "k", stroke: token("--muted"), strokeWidth: 1.3, strokeOpacity: 0.8 }),
            Plot.line(motors.filter((d) => d.k === weak), { x: "t", y: "v", stroke: token("--weak-rotor"), strokeWidth: 2 })],
        }),
      });
      const p = focus.p;
      tracks.push({
        title: p ? `<b>Fault detector</b> · probability of a fault
            <span class="key" style="--c:${token("--weak-rotor")}"><i style="height:8px;opacity:.35"></i>alarm raised</span>`
          : `<b>Fault detector</b> · ${escapeHtml(conditionLabel(r.site, focus.condition))} flies without a detector`,
        plot: p ? Plot.plot({
          ...common, y: { domain: [0, 1], ticks: 3, label: null },
          marks: [grid, ...onset,
            Plot.areaY(series(focus, focus.alarm), { x: "t", y: "v", curve: "step-after", fill: token("--weak-rotor"), fillOpacity: 0.2 }),
            Plot.line(series(focus, p), { x: "t", y: "v", stroke: token("--ink"), strokeWidth: 1.6 })],
        }) : null,
      });
    }
    const perFlight = (values) => shown.flatMap((f) => series(f, f[values]).map((d) => ({ ...d, key: f.key })));
    const colours = Object.fromEntries(shown.map((f) => [f.key, conditionColour(r.site, f.condition)]));
    const lines = (field) => shown.map((f) => Plot.line(series(f, f[field]), {
      x: "t", y: "v", stroke: colours[f.key], strokeWidth: f.key === focus?.key ? 2.2 : 1.4,
      strokeOpacity: f.key === focus?.key ? 1 : 0.75,
    }));
    const lands = shown.flatMap((f) => {
      const i = f.land.indexOf(1);
      return i >= 0 ? [{ t: f.t[i] - f.offset, key: f.key }] : [];
    });
    const keys = shown.map((f) => `<span class="key" style="--c:${colours[f.key]}"><i></i>${escapeHtml(conditionLabel(r.site, f.condition))}</span>`).join("");
    tracks.push({
      title: `<b>Speed command</b> · 1 = the mission's normal speed ${lands.length ? "· ▼ the policy commanded a landing" : ""}`,
      plot: Plot.plot({
        ...common, y: { domain: [0, 1.05], ticks: 3, label: null },
        marks: [grid, ...onset, ...lines("speed"),
          Plot.dot(lands, { x: "t", y: 1.02, symbol: "triangle", r: 5, rotate: 180, fill: (d) => colours[d.key] })],
      }),
    });
    const lowest = Math.min(this.replay.site.action_spec.low[1], -0.5);
    tracks.push({
      title: `<b>Altitude offset command</b> · metres below the mission altitude <span style="margin-left:auto"></span>${keys}`,
      plot: Plot.plot({
        ...common, y: { domain: [lowest, 0.1], ticks: 3, label: null },
        marks: [grid, ...onset, ...lines("alt")],
      }),
    });

    for (const tr of tracks) {
      const wrap = document.createElement("div");
      wrap.className = "track";
      wrap.innerHTML = `<div class="track-title">${tr.title}</div>`;
      if (tr.plot) wrap.appendChild(tr.plot);
      this.el.appendChild(wrap);
    }
    this.scale = tracks.find((t) => t.plot)?.plot.scale("x");
    this.cursor = document.createElement("div");
    this.cursor.className = "cursor";
    this.el.appendChild(this.cursor);
    const scrub = document.createElement("div");
    scrub.className = "scrub";
    scrub.title = "Drag to scrub";
    this.el.appendChild(scrub);
    const seek = (e) => {
      const box = this.el.getBoundingClientRect();
      const px = Math.min(Math.max(e.clientX - box.left, MARGIN.marginLeft), width - MARGIN.marginRight);
      r.pause();
      r.seek(this.scale.invert(px));
    };
    scrub.addEventListener("pointerdown", (e) => { scrub.setPointerCapture(e.pointerId); seek(e); });
    scrub.addEventListener("pointermove", (e) => { if (e.buttons) seek(e); });
    this.moveCursor(r.time);
  }

  moveCursor(t) {
    if (!this.scale || !this.cursor) return;
    this.cursor.style.left = `${this.scale.apply(t)}px`;
  }
}
