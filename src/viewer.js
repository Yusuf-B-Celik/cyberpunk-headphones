/**
 * CY-01 · cyberpunk headphone viewer
 * ---------------------------------------------------------------------------
 * Loads the GLB exported from Blender (Draco compressed), lights it as a dark
 * studio product shot, and exposes an inspector: camera presets, part focus,
 * exploded view, wireframe, clay, neon toggle, bloom, PNG export.
 *
 * Everything is local: three.js is bundled, the Draco decoder ships in
 * assets/draco, no CDN requests.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { initSelfTest } from './selftest.js';

const MODEL_URL = 'model/cyberpunk-headphones.glb';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------ dom helpers */
const $ = (s) => document.querySelector(s);
const canvas = $('#gl');
const bootEl = $('#boot'), bootBar = $('#bootbar'), bootLabel = $('#bootlabel');
const captionEl = $('#caption');
const panelEl = $('#panel');

const state = {
  ready: false,
  explode: 0,
  wire: false,
  clay: false,
  neon: true,
  spin: !REDUCED,
  ground: true,
  bloom: true,
  focus: null,
};

/* ------------------------------------------------------------------ scene */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = gradientBackground();
scene.fog = new THREE.Fog(0x080a0e, 1.4, 3.6);

/** Vertical studio gradient used as the scene background. */
function gradientBackground() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.00, '#12161d');
  grd.addColorStop(0.42, '#0a0d13');
  grd.addColorStop(0.72, '#07090d');
  grd.addColorStop(1.00, '#04050a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 20);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.rotateSpeed = 0.85;
controls.zoomSpeed = 0.8;
controls.minDistance = 0.12;
controls.maxDistance = 1.6;
controls.autoRotate = state.spin;
controls.autoRotateSpeed = 0.9;
controls.target.set(0, 0.02, 0);

/* ------------------------------------------------- environment + lights */
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = envRT.texture;
scene.environmentIntensity = 0.48;

scene.add(new THREE.HemisphereLight(0x93b7ff, 0x05060a, 0.35));

const key = new THREE.DirectionalLight(0xfff3e6, 2.6);
key.position.set(-0.55, 0.62, 0.72);
scene.add(key);

const coolFill = new THREE.DirectionalLight(0x8fb6ff, 0.85);
coolFill.position.set(0.72, -0.18, 0.42);
scene.add(coolFill);

const rimCyan = new THREE.PointLight(0x36d8ff, 6.5, 3.2, 2);
rimCyan.position.set(0.42, 0.30, -0.48);
scene.add(rimCyan);

const rimMagenta = new THREE.PointLight(0xff2f8e, 4.2, 3.0, 2);
rimMagenta.position.set(-0.46, -0.10, -0.42);
scene.add(rimMagenta);

const topLight = new THREE.PointLight(0xbfe4ff, 3.0, 2.4, 2);
topLight.position.set(0.05, 0.55, 0.10);
scene.add(topLight);

/* ------------------------------------------------------- contact shadow */
function shadowTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.00, 'rgba(0,0,0,0.92)');
  grd.addColorStop(0.42, 'rgba(0,0,0,0.42)');
  grd.addColorStop(1.00, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 })
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = -0.098;
scene.add(shadow);

/* ---------------------------------------------------------------- loader */
const root = new THREE.Group();
scene.add(root);

