// The 3D flight replay. Every flight is drawn from its logged 10-per-second
// steps (site/data/replay/<group>.json, already in Gazebo's frame: x east,
// y north, z up), interpolated to the screen's frame rate. Flights of one
// group share a clock measured from the fault's onset (or from the first
// logged step for healthy flights), so the same fault lines up across
// conditions.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { ICONS, OUTCOMES, ROTOR_NAMES, conditionColour, conditionLabel, data, theme, token } from "./common.js";

const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One flight's whole-number columns -> typed arrays in real units. */
export function decodeFlight(raw, scale, offset) {
  const f = (a, k) => Float32Array.from(a, (v) => v * k);
  const t = Float64Array.from(raw.t, (v) => v * scale.t_s);
  return {
    ...raw,
    n: t.length,
    t,
    x: f(raw.x, scale.pos_m), y: f(raw.y, scale.pos_m), z: f(raw.z, scale.pos_m),
    q: raw.q.map((a) => f(a, scale.quat)),
    m: raw.m.map((a) => f(a, scale.unit)),
    p: raw.p ? f(raw.p, scale.unit) : null,
    alarm: Uint8Array.from(raw.alarm),
    speed: f(raw.speed, scale.unit),
    alt: f(raw.alt, scale.alt_m),
    land: Uint8Array.from(raw.land),
    offset,                          // local flight time = shared clock + offset
    end: t[t.length - 1],
  };
}

/** Index i and fraction u with t[i] + u (t[i+1] - t[i]) = time, clamped. */
export function locate(t, time) {
  if (time <= t[0]) return [0, 0];
  const n = t.length;
  if (time >= t[n - 1]) return [n - 1, 0];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= time) lo = mid; else hi = mid;
  }
  return [lo, (time - t[lo]) / (t[hi] - t[lo])];
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

function makeDrone(x500, colour) {
  const h = x500.leg_height;                  // the model's origin sits at the feet
  const root = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b3240, metalness: 0.35, roughness: 0.55 });
  const tint = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.35, roughness: 0.5 });
  const add = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); root.add(m); return m; };

  add(new THREE.BoxGeometry(0.17, 0.17, 0.05), frame, 0, 0, h);
  add(new THREE.BoxGeometry(0.13, 0.13, 0.014), tint, 0, 0, h + 0.032);
  // two landing skids and their struts
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.30, 0.014, 0.014), frame, 0, s * 0.11, 0.007);
    for (const e of [-1, 1]) {
      const strut = add(new THREE.BoxGeometry(0.012, 0.012, h), frame, e * 0.07, s * 0.1, h / 2);
      strut.rotation.x = -s * 0.25;
    }
  }
  const rotors = x500.rotors.map((r) => {
    const len = Math.hypot(r.x, r.y);
    const arm = add(new THREE.BoxGeometry(len, 0.022, 0.018), tint, r.x / 2, r.y / 2, h + 0.01);
    arm.rotation.z = Math.atan2(r.y, r.x);
    const motor = add(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 16), frame, r.x, r.y, h + x500.rotor_z - 0.02);
    motor.rotation.x = Math.PI / 2;
    const radius = x500.prop_diameter / 2;
    const disc = add(new THREE.CircleGeometry(radius, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      r.x, r.y, h + x500.rotor_z);
    const blades = new THREE.Group();
    blades.position.set(r.x, r.y, h + x500.rotor_z + 0.004);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(x500.prop_diameter, 0.02, 0.004),
      new THREE.MeshStandardMaterial({ color: 0x0e1117, roughness: 0.4 }));
    blades.add(blade);
    root.add(blades);
    const ring = add(new THREE.RingGeometry(radius * 1.05, radius * 1.3, 48),
      new THREE.MeshBasicMaterial({ color: 0xff5a5f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      r.x, r.y, h + x500.rotor_z + 0.006);
    ring.visible = false;
    return { disc, blades, ring, spin: r.spin === "ccw" ? 1 : -1, angle: Math.random() * 6 };
  });
  return { root, rotors, frame, tint };
}

function canvasTexture(w, h, paint) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dashedPath(points, colour) {
  const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
  const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: colour, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.8 }));
  line.computeLineDistances();
  return line;
}

