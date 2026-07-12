/**
 * ui.js — screen manager and all menu wiring (title, mode/cup/char/kart select,
 * pause, results, trophy, stats, settings). Talks to Game via window.GameApp.
 */
const UI = (() => {
  const screens = {};
  let backStack = [];
  let selection = {
    mode: 'gp', cc: '100', cupId: 'bolt', trackId: null,
    characterId: null, kartId: null,
  };

  function cacheScreens() {
    document.querySelectorAll('.screen').forEach(s => screens[s.id] = s);
  }

  function show(id, push = true) {
    if (push && screens[id] && document.querySelector('.screen.active')) {
      const cur = document.querySelector('.screen.active');
      if (cur && cur.id !== id) backStack.push(cur.id);
    }
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[id].classList.add('active');
  }
  function goBack(fallback = 'screen-main') {
    const prev = backStack.pop() || fallback;
    show(prev, false);
  }

  function fmtTime(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000));
    return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(3, '0')}`;
  }

  // ---------- Loading ----------
  function playLoading(cb) {
    let p = 0;
    const fill = document.getElementById('loading-bar-fill');
    const label = document.getElementById('loading-label');
    const labels = ['Warming up engines…', 'Painting the track…', 'Inflating tires…', 'Polishing shells…', 'Ready!'];
    const t = setInterval(() => {
      p += 8 + Math.random() * 14;
      fill.style.width = Math.min(100, p) + '%';
      label.textContent = labels[Math.min(labels.length - 1, Math.floor(p / 25))];
      if (p >= 100) { clearInterval(t); setTimeout(cb, 250); }
    }, 90);
  }

  // ---------- Cup grid ----------
  function renderCupGrid() {
    const profile = SaveSystem.get();
    const grid = document.getElementById('cup-grid');
    grid.innerHTML = '';
    document.getElementById('cup-title').textContent = selection.mode === 'gp' ? 'SELECT CUP' : 'SELECT TRACK';
    if (selection.mode === 'gp') {
      Object.values(CUPS).forEach(cup => {
        const locked = cup.unlock && !(profile.cupResults[cup.unlock.id]);
        const card = document.createElement('div');
        card.className = 'cup-card' + (locked ? ' locked' : '');
        const result = profile.cupResults[cup.id];
        const trophyIcon = result ? { gold: '🥇', silver: '🥈', bronze: '🥉' }[result.trophy] : '';
        card.innerHTML = `<div class="cup-icon">${cup.icon}</div><div class="cup-name">${cup.name}</div><div class="cup-sub">${cup.tracks.length} races ${trophyIcon}</div>`;
        if (!locked) card.onclick = () => { AudioSys.SFX.uiConfirm(); selection.cupId = cup.id; goToCharSelect(); };
        grid.appendChild(card);
      });
    } else {
      Object.values(TRACKS).forEach(t => {
        const card = document.createElement('div');
        card.className = 'cup-card';
        card.innerHTML = `<div class="cup-icon">🏁</div><div class="cup-name">${t.name}</div><div class="cup-sub">${t.laps} laps</div>`;
        card.onclick = () => { AudioSys.SFX.uiConfirm(); selection.trackId = t.id; goToCharSelect(); };
        grid.appendChild(card);
      });
    }
  }

  function renderTTGrid() {
    const grid = document.getElementById('tt-grid');
    grid.innerHTML = '';
    Object.values(TRACKS).forEach(t => {
      const ghost = SaveSystem.getGhost(t.id);
      const card = document.createElement('div');
      card.className = 'cup-card';
      card.innerHTML = `<div class="cup-icon">⏱️</div><div class="cup-name">${t.name}</div><div class="cup-sub">${ghost ? 'Best: ' + fmtTime(ghost.timeMs) : 'No time yet'}</div>`;
      card.onclick = () => { AudioSys.SFX.uiConfirm(); selection.mode = 'tt'; selection.trackId = t.id; goToCharSelect(); };
      grid.appendChild(card);
    });
  }

  function goToCharSelect() { renderCharGrid(); show('screen-char'); }

  // ---------- Character select ----------
  function renderCharGrid() {
    const profile = SaveSystem.get();
    const grid = document.getElementById('char-grid');
    grid.innerHTML = '';
    ROSTER.characters.forEach(c => {
      const unlocked = SaveSystem.isCharUnlocked(c.id);
      const card = document.createElement('div');
      card.className = 'char-card' + (unlocked ? '' : ' locked') + (selection.characterId === c.id ? ' selected' : '');
      card.style.color = c.color;
      card.innerHTML = `${c.emoji}` + (unlocked ? '' : '<span class="lock-badge">🔒</span>');
      card.onclick = () => {
        if (!unlocked) { AudioSys.SFX.hit(); return; }
        AudioSys.SFX.uiClick();
        selection.characterId = c.id;
        renderCharGrid();
        renderCharDetail(c);
      };
      grid.appendChild(card);
    });
    if (!selection.characterId) selection.characterId = ROSTER.characters.find(c => SaveSystem.isCharUnlocked(c.id)).id;
    renderCharDetail(getCharacter(selection.characterId));
  }
  function renderCharDetail(c) {
    document.getElementById('char-portrait').textContent = c.emoji;
    document.getElementById('char-portrait').style.color = c.color;
    document.getElementById('char-name').textContent = c.name;
    document.getElementById('char-class').textContent = c.cls.toUpperCase() + ' CLASS';
    const statsEl = document.getElementById('char-stats');
    statsEl.innerHTML = '';
    Object.entries(c.stats).forEach(([k, v]) => statsEl.appendChild(statRow(k, v)));
  }
  function statRow(label, val) {
    const row = document.createElement('div'); row.className = 'stat-row';
    row.innerHTML = `<div class="stat-label">${label}</div><div class="stat-track"><div class="stat-fill" style="width:${Math.round(val * 100)}%"></div></div>`;
    return row;
  }

  // ---------- Kart select ----------
  function renderKartGrid() {
    const grid = document.getElementById('kart-grid');
    grid.innerHTML = '';
    ROSTER.karts.forEach(k => {
      const unlocked = SaveSystem.isKartUnlocked(k.id);
      const card = document.createElement('div');
      card.className = 'char-card' + (unlocked ? '' : ' locked') + (selection.kartId === k.id ? ' selected' : '');
      card.innerHTML = `${k.emoji}` + (unlocked ? '' : '<span class="lock-badge">🔒</span>');
      card.onclick = () => {
        if (!unlocked) { AudioSys.SFX.hit(); return; }
        AudioSys.SFX.uiClick();
        selection.kartId = k.id;
        renderKartGrid();
        renderKartDetail(k);
      };
      grid.appendChild(card);
    });
    if (!selection.kartId) selection.kartId = ROSTER.karts.find(k => SaveSystem.isKartUnlocked(k.id)).id;
    renderKartDetail(getKart(selection.kartId));
  }
  function renderKartDetail(k) {
    document.getElementById('kart-portrait').textContent = k.emoji;
    document.getElementById('kart-name').textContent = k.name;
    const statsEl = document.getElementById('kart-stats');
    statsEl.innerHTML = '';
    Object.entries(k.stats).forEach(([key, v]) => statsEl.appendChild(statRow(key, v)));
  }

  // ---------- Results / trophy ----------
  function renderResults(title, rows, continueLabel) {
    document.getElementById('results-title').textContent = title;
    const table = document.getElementById('results-table');
    table.innerHTML = '';
    rows.forEach(r => {
      const div = document.createElement('div');
      div.className = 'result-row' + (r.isPlayer ? ' me' : '');
      div.innerHTML = `<div class="result-rank">${r.rank}</div><div class="result-name">${r.name}</div><div class="result-time">${r.detail || ''}</div>`;
      table.appendChild(div);
    });
    document.getElementById('results-continue').textContent = continueLabel || 'Continue ▶';
    show('screen-results');
  }

  function renderTrophy(trophy, cupName) {
    const icon = { gold: '🥇', silver: '🥈', bronze: '🥉', none: '🏁' }[trophy];
    const text = { gold: 'GOLD TROPHY!', silver: 'SILVER TROPHY!', bronze: 'BRONZE TROPHY!', none: 'CUP COMPLETE' }[trophy];
    document.getElementById('trophy-icon').textContent = icon;
    document.getElementById('trophy-text').textContent = text;
    document.getElementById('trophy-cup').textContent = cupName;
    show('screen-trophy');
    AudioSys.SFX.finish();
  }

  // ---------- Stats ----------
  function renderStats() {
    const p = SaveSystem.get();
    const body = document.getElementById('stats-body');
    body.innerHTML = '';
    const sec1 = document.createElement('div'); sec1.className = 'stats-section';
    sec1.innerHTML = `<h3>CAREER STATS</h3>` + Object.entries(p.stats).map(([k, v]) =>
      `<div class="stats-line"><span>${k.replace(/([A-Z])/g, ' $1')}</span><b>${v}</b></div>`).join('');
    body.appendChild(sec1);

    const sec2 = document.createElement('div'); sec2.className = 'stats-section';
    sec2.innerHTML = `<h3>UNLOCKS</h3>
      <div class="stats-line"><span>Racers unlocked</span><b>${p.unlockedCharacters.length}/${ROSTER.characters.length}</b></div>
      <div class="stats-line"><span>Karts unlocked</span><b>${p.unlockedKarts.length}/${ROSTER.karts.length}</b></div>`;
    body.appendChild(sec2);

    const sec3 = document.createElement('div'); sec3.className = 'stats-section';
    const achList = achievementDefs();
    sec3.innerHTML = `<h3>ACHIEVEMENTS</h3><div class="ach-grid">` + achList.map(a =>
      `<div class="ach-card ${p.achievements[a.id] ? 'unlocked' : ''}">${a.icon} ${a.name}</div>`).join('') + `</div>`;
    body.appendChild(sec3);
    show('screen-stats');
  }

  function achievementDefs() {
    return [
      { id: 'first_win', icon: '🏆', name: 'First Win' },
      { id: 'ten_races', icon: '🏁', name: '10 Races Played' },
      { id: 'mini_turbo_master', icon: '💨', name: '50 Mini-Turbos' },
      { id: 'gold_bolt', icon: '🥇', name: 'Bolt Cup Gold' },
      { id: 'battle_win', icon: '🎈', name: 'Battle Champion' },
      { id: 'all_unlocked', icon: '⭐', name: 'Full Roster' },
    ];
  }

  // ---------- Settings ----------
  function renderSettings() {
    const s = SaveSystem.get().settings;
    const list = document.getElementById('settings-list');
    list.innerHTML = '';
    list.appendChild(toggleRow('Music', s.musicVolume > 0, v => { SaveSystem.updateSettings({ musicVolume: v ? 0.6 : 0 }); AudioSys.applyVolumes(); }));
    list.appendChild(toggleRow('Sound Effects', s.sfxVolume > 0, v => { SaveSystem.updateSettings({ sfxVolume: v ? 0.8 : 0 }); AudioSys.applyVolumes(); }));
    list.appendChild(toggleRow('Show Minimap', s.showMinimap, v => SaveSystem.updateSettings({ showMinimap: v })));
    list.appendChild(gyroRow(s));
    show('screen-settings');
  }
  function toggleRow(label, initial, onChange) {
    const row = document.createElement('div'); row.className = 'setting-row';
    const lab = document.createElement('label'); lab.textContent = label;
    const tog = document.createElement('div'); tog.className = 'toggle' + (initial ? ' on' : '');
    tog.onclick = () => { const on = !tog.classList.contains('on'); tog.classList.toggle('on', on); onChange(on); AudioSys.SFX.uiClick(); };
    row.appendChild(lab); row.appendChild(tog);
    return row;
  }
  function gyroRow(s) {
    const row = document.createElement('div'); row.className = 'setting-row';
    const lab = document.createElement('label'); lab.textContent = 'Gyroscope Steering';
    const tog = document.createElement('div'); tog.className = 'toggle' + (s.gyro ? ' on' : '');
    tog.onclick = async () => {
      const wantOn = !tog.classList.contains('on');
      if (wantOn) {
        const granted = await InputSys.requestGyroPermission();
        if (!granted) { AudioSys.SFX.hit(); return; }
      }
      InputSys.setGyroEnabled(wantOn);
      SaveSystem.updateSettings({ gyro: wantOn });
      tog.classList.toggle('on', wantOn);
      AudioSys.SFX.uiClick();
    };
    row.appendChild(lab); row.appendChild(tog);
    return row;
  }

  // ---------- Wiring ----------
  function init() {
    cacheScreens();
    document.getElementById('screen-title').addEventListener('click', () => {
      AudioSys.resume();
      AudioSys.startMusic();
      AudioSys.SFX.uiConfirm();
      document.getElementById('profile-badge').textContent = 'PROFILE: ' + SaveSystem.get().name;
      show('screen-main');
    });

    document.body.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      AudioSys.SFX.uiClick();
      const action = btn.dataset.action;
      handleAction(action, btn);
    });
    document.body.addEventListener('touchstart', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
    }, { passive: true });

    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => show(b.dataset.back, false)));
    document.querySelectorAll('[data-back-dynamic]').forEach(b => b.addEventListener('click', () => goBack()));

    document.querySelectorAll('.cc-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.cc-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      selection.cc = b.dataset.cc;
      AudioSys.SFX.uiClick();
    }));

    document.querySelectorAll('#screen-mode .menu-btn').forEach(b => b.addEventListener('click', () => {
      selection.mode = b.dataset.mode;
    }));
  }

  function handleAction(action, btn) {
    switch (action) {
      case 'mode-select': renderCCDefault(); show('screen-mode'); break;
      case 'time-trial-select': renderTTGrid(); show('screen-tt-select'); break;
      case 'battle-select': show('screen-battle-select'); break;
      case 'cup-select': selection.mode = btn.dataset.mode; renderCupGrid(); show('screen-cup'); break;
      case 'char-select':
        if (btn.dataset.mode === 'battle') selection.mode = 'battle';
        goToCharSelect();
        break;
      case 'kart-select': renderKartGrid(); show('screen-kart'); break;
      case 'start-race': GameApp.startRace(selection); break;
      case 'stats': renderStats(); break;
      case 'settings': renderSettings(); break;
      case 'resume': GameApp.resumeRace(); break;
      case 'restart-race': GameApp.restartRace(); break;
      case 'quit-race': GameApp.quitRace(); break;
      case 'results-continue': GameApp.onResultsContinue(); break;
      case 'to-main': show('screen-main'); break;
    }
  }
  function renderCCDefault() {}

  return {
    show, goBack, fmtTime, playLoading, init, selection,
    renderResults, renderTrophy, achievementDefs,
  };
})();
