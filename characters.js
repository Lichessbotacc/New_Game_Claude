/**
 * characters.js — original racer roster & kart roster with MK-Wii-like stat spread
 * (speed / accel / weight / handling / drift / miniTurbo).
 * All names, characters and vehicles are original creations for this game.
 */
const ROSTER = {
  characters: [
    { id: 'bolt',   name: 'Bolt',        cls: 'Light',  emoji: '🐿️', color: '#ffd24a',
      stats: { speed: .45, accel: .85, weight: .3, handling: .8, drift: .8 } },
    { id: 'ember',  name: 'Ember',       cls: 'Light',  emoji: '🦊', color: '#ff5e3a',
      stats: { speed: .5,  accel: .8,  weight: .35, handling: .78, drift: .82 } },
    { id: 'zippy',  name: 'Zippy',       cls: 'Light',  emoji: '🐇', color: '#21e6c1',
      stats: { speed: .4,  accel: .9,  weight: .25, handling: .85, drift: .78 } },
    { id: 'crank',  name: 'Crank',       cls: 'Medium', emoji: '🦝', color: '#7a5cff',
      stats: { speed: .6,  accel: .65, weight: .55, handling: .65, drift: .6 } },
    { id: 'nova',   name: 'Nova',        cls: 'Medium', emoji: '🐱', color: '#ff9de2',
      stats: { speed: .62, accel: .62, weight: .5,  handling: .68, drift: .62 } },
    { id: 'ridge',  name: 'Ridge',       cls: 'Medium', emoji: '🐗', color: '#5da8ff',
      stats: { speed: .58, accel: .68, weight: .58, handling: .6,  drift: .58 } },
    { id: 'tundra', name: 'Tundra',      cls: 'Heavy',  emoji: '🐻', color: '#c9c9c9',
      stats: { speed: .8,  accel: .4,  weight: .85, handling: .4,  drift: .4 } },
    { id: 'rumble', name: 'Rumble',      cls: 'Heavy',  emoji: '🦏', color: '#8a5a2a',
      stats: { speed: .85, accel: .35, weight: .95, handling: .35, drift: .35 }, unlock: { type: 'cup', id: 'flame' } },
    { id: 'shade',  name: 'Shade',       cls: 'Medium', emoji: '🦇', color: '#3a2a5c',
      stats: { speed: .65, accel: .6,  weight: .5,  handling: .7,  drift: .68 }, unlock: { type: 'cup', id: 'wave' } },
    { id: 'glint',  name: 'Glint',       cls: 'Light',  emoji: '🦎', color: '#4affb0',
      stats: { speed: .48, accel: .82, weight: .3, handling: .82, drift: .84 }, unlock: { type: 'coins', amount: 300 } },
  ],
  karts: [
    { id: 'dart',   name: 'Dart Racer',   emoji: '🏎️', stats: { speed: .5,  accel: .8, weight: .35, handling: .8,  drift: .8 } },
    { id: 'hauler', name: 'Hauler',       emoji: '🚙', stats: { speed: .7,  accel: .55, weight: .7,  handling: .55, drift: .5 } },
    { id: 'wasp',   name: 'Wasp Cycle',   emoji: '🏍️', stats: { speed: .55, accel: .75, weight: .4,  handling: .9,  drift: .9 } },
    { id: 'brute',  name: 'Brute Rig',    emoji: '🚚', stats: { speed: .85, accel: .3,  weight: .95, handling: .3,  drift: .3 }, unlock: { type: 'cup', id: 'bolt' } },
    { id: 'glider', name: 'Glider X',     emoji: '🛞', stats: { speed: .6,  accel: .65, weight: .5,  handling: .7,  drift: .7 }, unlock: { type: 'cup', id: 'shell' } },
  ],
};

function getCharacter(id) { return ROSTER.characters.find(c => c.id === id); }
function getKart(id) { return ROSTER.karts.find(k => k.id === id); }

/** Combine character + kart stats into final vehicle performance parameters. */
function combineStats(character, kart) {
  const s = character.stats, k = kart.stats;
  const avg = (a, b, w = 0.5) => a * w + b * (1 - w);
  return {
    topSpeed: 60 + avg(s.speed, k.speed) * 55,          // world units/s
    accel: 14 + avg(s.accel, k.accel) * 16,             // accel force
    weight: 0.6 + avg(s.weight, k.weight) * 1.0,         // affects collisions/knockback
    handling: 1.4 + avg(s.handling, k.handling) * 1.8,   // turn rate
    driftFactor: 0.5 + avg(s.drift, k.drift) * 0.9,      // mini-turbo charge rate
  };
}
