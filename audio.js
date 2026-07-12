/**
 * audio.js — fully synthesized audio (no external files needed).
 * Engine drone, SFX blips, and a procedural background arpeggio "soundtrack",
 * all generated with WebAudio oscillators/noise so there is zero copyright risk.
 */
const AudioSys = (() => {
  let ctx = null;
  let masterGain, musicGain, sfxGain;
  let engineOsc = null, engineGain = null, engineFilter = null;
  let musicTimer = null;
  let unlocked = false;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain(); masterGain.gain.value = 1; masterGain.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.connect(masterGain);
    sfxGain = ctx.createGain(); sfxGain.connect(masterGain);
    applyVolumes();
  }

  function applyVolumes() {
    const s = SaveSystem.get().settings;
    if (musicGain) musicGain.gain.value = s.musicVolume;
    if (sfxGain) sfxGain.gain.value = s.sfxVolume;
  }

  function resume() {
    init();
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
  }

  // ---------- SFX ----------
  function blip({ freq = 440, dur = 0.12, type = 'square', vol = 0.3, slideTo = null, delay = 0 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst({ dur = 0.25, vol = 0.4, filterFreq = 2000, delay = 0 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const bufferSize = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = filterFreq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter); filter.connect(g); g.connect(sfxGain);
    src.start(t0);
  }

  const SFX = {
    countBeep: () => blip({ freq: 520, dur: 0.15, type: 'square', vol: 0.35 }),
    countGo: () => blip({ freq: 880, dur: 0.35, type: 'sawtooth', vol: 0.4, slideTo: 1400 }),
    boost: () => { blip({ freq: 220, dur: 0.3, type: 'sawtooth', vol: 0.35, slideTo: 900 }); noiseBurst({ dur: 0.2, vol: 0.15 }); },
    miniTurboBlue: () => blip({ freq: 500, dur: 0.18, type: 'square', vol: 0.3, slideTo: 1000 }),
    miniTurboOrange: () => blip({ freq: 650, dur: 0.22, type: 'square', vol: 0.35, slideTo: 1300 }),
    itemGet: () => { blip({ freq: 300, dur: 0.08, vol: .25 }); blip({ freq: 500, dur: 0.08, vol: .25, delay: .08 }); blip({ freq: 750, dur: 0.12, vol: .3, delay: .16 }); },
    itemUse: () => blip({ freq: 400, dur: 0.15, type: 'triangle', vol: 0.3, slideTo: 200 }),
    hit: () => { noiseBurst({ dur: 0.3, vol: 0.45, filterFreq: 900 }); blip({ freq: 140, dur: 0.2, type: 'sawtooth', vol: .3 }); },
    jump: () => blip({ freq: 300, dur: 0.15, type: 'sine', vol: 0.25, slideTo: 500 }),
    land: () => noiseBurst({ dur: 0.12, vol: 0.3, filterFreq: 500 }),
    lapChime: () => { blip({ freq: 660, dur: 0.15, vol: .3 }); blip({ freq: 880, dur: 0.2, vol: .3, delay: .12 }); },
    finish: () => { [660, 880, 990, 1320].forEach((f, i) => blip({ freq: f, dur: 0.25, vol: .3, delay: i * .12 })); },
    uiClick: () => blip({ freq: 700, dur: 0.05, type: 'square', vol: 0.2 }),
    uiConfirm: () => blip({ freq: 500, dur: 0.1, type: 'square', vol: 0.25, slideTo: 900 }),
    balloonPop: () => { noiseBurst({ dur: .15, vol: .35, filterFreq: 1500 }); blip({freq: 900, dur: .1, vol: .2, slideTo: 300}); },
  };

  // ---------- Engine drone ----------
  function startEngine() {
    if (!ctx || engineOsc) return;
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 600;
    engineGain = ctx.createGain(); engineGain.gain.value = 0.0;
    engineOsc.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(sfxGain);
    engineOsc.frequency.value = 60;
    engineOsc.start();
  }
  function updateEngine(throttle01, speed01) {
    if (!engineOsc) return;
    const freq = 55 + speed01 * 260 + throttle01 * 40;
    engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
    engineFilter.frequency.setTargetAtTime(300 + speed01 * 1400, ctx.currentTime, 0.08);
    engineGain.gain.setTargetAtTime(0.05 + throttle01 * 0.08, ctx.currentTime, 0.1);
  }
  function stopEngine() {
    if (engineOsc) { try { engineOsc.stop(); } catch (e) {} engineOsc = null; }
  }

  // ---------- Procedural music ----------
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16]; // major-pentatonic-ish, upbeat
  function noteFreq(base, semitone) { return base * Math.pow(2, semitone / 12); }

  function startMusic() {
    if (!ctx || musicTimer) return;
    let step = 0;
    const bpm = 140;
    const stepDur = 60 / bpm / 2;
    const bass = 110;
    musicTimer = setInterval(() => {
      const t = ctx.currentTime;
      const beatInBar = step % 8;
      // bass pulse
      if (beatInBar % 2 === 0) {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = bass * (beatInBar === 0 ? 1 : 0.75);
        g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 1.8);
        o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + stepDur * 2);
      }
      // arpeggio lead
      const degree = SCALE[(step * 3 + Math.floor(step / 5)) % SCALE.length];
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
      o2.type = 'square'; o2.frequency.value = noteFreq(bass * 4, degree);
      g2.gain.setValueAtTime(0.05, t); g2.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.9);
      o2.connect(g2); g2.connect(musicGain); o2.start(t); o2.stop(t + stepDur);
      // hi-hat tick
      noiseTick(t, 0.03);
      step++;
    }, stepDur * 1000);
  }
  function noiseTick(t0, vol) {
    const bufferSize = ctx.sampleRate * 0.03;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 6000;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.03);
    src.connect(filter); filter.connect(g); g.connect(musicGain);
    src.start(t0);
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

  return { init, resume, applyVolumes, SFX, startEngine, updateEngine, stopEngine, startMusic, stopMusic };
})();
