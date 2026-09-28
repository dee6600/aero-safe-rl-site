// The story page: numbers, the hero replay, the severity explainer, the
// charts, the featured flights and the clips. Counts shown here are sums of
// counts in the results files; every rate is read as it was written.
import { $, OUTCOMES, conditionColour, conditionLabel, data, escapeHtml, fillNumbers, initTheme, int, pct, pct0, pts, range } from "./common.js";
import { Replay, mountPlayer } from "./replay.js";
import { Timelines } from "./timelines.js";
import * as charts from "./charts.js";

initTheme();
const [site, m10, m11, m13, featured, film, training] = await Promise.all([
  data.site(), data.m10(), data.m11(), data.m13(), data.featured(), data.film(), data.training()]);
const featuredById = Object.fromEntries(featured.map((f) => [f.id, f]));
fillNumbers({ site, m10, m11, m13, training });

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------ counts

const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const analysed = sum(m10.runs, (r) => r.analysed);
const planned = sum(m10.runs, (r) => r.planned);
for (const id of ["n-analysed", "n-analysed-2", "n-analysed-3"]) $(`#${id}`).textContent = int(analysed);
$("#n-planned").textContent = int(planned);
$("#n-runs").textContent = m10.runs.length;
const holds = m10.comparisons.filter((c) => c.result.holds).length;
$("#n-holds").textContent = holds;
$("#n-holds-2").textContent = holds;
$("#n-comparisons").textContent = m10.comparisons.length;
const m11Analysed = sum(m11.runs, (r) => r.analysed);
$("#n-m11").textContent = int(m11Analysed);
$("#n-settings").textContent = Object.keys(m11.settings).length;
$("#n-planned-all").textContent = int(planned + sum(m11.runs, (r) => r.planned));
const lost = (runs) => sum(runs, (r) => r.excluded?.worker_restarted ?? 0);
$("#n-lost").textContent = `${int(lost(m10.runs))} and ${int(lost(m11.runs))}`;
const [lo, hi] = [site.action_spec.low, site.action_spec.high];
$("#cmd-speed").textContent = `${pct0(lo[0])}–${pct0(hi[0])}% of normal`;
$("#cmd-alt").textContent = `${lo[1]} to ${hi[1]} m`;
const td = ["c2", "c3", "c4"].map((c) => m10.descriptive[c]?.median_touchdown_speed_m_s?.["0.45"]).filter((v) => v != null);
$("#td-45").textContent = `${Math.min(...td).toFixed(1)}–${Math.max(...td).toFixed(1)} m/s`;
const t = m10.transfer_agreement.mission_success;
$("#transfer-miss").textContent = `${t.cells - t.agree} of ${t.cells}`;
const bonf = m13.multiplicity.main;
$("#n-bonf-holds").textContent = bonf.comparisons.filter((c) => c.holds).length;
$("#bonf-level").textContent = `${(100 * bonf.level).toFixed(1)}%`;
const spread = m13.isaac.seed_spread;
$("#n-seeds").textContent = Object.keys(spread.seeds).length;
$("#n-seeds-pass").textContent = Object.values(spread.seeds).filter((s) => s.gate_passed).length;

// The Isaac diagnostics' readings: each sentence states the outcome of a
// rule frozen in configs/rl/diagnostics_v1.yaml, as results/m13 applied it.
const sr = spread.reading;
$("#seed-reading").textContent = !sr ? "" : sr.representative
  ? `Within 5 points of the ${Object.keys(spread.seeds).length}-seed average on success at 40% and on crashes at 40–50%, so by the rule set before training the flown three are typical of the recipe.`
  : `They differ from the ${Object.keys(spread.seeds).length}-seed average by ${pts(sr.gaps.success_040)} points on success at 40% and ${pts(sr.gaps.crash_040_050)} on crashes at 40–50%, so the PX4 results likely carry that bias.`;
const bl = m13.isaac.blanking;
if (bl?.complete) {
  const names = (label) => Object.entries(bl.reading.by_group).filter(([, r]) => r === label).map(([g]) => charts.INPUT_GROUPS[g] ?? g);
  const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const carry = names("carries the fault signal");
  const fly = names("needed to fly");
  $("#blank-reading").textContent = !bl.reading.attribution
    ? "Isaac did not first reproduce PX4's own blanking results, so by the rule fixed in advance the chart is inconclusive."
    : "Isaac first reproduced PX4's own blanking results. " +
      (carry.length ? `Blanking ${list(carry)} at least halves its success at 40%: that is where it reads the fault.`
        : "No single group halves its success at 40%: the signal is spread across its inputs.") +
      (fly.length ? ` Without ${list(fly)} it cannot fly even a healthy mission.` : "");
}

// ------------------------------------------------------------ hero replay