export class Replay {
  constructor(el, site, opts = {}) {
    this.el = el;
    this.site = site;
    this.opts = { autoplay: false, loop: false, speed: 1, scale: 3, labels: true, ...opts };
    this.listeners = { time: [], load: [], state: [] };
    this.flights = [];
    this.time = 0;
    this.playing = false;
    this.speed = this.opts.speed;
    this.visibleOnScreen = true;
    this.pauseUntil = 0;
    this._build();
  }

  on(ev, cb) { this.listeners[ev].push(cb); return this; }
  _emit(ev, v) { for (const cb of this.listeners[ev]) cb(v); }

  _build() {
    this.el.classList.add("viewer");
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    } catch (e) {
      this.el.innerHTML = '<div class="viewer-fallback">This browser cannot show the 3D replay (WebGL is unavailable).</div>';
      this.failed = true;
      return;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.el.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    this.el.appendChild(this.labels.domElement);
    this.clockEl = document.createElement("div");
    this.clockEl.className = "viewer-clock";
    this.el.appendChild(this.clockEl);
    const tools = document.createElement("div");
    tools.className = "viewer-tools";
    tools.innerHTML = `<button class="icon-btn" type="button" aria-label="Reset the view" title="Reset the view">${ICONS.reset}</button>`;
    tools.firstChild.addEventListener("click", () => { this.autoFrame = true; this.frameMission(); });
    this.el.appendChild(tools);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 600);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 120;
    this.autoFrame = true;
    this.controls.addEventListener("start", () => { this.autoFrame = false; });
    this.scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x4a6b2a, 1.7));
    const sun = new THREE.DirectionalLight(0xfff6e5, 2.0);
    sun.position.set(-8, -12, 20);
    this.scene.add(sun);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this._ground();

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(this.el);
    new IntersectionObserver((es) => { this.visibleOnScreen = es[0].isIntersecting; }).observe(this.el);
    window.addEventListener("themechange", () => this._theme());
    this._resize();
    this._theme();
    this.last = performance.now();
    this.renderer.setAnimationLoop((now) => this._frame(now));
  }

  /** Daylight scenery, decorative only (the flights flew over a flat
   *  plane): a sky gradient, a grass ground fading into haze, a takeoff pad
   *  and a faint 5 m grid for scale. Drawn from canvases, nothing downloaded. */
  _ground() {
    const g = new THREE.Group();
    // a sky dome, pale at the horizon and blue overhead, whatever the camera's pitch
    const horizon = new THREE.Color(0xdde8f1), zenith = new THREE.Color(0x4f8fda);
    const dome = new THREE.SphereGeometry(420, 32, 16);
    const colours = [];
    const pos = dome.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const up = Math.max(0, pos.getY(i) / 420);          // the sphere's own y is turned to world z below
      colours.push(...horizon.clone().lerp(zenith, Math.min(1, Math.pow(up, 0.55) * 1.1)).toArray());
    }
    dome.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    const sky = new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.rotation.x = Math.PI / 2;
    sky.position.set(7.5, 7.5, 0);
    g.add(sky);
    this.scene.background = horizon;
    this.scene.fog = new THREE.Fog(0xdde8f1, 70, 330);
    const grass = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#5d8c3a"; ctx.fillRect(0, 0, w, h);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 9000; i++) {
        const l = 30 + rnd() * 22, c = 38 + rnd() * 18;
        ctx.fillStyle = `hsl(${88 + rnd() * 22} ${c}% ${l}%)`;
        ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 2 + rnd() * 4);
      }
    });
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.repeat.set(120, 120);                                    // 4 m tiles over 480 m
    grass.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    grass.colorSpace = THREE.SRGBColorSpace;
    const field = new THREE.Mesh(new THREE.PlaneGeometry(480, 480), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
    field.position.set(7.5, 7.5, -0.01);
    g.add(field);
    this.gridMajor = new THREE.GridHelper(80, 16, 0xffffff, 0xffffff);
    this.gridMajor.rotation.x = Math.PI / 2;
    this.gridMajor.position.set(7.5, 7.5, 0.005);
    this.gridMajor.material.transparent = true;
    this.gridMajor.material.opacity = 0.16;
    g.add(this.gridMajor);
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    pad.position.z = 0.01;
    g.add(pad);
    const north = document.createElement("div");
    north.className = "label3d";
    north.style.setProperty("--c", "var(--muted)");
    north.textContent = "North";
    const n = new CSS2DObject(north);
    n.position.set(7.5, 20, 0);
    g.add(n);
    this.world.add(g);
    this.shadowTexture = canvasTexture(64, 64, (ctx, w, h) => {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, "rgba(0,0,0,0.55)"); grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    });
  }

  _theme() {
    if (this.failed) return;
    for (const f of this.flights) {
      const c = new THREE.Color(conditionColour(this.site, f.condition));
      f.drone.tint.color = c;
      f.drone.tint.emissive = c;
      f.trail.material.color = c;
      f.label.style.setProperty("--c", conditionColour(this.site, f.condition));
    }
    this.weakColour = new THREE.Color(token("--weak-rotor"));
    for (const f of this.flights) f.drone.rotors.forEach((r) => r.ring.material.color.copy(this.weakColour));
  }

  _resize() {
    if (this.failed) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const f of this.flights) f.trail.material.resolution.set(w, h);
    if (this.autoFrame) this.frameMission();
  }

  /** The whole mission in view from beyond the takeoff corner with the sky
   *  above, as the filmed Gazebo window sees it: step back until every
   *  corner of the mission's box (ground to above mission altitude) is on
   *  screen. */
  frameMission() {
    const pts = this.mission?.path ?? [[0, 0, 5], [15, 15, 5]];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 1.5, Math.max(...xs) + 1.5, Math.min(...ys) - 1.5, Math.max(...ys) + 1.5];
    const top = Math.max(...pts.map((p) => p[2])) + 2;
    const target = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, top * 0.3);
    const up = 0.34;                                          // radians above the horizon
    const dir = new THREE.Vector3(-0.794 * Math.cos(up), -0.607 * Math.cos(up), Math.sin(up));
    const corners = [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [0, top].map((z) => new THREE.Vector3(x, y, z))));
    const v = new THREE.Vector3();
    for (let d = 6; d < 200; d += 0.5) {
      this.camera.position.copy(target).addScaledVector(dir, d);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      if (corners.every((c) => { v.copy(c).project(this.camera); return Math.abs(v.x) < 0.94 && Math.abs(v.y) < 0.9 && v.z < 1; })) break;
    }
    this.controls.target.copy(target);
    this.controls.update();
  }

  /** Load a replay group; `show` limits which flights are drawn at first. */
  async load(group, { show = null, focus = null } = {}) {
    if (this.failed) return;
    const rec = await data.replay(group);
    this._clear();
    this.group = rec;
    const fault = rec.fault;
    this.align = rec.align;
    const mission = rec.flights[0]?.mission ?? "square_circuit";
    this.mission = this.site.missions[mission];
    const lift = this.site.x500.leg_height * this.opts.scale;
    this.track = new THREE.Group();
    this.track.position.z = lift;
    this.world.add(this.track);
    if (this.mission) {
      this.path = dashedPath(this.mission.path, 0xffffff);
      this.track.add(this.path);
    }
    for (const raw of rec.flights) {
      // lined up at the observed onset; a flight whose fault never began is
      // placed where the fault was requested
      const offset = rec.align === "onset" ? (raw.onset_s ?? fault?.onset_requested_s ?? 0) : 0;
      const f = decodeFlight(raw, rec.scale, offset);
      f.colour = conditionColour(this.site, f.condition);
      f.drone = makeDrone(this.site.x500, f.colour);
      f.drone.root.scale.setScalar(this.opts.scale);
      this.world.add(f.drone.root);
      f.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false }));
      this.world.add(f.shadow);
      const positions = new Float32Array(f.n * 3);
      for (let i = 0; i < f.n; i++) positions.set([f.x[i], f.y[i], f.z[i]], i * 3);
      const geom = new LineGeometry();
      geom.setPositions(positions);
      geom.instanceCount = 0;
      f.trail = new Line2(geom, new LineMaterial({ color: f.colour, linewidth: 2.5, transparent: true, opacity: 0.95 }));
      f.trail.material.resolution.set(this.el.clientWidth, this.el.clientHeight);
      this.track.add(f.trail);
      // the anchor is placed by CSS2DRenderer; the chip inside is stacked in
      // screen pixels, since drones of one fault often fly on top of each other
      const anchor = document.createElement("div");
      f.label = document.createElement("span");
      f.label.className = "label3d";
      f.label.style.setProperty("--c", f.colour);
      f.label.style.transform = `translateY(${-20 - 17 * this.flights.length}px)`;
      anchor.appendChild(f.label);
      f.labelObj = new CSS2DObject(anchor);
      f.labelObj.position.set(0, 0, 0.9);
      f.drone.root.add(f.labelObj);
      f.endMark = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 40),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(token(OUTCOMES[f.outcome].token)), side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      f.endMark.position.set(f.x[f.n - 1], f.y[f.n - 1], 0.02);
      f.endMark.visible = false;
      this.world.add(f.endMark);
      f.rotor = fault ? fault.rotor : -1;
      f.shown = true;
      this.flights.push(f);
    }
    this.domain = [
      Math.min(...this.flights.map((f) => -f.offset)),
      Math.max(...this.flights.map((f) => f.end - f.offset)),
    ];
    if (show) for (const f of this.flights) this.setShown(f.key, show.includes(f.key));
    this.focus = focus && this.flights.some((f) => f.key === focus) ? focus : this.flights[0]?.key;
    this._labels();
    this._theme();
    this.frameMission();
    this.seek(this.align === "onset" ? Math.max(this.domain[0], -8) : this.domain[0]);
    this._emit("load", this);
    if (this.opts.autoplay && !REDUCED_MOTION) this.play();
  }

  _clear() {
    for (const f of this.flights) {
      this.world.remove(f.drone.root, f.endMark, f.shadow);
      f.drone.root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      f.labelObj.element.remove();
    }
    if (this.track) this.world.remove(this.track);
    this.flights = [];
    this.path = null;
  }

  _labels() {
    for (const f of this.flights) {
      const name = conditionLabel(this.site, f.condition);
      f.label.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      f.labelObj.visible = this.opts.labels && f.shown;
    }
  }

  setShown(key, on) {
    const f = this.flights.find((x) => x.key === key);
    if (!f) return;
    f.shown = on;
    f.drone.root.visible = on;
    f.trail.visible = on;
    f.shadow.visible = on;
    f.labelObj.visible = on && this.opts.labels;
    if (!on) f.endMark.visible = false;
    this._pose(this.time);
    this._emit("state", this);
  }

  setFocus(key) { this.focus = key; this._emit("state", this); }

  setScale(s) {
    this.opts.scale = s;
    for (const f of this.flights) f.drone.root.scale.setScalar(s);
    if (this.track) this.track.position.z = this.site.x500.leg_height * s;
    this._pose(this.time);
  }

  play() {
    if (!this.flights.length) return;
    if (this.time >= this.domain[1]) this.time = this.domain[0];
    this.playing = true;
    this._emit("state", this);
  }
  pause() { this.playing = false; this._emit("state", this); }
  toggle() { this.playing ? this.pause() : this.play(); }
  setSpeed(v) { this.speed = v; this._emit("state", this); }

  seek(time) {
    if (!this.domain) return;
    this.time = Math.min(Math.max(time, this.domain[0]), this.domain[1]);
    this._pose(this.time);
    this._emit("time", this.time);
  }

  _pose(time) {
    const faultOn = this.align === "onset" && time >= 0;
    for (const f of this.flights) {
      if (!f.shown) continue;
      const local = time + f.offset;
      const [i, u] = locate(f.t, local);
      const j = Math.min(i + 1, f.n - 1);
      const x = f.x[i] + (f.x[j] - f.x[i]) * u;
      const y = f.y[i] + (f.y[j] - f.y[i]) * u;
      const z = f.z[i] + (f.z[j] - f.z[i]) * u;
      f.drone.root.position.set(x, y, Math.max(z, 0));
      const h = Math.max(z, 0);                    // the blob shadow shrinks and fades with height
      f.shadow.position.set(x, y, 0.02);
      f.shadow.scale.setScalar(this.opts.scale * 0.62 * (1 + h * 0.05));
      f.shadow.material.opacity = Math.max(0.15, 1 - h / 14);
      _qa.set(f.q[1][i], f.q[2][i], f.q[3][i], f.q[0][i]).normalize();
      _qb.set(f.q[1][j], f.q[2][j], f.q[3][j], f.q[0][j]).normalize();
      f.drone.root.quaternion.slerpQuaternions(_qa, _qb, u);
      f.trail.geometry.instanceCount = i;
      f.motors = f.m.map((m) => m[i] + (m[j] - m[i]) * u);
      const weak = faultOn && f.fault_confirmed !== false && f.rotor >= 0 && local >= f.offset;
      f.drone.rotors.forEach((r, k) => { r.ring.visible = weak && k === f.rotor; });
      f.done = local >= f.end;
      f.endMark.visible = f.done;
    }
    this._clock(time);
  }

  _clock(time) {
    const sign = time < 0 ? "−" : "+";
    const abs = Math.abs(time).toFixed(1);
    if (this.align === "onset") {
      const fault = this.group.fault;
      const event = time >= 0 && fault ? ` <span class="event">${ROTOR_NAMES[fault.rotor]} rotor weak</span>` : "";
      this.clockEl.innerHTML = `${sign}${abs} s from fault${event}`;
    } else {
      this.clockEl.textContent = `${abs} s into the flight`;
    }
  }

  _frame(now) {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.playing && now >= this.pauseUntil) {
      let t = this.time + dt * this.speed;
      if (t >= this.domain[1]) {
        if (this.opts.loop) { t = this.domain[0]; this.pauseUntil = now + 1200; }
        else { t = this.domain[1]; this.pause(); }
      }
      this.time = t;
      this._pose(t);
      this._emit("time", t);
    }
    if (!this.visibleOnScreen || document.hidden) return;
    for (const f of this.flights) {
      if (!f.shown || !f.motors) continue;
      f.drone.rotors.forEach((r, k) => {
        const spinning = !f.done && f.motors[k] > 0.05;
        if (spinning && !REDUCED_MOTION) r.angle += dt * (6 + 60 * f.motors[k]) * r.spin * Math.min(this.speed, 2);
        r.blades.rotation.z = r.angle;
        r.disc.material.opacity = spinning ? 0.06 + 0.16 * f.motors[k] : 0.03;
      });
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}