const draco = new DRACOLoader().setDecoderPath('assets/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);

const parts = [];      // {obj, home:Vector3, center:Vector3, dir:Vector3, kind}
let modelRadius = 0.2;
let modelCenter = new THREE.Vector3();

bootBar.style.width = '12%';
loader.load(
  MODEL_URL,
  (gltf) => {
    const model = gltf.scene;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = false;
      o.frustumCulled = false;
      o.material.side = THREE.FrontSide;
      o.material.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (!matBackup.has(o.material)) {
        matBackup.set(o.material, {
          wireframe: o.material.wireframe,
          neonEmissive: o.material.emissiveIntensity ?? 0,
          color: o.material.color?.clone(),
          rough: o.material.roughness,
          metal: o.material.metallic,
          flat: o.material.flatShading,
        });
      }
    });
    root.add(model);

    // measure
    const box = new THREE.Box3().setFromObject(model);
    box.getCenter(modelCenter);
    const size = box.getSize(new THREE.Vector3());
    modelRadius = Math.max(size.x, size.y, size.z) * 0.5;
    shadow.scale.set(size.x * 2.05, size.z * 2.4, 1);
    shadow.position.y = box.min.y - 0.004;

    // classify parts; the glTF exporter splits each Blender object into one
    // primitive per material, so group primitives back into their assembly and
    // let every primitive of an assembly share one explode direction.
    const assemblies = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.name.replace(/_\d+$/, '');
      const kind = ['CupShell', 'EarPad', 'Baffle', 'Grille', 'Yoke', 'CupDetails']
        .find((k) => key.startsWith(k)) || 'Frame';
      const b = new THREE.Box3().setFromObject(o);
      const sphere = b.getBoundingSphere(new THREE.Sphere());
      let a = assemblies.get(key);
      if (!a) {
        a = { kind, box: new THREE.Box3(), radius: 0, meshes: [] };
        assemblies.set(key, a);
      }
      a.box.expandByObject(o);
      a.radius = Math.max(a.radius, sphere.radius);
      a.meshes.push(o);
    });
    assemblies.forEach((a, key) => {
      const c = a.box.getCenter(new THREE.Vector3());
      const dir = c.clone().sub(modelCenter);
      if (dir.lengthSq() < 1e-12) dir.set(0, 1, 0);
      dir.normalize();
      a.meshes.forEach((o) => parts.push({
        obj: o, kind: a.kind, assembly: key, home: o.position.clone(),
        center: c, dir, radius: a.radius,
      }));
    });

    // centre the model on the origin so orbit feels right
    model.position.sub(modelCenter);
    parts.forEach((p) => { p.center.sub(modelCenter); });

    $('#specTris').textContent = `${(countTriangles(model) / 1000).toFixed(1)}b`;
    $('#specSize').textContent = `${Math.round(size.x * 1000)}×${Math.round(size.y * 1000)}×${Math.round(size.z * 1000)} mm`;

    bootBar.style.width = '100%';
    bootLabel.textContent = 'hazır';
    state.ready = true;
    window.__viewer = api;
    applyView('hero', 0);
    setTimeout(() => bootEl.classList.add('gone'), 260);
    resize();
    initSelfTest(window.__viewer);
    note('<b>CY-01</b> — mat karbon fiber gövde, yumuşak deri pedler, geometrik panel olukları. Detay için panelden bir odak seç.');
  },
  (e) => {
    if (e.lengthComputable) bootBar.style.width = `${12 + (e.loaded / e.total) * 82}%`;
    else bootBar.style.width = '70%';
  },
  (err) => {
    console.error(err);
    bootLabel.textContent = 'model yüklenemedi — konsola bak';
    bootBar.style.width = '100%';
    bootBar.style.background = '#ff4fa3';
  }
);

function countTriangles(obj) {
  let n = 0;
  obj.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return n;
}

/* ------------------------------------------------------------- composer */
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.55, 0.88);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  // run the glow at half resolution: cheaper, and the blur is smoother
  bloomPass.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
}
addEventListener('resize', resize);
resize();

/* ---------------------------------------------------------- camera rig */
const VIEWS = {
  hero:   { dir: new THREE.Vector3(0.78, 0.34, 0.86), margin: 1.06 },
  front:  { dir: new THREE.Vector3(0.05, 0.12, 1.00), margin: 1.05 },
  side:   { dir: new THREE.Vector3(1.00, 0.08, 0.08), margin: 1.05 },
  top:    { dir: new THREE.Vector3(0.10, 1.00, 0.36), margin: 1.07 },
  bottom: { dir: new THREE.Vector3(0.30, -1.00, 0.30), margin: 1.07 },
};

function distanceFor(radius, margin) {
  const fov = THREE.MathUtils.degToRad(camera.fov);
  return (radius / Math.sin(fov / 2)) * margin;
}

/** Model bounding box, measured once on the assembled model. */
let modelBox = null;
function measuredBox() {
  if (modelBox) return modelBox;
  const b = new THREE.Box3();
  parts.forEach((p) => {
    p.obj.updateWorldMatrix(true, false);
    const g = p.obj.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    b.union(g.boundingBox.clone().applyMatrix4(p.obj.matrixWorld));
  });
  modelBox = b;
  return b;
}

