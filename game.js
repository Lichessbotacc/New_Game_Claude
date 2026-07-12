/**
 * game.js — top-level race orchestrator. Wires physics + AI + rendering + input + items
 * into playable Grand Prix / VS / Time Trial / Battle modes, drives the HUD, and hands
 * off to UI for menus/results/trophy screens.
 */
const GameApp = (() => {
  const NUM_RACERS = 8;
  const GP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1]; // classic-style points table

  let raceState = null; // active race object
  let gpState = null;   // {cupId, cc, trackIndex, tracks, points:{id:total}}
  let paused = false;
  let animHandle = null;

  function init() {
    RenderSys.init();
    InputSys.init();
  }

  // ---------- Entry points from UI ----------
  function startRace(selection) {
    if (selection.mode === 'gp') {
      const cup = CUPS[selection.cupId];
      gpState = { cupId: cup.id, cc: selection.cc, trackIndex: 0, tracks: cup.tracks, points: {} };
      loadRace(cup.tracks[0], selection, { mode: 'gp' });
    } else if (selection.mode === 'vs') {
      loadRace(selection.trackId, selection, { mode: 'vs' });
    } else if (selection.mode === 'tt') {
      loadRace(selection.trackId, selection, { mode: 'tt' });
    } else if (selection.mode === 'battle') {
      loadRace('coral_coast', selection, { mode: 'battle' });
    }
  }

  function loadRace(trackId, selection, opts) {
    UI.show('screen-race-loading');
    document.getElementById('race-loading-track').textContent = TRACKS[trackId].name;
    const tips = [
      'Tip: Hold Drift then release for a Mini-Turbo!',
      'Tip: Charge the drift longer for an Orange Mini-Turbo.',
      'Tip: Trick off ramps for a landing boost.',
      'Tip: Off-road terrain slows you down — stay on the racing line.',
      'Tip: Save defensive items for when a Zapper is incoming.',
    ];
    document.getElementById('rl-tip').textContent = tips[Math.floor(Math.random() * tips.length)];
    UI.playLoading(() => {
      buildRace(trackId, selection, opts);
    });
  }

  // ---------- Race construction ----------
  function buildRace(trackId, selection, opts) {
    const trackDef = TRACKS[trackId];
    const spline = new TrackSpline(trackDef);
    RenderSys.buildTrack(trackDef, spline);
    RenderSys.removeAllKarts();

    const character = getCharacter(selection.characterId);
    const kart = getKart(selection.kartId);
    const perf = combineStats(character, kart);
    const ccMult = { '100': 1.0, '150': 1.15, '200': 1.3 }[selection.cc] || 1.0;
    perf.topSpeed *= ccMult; perf.accel *= (opts.mode === 'tt' ? 1 : ccMult);

    const karts = [];
    const startU = segmentToU(trackDef, trackDef.startSegment);
    const player = new Kart({ trackSpline: spline, perf, startU, lane: 0, isPlayer: true });
    player.id = 'player'; player.name = character.name; player.color = character.color; player.character = character;
    karts.push(player);
    RenderSys.addKart('player', character.color);

    const aiDrivers = [];
    if (opts.mode !== 'tt') {
      const pool = ROSTER.characters.filter(c => c.id !== character.id);
      for (let i = 0; i < NUM_RACERS - 1; i++) {
        const c = pool[i % pool.length];
        const k = ROSTER.karts[i % ROSTER.karts.length];
        const aiPerf = combineStats(c, k);
        aiPerf.topSpeed *= ccMult * (0.9 + Math.random() * 0.15);
        aiPerf.accel *= ccMult;
        const lane = ((i % 4) - 1.5) * 3.2;
        const aiKart = new Kart({ trackSpline: spline, perf: aiPerf, startU, lane: lane - 6 - Math.floor(i / 4) * 5, isPlayer: false });
        aiKart.id = 'cpu' + i; aiKart.name = c.name; aiKart.color = c.color;
        karts.push(aiKart);
        RenderSys.addKart(aiKart.id, c.color);
        aiDrivers.push(new AIDriver(aiKart, pickPersonality(i), 0.55 + Math.random() * 0.4));
      }
    }

    raceState = {
      mode: opts.mode, trackDef, spline, karts, aiDrivers, player,
      itemEntities: [], time: 0, started: false, countdown: 3.999,
      finishedOrder: [], place: 1, camShake: 0,
      ghostFrames: [], ghostPlayback: opts.mode === 'tt' ? SaveSystem.getGhost(trackId) : null,
      ghostKartMesh: null, ghostIdx: 0,
      balloons: {}, battleTimer: opts.mode === 'battle' ? 120 : 0,
      selection, trackId,
    };
    karts.forEach(k => { k.item = null; });

    if (raceState.ghostPlayback) {
      RenderSys.addKart('ghost', 0x888888);
      raceState.ghostKartMesh = true;
    }
    if (opts.mode === 'battle') {
      karts.forEach(k => { raceState.balloons[k.id] = 3; });
    }

    document.getElementById('hud-lap').textContent = opts.mode === 'battle' ? 'BALLOONS: 3' : `LAP 1/${trackDef.laps}`;
    resize();
    UI.show('screen-hud');
    paused = false;
    AudioSys.startEngine();
    startCountdown();
    if (!animHandle) loop();
  }

  function resize() { RenderSys.resize(); }

  function startCountdown() {
    raceState.countdown = 3.0;
    const msg = document.getElementById('hud-message');
    msg.classList.add('show');
    let last = -1;
    const tick = () => {
      if (!raceState) return;
      const n = Math.ceil(raceState.countdown);
      if (n !== last && n > 0) { AudioSys.SFX.countBeep(); last = n; }
    };
    tick();
    raceState._countdownTickFn = tick;
  }

  // ---------- Main loop ----------
  function loop() {
    animHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.033, RenderSys && clockDelta());
    if (raceState && !paused) updateRace(dt);
    RenderSys.render();
  }
  let lastT = performance.now();
  function clockDelta() {
    const now = performance.now();
    const dt = (now - lastT) / 1000;
    lastT = now;
    return dt;
  }

  function updateRace(dt) {
    const rs = raceState;
    InputSys.pollFrame();

    if (rs.countdown > 0) {
      rs.countdown -= dt;
      const msg = document.getElementById('hud-message');
      if (rs.countdown <= 0) {
        msg.textContent = 'GO!'; AudioSys.SFX.countGo();
        setTimeout(() => msg.classList.remove('show'), 600);
        rs.started = true;
      } else {
        msg.textContent = String(Math.ceil(rs.countdown));
        rs._countdownTickFn();
      }
    }

    if (rs.started) {
      handlePlayerInput(rs, dt);
      rs.aiDrivers.forEach(ai => ai.update(dt, raceApi));
      rs.karts.forEach(k => k.update(dt, worldApi(rs)));
      resolveKartCollisions(rs.karts);
      updateItemBoxPickups(rs);
      rs.itemEntities.forEach(e => e.update(dt, rs.karts));
      rs.itemEntities = rs.itemEntities.filter(e => !e.dead);
      RenderSys.syncItemEntities(rs.itemEntities);
      RenderSys.updateHazards(rs.trackDef, dt);
      RenderSys.updateItemBoxes(rs.trackDef, dt);
      applyHazardCollisions(rs);

      if (rs.mode !== 'battle') updateRacePositionsAndLaps(rs, dt);
      else updateBattle(rs, dt);

      rs.time += dt;
      if (rs.mode === 'tt') recordGhostFrame(rs, dt);
      updateHUD(rs);
    }

    rs.karts.forEach(k => RenderSys.syncKartMesh(k.id, k));
    if (rs.ghostPlayback) syncGhostMesh(rs);
    RenderSys.updateCamera(rs.player, dt, rs.camShake);
    rs.camShake = Math.max(0, rs.camShake - dt * 2);
    AudioSys.updateEngine(rs.player.throttleInput, Math.abs(rs.player.speed) / rs.player.perf.topSpeed);
    if (SaveSystem.get().settings.showMinimap) RenderSys.drawMinimap(rs.spline, rs.karts, 'player');

    InputSys.clearFrameEdges();
    if (InputSys.state.pausePressedEdge) togglePause();
  }

  function handlePlayerInput(rs, dt) {
    const p = rs.player;
    const st = InputSys.state;
    p.steerInput = st.steer;
    p.throttleInput = st.accel ? 1 : 0;
    p.brakeInput = st.brake ? 1 : 0;
    if (st.driftPressedEdge) p.startDrift(st.steer !== 0 ? Math.sign(st.steer) : 1);
    if (st.driftReleasedEdge) p.releaseDrift();
    if (st.trickPressedEdge) p.doTrick();
    if (st.itemPressedEdge && p.item) useItem(p);
  }

  // ---------- Item pickups / usage ----------
  function updateItemBoxPickups(rs) {
    const boxes = rs.trackDef._itemBoxMeshes || [];
    rs.karts.forEach(k => {
      if (k.item) return;
      boxes.forEach(b => {
        if (!b.active) return;
        const dx = k.position.x - b.mesh.position.x, dz = k.position.z - b.mesh.position.z;
        if (Math.hypot(dx, dz) < 2.2) {
          const rankFrac = rankFractionOf(rs, k);
          k.item = rollItem(rankFrac, rs.karts.length);
          b.active = false; b.respawn = 4 + Math.random() * 2;
          if (k.isPlayer) { updateItemSlotUI(k.item); AudioSys.SFX.itemGet(); }
        }
      });
    });
  }
  function rankFractionOf(rs, kart) {
    const sorted = [...rs.karts].sort((a, b) => b.lapProgressU - a.lapProgressU);
    const idx = sorted.indexOf(kart);
    return idx / Math.max(1, sorted.length - 1);
  }
  function updateItemSlotUI(itemId) {
    const icon = document.getElementById('hud-item-icon');
    icon.textContent = itemId ? ITEM_DEFS[itemId].icon : '';
  }

  function useItem(kart) {
    if (!kart.item) return;
    const id = kart.item;
    if (useItemSelf(kart, id, raceApiFor(kart))) { kart.item = null; if (kart.isPlayer) updateItemSlotUI(null); return; }
    // projectile-style items
    const rs = raceState;
    const targetAhead = nearestAhead(rs, kart);
    switch (id) {
      case 'zapper': case 'triZapper':
        spawnZapper(rs, kart, targetAhead, id === 'triZapper' ? 3 : 1);
        break;
      case 'oilSlick': case 'tripleOil':
        spawnOil(rs, kart, id === 'tripleOil' ? 3 : 1);
        break;
      case 'swarmDrone': {
        const leader = rs.karts.reduce((a, b) => (a.lapProgressU > b.lapProgressU ? a : b));
        const e = new ItemEntity('swarmDrone', kart, { speed: 70, homing: true, target: leader, life: 10 });
        rs.itemEntities.push(e);
        break;
      }
      default: break;
    }
    AudioSys.SFX.itemUse();
    SaveSystem.bumpStat('itemsUsed');
    kart.item = null;
    if (kart.isPlayer) updateItemSlotUI(null);
  }
  function raceApiFor(kart) { return raceApi; }
  function nearestAhead(rs, kart) {
    let best = null, bestD = Infinity;
    rs.karts.forEach(k => {
      if (k === kart) return;
      if (k.lapProgressU <= kart.lapProgressU) return;
      const d = k.lapProgressU - kart.lapProgressU;
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }
  function spawnZapper(rs, kart, target, count) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        if (!raceState) return;
        const e = new ItemEntity('zapper', kart, { speed: 62, homing: !!target, target, life: 6 });
        raceState.itemEntities.push(e);
      }, i * 260);
    }
  }
  function spawnOil(rs, kart, count) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        if (!raceState) return;
        const e = new ItemEntity('oilSlick', kart, { trailBehind: true, life: 15 });
        raceState.itemEntities.push(e);
      }, i * 350);
    }
  }

  function applyHazardCollisions(rs) {
    (rs.trackDef._hazardObjs || []).forEach(hz => {
      if (hz.def.type === 'rotor' || hz.def.type === 'swinger') {
        const wp = new THREE.Vector3(); hz.mesh.getWorldPosition(wp);
        const armLen = hz.def.radius;
        rs.karts.forEach(k => {
          const dx = k.position.x - wp.x, dz = k.position.z - wp.z;
          const d = Math.hypot(dx, dz);
          if (d < armLen + 1.5 && d > armLen - 3 && k.spinoutTimer <= 0) {
            k.applySpinout(0.9);
            if (k.isPlayer) rs.camShake = 0.4;
          }
        });
      } else if (hz.def.type === 'lavaPuddle') {
        const wp = new THREE.Vector3(); hz.mesh.getWorldPosition(wp);
        rs.karts.forEach(k => {
          const dx = k.position.x - wp.x, dz = k.position.z - wp.z;
          if (Math.hypot(dx, dz) < 6 && k.grounded && k.spinoutTimer <= 0) k.applySpinout(0.7);
        });
      }
    });
  }

  // ---------- Race progress / ranking ----------
  function updateRacePositionsAndLaps(rs, dt) {
    rs.karts.forEach(k => {
      const lapNum = Math.floor(k.lapProgressU);
      if (lapNum > k.lap) {
        k.lap = lapNum;
        if (k.isPlayer && k.lap < rs.trackDef.laps) showLapBanner(`LAP ${k.lap + 1}/${rs.trackDef.laps}`);
        if (k.isPlayer) AudioSys.SFX.lapChime();
      }
      if (!k.finished && k.lap >= rs.trackDef.laps) {
        k.finished = true;
        k.finishTime = rs.time;
        rs.finishedOrder.push(k);
        if (k.isPlayer) onPlayerFinish(rs);
      }
    });
    const sorted = [...rs.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.lapProgressU - a.lapProgressU;
    });
    rs.place = sorted.indexOf(rs.player) + 1;
  }

  function showLapBanner(text) {
    const el = document.getElementById('hud-lap-banner');
    el.textContent = text; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1400);
  }

  function onPlayerFinish(rs) {
    if (rs.mode === 'tt') {
      finalizeTimeTrial(rs);
      return;
    }
    // wait for the rest to finish or timeout, then show results
    setTimeout(() => finishRaceIfDone(rs, true), 400);
  }
  function finishRaceIfDone(rs, force) {
    if (!raceState) return;
    // simulate remaining CPU finishes quickly by progress order if forced
    if (force) {
      const remaining = rs.karts.filter(k => !k.finished);
      remaining.sort((a, b) => b.lapProgressU - a.lapProgressU);
      remaining.forEach((k, i) => { k.finished = true; k.finishTime = rs.time + i * 1.2 + 1; rs.finishedOrder.push(k); });
    }
    showRaceResults(rs);
  }

  function showRaceResults(rs) {
    AudioSys.stopEngine();
    const ordered = [...rs.finishedOrder].sort((a, b) => a.finishTime - b.finishTime);
    const rows = ordered.map((k, i) => ({
      rank: i + 1, name: k.name, isPlayer: k.isPlayer, detail: UI.fmtTime(k.finishTime * 1000),
    }));
    SaveSystem.bumpStat('racesPlayed');
    const playerRank = ordered.findIndex(k => k.isPlayer) + 1;
    if (playerRank === 1) { SaveSystem.bumpStat('wins'); SaveSystem.unlockAchievement('first_win'); }
    if (playerRank <= 3) SaveSystem.bumpStat('podiums');
    if (SaveSystem.get().stats.racesPlayed >= 10) SaveSystem.unlockAchievement('ten_races');
    maybeUnlockRewards(playerRank);

    raceState._lastPlayerRank = playerRank;
    if (rs.mode === 'gp') {
      gpState.points[rs.player.id] = (gpState.points[rs.player.id] || 0) + (GP_POINTS[playerRank - 1] || 0);
      ordered.forEach((k, i) => { if (!k.isPlayer) gpState.points[k.id] = (gpState.points[k.id] || 0) + (GP_POINTS[i] || 0); });
    }
    UI.renderResults(rs.mode === 'gp' ? `RACE ${gpState.trackIndex + 1}/${gpState.tracks.length} RESULTS` : 'RACE RESULTS', rows,
      rs.mode === 'gp' ? 'Continue ▶' : 'Continue ▶');
  }

  function maybeUnlockRewards(playerRank) {
    if (playerRank === 1) {
      ROSTER.characters.forEach(c => { if (c.unlock && c.unlock.type === 'coins') { /* coin-based, evaluated elsewhere */ } });
    }
  }

  function onResultsContinue() {
    const rs = raceState;
    if (rs.mode === 'gp') {
      gpState.trackIndex++;
      if (gpState.trackIndex < gpState.tracks.length) {
        cleanupRace();
        loadRace(gpState.tracks[gpState.trackIndex], rs.selection, { mode: 'gp' });
      } else {
        finishGP();
      }
    } else {
      cleanupRace();
      UI.show('screen-main', false);
    }
  }

  function finishGP() {
    const standings = Object.entries(gpState.points).sort((a, b) => b[1] - a[1]);
    const playerTotal = gpState.points['player'] || 0;
    const rank = standings.findIndex(s => s[0] === 'player') + 1;
    let trophy = 'none';
    if (rank === 1) trophy = 'gold'; else if (rank === 2) trophy = 'silver'; else if (rank === 3) trophy = 'bronze';
    SaveSystem.recordCupResult(gpState.cupId, trophy, playerTotal);
    if (trophy === 'gold' && gpState.cupId === 'bolt') SaveSystem.unlockAchievement('gold_bolt');
    // unlock next cup's characters/kart automatically handled via profile.cupResults check
    checkCupUnlocks();
    UI.renderTrophy(trophy, CUPS[gpState.cupId].name);
    cleanupRace();
  }

  function checkCupUnlocks() {
    ROSTER.characters.forEach(c => { if (c.unlock && c.unlock.type === 'cup' && SaveSystem.get().cupResults[c.unlock.id]) SaveSystem.unlockCharacter(c.id); });
    ROSTER.karts.forEach(k => { if (k.unlock && k.unlock.type === 'cup' && SaveSystem.get().cupResults[k.unlock.id]) SaveSystem.unlockKart(k.id); });
    if (SaveSystem.get().unlockedCharacters.length === ROSTER.characters.length && SaveSystem.get().unlockedKarts.length === ROSTER.karts.length) {
      SaveSystem.unlockAchievement('all_unlocked');
    }
  }

  // ---------- Time Trial / ghost ----------
  function recordGhostFrame(rs, dt) {
    rs.ghostFrames.push({ x: rs.player.position.x, y: rs.player.position.y, z: rs.player.position.z, h: rs.player.heading });
  }
  function syncGhostMesh(rs) {
    if (!rs.ghostPlayback) return;
    const frames = rs.ghostPlayback.frames;
    const idx = Math.min(frames.length - 1, Math.floor(rs.time * 60));
    const f = frames[idx];
    if (!f) return;
    const mesh = RenderSys.scene.getObjectByProperty && null;
    // reuse kart sync path via a fake kart-like object
    const fake = { position: new THREE.Vector3(f.x, f.y, f.z), heading: f.h, isDrifting: false, driftDir: 0, grounded: true, verticalVel: 0, speed: 30, boostTimer: 0, shieldTimer: 0, invisTimer: 0 };
    fake.userData = {};
    RenderSys.syncKartMesh('ghost', fake);
  }
  function finalizeTimeTrial(rs) {
    AudioSys.stopEngine();
    AudioSys.SFX.finish();
    const timeMs = Math.floor(rs.time * 1000);
    const improved = SaveSystem.saveGhost(rs.trackId, timeMs, rs.ghostFrames);
    SaveSystem.bumpStat('racesPlayed');
    UI.renderResults('TIME TRIAL RESULT', [
      { rank: '🏁', name: rs.player.name, isPlayer: true, detail: UI.fmtTime(timeMs) },
      { rank: improved ? '★' : '—', name: improved ? 'New personal best!' : 'Ghost saved from best run', isPlayer: false, detail: SaveSystem.getGhost(rs.trackId) ? UI.fmtTime(SaveSystem.getGhost(rs.trackId).timeMs) : '' },
    ], 'Continue ▶');
  }

  // ---------- Battle mode ----------
  function updateBattle(rs, dt) {
    rs.battleTimer -= dt;
    // balloon pop detection: a spinout rising edge (freshly hit) costs one balloon
    rs.karts.forEach(k => {
      const justHit = k.spinoutTimer > 0 && !k._wasSpinning;
      if (justHit && rs.balloons[k.id] > 0) {
        rs.balloons[k.id]--;
        AudioSys.SFX.balloonPop();
      }
      k._wasSpinning = k.spinoutTimer > 0;
    });
    document.getElementById('hud-lap').textContent = `BALLOONS: ${rs.balloons['player']} · ${Math.max(0, Math.ceil(rs.battleTimer))}s`;
    if (rs.battleTimer <= 0 || rs.balloons['player'] <= 0) {
      endBattle(rs);
    }
  }
  function endBattle(rs) {
    if (raceState !== rs) return;
    AudioSys.stopEngine();
    const standings = Object.entries(rs.balloons).sort((a, b) => b[1] - a[1]);
    const rows = standings.map(([id, bal], i) => ({ rank: i + 1, name: rs.karts.find(k => k.id === id).name, isPlayer: id === 'player', detail: bal + ' balloons' }));
    const playerWon = standings[0][0] === 'player';
    if (playerWon) { SaveSystem.bumpStat('battlesWon'); SaveSystem.unlockAchievement('battle_win'); }
    UI.renderResults('BATTLE RESULTS', rows, 'Continue ▶');
    cleanupRace();
  }

  // ---------- HUD ----------
  function updateHUD(rs) {
    if (rs.mode !== 'battle') {
      document.getElementById('hud-position').innerHTML = rs.place + ordinalSuffix(rs.place);
      document.getElementById('hud-lap').textContent = `LAP ${Math.min(rs.player.lap + 1, rs.trackDef.laps)}/${rs.trackDef.laps}`;
      document.getElementById('hud-timer').textContent = UI.fmtTime(rs.time * 1000);
    }
  }
  function ordinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return '<span>' + (s[(v - 20) % 10] || s[v] || s[0]) + '</span>';
  }

  // ---------- Rubber-banding ----------
  function getRubberBandFactor(kart) {
    if (!raceState || kart.isPlayer) return 1;
    const player = raceState.player;
    const diff = kart.lapProgressU - player.lapProgressU;
    // if AI is far ahead of player, slow slightly; if far behind, speed up slightly
    return Math.max(0.85, Math.min(1.18, 1 - diff * 0.4));
  }

  const raceApi = {
    get trackSpline() { return raceState && raceState.spline; },
    useItem: (kart) => useItem(kart),
    getRubberBandFactor,
    spawnShockwave: (kart) => {
      const rs = raceState;
      rs.karts.forEach(k => {
        if (k === kart) return;
        const d = k.position.distanceTo(kart.position);
        if (d < 14 && k.shieldTimer <= 0 && k.invisTimer <= 0) k.applySpinout(0.8);
      });
      rs.camShake = 0.5;
    },
  };
  function worldApi(rs) {
    return {
      isRampSegment: (u) => (rs.trackDef.ramps || []).some(seg => Math.abs(((u - segmentToU(rs.trackDef, seg) + 1.5) % 1) - 0.5) < 0.012),
      isBoostSegment: (u) => (rs.trackDef.boostPads || []).some(seg => Math.abs(((u - segmentToU(rs.trackDef, seg) + 1.5) % 1) - 0.5) < 0.01),
    };
  }

  // ---------- Pause / lifecycle ----------
  function togglePause() {
    if (!raceState) return;
    paused = !paused;
    UI.show(paused ? 'screen-pause' : 'screen-hud', paused);
    if (paused) AudioSys.stopEngine(); else AudioSys.startEngine();
  }
  function resumeRace() { paused = false; UI.show('screen-hud', false); AudioSys.startEngine(); }
  function restartRace() {
    const rs = raceState; if (!rs) return;
    const sel = rs.selection, trackId = rs.trackId, mode = rs.mode;
    cleanupRace();
    loadRace(trackId, sel, { mode });
  }
  function quitRace() {
    cleanupRace();
    gpState = null;
    UI.show('screen-main', false);
  }
  function cleanupRace() {
    AudioSys.stopEngine();
    raceState = null;
    paused = false;
  }

  return {
    init, startRace, resumeRace, restartRace, quitRace, onResultsContinue,
  };
})();
