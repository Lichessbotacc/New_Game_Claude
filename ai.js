/**
 * ai.js — CPU driver behavior. Follows the track spline as a waypoint path with
 * per-personality noise, item usage heuristics, and rubber-band skill scaling.
 */
const PERSONALITIES = {
  aggressive: { lineNoise: 0.35, itemChance: 0.9, driftBias: 1.2, brakeCaution: 0.4, name: 'Aggressive' },
  balanced:   { lineNoise: 0.2,  itemChance: 0.7, driftBias: 1.0, brakeCaution: 0.7, name: 'Balanced' },
  defensive:  { lineNoise: 0.15, itemChance: 0.5, driftBias: 0.8, brakeCaution: 1.0, name: 'Defensive' },
  erratic:    { lineNoise: 0.55, itemChance: 0.8, driftBias: 1.4, brakeCaution: 0.3, name: 'Erratic' },
};

class AIDriver {
  constructor(kart, personalityKey, skill = 0.75) {
    this.kart = kart;
    this.personality = PERSONALITIES[personalityKey] || PERSONALITIES.balanced;
    this.skill = skill; // 0..1, scales reaction/line accuracy
    this.laneOffset = (Math.random() * 2 - 1) * 4;
    this.laneTarget = this.laneOffset;
    this.laneChangeTimer = Math.random() * 3;
    this.itemCooldown = Math.random() * 2;
  }

  update(dt, race) {
    const kart = this.kart;
    const spline = race.trackSpline;
    const lookAhead = 0.03 + this.skill * 0.015;
    const u = (kart.uNow !== undefined ? kart.uNow : 0);

    this.laneChangeTimer -= dt;
    if (this.laneChangeTimer <= 0) {
      this.laneTarget = (Math.random() * 2 - 1) * (spline.def.width / 2 - 3) * this.personality.lineNoise * 2;
      this.laneChangeTimer = 2 + Math.random() * 3;
    }

    const targetU = u + lookAhead;
    const targetPt = spline.pointAt(targetU);
    const tangent = spline.tangentAt(targetU);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const aimPoint = targetPt.clone().add(normal.multiplyScalar(this.laneOffset));

    this.laneOffset += (this.laneTarget - this.laneOffset) * dt * 0.6;

    const dx = aimPoint.x - kart.position.x, dz = aimPoint.z - kart.position.z;
    const desiredHeading = Math.atan2(dx, dz);
    let diff = desiredHeading - kart.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // rubber-band: trailing AIs get a mild perf boost, leaders a mild penalty
    const rb = race.getRubberBandFactor ? race.getRubberBandFactor(kart) : 1.0;

    kart.steerInput = Math.max(-1, Math.min(1, diff * 2.2));
    kart.throttleInput = 1.0 * (0.7 + this.skill * 0.3) * rb;
    kart.brakeInput = 0;

    // simple corner braking: if turn is sharp, ease off
    if (Math.abs(diff) > 0.5 && kart.speed > kart.perf.topSpeed * 0.5) {
      kart.throttleInput *= 1 - this.personality.brakeCaution * 0.4;
    }

    // drift into sharp turns
    if (Math.abs(diff) > 0.35 && kart.grounded && !kart.isDrifting && kart.speed > 15) {
      kart.startDrift(diff > 0 ? 1 : -1);
    } else if (kart.isDrifting && Math.abs(diff) < 0.12) {
      kart.releaseDrift();
    }

    // items
    this.itemCooldown -= dt;
    if (kart.item && this.itemCooldown <= 0) {
      if (Math.random() < this.personality.itemChance * dt * 0.5 + dt * 0.05) {
        race.useItem(kart);
        this.itemCooldown = 1 + Math.random() * 2;
      }
    }
  }
}

function pickPersonality(index) {
  const keys = Object.keys(PERSONALITIES);
  return keys[index % keys.length];
}
