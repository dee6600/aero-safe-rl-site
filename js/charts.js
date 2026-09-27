// Every results chart on the story page. Each reads one field of
// results/m10/results.json or results/m11/results.json (copied unchanged
// into site/data/) and draws it; none computes a rate or an interval.
import * as Plot from "@observablehq/plot";
import { OUTCOMES, conditionColour, conditionLabel, escapeHtml, pct, pct0, pts, range, sev, token } from "./common.js";

const drawn = [];
/** Draw now and again whenever the theme changes. */
export function chart(el, draw) {
  const run = () => {
    el.replaceChildren();
    const out = draw();
    if (out) el.append(...[out].flat());
  };
  drawn.push(run);
  run();
  let width = el.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - width) > 24) { width = el.clientWidth; run(); }
  }).observe(el);
}
window.addEventListener("themechange", () => drawn.forEach((run) => run()));

function base(el, extra = {}) {
  return {
    width: Math.max(280, el.clientWidth),
    style: { background: "transparent", color: token("--muted"), fontSize: "12px", fontFamily: "var(--sans)" },
    marginLeft: 44, marginBottom: 40, ...extra,
  };
}
const grid = () => Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 });
const SEVERITIES = ["0.00", "0.20", "0.30", "0.35", "0.40", "0.45", "0.50", "0.70", "1.00"];
const sevLabel = (s) => (Number(s) === 0 ? "healthy" : `${pct0(Number(s))}%`);

// ------------------------------------------------------------ outcomes by severity

/** Rate against severity, with intervals, for the conditions switched on. */
export function outcomesBySeverity(el, m10, site, outcome, shown) {
  return () => {
    const conds = shown().filter((c) => m10.main[c]);
    const rows = conds.flatMap((c, i) => Object.entries(m10.main[c]).map(([s, cell]) => ({
      c, s, i, ...cell[outcome], label: conditionLabel(site, c),
    })));
    const dx = (c) => (conds.indexOf(c) - (conds.length - 1) / 2) * 7;
    return Plot.plot({
      ...base(el, { height: 300 }),
      x: { type: "point", domain: SEVERITIES, tickFormat: sevLabel, label: "rotor weakened by →", padding: 0.3 },
      y: { domain: [0, 1], tickFormat: (d) => `${pct0(d)}%`, label: null, ticks: 5 },
      marks: [
        grid(),
        ...conds.flatMap((c) => {
          const d = rows.filter((r) => r.c === c);
          const colour = conditionColour(site, c);
          const dash = site.conditions[c]?.dash ?? null;
          return [
            Plot.line(d, { x: "s", y: "rate", stroke: colour, strokeWidth: 2, strokeDasharray: dash, dx: dx(c) }),
            Plot.ruleX(d, { x: "s", y1: "lo", y2: "hi", stroke: colour, strokeWidth: 2, strokeOpacity: 0.55, dx: dx(c) }),
            Plot.dot(d, {
              x: "s", y: "rate", fill: colour, r: 4, stroke: token("--surface"), strokeWidth: 1.5, dx: dx(c),
              title: (r) => `${r.label}\nrotor weakened by ${sevLabel(r.s)}\n${pct(r.rate)} ${range(r)}\n${r.k} of ${r.n} flights`,
              tip: { fill: token("--surface-2"), stroke: token("--border-strong"), textColor: token("--ink") },
            }),
          ];
        }),
      ],
    });
  };
}

// ------------------------------------------------------------ interval rows (comparisons, generalization)

/** Rows of "A minus B" differences with their 95% intervals, drawn as
 *  HTML so long labels wrap on a phone. `rows`: {label, sub, r, holds,
 *  better} where r = {difference, lo, hi} and better = +1 when up is good. */
export function intervalRows(rows, domain = [-0.4, 0.8]) {
  const wrap = document.createElement("div");
  wrap.className = "irows";
  const x = (v) => ((Math.min(Math.max(v, domain[0]), domain[1]) - domain[0]) / (domain[1] - domain[0])) * 100;
  const ticks = [];
  for (let t = Math.ceil(domain[0] * 5) / 5; t <= domain[1] + 1e-9; t += 0.2) ticks.push(Math.round(t * 100) / 100);
  wrap.innerHTML = `
    <div class="irow axis"><div></div><div class="ibar">${ticks.map((t) => `<span style="left:${x(t)}%">${t === 0 ? "0" : pts(t)}</span>`).join("")}</div><div></div></div>
    ${rows.map((row) => `
    <div class="irow">
      <div class="ilabel">${row.label}${row.sub ? `<div class="small muted">${row.sub}</div>` : ""}</div>
      <div class="ibar" title="${escapeHtml(`${pts(row.r.difference)} points (${pts(row.r.lo)} to ${pts(row.r.hi)})`)}">
        ${ticks.map((t) => `<i class="${t === 0 ? "zero" : ""}" style="left:${x(t)}%"></i>`).join("")}
        <b style="left:${x(row.r.lo)}%;width:${Math.max(x(row.r.hi) - x(row.r.lo), 0.6)}%"></b>
        <em class="${row.holds ? "holds" : ""}" style="left:${x(row.r.difference)}%"></em>
      </div>
      <div class="iverdict ${row.holds ? "holds" : ""}">${row.holds ? "holds" : "does not hold"}<div class="small muted mono">${pts(row.r.difference)} (${pts(row.r.lo)} to ${pts(row.r.hi)})</div></div>
    </div>`).join("")}`;
  return wrap;
}