/** Distance at which the whole model fits the frame from `dir`, with `margin`. */
function tightDistance(dir, margin = 1.06) {
  const box = measuredBox();
  const c = box.getCenter(new THREE.Vector3());
  const d = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const f = dir.clone().normalize().negate();            // camera looks this way
  const up = Math.abs(f.y) > 0.94 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const r = new THREE.Vector3().crossVectors(f, up).normalize();
  const u = new THREE.Vector3().crossVectors(r, f).normalize();
  const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  let need = 0;
  for (let i = 0; i < 8; i++) {
    const q = new THREE.Vector3(
      (i & 1 ? d.x : -d.x), (i & 2 ? d.y : -d.y), (i & 4 ? d.z : -d.z));
    need = Math.max(need, Math.abs(q.dot(r)) / th - q.dot(f), Math.abs(q.dot(u)) / tv - q.dot(f));
  }
  return { dist: need * margin, center: c };
}

let tween = null;
function flyTo(target, camPos, ms = 900) {
  if (REDUCED || ms === 0) {
    controls.target.copy(target);
    camera.position.copy(camPos);
    controls.update();
    return;
  }
  tween = {
    t: 0, ms,
    fromT: controls.target.clone(), toT: target.clone(),
    fromP: camera.position.clone(), toP: camPos.clone(),
  };
}
function applyView(name, ms = 950) {
  const v = VIEWS[name];
  if (!v) return;
  const { dist, center } = state.ready
    ? tightDistance(v.dir, v.margin)
    : { dist: 0.6, center: new THREE.Vector3() };
  const pos = v.dir.clone().normalize().multiplyScalar(dist).add(center);
  flyTo(center, pos, ms);
  state.focus = null;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
}
applyView.immediate = (n) => applyView(n, 0);

/** Focus presets: which parts to frame, from which direction. */
const FOCUS = {
  pad:    { kinds: ['EarPad'],     dir: new THREE.Vector3(-0.50, 0.42, 0.62), zoom: 1.32,
            text: '<b>Deri kulak pedi</b> — prosedürel gren: yumuşak mottle + kırışık ağı + gözenek göçüşü, normal haritası 512², rough 0.52–0.92. Sünger profili kulağa yaslanacak biçimde şişkin, iç açıklık 77×92 mm.' },
  shell:  { kinds: ['CupShell'],   dir: new THREE.Vector3(0.86, 0.30, 0.42), zoom: 1.18,
            text: '<b>Mat karbon fiber gövde</b> — 2/2 twill dokuma: 32 çözgü/atkı demeti, normal + roughness haritası, reçine mikro dalgalanması. Metallic 0, mat spekülar (rough 0.46–0.72).' },
  lines:  { kinds: ['CupShell'],   dir: new THREE.Vector3(0.56, 0.70, 0.44), zoom: 1.10,
            text: '<b>Panel çizgileri</b> — boya değil geometri: 45° pahlı duvar + düz taban, ayrı koyu malzeme (Seam). Gövdede çevresel hat, kubbe üzerinde 4 radyal çizgi; simetrik.' },
  grille: { kinds: ['Grille'],     dir: new THREE.Vector3(-0.52, 0.50, 0.60), zoom: 1.16,
            text: '<b>Sürücü ızgarası</b> — 4 eşmerkezli halka + 12 radyal kol + merkez göbek; işlenmiş metal (rough 0.42). Merkezde neon halka.' },
  hinge:  { kinds: ['Yoke', 'CupDetails'], dir: new THREE.Vector3(0.44, 0.74, 0.50), zoom: 1.30,
            text: '<b>Menteşe ve sürgü</b> — torna edilmiş yatak, iki kanal, neon pivot düğmesi; gövde altında USB-C yuvası ve tırtıklı kadran.' },
};

/** World box of the parts a focus preset should frame. */
function focusFrame(name) {
  const f = FOCUS[name];
  if (!f) return null;
  const box = new THREE.Box3();
  const all = parts.filter((p) => f.kinds.includes(p.kind));
  let chosen = all;
  // the model is symmetric, so framing both halves would centre on the origin:
  // frame one cup only unless the part exists on a single side
  const right = all.filter((p) => p.center.x > modelRadius * 0.15);
  if (right.length && right.length < all.length) chosen = right;
  chosen.forEach((p) => {
    p.obj.updateWorldMatrix(true, false);
    const g = p.obj.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    box.union(g.boundingBox.clone().applyMatrix4(p.obj.matrixWorld));
  });
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, modelRadius * 0.3);
  return { box, center, radius, set: chosen, all, preset: f };
}

