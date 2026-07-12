/**
 * rendering.js — Three.js scene construction and per-frame render/camera update.
 * Track geometry is generated procedurally from the TrackSpline so every track
 * defined purely as data in track.js gets a full 3D mesh for free.
 */
const RenderSys = (() => {
  let renderer, scene, camera, clock;
  let trackGroup, kartMeshes = {}, itemMeshes = [];
  let sun, hemi;
  let particleSystems = [];
  let canvas;

  function init() {
    canvas = document.getElementById('gl-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = false; // perf: keep shadows off for iPad Safari WebGL
    resize();
    window.addEventListener('resize', resize);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 800);
    clock = new THREE.Clock();

    hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.1);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(60, 100, 40);
    scene.add(sun);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  function clearTrack() {
    if (trackGroup) { scene.remove(trackGroup); disposeGroup(trackGroup); }
    itemMeshes.forEach(m => scene.remove(m.mesh));
    itemMeshes = [];
    particleSystems.forEach(p => scene.remove(p.points));
    particleSystems = [];
  }
  function disposeGroup(g) {
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); } });
  }

  function buildTrack(trackDef, spline) {
    clearTrack();
    trackGroup = new THREE.Group();

    scene.background = new THREE.Color(trackDef.skyBottom);
    scene.fog = new THREE.Fog(new THREE.Color(trackDef.skyBottom).getHex(), 140, 620);
    hemi.color = new THREE.Color(trackDef.skyTop);
    hemi.groundColor = new THREE.Color(trackDef.groundColor);

    // ground plane
    const groundGeo = new THREE.PlaneGeometry(2000, 2000, 1, 1);
    const groundMat = new THREE.MeshLambertMaterial({ color: trackDef.groundColor });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    trackGroup.add(ground);

    // road ribbon
    const segs = 400;
    const roadVerts = [];
    const roadUVs = [];
    const roadIdx = [];
    const edgeLeft = [], edgeRight = [];
    for (let i = 0; i <= segs; i++) {
      const u = (i / segs) % 1;
      const p = spline.pointAt(u);
      const tangent = spline.tangentAt(u);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const halfW = trackDef.width / 2;
      const l = p.clone().add(normal.clone().multiplyScalar(halfW));
      const r = p.clone().add(normal.clone().multiplyScalar(-halfW));
      roadVerts.push(l.x, l.y + 0.02, l.z, r.x, r.y + 0.02, r.z);
      roadUVs.push(0, i / 10, 1, i / 10);
      edgeLeft.push(l); edgeRight.push(r);
      if (i < segs) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        roadIdx.push(a, b, c, b, d, c);
      }
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVerts, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
    roadGeo.setIndex(roadIdx);
    roadGeo.computeVertexNormals();
    const roadMat = new THREE.MeshLambertMaterial({ color: trackDef.roadColor });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    trackGroup.add(roadMesh);

    // stripes along edges (barrier markers)
    addEdgeBarriers(edgeLeft, trackDef);
    addEdgeBarriers(edgeRight, trackDef);

    // item boxes
    trackDef._itemBoxMeshes = [];
    (trackDef.itemBoxSlots || []).forEach(segIdx => {
      const u = segmentToU(trackDef, segIdx);
      const p = spline.pointAt(u);
      const box = makeItemBoxMesh();
      box.position.set(p.x, p.y + 1.3, p.z);
      trackGroup.add(box);
      trackDef._itemBoxMeshes.push({ mesh: box, u, active: true, respawn: 0 });
    });

    // boost pads
    (trackDef.boostPads || []).forEach(segIdx => {
      const u = segmentToU(trackDef, segIdx);
      const p = spline.pointAt(u);
      const tangent = spline.tangentAt(u);
      const pad = makeBoostPadMesh(trackDef.width * 0.7);
      pad.position.set(p.x, p.y + 0.03, p.z);
      pad.rotation.y = Math.atan2(tangent.x, tangent.z);
      trackGroup.add(pad);
    });

    // ramps (visual wedge)
    (trackDef.ramps || []).forEach(segIdx => {
      const u = segmentToU(trackDef, segIdx);
      const p = spline.pointAt(u);
      const tangent = spline.tangentAt(u);
      const ramp = makeRampMesh(trackDef.width * 0.8);
      ramp.position.set(p.x, p.y, p.z);
      ramp.rotation.y = Math.atan2(tangent.x, tangent.z);
      trackGroup.add(ramp);
    });

    // decorative props scattered off-track
    addScenery(spline, trackDef);

    // hazards
    trackDef._hazardObjs = (trackDef.hazards || []).map(h => buildHazard(h, spline, trackDef));

    scene.add(trackGroup);
  }

  function addEdgeBarriers(edgePts, trackDef) {
    const geo = new THREE.BoxGeometry(0.6, 0.9, 1.6);
    const matA = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const matB = new THREE.MeshLambertMaterial({ color: 0xff5e3a });
    const inst = new THREE.InstancedMesh(geo, matA, Math.ceil(edgePts.length / 6));
    let count = 0;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < edgePts.length; i += 6) {
      const p = edgePts[i];
      dummy.position.set(p.x, p.y + 0.4, p.z);
      dummy.updateMatrix();
      inst.setMatrixAt(count, dummy.matrix);
      inst.setColorAt(count, new THREE.Color(count % 2 === 0 ? 0xffffff : 0xff5e3a));
      count++;
    }
    inst.count = count;
    inst.instanceMatrix.needsUpdate = true;
    trackGroup.add(inst);
  }

  function makeItemBoxMesh() {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x664400, metalness: 0.3, roughness: 0.4 });
    const box = new THREE.Mesh(geo, mat);
    g.add(box);
    g.userData.spin = true;
    return g;
  }
  function makeBoostPadMesh(width) {
    const geo = new THREE.PlaneGeometry(width, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x21e6c1, transparent: true, opacity: 0.55 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  function makeRampMesh(width) {
    const geo = new THREE.BoxGeometry(width, 2.2, 6);
    geo.translate(0, 1.1, 3);
    const mat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -0.28;
    return m;
  }

  function addScenery(spline, trackDef) {
    const propGeo = new THREE.ConeGeometry(1.4, 4, 6);
    const propMat = new THREE.MeshLambertMaterial({ color: 0x2f8f4a });
    const inst = new THREE.InstancedMesh(propGeo, propMat, 90);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 90; i++) {
      const u = Math.random();
      const p = spline.pointAt(u);
      const tangent = spline.tangentAt(u);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const side = Math.random() > 0.5 ? 1 : -1;
      const dist = trackDef.width / 2 + 8 + Math.random() * 30;
      const pos = p.clone().add(normal.multiplyScalar(side * dist));
      dummy.position.set(pos.x, pos.y + 2, pos.z);
      dummy.scale.setScalar(0.6 + Math.random() * 1.2);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    trackGroup.add(inst);
  }

  function buildHazard(h, spline, trackDef) {
    const u = segmentToU(trackDef, h.segment);
    const center = spline.pointAt(u);
    let mesh;
    if (h.type === 'rotor') {
      const g = new THREE.Group();
      const armGeo = new THREE.BoxGeometry(h.radius * 2, 1, 1.2);
      const armMat = new THREE.MeshLambertMaterial({ color: 0xff5e3a });
      const arm = new THREE.Mesh(armGeo, armMat);
      g.add(arm);
      g.position.set(center.x, center.y + 1, center.z);
      mesh = g;
    } else if (h.type === 'swinger') {
      const g = new THREE.Group();
      const ballGeo = new THREE.SphereGeometry(1.6, 10, 10);
      const ballMat = new THREE.MeshLambertMaterial({ color: 0x7a5cff });
      const ball = new THREE.Mesh(ballGeo, ballMat);
      ball.position.set(h.radius, 0, 0);
      g.add(ball);
      g.position.set(center.x, center.y + 1.4, center.z);
      mesh = g;
    } else {
      const g = new THREE.Group();
      const geo = new THREE.CircleGeometry(6, 16);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.6 });
      const disc = new THREE.Mesh(geo, mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(center.x, center.y + 0.05, center.z);
      g.add(disc);
      mesh = g;
    }
    trackGroup.add(mesh);
    return { def: h, mesh, u, center, t: 0 };
  }

  function updateHazards(trackDef, dt) {
    (trackDef._hazardObjs || []).forEach(hz => {
      hz.t += dt;
      if (hz.def.type === 'rotor') hz.mesh.rotation.y = hz.t * 1.6;
      else if (hz.def.type === 'swinger') hz.mesh.rotation.z = Math.sin(hz.t * 1.3) * 1.4;
    });
  }

  function updateItemBoxes(trackDef, dt) {
    (trackDef._itemBoxMeshes || []).forEach(b => {
      b.mesh.rotation.y += dt * 2;
      b.mesh.position.y += Math.sin(performance.now() / 300 + b.u * 10) * 0.003;
      if (!b.active) {
        b.respawn -= dt;
        b.mesh.visible = false;
        if (b.respawn <= 0) { b.active = true; b.mesh.visible = true; }
      }
    });
  }

  // ---------- Karts ----------
  function makeKartMesh(color) {
    const g = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(1.6, 0.6, 2.6);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.5;
    g.add(body);

    const cabinGeo = new THREE.BoxGeometry(1.0, 0.5, 1.2);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x222430 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.95, -0.1);
    g.add(cabin);

    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.4, 10);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wheelOffsets = [[-0.9, 0.2, 1.0], [0.9, 0.2, 1.0], [-0.9, 0.2, -1.0], [0.9, 0.2, -1.0]];
    const wheels = wheelOffsets.map(o => {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(o[0], o[1], o[2]);
      g.add(w);
      return w;
    });
    g.userData.wheels = wheels;

    // driver blob
    const headGeo = new THREE.SphereGeometry(0.42, 10, 10);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffe0b0 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 1.35, -0.1);
    g.add(head);

    // shield visual (hidden by default)
    const shieldGeo = new THREE.SphereGeometry(2.0, 12, 12);
    const shieldMat = new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.28, depthWrite: false });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    shield.visible = false;
    g.add(shield);
    g.userData.shield = shield;

    return g;
  }

  function addKart(id, color) {
    const mesh = makeKartMesh(color);
    scene.add(mesh);
    kartMeshes[id] = mesh;
    return mesh;
  }
  function removeAllKarts() {
    Object.values(kartMeshes).forEach(m => scene.remove(m));
    kartMeshes = {};
  }

  function syncKartMesh(id, kart) {
    const mesh = kartMeshes[id];
    if (!mesh) return;
    mesh.position.copy(kart.position);
    mesh.rotation.y = kart.heading;
    mesh.rotation.z = kart.isDrifting ? -kart.driftDir * 0.18 : 0;
    mesh.rotation.x = kart.grounded ? 0 : Math.max(-0.3, Math.min(0.3, kart.verticalVel * 0.01));
    mesh.userData.wheels.forEach(w => w.rotation.x += kart.speed * 0.02);
    mesh.userData.shield.visible = kart.shieldTimer > 0;
    mesh.visible = kart.invisTimer > 0 ? (Math.floor(performance.now() / 80) % 2 === 0) : true;
    const body = mesh.children[0];
    if (body && body.material) {
      if (kart.boostTimer > 0) body.material.emissive = new THREE.Color(0xff8844);
      else body.material.emissive = new THREE.Color(0x000000);
    }
  }

  // ---------- Item entities ----------
  function syncItemEntities(entities) {
    // remove stale
    itemMeshes = itemMeshes.filter(im => {
      if (!entities.includes(im.entity)) { scene.remove(im.mesh); return false; }
      return true;
    });
    entities.forEach(e => {
      let im = itemMeshes.find(x => x.entity === e);
      if (!im) {
        const geo = e.type.includes('oil') ? new THREE.CylinderGeometry(1, 1, 0.3, 10) : new THREE.SphereGeometry(0.6, 10, 10);
        const color = e.type.includes('oil') ? 0x2a2a2a : (e.type.includes('zapper') ? 0x21e6c1 : 0xffffff);
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 }));
        scene.add(mesh);
        im = { entity: e, mesh };
        itemMeshes.push(im);
      }
      im.mesh.position.copy(e.position);
      im.mesh.position.y += 0.4;
      im.mesh.rotation.y += 0.15;
    });
  }

  // ---------- Camera ----------
  function updateCamera(kart, dt, cameraShake = 0) {
    const back = kart.forward.clone().multiplyScalar(-8.5);
    const desired = kart.position.clone().add(back).add(new THREE.Vector3(0, 4.2, 0));
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    const lookTarget = kart.position.clone().add(kart.forward.clone().multiplyScalar(8)).add(new THREE.Vector3(0, 1.5, 0));
    camera.lookAt(lookTarget);
    if (cameraShake > 0) {
      camera.position.x += (Math.random() - 0.5) * cameraShake;
      camera.position.y += (Math.random() - 0.5) * cameraShake;
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  // ---------- Minimap ----------
  function drawMinimap(spline, karts, playerId) {
    const cnv = document.getElementById('minimap-canvas');
    if (!cnv) return;
    const ctx = cnv.getContext('2d');
    ctx.clearRect(0, 0, cnv.width, cnv.height);
    // compute bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const p = spline.pointAt(i / 60);
      pts.push(p);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 12;
    const scale = Math.min((cnv.width - pad * 2) / (maxX - minX || 1), (cnv.height - pad * 2) / (maxZ - minZ || 1));
    const toXY = p => [pad + (p.x - minX) * scale, pad + (p.z - minZ) * scale];
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = toXY(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath();
    ctx.stroke();
    karts.forEach(k => {
      const [x, y] = toXY(k.position);
      ctx.fillStyle = k.id === playerId ? '#21e6c1' : '#ff5e3a';
      ctx.beginPath(); ctx.arc(x, y, k.id === playerId ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  return {
    init, resize, buildTrack, addKart, removeAllKarts, syncKartMesh, syncItemEntities,
    updateCamera, render, drawMinimap, updateHazards, updateItemBoxes,
    get scene() { return scene; }, get camera() { return camera; },
  };
})();