const r1 = featuredById.R1;
if (r1?.group) {
  const hero = new Replay($("#hero-viewer"), site, { autoplay: true, loop: true, speed: 1.5 });
  const c4 = r1.focus;
  hero.load(r1.group, { focus: c4 }).then(() => {
    const c2 = hero.flights.find((f) => f.condition === "c2");
    for (const f of hero.flights) hero.setShown(f.key, f.key === c4 || f.key === c2?.key);
    const out = (f) => (f ? OUTCOMES[f.outcome].label : "");
    const learned = hero.flights.find((f) => f.key === c4);
    $("#hero-caption").innerHTML = `
      Same fault, two real PX4 flights, lined up at the moment the back-left rotor began to weaken:
      <span style="color:${conditionColour(site, "c2")}">●</span> no recovery ${escapeHtml(out(c2))};
      <span style="color:${conditionColour(site, "c4")}">●</span> the learned policy ${escapeHtml(out(learned))}.
      A best case, chosen by a rule: ${r1.qualified} of the ${r1.considered} faults at this severity went this way. Overall
      the learned policy finishes ${pct(m10.main.c4["0.40"].mission_success.rate)} of missions here.
      <a href="explorer.html?g=${r1.group}&f=${encodeURIComponent(c4)}">Open in the explorer →</a>`;
  });
}

// ------------------------------------------------------------ the problem: severity explainer

const SEVS = ["0.00", "0.20", "0.30", "0.35", "0.40", "0.45", "0.50", "0.70", "1.00"];
const HOVER = 0.59;   // quoted from docs/recovery_baseline.md, the page's one physics fact
const slider = $("#severity");
const thrust = $("#thrust");
thrust.innerHTML = [0, 1, 2, 3].map((k) => `<div class="bar${k === 1 ? " weak" : ""}"><div class="fill"></div></div>`).join("") +
  `<div class="hover-line" style="bottom:${HOVER * 100}%"><span>needed to hover</span></div>`;
$("#outcome-key").innerHTML = Object.entries(OUTCOMES).map(([k, o]) => `<span class="outcome o-${k}">${o.short}</span>`).join("");
function drawSeverity() {
  const s = SEVS[Number(slider.value)];
  const v = Number(s);
  $("#sev-value").textContent = v ? `${pct0(v)}%` : "none";
  const bars = thrust.querySelectorAll(".bar");
  bars.forEach((b, k) => {
    const h = k === 1 ? 1 - v : 1;
    b.querySelector(".fill").style.height = `${h * 100}%`;
    b.classList.toggle("short", k === 1 && h < HOVER);
  });
  $("#sev-verdict").textContent = v < 0.35
    ? "Flies on unaided. PX4 alone finishes nearly every mission; there is little to recover."
    : v <= 0.45
      ? "The decision window. Whether the drone slows, descends or presses on decides how the flight ends."
      : "Past the limit. The weak rotor cannot give its share, so the drone comes down; the question is how hard.";
  const cells = Object.fromEntries(["c2", "c3", "c4"].filter((c) => m10.main[c]?.[s]).map((c) => [c, m10.main[c][s]]));
  $("#sev-outcomes").innerHTML = charts.outcomeStack(cells, site, ["c2", "c3", "c4"]) ||
    '<p class="note">No flights at this severity.</p>';
}
slider.addEventListener("input", drawSeverity);
drawSeverity();
window.addEventListener("themechange", drawSeverity);

// ------------------------------------------------------------ results charts

const ORDER = ["c2", "c3", "c4", "c6", "c5", "c5_delay1s", "c5_delay2s"].filter((c) => m10.main[c]);
const on = new Set(["c2", "c3", "c4"]);
const toggles = $("#cond-toggles");
const paintToggles = () => {
  toggles.innerHTML = ORDER.map((c) => `<button class="chip" type="button" aria-pressed="${on.has(c)}" data-c="${c}">
    <span class="dot" style="color:${conditionColour(site, c)};background:${conditionColour(site, c)}"></span>${escapeHtml(conditionLabel(site, c))}</button>`).join("");
};
paintToggles();
window.addEventListener("themechange", paintToggles);
const successChart = charts.outcomesBySeverity($("#ch-success"), m10, site, "mission_success", () => ORDER.filter((c) => on.has(c)));
const crashChart = charts.outcomesBySeverity($("#ch-crash"), m10, site, "crash", () => ORDER.filter((c) => on.has(c)));
charts.chart($("#ch-success"), successChart);
charts.chart($("#ch-crash"), crashChart);
toggles.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-c]");
  if (!b) return;
  on.has(b.dataset.c) ? on.delete(b.dataset.c) : on.add(b.dataset.c);
  if (!on.size) on.add(b.dataset.c);
  paintToggles();
  window.dispatchEvent(new CustomEvent("themechange"));   // redraw every chart
});
charts.chart($("#ch-comparisons"), charts.comparisons(m10, site));
charts.chart($("#ch-delay-success"), charts.detectorDelay($("#ch-delay-success"), m10, site, "0.40", "mission_success"));
charts.chart($("#ch-delay-crash"), charts.detectorDelay($("#ch-delay-crash"), m10, site, "0.45", "crash"));
charts.chart($("#ch-transfer-success"), charts.transfer($("#ch-transfer-success"), m10, site, "mission_success"));
charts.chart($("#ch-transfer-crash"), charts.transfer($("#ch-transfer-crash"), m10, site, "crash"));
charts.chart($("#ch-touchdown"), charts.touchdown($("#ch-touchdown"), m10, site));
charts.chart($("#ch-training"), charts.training($("#ch-training"), training, site));
charts.chart($("#ch-seeds"), charts.seedSpread($("#ch-seeds"), m13, site));
charts.chart($("#ch-blanking"), charts.blanking($("#ch-blanking"), m13));
charts.chart($("#ch-generalization"), charts.generalization(m11));

