/**
 * Self-test harness - only runs when the page is opened with ?selftest=1.
 * Exercises every control in a real browser and writes a JSON report into
 * #diag so it can be read from the accessibility tree / DOM dump.
 */
import * as THREE from 'three';

/** Does every corner of the model's bounding box project inside the viewport? */
// framing check lives in the viewer (it refreshes the camera matrices first)
function frameFit(v) {
  return v.frameFit();
}

function sceneTriangles(v) {
  let n = 0;
  v.scene.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return n;
}

export function initSelfTest(v) {
  const enabled = new URLSearchParams(location.search).has('selftest');
  const errors = [];
  addEventListener('error', (e) => errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason)));
  const origError = console.error;
  console.error = (...a) => { errors.push('console.error: ' + a.map(String).join(' ')); origError(...a); };

  let pre = document.getElementById('diag');
  if (!enabled) { if (pre) pre.remove(); return { enabled: false }; }
  if (!pre) {
    pre = document.createElement('pre');
    pre.id = 'diag';
    pre.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap';
    document.body.appendChild(pre);
  }

  const report = { steps: [], errors, started: new Date().toISOString() };
  const step = (name, data) => report.steps.push({ name, ...data });
  const pos = () => v.camera.position.toArray().map((n) => +n.toFixed(4));
  const tgt = () => v.controls.target.toArray().map((n) => +n.toFixed(4));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, timeout = 15000, step = 120) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (fn()) return Date.now() - t0;
      await wait(step);
    }
    return -1;
  };

  (async () => {
    await wait(60);
    step('load', {
      ready: v.state.ready,
      parts: v.parts.length,
      kinds: [...new Set(v.parts.map((p) => p.kind))].sort(),
      triangles: sceneTriangles(v),
      drawCalls: v.renderer.info.render.calls,
      assemblies: [...new Set(v.parts.map((p) => p.assembly))].sort(),
      textures: v.renderer.info.memory.textures,
      geometries: v.renderer.info.memory.geometries,
      camera: pos(), target: tgt(),
    });

    // camera presets must actually move the camera, each to a distinct place
    const seen = [];
    for (const name of ['front', 'side', 'top', 'bottom', 'hero']) {
      v.applyView(name, 0);
      await wait(30);
      seen.push({ name, camera: pos() });
      step('view:' + name, { camera: pos(), target: tgt(), ...frameFit(v) });
    }
    const uniq = new Set(seen.map((s) => s.camera.join(',')));
    step('presets', { distinct: uniq.size, expected: seen.length });

    step('modelBox', v.frameFit());
    for (const [k, fr] of Object.entries({
      pad: v.focusFrame('pad'), shell: v.focusFrame('shell'), lines: v.focusFrame('lines'),
      grille: v.focusFrame('grille'), hinge: v.focusFrame('hinge'),
    })) {
      step('frame:' + k, {
        parts: fr.set.length, ofTotal: fr.all.length,
        center: fr.center.toArray().map((n) => +n.toFixed(4)),
        radius: +fr.radius.toFixed(4),
      });
    }

    step('reducedMotion', { reduced: v.reducedMotion });
    // why does the tween not advance? sample it while it runs
    {
      v.applyView('hero', 0);
      await wait(80);
      const samples = [{ at: 0, cam: pos(), target: tgt(), tween: v.debugTween() }];
      v.applyFocus('pad');
      samples.push({ at: 1, cam: pos(), target: tgt(), tween: v.debugTween() });
      let acc = 0;
      for (const ms of [100, 350, 800, 1300]) {
        await wait(ms - acc); acc = ms;
        samples.push({ at: ms, cam: pos(), target: tgt(), tween: v.debugTween() });
      }
      step('focusDebug', { samples });
    }

    // part focus: the tween runs for 1s, so wait it out and check where we landed
    for (const name of ['pad', 'shell', 'lines', 'grille', 'hinge']) {
      const before = pos();
      v.applyFocus(name);
      // the transition is time-based, so wait for it to finish rather than
      // assuming a frame rate (headless software GL can run at a few fps)
      const took = await waitFor(() => !v.debugTween());
      const cap = document.getElementById('caption');
      const t = v.controls.target;
      const distToTarget = +v.camera.position.distanceTo(t).toFixed(3);
      step('focus:' + name, {
        transitionMs: took,
        camera: pos(), target: tgt(),
        moved: +Math.hypot(...before.map((b, i) => b - pos()[i])).toFixed(4),
        subjectIsCentred: +Math.hypot(t.x, t.y, t.z).toFixed(3) > 0.001,
        distToTarget,
        caption: cap.classList.contains('on'),
        captionLen: cap.textContent.trim().length,
      });
    }

    // exploded view must move every part away from its home position
    const homes = v.parts.map((p) => p.obj.position.clone());
    v.applyExplode(1);
    await wait(30);
    const moved = v.parts.filter((p, i) => p.obj.position.distanceTo(homes[i]) > 0.01).length;
    step('explode', { partsMoved: moved, parts: v.parts.length });
    v.applyExplode(0);
    await wait(20);
    const back = v.parts.filter((p, i) => p.obj.position.distanceTo(homes[i]) < 1e-6).length;
    step('explode:reset', { restored: back, parts: v.parts.length });

    // every checkbox in the panel, driven through real DOM events
    for (const id of ['neon', 'wire', 'clay', 'spin', 'ground', 'bloom']) {
      const el = document.getElementById(id);
      const before = el.checked;
      const emissiveBefore = emissiveTotal(v);
      el.checked = !before;
      el.dispatchEvent(new Event('change'));
      await wait(60);
      const emissiveAfter = emissiveTotal(v);
      if (id === 'neon' && emissiveAfter === emissiveBefore) {
        errors.push('neon toggle did not change emissive: ' + emissiveAfter);
      }
      step('toggle:' + id, {
        now: el.checked,
        state: v.state[id === 'wire' ? 'wire' : id],
        wireframes: countWire(v),
        emissive: emissiveTotal(v),
        glowPass: !!document.querySelector('canvas') && v.state.bloom,
      });
      el.checked = before;
      el.dispatchEvent(new Event('change'));
      await wait(20);
    }

    // slider
    const sl = document.getElementById('explode');
    sl.value = 65; sl.dispatchEvent(new Event('input'));
    await wait(30);
    step('slider', { out: document.getElementById('explodeOut').textContent, state: +v.state.explode.toFixed(2) });
    sl.value = 0; sl.dispatchEvent(new Event('input'));

    // panel + reset
    document.getElementById('btnPanel').click();
    const hidden = document.getElementById('panel').classList.contains('hidden');
    document.getElementById('btnPanel').click();
    step('panel', { toggledHidden: hidden, restored: !document.getElementById('panel').classList.contains('hidden') });

    document.getElementById('btnReset').click();
    await wait(40);
    step('reset', { camera: pos(), target: tgt(), explode: v.state.explode, wire: v.state.wire, clay: v.state.clay });

    // pixel probe: render into the composer and sample real luminance from the canvas
    v.camera.position.set(...[0.16, 0.06, 0.30]);
    v.controls.target.set(0, 0, 0);
    v.controls.update();
    await wait(120);
    report.pixels = await probePixels();

    report.ok = errors.length === 0 && uniq.size === 5;
    pre.textContent = 'SELFTEST ' + JSON.stringify(report);
    document.title = report.ok ? 'SELFTEST OK' : 'SELFTEST FAIL';
  })();

  function countWire(viewer) {
    let n = 0;
    viewer.scene.traverse((o) => { if (o.isMesh && o.material && o.material.wireframe) n++; });
    return n;
  }
  function emissiveTotal(viewer) {
    let s = 0;
    viewer.scene.traverse((o) => { if (o.isMesh && o.material && o.material.emissiveIntensity) s += o.material.emissiveIntensity; });
    return +s.toFixed(2);
  }

  /** Read the live framebuffer by forcing a fresh render in the same task. */
  async function probePixels() {
    const canvas = document.getElementById('gl');
    const c = document.createElement('canvas');
    c.width = 400; c.height = 250;
    const ctx = c.getContext('2d');
    // draw in the same frame as a render so the drawing buffer is still valid
    const grab = () => ctx.drawImage(canvas, 0, 0, c.width, c.height);
    const r = new Promise((res) => requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        grab();
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0, lit = 0, neon = 0, max = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = Math.max(d[i], d[i + 1], d[i + 2]);
          sum += l; if (l > 18) lit++; if (d[i + 2] > 110 && d[i] < 110) neon++;
          if (l > max) max = l; n++;
        }
        res({ mean: +(sum / n).toFixed(2), litPct: +(lit / n * 100).toFixed(1), neonPx: neon, max });
      });
    }));
    return r;
  }
  return { enabled: true, report };
}
