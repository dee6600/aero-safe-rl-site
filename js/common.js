// Shared by both pages: theme, data loading, number formatting, labels.
// Every number on the site is read from site/data/*.json (built by
// experiments/analysis/m12_site.py from results/); nothing here computes a
// statistic, it only formats what the results files already hold.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------ theme

function stored(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* private window or blocked storage: the default theme is fine */ }
  return null;
}

export function theme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function initTheme() {
  const asked = new URLSearchParams(location.search).get("theme");
  const initial = asked === "light" || asked === "dark" ? asked : stored("theme") || "dark";
  document.documentElement.dataset.theme = initial;
  for (const btn of $$("[data-theme-toggle]")) {
    const paint = () => {
      btn.setAttribute("aria-label", theme() === "dark" ? "Switch to light theme" : "Switch to dark theme");
      btn.innerHTML = theme() === "dark" ? ICONS.sun : ICONS.moon;
    };
    paint();
    btn.addEventListener("click", () => {
      document.documentElement.dataset.theme = theme() === "dark" ? "light" : "dark";
      stored("theme", theme());
      $$("[data-theme-toggle]").forEach((b) => b.dispatchEvent(new Event("repaint")));
      window.dispatchEvent(new CustomEvent("themechange", { detail: theme() }));
    });
    btn.addEventListener("repaint", paint);
  }
}

export const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
};

/** A design token's current value, e.g. token("--ink"). */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ------------------------------------------------------------ data

const cache = new Map();
export function getJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

export const data = {
  site: () => getJSON("data/site.json"),
  m10: () => getJSON("data/m10_results.json"),
  m11: () => getJSON("data/m11_results.json"),
  featured: () => getJSON("data/featured.json"),
  film: () => getJSON("data/film.json"),
  flights: () => getJSON("data/flights.json"),
  training: () => getJSON("data/training.json"),
  replay: (group) => getJSON(`data/replay/${group}.json`),
};

// ------------------------------------------------------------ numbers
// Python's format(x, ".0f") rounds exact halves to even and keeps a sign
// on negative zero; the paper's tables use it, so the site does too.

function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

function fixed0(x) {
  const r = roundHalfEven(x);
  return r === 0 && (x < 0 || Object.is(x, -0)) ? "-0" : String(r);
}

const MINUS = "−";
/** 0.2049 -> "20%" */
export const pct = (x) => (x == null ? "–" : `${fixed0(100 * x)}%`);
/** 0.2049 -> "20" */
export const pct0 = (x) => (x == null ? "–" : fixed0(100 * x));
/** 0.195 -> "+20" (percentage points, signed as the paper prints them) */
export function pts(x) {
  const s = fixed0(100 * x);
  return s.startsWith("-") ? `${MINUS}${s.slice(1)}` : `+${s}`;
}
/** {lo, hi} of a rate -> "(5–42)" */
export const range = (e) => `(${fixed0(100 * e.lo)}–${fixed0(100 * e.hi)})`;
/** a difference {difference, lo, hi} -> "+20 points (+3 to +42)" */
export const diff = (r) => `${pts(r.difference)} points (${pts(r.lo)} to ${pts(r.hi)})`;
export const int = (n) => Number(n).toLocaleString("en-US");
export const sev = (s) => Number(s).toFixed(2);

/** obj at a dotted path whose keys may themselves hold dots ("0.40"):
 *  at each step the shortest run of parts that names a key wins. */
export function lookup(obj, path) {
  const parts = path.split(".");
  let v = obj;
  for (let i = 0; i < parts.length && v !== undefined;) {
    let j = i + 1;
    while (j <= parts.length && !(v != null && Object.hasOwn(Object(v), parts.slice(i, j).join(".")))) j++;
    if (j > parts.length) return undefined;
    v = v[parts.slice(i, j).join(".")];
    i = j;
  }
  return v;
}

/** Fill every [data-num="source:path|format"] element, e.g.
 *  data-num="m10:comparisons.0.result.a.rate|pct". */
export function fillNumbers(sources, root = document) {
  const formats = { pct, pct0, pts, range, diff, int, sev, raw: (v) => String(v) };
  for (const el of $$("[data-num]", root)) {
    const [ref, fmt = "raw"] = el.dataset.num.split("|");
    const [src, path] = ref.split(":");
    const v = lookup(sources[src], path);
    if (v === undefined) {
      el.textContent = "–";
      el.title = `missing: ${el.dataset.num}`;
      continue;
    }
    el.textContent = formats[fmt](v);
  }
}

// ------------------------------------------------------------ labels

export const OUTCOMES = {
  mission_success: { label: "finished the mission", short: "success", token: "--good" },
  safe_landing: { label: "came down safely, mission not finished", short: "safe landing", token: "--warning" },
  crash: { label: "crashed", short: "crash", token: "--critical" },
  incomplete: { label: "ran out of time", short: "incomplete", token: "--neutral" },
};

export function conditionColour(site, name) {
  return site.conditions[name]?.colour?.[theme()] ?? token("--muted");
}

export function conditionLabel(site, name) {
  return site.conditions[name]?.label ?? name;
}

export function policyLabel(site, key) {
  return site.policies[key] ?? key;
}

/** "learned (training seed 3)" -- what flew a flight. */
export function flownBy(site, flight) {
  const c = conditionLabel(site, flight.condition);
  const p = flight.policy_key;
  return p && p !== "nominal" && p !== "rule_based" ? `${c} (${policyLabel(site, p)})` : c;
}

export const ROTOR_NAMES = ["front right", "back left", "front left", "back right"];

export function faultText(fault) {
  if (!fault) return "Healthy flight, no fault";
  const kind = fault.profile === "step" ? "suddenly" : `over ${Number(fault.ramp_s).toFixed(1)} s`;
  return `${ROTOR_NAMES[fault.rotor]} rotor loses ${pct0(fault.severity)}% of its thrust ${kind}, ` +
    `${Number(fault.onset_requested_s).toFixed(1)} s into the flight`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