/** Play/pause, scrubber, speed and time readout wired to a Replay. */
export function mountPlayer(el, replay) {
  el.classList.add("player");
  el.innerHTML = `
    <button class="icon-btn" type="button" data-play aria-label="Play">${ICONS.play}</button>
    <input type="range" min="0" max="1000" value="0" step="1" aria-label="Replay time">
    <select aria-label="Playback speed">
      <option value="0.5">0.5×</option><option value="1" selected>1×</option>
      <option value="2">2×</option><option value="4">4×</option>
    </select>
    <label class="small muted nowrap"><input type="checkbox" checked data-scale> drawn 3× life size</label>`;
  const btn = el.querySelector("[data-play]");
  const range = el.querySelector("input[type=range]");
  const speed = el.querySelector("select");
  const scale = el.querySelector("[data-scale]");
  speed.value = String(replay.speed);
  const toFrac = (t) => ((t - replay.domain[0]) / (replay.domain[1] - replay.domain[0])) * 1000;
  replay.on("time", (t) => { range.value = String(Math.round(toFrac(t))); });
  replay.on("state", () => {
    btn.innerHTML = replay.playing ? ICONS.pause : ICONS.play;
    btn.setAttribute("aria-label", replay.playing ? "Pause" : "Play");
  });
  btn.addEventListener("click", () => replay.toggle());
  range.addEventListener("input", () => {
    replay.pause();
    replay.seek(replay.domain[0] + (range.value / 1000) * (replay.domain[1] - replay.domain[0]));
  });
  speed.addEventListener("change", () => replay.setSpeed(Number(speed.value)));
  scale.addEventListener("change", () => replay.setScale(scale.checked ? 3 : 1));
  el.addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT") return;
    if (e.key === " ") { e.preventDefault(); replay.toggle(); }
  });
}
