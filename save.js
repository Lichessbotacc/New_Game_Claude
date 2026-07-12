/**
 * save.js — local persistence: profile, unlocks, stats, achievements, ghosts.
 */
const SaveSystem = (() => {
  const KEY = 'turbodash_profile_v1';

  function defaultProfile() {
    return {
      name: 'PLAYER 1',
      createdAt: Date.now(),
      unlockedCharacters: ['bolt', 'ember', 'zippy', 'crank'],
      unlockedKarts: ['dart', 'hauler', 'wasp'],
      cupResults: {},        // cupId -> { trophy: 'gold'|'silver'|'bronze', bestPts }
      stats: {
        racesPlayed: 0,
        wins: 0,
        podiums: 0,
        totalCoins: 0,
        mintTurbosPulled: 0,
        distanceKm: 0,
        itemsUsed: 0,
        battlesWon: 0,
      },
      achievements: {},      // id -> true
      ghosts: {},            // trackId -> {timeMs, frames:[...]}
      settings: {
        musicVolume: 0.6,
        sfxVolume: 0.8,
        gyro: false,
        controlScheme: 'joystick', // joystick | tilt
        showMinimap: true,
      },
    };
  }

  let profile = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultProfile();
      const parsed = JSON.parse(raw);
      // merge with defaults to survive schema growth
      return Object.assign(defaultProfile(), parsed, {
        stats: Object.assign(defaultProfile().stats, parsed.stats || {}),
        settings: Object.assign(defaultProfile().settings, parsed.settings || {}),
      });
    } catch (e) {
      console.warn('Save load failed, using default profile', e);
      return defaultProfile();
    }
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(profile)); }
    catch (e) { console.warn('Save persist failed', e); }
  }

  function get() { return profile; }

  function unlockCharacter(id) {
    if (!profile.unlockedCharacters.includes(id)) { profile.unlockedCharacters.push(id); persist(); return true; }
    return false;
  }
  function unlockKart(id) {
    if (!profile.unlockedKarts.includes(id)) { profile.unlockedKarts.push(id); persist(); return true; }
    return false;
  }
  function isCharUnlocked(id) { return profile.unlockedCharacters.includes(id); }
  function isKartUnlocked(id) { return profile.unlockedKarts.includes(id); }

  function recordCupResult(cupId, trophy, pts) {
    const cur = profile.cupResults[cupId];
    const rank = { gold: 3, silver: 2, bronze: 1, none: 0 };
    if (!cur || rank[trophy] > rank[cur.trophy]) {
      profile.cupResults[cupId] = { trophy, bestPts: pts };
    }
    persist();
  }

  function bumpStat(key, amount = 1) {
    profile.stats[key] = (profile.stats[key] || 0) + amount;
    persist();
  }

  function unlockAchievement(id) {
    if (!profile.achievements[id]) { profile.achievements[id] = true; persist(); return true; }
    return false;
  }

  function saveGhost(trackId, timeMs, frames) {
    const cur = profile.ghosts[trackId];
    if (!cur || timeMs < cur.timeMs) {
      profile.ghosts[trackId] = { timeMs, frames };
      persist();
      return true;
    }
    return false;
  }
  function getGhost(trackId) { return profile.ghosts[trackId] || null; }

  function updateSettings(patch) { Object.assign(profile.settings, patch); persist(); }

  function resetProfile() { profile = defaultProfile(); persist(); }

  return {
    get, persist, unlockCharacter, unlockKart, isCharUnlocked, isKartUnlocked,
    recordCupResult, bumpStat, unlockAchievement, saveGhost, getGhost,
    updateSettings, resetProfile,
  };
})();
