/**
 * input.js — unified input layer: touch joystick + buttons, keyboard (desktop testing),
 * and optional device-orientation (gyro) steering for supported iPads.
 */
const InputSys = (() => {
  const state = {
    steer: 0,       // -1..1
    accel: false,
    brake: false,
    drift: false,
    driftPressedEdge: false,
    driftReleasedEdge: false,
    item: false,
    itemPressedEdge: false,
    trick: false,
    trickPressedEdge: false,
    pausePressedEdge: false,
  };
  let gyroEnabled = false;
  let gyroBaseline = null;
  let joyActive = false, joyTouchId = null, joyCenter = { x: 0, y: 0 };
  const keys = {};

  function setupTouch() {
    const zone = document.getElementById('joystick-zone');
    const stick = document.getElementById('joystick-stick');
    const base = zone.querySelector('.joystick-base');

    function baseRect() { return base.getBoundingClientRect(); }

    zone.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      joyTouchId = t.identifier; joyActive = true;
      const r = baseRect();
      joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      updateStick(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) if (t.identifier === joyTouchId) updateStick(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    function endTouch(e) {
      for (const t of e.changedTouches) if (t.identifier === joyTouchId) {
        joyActive = false; joyTouchId = null; state.steer = 0;
        stick.style.transform = `translate(0px,0px)`;
      }
    }
    zone.addEventListener('touchend', endTouch);
    zone.addEventListener('touchcancel', endTouch);

    function updateStick(cx, cy) {
      const maxR = 45;
      let dx = cx - joyCenter.x, dy = cy - joyCenter.y;
      const d = Math.hypot(dx, dy);
      if (d > maxR) { dx = dx / d * maxR; dy = dy / d * maxR; }
      stick.style.transform = `translate(${dx}px,${dy}px)`;
      state.steer = Math.max(-1, Math.min(1, dx / maxR));
    }

    bindHold('btn-accel', v => state.accel = v);
    bindHold('btn-brake', v => state.brake = v);
    bindHold('btn-drift', v => {
      if (v && !state.drift) state.driftPressedEdge = true;
      if (!v && state.drift) state.driftReleasedEdge = true;
      state.drift = v;
    });
    bindTap('btn-item', () => state.itemPressedEdge = true);
    bindTap('btn-trick', () => state.trickPressedEdge = true);
    bindTap('btn-pause', () => state.pausePressedEdge = true);
  }

  function bindHold(id, cb) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = e => { cb(true); e.preventDefault(); };
    const off = e => { cb(false); e.preventDefault(); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off);
    el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on);
    window.addEventListener('mouseup', off);
  }
  function bindTap(id, cb) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', e => { cb(); e.preventDefault(); }, { passive: false });
    el.addEventListener('mousedown', () => cb());
  }

  function setupKeyboard() {
    window.addEventListener('keydown', e => {
      keys[e.code] = true;
      if (e.code === 'Space' && !state.drift) { state.drift = true; state.driftPressedEdge = true; }
      if (e.code === 'KeyE') state.itemPressedEdge = true;
      if (e.code === 'KeyQ') state.trickPressedEdge = true;
      if (e.code === 'Escape') state.pausePressedEdge = true;
    });
    window.addEventListener('keyup', e => {
      keys[e.code] = false;
      if (e.code === 'Space') { state.drift = false; state.driftReleasedEdge = true; }
    });
  }

  function setupGyro() {
    window.addEventListener('deviceorientation', e => {
      if (!gyroEnabled) return;
      if (gyroBaseline === null) gyroBaseline = e.gamma || 0;
      const rel = (e.gamma || 0) - gyroBaseline;
      state.steer = Math.max(-1, Math.min(1, rel / 22));
    });
  }

  async function requestGyroPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        gyroEnabled = res === 'granted';
      } catch (e) { gyroEnabled = false; }
    } else {
      gyroEnabled = true;
    }
    gyroBaseline = null;
    return gyroEnabled;
  }
  function setGyroEnabled(v) { gyroEnabled = v; gyroBaseline = null; }

  function pollFrame() {
    // keyboard override each frame (desktop testing convenience)
    if (keys['ArrowLeft'] || keys['KeyA']) state.steer = -1;
    else if (keys['ArrowRight'] || keys['KeyD']) state.steer = 1;
    else if (!joyActive && !gyroEnabled) state.steer = 0;
    state.accel = state.accel || keys['ArrowUp'] || keys['KeyW'];
    state.brake = state.brake || keys['ArrowDown'] || keys['KeyS'];
  }

  function clearFrameEdges() {
    state.driftPressedEdge = false;
    state.driftReleasedEdge = false;
    state.itemPressedEdge = false;
    state.trickPressedEdge = false;
    state.pausePressedEdge = false;
    if (!keys['ArrowUp'] && !keys['KeyW']) state.accel = false;
    if (!keys['ArrowDown'] && !keys['KeyS']) state.brake = false;
  }

  function init() {
    setupTouch();
    setupKeyboard();
    setupGyro();
  }

  return { init, state, pollFrame, clearFrameEdges, requestGyroPermission, setGyroEnabled };
})();