const OUTCOME_WORD = { mission_success: "finishing the mission", crash: "crashing", safe_landing: "landing safely" };
const pc = (v) => `${Number((100 * v).toFixed(1))}`;   // a severity as a percentage: 0.425 -> "42.5"
const sevRange = (list) => (list.length > 1 ? `${pc(list[0])}–${pc(list.at(-1))}%` : `${pc(list[0])}%`);

export function comparisons(m10, site) {
  return () => intervalRows(m10.comparisons.map((c) => ({
    label: `<b>${escapeHtml(cap(conditionLabel(site, c.a)))}</b> against ${escapeHtml(conditionLabel(site, c.b))}`,
    sub: `${OUTCOME_WORD[c.outcome]}, rotor weakened by ${sevRange(c.severities.map(Number))}${c.outcome === "crash" ? " · lower is better" : ""}`,
    r: c.result, holds: c.result.holds,
  })), [-0.4, 0.8]);
}

export function generalization(m11) {
  return () => intervalRows(Object.values(m11.settings).flatMap((s) => {
    // settings whose check asks for an advantage; "not worse" checks are a different question
    const c = s.checks.find((k) => k.id === "edge" && k.expect === "better");
    if (!c) return [];
    const far = s.distance?.outside ? " · outside training" : "";
    return [{
      label: `<b>${escapeHtml(cap(s.label))}</b>`,
      sub: `learned against ${c.b?.endsWith("c2") ? "no recovery" : "its unblanked self"}, finishing at ${sevRange(c.severities)}${far}`,
      r: c.result, holds: c.holds,
    }];
  }), [-0.4, 0.8]);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------ does the detector matter

export function detectorDelay(el, m10, site, severity, outcome) {
  return () => {
    const cells = m10.delay_curve[severity];
    const order = ["c5", "c5_delay1s", "c5_delay2s", "c4", "c6"].filter((c) => cells[c]);
    const rows = order.map((c) => ({ c, label: conditionLabel(site, c), ...cells[c][outcome] }));
    return Plot.plot({
      ...base(el, { height: 44 + 34 * rows.length, marginLeft: 12, marginBottom: 32 }),
      x: { domain: [0, outcome === "crash" ? 1 : 0.6], tickFormat: (d) => `${pct0(d)}%`, label: null, ticks: 4, grid: true },
      y: { domain: rows.map((r) => r.label), axis: null },
      marks: [
        Plot.gridX({ stroke: token("--grid"), strokeOpacity: 1 }),
        Plot.ruleY(rows, { y: "label", x1: "lo", x2: "hi", stroke: (r) => conditionColour(site, r.c), strokeWidth: 3, strokeOpacity: 0.55 }),
        Plot.dot(rows, {
          y: "label", x: "rate", r: 6, fill: (r) => conditionColour(site, r.c), stroke: token("--surface"), strokeWidth: 1.5,
          title: (r) => `${r.label}\n${pct(r.rate)} ${range(r)}\n${r.k} of ${r.n} flights`, tip: tipStyle(),
        }),
        Plot.text(rows, { y: "label", x: 0, text: "label", textAnchor: "start", dy: -13, fill: token("--ink-2"), fontSize: 11.5 }),
      ],
    });
  };
}

const tipStyle = () => ({ fill: token("--surface-2"), stroke: token("--border-strong"), textColor: token("--ink") });

// ------------------------------------------------------------ Isaac against PX4

export function transfer(el, m10, site, outcome) {
  return () => {
    const cells = m10.transfer.rows.flatMap((row) => Object.entries(row.policies).flatMap(([policy, p]) => {
      const c = p[outcome];
      if (!c || c.isaac == null || !c.px4) return [];
      const inside = c.isaac >= c.px4.lo && c.isaac <= c.px4.hi;
      return [{ policy, severity: row.severity, isaac: c.isaac, ...c.px4, inside }];
    }));
    const colour = conditionColour(site, "c4");
    return Plot.plot({
      ...base(el, { height: Math.min(340, Math.max(280, el.clientWidth * 0.8)), marginLeft: 48 }),
      x: { domain: [0, 1], label: "Isaac Sim predicted →", tickFormat: (d) => `${pct0(d)}%`, ticks: 5 },
      y: { domain: [0, 1], label: "↑ PX4 measured", tickFormat: (d) => `${pct0(d)}%`, ticks: 5 },
      marks: [
        grid(),
        Plot.line([[0, 0], [1, 1]], { stroke: token("--axis"), strokeDasharray: "4 4" }),
        Plot.ruleX(cells, { x: "isaac", y1: "lo", y2: "hi", stroke: colour, strokeOpacity: 0.45, strokeWidth: 2 }),
        Plot.dot(cells, {
          x: "isaac", y: "rate", r: 4.5, stroke: colour, strokeWidth: 1.8,
          fill: (d) => (d.inside ? colour : token("--surface")),
          title: (d) => `${d.policy.replace("c4_600", "600 updates,").replace("c4 ", "").replace("v3_seed_", "seed ").replace("v4_seed_", "seed ")}\nrotor weakened by ${sevLabel(d.severity)}\nIsaac ${pct(d.isaac)} · PX4 ${pct(d.rate)} ${range(d)}\n${d.inside ? "inside" : "outside"} the PX4 interval`,
          tip: tipStyle(),
        }),
      ],
    });
  };
}

// ------------------------------------------------------------ touchdown speed

export function touchdown(el, m10, site) {
  return () => {
    const conds = ["c2", "c3", "c4"].filter((c) => m10.descriptive[c]);
    const rows = conds.flatMap((c) => Object.entries(m10.descriptive[c].median_touchdown_speed_m_s)
      .filter(([, v]) => v != null).map(([s, v]) => ({ c, s, v, label: conditionLabel(site, c) })));
    const limit = site.outcome_spec.crash_touchdown_speed_m_s;
    return Plot.plot({
      ...base(el, { height: 280 }),
      x: { type: "point", domain: SEVERITIES, tickFormat: sevLabel, label: "rotor weakened by →", padding: 0.3 },
      y: { domain: [0, Math.ceil(Math.max(...rows.map((r) => r.v)))], label: "↑ median touchdown, m/s", ticks: 5 },
      marks: [
        grid(),
        Plot.ruleY([limit], { stroke: token("--critical"), strokeDasharray: "5 4" }),
        Plot.text([limit], { y: (d) => d, x: () => "0.00", text: () => `crash above ${limit} m/s`, dy: -8, textAnchor: "start", fill: token("--critical"), fontSize: 11 }),
        ...conds.map((c) => Plot.line(rows.filter((r) => r.c === c), { x: "s", y: "v", stroke: conditionColour(site, c), strokeWidth: 2 })),
        Plot.dot(rows, {
          x: "s", y: "v", r: 3.5, fill: (r) => conditionColour(site, r.c),
          title: (r) => `${r.label}\nrotor weakened by ${sevLabel(r.s)}\nmedian touchdown ${r.v.toFixed(2)} m/s`, tip: tipStyle(),
        }),
      ],
    });
  };
}

// ------------------------------------------------------------ training curves

export function training(el, curves, site) {
  return () => {
    const colour = conditionColour(site, "c4");
    const runs = ["train_v3_seed_1", "train_v3_seed_2", "train_v3_seed_3"].filter((r) => curves.runs[r]);
    const rows = runs.flatMap((r, i) => curves.runs[r].update.map((u, j) => ({
      run: r, seed: i + 1, u, v: curves.runs[r].success_edge[j],
    })).filter((d) => d.v != null));
    const dash = [null, "6 4", "2 3"];
    const key = document.createElement("div");
    key.className = "timelines";
    key.innerHTML = `<div class="track-title">${runs.map((r, i) => `<span class="key"><svg width="22" height="6"><line x1="0" x2="22" y1="3" y2="3" stroke="${colour}" stroke-width="2" stroke-dasharray="${dash[i] ?? ""}"/></svg>training seed ${i + 1}</span>`).join("")}</div>`;
    return [key, Plot.plot({
      ...base(el, { height: 250, marginRight: 16 }),
      x: { label: "training update →" },
      y: { domain: [0, 1], label: "↑ finished, rotor 35–45% weaker (Isaac)", tickFormat: (d) => `${pct0(d)}%`, ticks: 5 },
      marks: [
        grid(),
        ...runs.map((r, i) => Plot.line(rows.filter((d) => d.run === r), Plot.windowY({ k: 9, anchor: "middle" },
          { x: "u", y: "v", stroke: colour, strokeWidth: 1.8, strokeDasharray: dash[i] }))),
      ],
    })];
  };
}

// ------------------------------------------------------------ one severity's outcomes (the severity explainer)

export function outcomeStack(cells, site, conds) {
  const order = ["mission_success", "safe_landing", "crash", "incomplete"];
  return conds.filter((c) => cells[c]).map((c) => `
    <div class="stack-row">
      <div class="stack-name"><span class="dot solid" style="background:${conditionColour(site, c)}"></span>${escapeHtml(cap(conditionLabel(site, c)))}</div>
      <div class="stack">${order.map((o) => {
        const e = cells[c][o];
        return e && e.rate > 0 ? `<span class="o-${o}" style="width:${100 * e.rate}%" title="${escapeHtml(`${OUTCOMES[o].label}: ${pct(e.rate)} ${range(e)}, ${e.k} of ${e.n}`)}">${e.rate >= 0.12 ? pct(e.rate) : ""}</span>` : "";
      }).join("")}</div>
    </div>`).join("");
}