// ------------------------------------------------------------ featured flights

const gallery = new Replay($("#feature-viewer"), site, { autoplay: false });
mountPlayer($("#feature-player"), gallery);
new Timelines($("#feature-timelines"), gallery);
const tabs = $("#feature-tabs");
for (const f of featured) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = f.title;
  b.dataset.id = f.id;
  b.setAttribute("aria-selected", "false");
  b.addEventListener("click", () => showFeature(f));
  tabs.appendChild(b);
}
async function showFeature(f) {
  for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.id === f.id));
  const count = f.id === "R5" ? `${f.qualified} of ${f.considered} such flights stalled.`
    : `${f.qualified} of ${f.considered} faults qualified.`;
  if (!f.group) {
    $("#feature-rule").textContent = `${f.rule} No flight met this rule.`;
    return;
  }
  $("#feature-rule").innerHTML = `${escapeHtml(f.rule)} ${count}
    <a href="explorer.html?g=${f.group}&f=${encodeURIComponent(f.focus)}">Open in the explorer →</a>`;
  await gallery.load(f.group, { focus: f.focus });
  const keep = new Set([f.focus, ...gallery.flights.filter((x) => ["c2", "c3", "c4", "s5_c2", "s10_c4"].includes(x.condition)).map((x) => x.key)]);
  for (const x of gallery.flights) gallery.setShown(x.key, keep.has(x.key));
  gallery.play();
}
let started = false;
new IntersectionObserver((es) => {
  if (es[0].isIntersecting && !started && featured.length) { started = true; showFeature(featured[1] ?? featured[0]); }
}, { rootMargin: "200px" }).observe($("#featured"));

// ------------------------------------------------------------ clips

async function exists(path) {
  try { return (await fetch(path, { method: "HEAD" })).ok; } catch { return false; }
}
const clips = $("#clips");
const CLIPS = [
  { file: "media/isaac_closeup.mp4", tag: '<span class="tag train">Training simulator · Isaac Sim</span>',
    text: "A camera follows one of four drones flown by the trained policy, its weak rotor at 40%; the others fly healthy, at 35% and at 45%. Shown at 4× speed." },
  { file: "media/isaac_wide.mp4", tag: '<span class="tag train">Training simulator · Isaac Sim</span>',
    text: `64 drones at once, each with its own fault from none to 70%; training flew ${int(training.num_envs[0])} like this. Shown at 4× speed.` },
];
for (const c of CLIPS) {
  const card = document.createElement("figure");
  card.className = "media-card figure";
  card.innerHTML = (await exists(c.file))
    ? `<video src="${c.file}" muted loop playsinline autoplay preload="metadata"></video><figcaption class="caption">${c.tag}${c.text}</figcaption>`
    : `<div class="placeholder">This clip has not been filmed yet.</div><figcaption class="caption">${c.tag}${c.text}</figcaption>`;
  clips.appendChild(card);
}
if (film?.clip && (await exists(film.clip))) {
  const card = document.createElement("figure");
  card.className = "media-card figure";
  card.style.gridColumn = "1 / -1";
  const shown = film.attempts.map((a) => `${escapeHtml(cap(conditionLabel(site, a.condition)))}:
    ${OUTCOMES[a.outcome].label}${a.outcome === a.logged_outcome ? ", as in the evaluation's logged flight"
      : ` (in the evaluation's logged flight it ${OUTCOMES[a.logged_outcome].label})`}.`).join(" ");
  card.innerHTML = `
    <video src="${film.clip}" muted playsinline controls preload="metadata"></video>
    <div id="film-viewer" style="margin:12px;aspect-ratio:2.7/1"></div>
    <figcaption class="caption"><span class="tag eval">Evaluation simulator · PX4 + Gazebo, real time</span>
      The featured fault re-flown for the camera; underneath, the same two flights replayed from their own logs on one clock.
      ${shown}</figcaption>`;
  clips.appendChild(card);
  const video = card.querySelector("video");
  const replay = new Replay(card.querySelector("#film-viewer"), site, { autoplay: false });
  await replay.load("film");
  const follow = () => {
    replay.seek(video.currentTime - film.lead_s);
    if (!video.paused) requestAnimationFrame(follow);
  };
  video.addEventListener("play", follow);
  video.addEventListener("seeked", follow);
}