function applyFocus(name) {
  const fr = focusFrame(name);
  if (!fr) return;
  const dir = fr.preset.dir.clone().normalize();
  // tight fit of the framed part, then pull back by the preset zoom factor
  const half = new THREE.Vector3();
  fr.box.getSize(half).multiplyScalar(0.5);
  const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const f = dir.clone().negate();
  const up = Math.abs(f.y) > 0.94 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const rr = new THREE.Vector3().crossVectors(f, up).normalize();
  const uu = new THREE.Vector3().crossVectors(rr, f).normalize();
  let need = 0;
  for (let i = 0; i < 8; i++) {
    const q = new THREE.Vector3((i & 1 ? half.x : -half.x), (i & 2 ? half.y : -half.y), (i & 4 ? half.z : -half.z));
    need = Math.max(need, Math.abs(q.dot(rr)) / th - q.dot(f), Math.abs(q.dot(uu)) / tv - q.dot(f));
  }
  const dist = need * fr.preset.zoom;
  const pos = dir.multiplyScalar(dist).add(fr.center);
  flyTo(fr.center, pos, 1000);
  state.focus = name;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.remove('on'));
  note(fr.preset.text);
}

/* -------------------------------------------------------------- explode */
const EXPLODE_GAIN = 0.14;
function applyExplode(t) {
  parts.forEach((p) => {
    const d = p.dir.clone();
    if (p.kind === 'EarPad' || p.kind === 'Baffle' || p.kind === 'Grille') {
      // pull the internals out sideways so the stack reads
      const side = Math.sign(p.center.x) || 1;
      d.x += side * 1.5;
      d.normalize();
    }
    p.obj.position.copy(p.home).addScaledVector(d, t * EXPLODE_GAIN);
  });
  shadow.material.opacity = 0.85 * (1 - t * 0.65);
}

/* ------------------------------------------------------------ materials */
const matBackup = new Map();
function setWire(on) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!matBackup.has(o.material)) {
      matBackup.set(o.material, {
        wireframe: o.material.wireframe,
        neonEmissive: o.material.emissiveIntensity,
        color: o.material.color?.clone(),
        rough: o.material.roughness,
        metal: o.material.metallic,
        flat: o.material.flatShading,
      });
    }
    const b = matBackup.get(o.material);
    if (on) {
      o.material.wireframe = true;
      o.material.flatShading = true;
    } else {
      o.material.wireframe = b.wireframe;
      o.material.flatShading = b.flat;
    }
    o.material.needsUpdate = true;
  });
}
function setClay(on) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = matBackup.get(o.material);
    if (!b) return;
    if (on) {
      if (o.material.color) o.material.color.setHex(0xb9bec6);
      if ('roughness' in o.material) o.material.roughness = 0.62;
      if ('metallic' in o.material) o.material.metallic = 0.0;
      o.material.emissiveIntensity = 0;
    } else {
      if (b.color && o.material.color) o.material.color.copy(b.color);
      if ('roughness' in o.material) o.material.roughness = b.rough;
      if ('metallic' in o.material) o.material.metallic = b.metal;
      o.material.emissiveIntensity = state.neon ? b.neonEmissive : 0;
    }
    o.material.needsUpdate = true;
  });
}
function setNeon(on) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = matBackup.get(o.material);
    const strength = b ? b.neonEmissive : (o.material.emissiveIntensity ?? 0);
    if (!b) return;
    o.material.emissiveIntensity = on && !state.clay ? strength : 0;
    o.material.needsUpdate = true;
  });
  bloomPass.enabled = state.bloom && on;
}

/* ----------------------------------------------------------------- ui */
function note(html) {
  captionEl.innerHTML = html;
  captionEl.classList.add('on');
  clearTimeout(note._t);
  note._t = setTimeout(() => captionEl.classList.remove('on'), 9000);
}

document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => applyView(b.dataset.view)));
document.querySelectorAll('[data-focus]').forEach((b) =>
  b.addEventListener('click', () => applyFocus(b.dataset.focus)));

$('#btnPanel').addEventListener('click', () => {
  const hidden = panelEl.classList.toggle('hidden');
  $('#btnPanel').setAttribute('aria-expanded', String(!hidden));
});

