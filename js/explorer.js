// The flight explorer: every analysed M10 flight in a filterable table;
// choosing one replays it beside every other condition that flew the same
// fault. Deep links: explorer.html?g=<group>&f=<flight key>&t=<seconds>.
import {
  $, OUTCOMES, ROTOR_NAMES, conditionColour, conditionLabel, data, escapeHtml, faultText, flownBy, initTheme,
  int, pct0, policyLabel, sev,
} from "./common.js";
import { Replay, mountPlayer } from "./replay.js";
import { Timelines } from "./timelines.js";

initTheme();
const PAGE = 50;
const HEADLINE = ["c2", "c3", "c4"];

const [site, flights, featured, film] = await Promise.all([data.site(), data.flights(), data.featured(), data.film()]);
const rows = flights.key.map((_, i) => Object.fromEntries(Object.keys(flights).map((k) => [k, flights[k][i]])));
const byKey = new Map(rows.map((r) => [r.key, r]));

const replay = new Replay($("#viewer"), site, { autoplay: true });
mountPlayer($("#player"), replay);
new Timelines($("#timelines"), replay);

// ------------------------------------------------------------ filters and table

const FILTERS = {
  condition: { label: "Condition", value: (r) => r.condition, text: (v) => conditionLabel(site, v) },
  policy: { label: "Policy", value: (r) => r.policy, text: (v) => policyLabel(site, v) },
  severity: { label: "Rotor weakened by", value: (r) => sev(r.severity), text: (v) => (Number(v) ? `${pct0(Number(v))}%` : "healthy") },
  profile: { label: "Fault onset", value: (r) => r.profile, text: (v) => ({ step: "sudden", ramp: "ramped", none: "no fault" }[v] ?? v) },
  rotor: { label: "Weak rotor", value: (r) => (r.rotor >= 0 ? String(r.rotor) : "-1"), text: (v) => (v === "-1" ? "none" : ROTOR_NAMES[v]) },
  outcome: { label: "Outcome", value: (r) => r.outcome, text: (v) => OUTCOMES[v]?.short ?? v },
};
const state = { page: 0, selected: null };
const filterEl = $("#filters");
for (const [name, f] of Object.entries(FILTERS)) {
  const values = [...new Set(rows.map(f.value))].sort((a, b) => (isNaN(a) ? a.localeCompare(b) : a - b));
  const label = document.createElement("label");
  label.innerHTML = `${f.label}<select data-filter="${name}"><option value="">All</option>${values
    .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(f.text(v))}</option>`).join("")}</select>`;
  filterEl.appendChild(label);
}
filterEl.addEventListener("change", () => { state.page = 0; drawTable(); });

function filtered() {
  const active = [...filterEl.querySelectorAll("select")].filter((s) => s.value);
  return rows.filter((r) => active.every((s) => FILTERS[s.dataset.filter].value(r) === s.value));
}

function drawTable() {
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  state.page = Math.min(state.page, pages - 1);
  $("#count").textContent = `${int(list.length)} of ${int(rows.length)} flights`;
  $("#page").textContent = `Page ${state.page + 1} of ${pages}`;
  $("#prev").disabled = state.page === 0;
  $("#next").disabled = state.page >= pages - 1;
  $("#rows").innerHTML = list.slice(state.page * PAGE, (state.page + 1) * PAGE).map((r) => `
    <tr data-key="${escapeHtml(r.key)}" aria-selected="${r.key === state.selected}" tabindex="0">
      <td><span class="dot solid" style="background:${conditionColour(site, r.condition)};display:inline-block;margin-right:7px"></span>${escapeHtml(conditionLabel(site, r.condition))}</td>
      <td>${escapeHtml(r.policy === "nominal" || r.policy === "rule_based" ? "–" : policyLabel(site, r.policy))}</td>
      <td>${r.severity ? `${pct0(r.severity)}%` : "healthy"}</td>
      <td>${r.rotor >= 0 ? `${ROTOR_NAMES[r.rotor]}, ${r.profile === "step" ? "sudden" : "ramped"}` : "–"}</td>
      <td><span class="outcome o-${r.outcome}">${OUTCOMES[r.outcome].short}</span>${r.confirmed === false && r.severity ? ' <span class="chip warn-chip" title="The rotor-fault plugin never confirmed this fault">unconfirmed</span>' : ""}</td>
      <td class="mono">${r.touchdown != null ? `${r.touchdown.toFixed(2)} m/s` : "–"}</td>
      <td class="mono">${r.duration.toFixed(0)} s</td>
    </tr>`).join("");
}
$("#rows").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-key]");
  if (tr) openFlight(tr.dataset.key);
});
$("#rows").addEventListener("keydown", (e) => {
  const tr = e.target.closest("tr[data-key]");
  if (tr && e.key === "Enter") openFlight(tr.dataset.key);
});
$("#prev").addEventListener("click", () => { state.page--; drawTable(); });
$("#next").addEventListener("click", () => { state.page++; drawTable(); });

// ------------------------------------------------------------ opening a group

function openFlight(key) {
  const r = byKey.get(key);
  if (r) openGroup(r.group, key);
}

async function openGroup(group, focus, time = null, note = "") {
  state.selected = focus;
  drawTable();
  await replay.load(group, { focus });
  const shown = replay.flights.filter((f) => f.key === focus || HEADLINE.includes(f.condition) || replay.flights.length <= 3);
  for (const f of replay.flights) replay.setShown(f.key, shown.includes(f));
  if (time != null) { replay.pause(); replay.seek(time); }
  describe(note);
  const url = new URL(location.href);
  url.searchParams.set("g", group);
  url.searchParams.set("f", focus ?? "");
  url.searchParams.delete("t");
  history.replaceState(null, "", url);
}

function describe(note) {
  const g = replay.group;
  const focus = replay.flights.find((f) => f.key === replay.focus);
  $("#replay-title").textContent = g.fault ? `Rotor weakened by ${pct0(g.fault.severity)}%` : "A healthy flight";
  const what = faultText(g.fault);
  $("#replay-sub").innerHTML = `${escapeHtml(what.charAt(0).toUpperCase() + what.slice(1))}. ${replay.flights.length} flight${replay.flights.length > 1 ? "s" : ""} flew this ${g.fault ? "fault" : "flight"}${g.align === "onset" ? ", lined up at the moment the fault began" : ""}.${note ? ` <span class="ink-2">${note}</span>` : ""}`;
  $("#legend").innerHTML = `<table class="data"><thead><tr><th>Show</th><th>Flown by</th><th>Outcome</th><th>Traces</th></tr></thead><tbody>${replay.flights.map((f) => `
    <tr>
      <td><input type="checkbox" data-show="${escapeHtml(f.key)}" ${f.shown ? "checked" : ""} aria-label="Show ${escapeHtml(flownBy(site, f))}"></td>
      <td style="white-space:normal"><span class="dot solid" style="background:${conditionColour(site, f.condition)};display:inline-block;margin-right:7px"></span>${escapeHtml(conditionLabel(site, f.condition))}${f.policy_key.startsWith("v") ? `<div class="small muted" style="margin-left:17px">${escapeHtml(policyLabel(site, f.policy_key))}</div>` : ""}</td>
      <td><span class="outcome o-${f.outcome}">${OUTCOMES[f.outcome].short}</span>${f.fault_confirmed === false && g.fault ? ' <span class="chip warn-chip" title="The rotor-fault plugin never confirmed this fault">fault unconfirmed</span>' : ""}</td>
      <td><input type="radio" name="focus" data-focus="${escapeHtml(f.key)}" ${f.key === replay.focus ? "checked" : ""} aria-label="Show ${escapeHtml(flownBy(site, f))} in the timelines"></td>
    </tr>`).join("")}</tbody></table>`;
  const detector = site.conditions[focus?.condition]?.detector;
  $("#info").innerHTML = focus ? [
    ["Flown by", escapeHtml(flownBy(site, focus))],
    ["Detector", escapeHtml(detector ?? "–")],
    ["Outcome", `<span class="outcome o-${focus.outcome}">${OUTCOMES[focus.outcome].label}</span>`],
    ["Ended by", escapeHtml(focus.termination.replaceAll("_", " "))],
    ["Touchdown speed", focus.touchdown_speed_m_s != null ? `${focus.touchdown_speed_m_s.toFixed(2)} m/s (a crash is faster than ${site.outcome_spec.crash_touchdown_speed_m_s} m/s)` : "–"],
    ["Run", `<span class="mono">${escapeHtml(focus.key)}</span>`],
    ["Mission", escapeHtml(focus.mission.replaceAll("_", " "))],
    ["Source", "PX4 + Gazebo, logged 10 times a second"],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("") : "";
}

$("#legend").addEventListener("change", (e) => {
  if (e.target.dataset.show) replay.setShown(e.target.dataset.show, e.target.checked);
  if (e.target.dataset.focus) {
    replay.setFocus(e.target.dataset.focus);
    replay.setShown(e.target.dataset.focus, true);
    describe("");
  }
});

// ------------------------------------------------------------ featured

const tabs = $("#featured");
const entries = featured.filter((f) => f.group);
const filmEntry = film?.attempts?.length ? { id: "film", title: "The filmed fault", rule: "The fault filmed in Gazebo, re-flown for the camera.", group: "film", focus: film.attempts.at(-1).key } : null;
for (const f of [...entries, ...(filmEntry ? [filmEntry] : [])]) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = f.title;
  b.setAttribute("aria-selected", "false");
  b.addEventListener("click", () => selectFeatured(f));
  b.dataset.id = f.id;
  tabs.appendChild(b);
}
function selectFeatured(f) {
  for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.id === f.id));
  const count = f.considered ? ` Chosen by a rule written before any replay was viewed: ${f.qualified} of ${f.considered} qualified.` : "";
  openGroup(f.group, f.focus, null, `${escapeHtml(f.rule)}${count}`);
}

drawTable();
const params = new URLSearchParams(location.search);
if (params.get("g")) {
  const t = params.get("t");
  openGroup(params.get("g"), params.get("f") || null, t != null ? Number(t) : null);
} else if (entries.length) {
  selectFeatured(entries[0]);
}
