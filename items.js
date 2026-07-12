/**
 * items.js — original item system inspired by classic kart-racer item boxes.
 * All item names/effects are original creations.
 */
const ITEM_DEFS = {
  zapper:      { id: 'zapper', name: 'Zapper Shell', icon: '🌀', desc: 'Fires forward, homes toward the racer ahead.' },
  triZapper:   { id: 'triZapper', name: 'Triple Zapper', icon: '🌀🌀🌀', desc: 'Three shells that orbit and can be fired.' },
  nitro:       { id: 'nitro', name: 'Nitro Canister', icon: '🧪', desc: 'Instant speed boost.' },
  tripleNitro: { id: 'tripleNitro', name: 'Nitro Trio', icon: '🧪🧪🧪', desc: 'Three stacked speed boosts.' },
  shieldOrb:   { id: 'shieldOrb', name: 'Shield Orb', icon: '🛡️', desc: 'Blocks one hit and can swat nearby foes.' },
  oilSlick:    { id: 'oilSlick', name: 'Oil Slick', icon: '🛢️', desc: 'Drop behind you to spin out chasers.' },
  tripleOil:   { id: 'tripleOil', name: 'Oil Trio', icon: '🛢️🛢️🛢️', desc: 'Three oil slicks trailed behind.' },
  megaHorn:    { id: 'megaHorn', name: 'Mega Horn', icon: '📯', desc: 'Shockwave that spins out everyone nearby.' },
  overdrive:   { id: 'overdrive', name: 'Overdrive Star', icon: '⭐', desc: 'Temporary invincibility + max speed.' },
  magnetBolt:  { id: 'magnetBolt', name: 'Magnet Bolt', icon: '🧲', desc: 'Pulls you toward the race leader.' },
  swarmDrone:  { id: 'swarmDrone', name: 'Swarm Drone', icon: '🛸', desc: 'Hunts down the racer in 1st place.' },
};

// Rank-based probability tables (rank 1 = leader gets weak items, last place gets strong ones)
// This is the classic "catch-up" item distribution philosophy, reimplemented originally.
function rollItem(rankFrac /* 0=leader..1=last */, numRacers) {
  const table = [];
  const push = (id, w) => table.push({ id, w });

  if (rankFrac < 0.15) {
    push('zapper', 30); push('shieldOrb', 25); push('oilSlick', 20); push('nitro', 15); push('magnetBolt', 10);
  } else if (rankFrac < 0.4) {
    push('zapper', 25); push('nitro', 22); push('shieldOrb', 18); push('oilSlick', 15); push('triZapper', 10); push('tripleOil', 10);
  } else if (rankFrac < 0.7) {
    push('nitro', 22); push('triZapper', 18); push('tripleNitro', 15); push('tripleOil', 12);
    push('shieldOrb', 10); push('megaHorn', 10); push('swarmDrone', 8); push('zapper', 5);
  } else {
    push('overdrive', 18); push('megaHorn', 18); push('tripleNitro', 20); push('swarmDrone', 14);
    push('triZapper', 12); push('magnetBolt', 10); push('tripleOil', 8);
  }
  const total = table.reduce((s, e) => s + e.w, 0);
  let r = Math.random() * total;
  for (const e of table) { if ((r -= e.w) <= 0) return e.id; }
  return table[0].id;
}

/** World projectile/hazard entity spawned by item usage. */
class ItemEntity {
  constructor(type, owner, opts = {}) {
    this.type = type; // 'zapper' | 'oilSlick' | 'swarmDrone'
    this.owner = owner;
    this.position = owner.position.clone();
    this.heading = owner.heading;
    this.speed = opts.speed || 55;
    this.life = opts.life || 8;
    this.dead = false;
    this.homing = !!opts.homing;
    this.target = opts.target || null;
    this.radius = opts.radius || 1.2;
    this.trailBehind = !!opts.trailBehind;
    if (this.trailBehind) {
      const back = owner.forward.clone().multiplyScalar(-3);
      this.position.add(back);
      this.speed = 0;
    }
  }
  update(dt, karts) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    if (this.homing && this.target && !this.target.finished) {
      const dx = this.target.position.x - this.position.x, dz = this.target.position.z - this.position.z;
      const desired = Math.atan2(dx, dz);
      let diff = desired - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, diff * 3 * dt));
    }
    if (this.speed !== 0) {
      this.position.x += Math.sin(this.heading) * this.speed * dt;
      this.position.z += Math.cos(this.heading) * this.speed * dt;
    }
    for (const k of karts) {
      if (k === this.owner && this.life > (this.trailBehind ? 999 : 7.6)) continue;
      const dx = k.position.x - this.position.x, dz = k.position.z - this.position.z;
      if (Math.hypot(dx, dz) < this.radius + k.radius) {
        this.onHit(k);
        if (!this.trailBehind) this.dead = true;
      }
    }
  }
  onHit(kart) {
    if (kart.shieldTimer > 0) { kart.shieldTimer = 0; AudioSys.SFX.hit(); return; }
    if (kart.invisTimer > 0) return; // overdrive ignores
    kart.applySpinout(this.type === 'megaHornWave' ? 0.6 : 1.1);
  }
}

/** Apply an item's primary effect to the user (self-use items). */
function useItemSelf(kart, itemId, world) {
  switch (itemId) {
    case 'nitro': case 'tripleNitro':
      kart.applyBoost(0.7, 1.4);
      AudioSys.SFX.boost();
      SaveSystem.bumpStat('itemsUsed');
      return true;
    case 'overdrive':
      kart.invisTimer = 7;
      kart.applyBoost(7, 1.35);
      AudioSys.SFX.boost();
      SaveSystem.bumpStat('itemsUsed');
      return true;
    case 'shieldOrb':
      kart.shieldTimer = 8;
      AudioSys.SFX.itemUse();
      SaveSystem.bumpStat('itemsUsed');
      return true;
    case 'magnetBolt': {
      // pull toward leader: give a burst of speed and slight steering assist handled in game.js
      kart.applyBoost(1.2, 1.2);
      AudioSys.SFX.itemUse();
      SaveSystem.bumpStat('itemsUsed');
      return true;
    }
    case 'megaHorn': {
      world.spawnShockwave(kart);
      AudioSys.SFX.itemUse();
      SaveSystem.bumpStat('itemsUsed');
      return true;
    }
    default:
      return false;
  }
}