$('#explode').addEventListener('input', (e) => {
  state.explode = e.target.value / 100;
  $('#explodeOut').textContent = `${e.target.value}%`;
  applyExplode(state.explode);
});
$('#wire').addEventListener('change', (e) => { state.wire = e.target.checked; setWire(state.wire); });
$('#clay').addEventListener('change', (e) => { state.clay = e.target.checked; setClay(state.clay); });
$('#neon').addEventListener('change', (e) => { state.neon = e.target.checked; setNeon(state.neon); });
$('#spin').addEventListener('change', (e) => { state.spin = e.target.checked; controls.autoRotate = state.spin; });
$('#ground').addEventListener('change', (e) => { state.ground = e.target.checked; shadow.visible = state.ground; });
$('#bloom').addEventListener('change', (e) => {
  state.bloom = e.target.checked;
  bloomPass.enabled = state.bloom && state.neon;
});

$('#btnReset').addEventListener('click', () => {
  state.explode = 0; $('#explode').value = 0; $('#explodeOut').textContent = '0%';
  applyExplode(0);
  ['wire', 'clay'].forEach((id) => { $('#' + id).checked = false; });
  state.wire = state.clay = false; setWire(false); setClay(false);
  applyView('hero');
  note('<b>sıfırlandı</b> — 3/4 görünüm, malzemeler özgün.');
});

$('#btnShot').addEventListener('click', () => {
  composer.render();
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cy-01-headphones.png';
  a.click();
  note('PNG indirildi — sahne görüntüsü 3B tuvalden alındı.');
});

addEventListener('keydown', (e) => {
  if (e.target.matches('input,button,a')) return;
  const k = e.key.toLowerCase();
  if (k === 'p') $('#btnPanel').click();
  if (k === 'r') { $('#spin').checked = !$('#spin').checked; $('#spin').dispatchEvent(new Event('change')); }
  if (k === 'e') {
    const v = state.explode > 0.5 ? 0 : 100;
    $('#explode').value = v; $('#explode').dispatchEvent(new Event('input'));
  }
  if (k === 'w') { $('#wire').checked = !state.wire; $('#wire').dispatchEvent(new Event('change')); }
});

/* --------------------------------------------------------------- loop */
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0;

function tick() {
  requestAnimationFrame(tick);
  // cap generously: on a slow/software renderer a tight clamp turns every
  // transition into slow motion instead of protecting against huge jumps
  const dt = Math.min(clock.getDelta(), 0.12);

  if (tween) {
    tween.t += dt * 1000;
    const p = Math.min(1, tween.t / tween.ms);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // easeInOutCubic
    controls.target.lerpVectors(tween.fromT, tween.toT, e);
    camera.position.lerpVectors(tween.fromP, tween.toP, e);
    if (p >= 1) tween = null;
  }

  // subtle neon breathing
  const t = clock.elapsedTime;
  if (state.neon && !state.clay) {
    rimCyan.intensity = 6.5 + Math.sin(t * 0.9) * 0.7;
    rimMagenta.intensity = 4.2 + Math.sin(t * 0.62 + 1.8) * 0.5;
  }

  controls.update();
  composer.render();

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) {
    $('#fps').textContent = `${Math.round(fpsFrames / fpsAcc)} fps`;
    fpsAcc = 0; fpsFrames = 0;
  }
}
tick();

function frameFit() {
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const box = new THREE.Box3();
  parts.forEach((p) => {
    p.obj.updateWorldMatrix(true, false);
    const g = p.obj.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    box.union(g.boundingBox.clone().applyMatrix4(p.obj.matrixWorld));
  });
  let maxAbs = 0;
  const c = box.getCenter(new THREE.Vector3());
  const d = box.getSize(new THREE.Vector3());
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(
      c.x + (i & 1 ? d.x : -d.x) / 2,
      c.y + (i & 2 ? d.y : -d.y) / 2,
      c.z + (i & 4 ? d.z : -d.z) / 2).project(camera);
    maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
  }
  return { fits: maxAbs <= 1.02, maxAbsNdc: +maxAbs.toFixed(3), modelBox: [c.toArray().map((n) => +n.toFixed(3)), d.toArray().map((n) => +n.toFixed(3))] };
}

const api = {
  scene, camera, renderer, controls, state, parts, applyView, applyFocus, applyExplode,
  focusFrame, frameFit, THREE,
  debugTween: () => (tween ? {
    t: +tween.t.toFixed(1), ms: tween.ms,
    fromP: tween.fromP.toArray().map((n) => +n.toFixed(3)),
    toP: tween.toP.toArray().map((n) => +n.toFixed(3)),
    fromT: tween.fromT.toArray().map((n) => +n.toFixed(3)),
    toT: tween.toT.toArray().map((n) => +n.toFixed(3)),
  } : null),
  reducedMotion: REDUCED,
};
window.__viewer = api;
