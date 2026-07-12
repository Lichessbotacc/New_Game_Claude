/**
 * physics.js — arcade kart physics model.
 * Speed is scalar along a heading vector; steering rotates heading; drifting biases heading vs
 * velocity to build mini-turbo charge; off-track reduces max speed; ramps launch the kart into
 * an airborne trick state that grants a boost on a good landing.
 */
const GRAVITY = -38;
const DRIFT_CHARGE_BLUE = 0.9;   // seconds held to reach blue mini-turbo
const DRIFT_CHARGE_ORANGE = 1.8; // seconds to reach orange (bigger) mini-turbo
const MAX_STEER_RATE = 3.2;

class Kart {
  constructor({ trackSpline, perf, startU, lane = 0, isPlayer = false }) {
    this.trackSpline = trackSpline;
    this.perf = perf; // {topSpeed, accel, weight, handling, driftFactor}
    this.isPlayer = isPlayer;

    const p = trackSpline.pointAt(startU);
    const tangent = trackSpline.tangentAt(startU);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    this.position = p.clone().add(normal.clone().multiplyScalar(lane)).add(new THREE.Vector3(0, 1, 0));
    this.heading = Math.atan2(tangent.x, tangent.z);
    this.velocity = new THREE.Vector3();
    this.speed = 0;              // scalar forward speed
    this.verticalVel = 0;
    this.grounded = true;

    this.steerInput = 0;         // -1..1
    this.throttleInput = 0;      // 0..1
    this.brakeInput = 0;         // 0..1

    this.isDrifting = false;
    this.driftDir = 0;           // -1 left, 1 right
    this.driftTime = 0;
    this.driftTier = 0;          // 0 none,1 blue,2 orange
    this.boostTimer = 0;         // seconds remaining of active boost
    this.boostStrength = 0;

    this.trickState = 'none';    // none|air|trick
    this.airTime = 0;

    this.lapProgressU = startU;  // continuous track parameter (for progress/rank)
    this.lap = 0;
    this.lastCheckpointIdx = -1;
    this.finished = false;
    this.finishTime = 0;

    this.offroad = false;
    this.item = null;            // held item id
    this.itemUseTimer = 0;
    this.spinoutTimer = 0;       // when hit, disables control
    this.shieldTimer = 0;        // defensive item active
    this.invisTimer = 0;

    this.radius = 1.1;
    this.wobble = 0; // visual only
  }

  get effectiveTopSpeed() {
    let mult = this.offroad ? 0.55 : 1.0;
    if (this.boostTimer > 0) mult *= 1.55;
    return this.perf.topSpeed * mult;
  }

  startDrift(dir) {
    if (!this.grounded || this.spinoutTimer > 0) return;
    if (Math.abs(this.speed) < 8) return;
    this.isDrifting = true;
    this.driftDir = dir;
    this.driftTime = 0;
    this.driftTier = 0;
  }

  releaseDrift() {
    if (!this.isDrifting) return;
    if (this.driftTier === 1) { this.applyBoost(0.5, 1.05); AudioSys.SFX.miniTurboBlue(); }
    else if (this.driftTier >= 2) { this.applyBoost(1.0, 1.12); AudioSys.SFX.miniTurboOrange(); }
    this.isDrifting = false;
    this.driftTier = 0;
    this.driftTime = 0;
  }

  applyBoost(duration, strength) {
    this.boostTimer = Math.max(this.boostTimer, duration);
    this.boostStrength = strength;
  }

  applySpinout(duration = 1.1) {
    this.spinoutTimer = duration;
    this.speed *= 0.3;
    this.isDrifting = false;
    AudioSys.SFX.hit();
  }

  update(dt, world) {
    if (this.spinoutTimer > 0) {
      this.spinoutTimer -= dt;
      this.steerInput = 0; this.throttleInput = 0;
    }
    if (this.shieldTimer > 0) this.shieldTimer -= dt;
    if (this.invisTimer > 0) this.invisTimer -= dt;
    if (this.itemUseTimer > 0) this.itemUseTimer -= dt;

    // --- Steering & drift ---
    const steerAmt = this.steerInput * MAX_STEER_RATE * (this.perf.handling / 3) * dt;
    if (this.isDrifting) {
      this.driftTime += dt;
      if (this.driftTime > DRIFT_CHARGE_ORANGE) this.driftTier = 2;
      else if (this.driftTime > DRIFT_CHARGE_BLUE) this.driftTier = 1;
      // drift carves a wider arc biased toward driftDir
      this.heading += this.driftDir * (0.55 + Math.abs(this.steerInput) * 0.35) * dt * 2.1;
      this.heading += steerAmt * 0.25;
    } else {
      this.heading += steerAmt * (this.speed > 1 ? 1 : 0.4);
    }

    // --- Throttle / brake / accel curve ---
    const top = this.effectiveTopSpeed;
    if (this.spinoutTimer <= 0) {
      if (this.throttleInput > 0) {
        const accelCurve = 1 - Math.min(1, this.speed / top);
        this.speed += this.perf.accel * accelCurve * this.throttleInput * dt;
      } else if (this.brakeInput > 0) {
        if (this.speed > 0) this.speed -= this.perf.accel * 1.6 * dt;
        else this.speed -= this.perf.accel * 0.6 * dt; // reverse
        this.speed = Math.max(this.speed, -top * 0.4);
      } else {
        this.speed -= 8 * dt; // natural drag
      }
    } else {
      this.speed -= 10 * dt;
    }
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      this.speed = Math.min(this.speed + this.perf.accel * 2.4 * dt, top);
    }
    this.speed = Math.max(-top * 0.4, Math.min(this.speed, top));

    // --- Move ---
    const dir = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.velocity.copy(dir).multiplyScalar(this.speed);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // --- Track sampling: elevation, off-road, ramps ---
    const u = this.trackSpline.nearestU(this.position, this.lapProgressU);
    const centerPt = this.trackSpline.pointAt(u);
    const tangent = this.trackSpline.tangentAt(u);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const rel = new THREE.Vector3(this.position.x - centerPt.x, 0, this.position.z - centerPt.z);
    const lateral = rel.dot(normal);
    const halfW = this.trackSpline.widthAt(u) / 2;
    this.offroad = Math.abs(lateral) > halfW;

    // ground height target from spline elevation (smooth terrain following)
    const groundY = centerPt.y + 1.0;
    const onRamp = world.isRampSegment ? world.isRampSegment(u) : false;

    if (this.grounded) {
      if (onRamp && this.speed > 20) {
        this.verticalVel = 14;
        this.grounded = false;
        this.trickState = 'air';
        this.airTime = 0;
        AudioSys.SFX.jump();
      } else {
        this.position.y = groundY;
        this.verticalVel = 0;
      }
    }
    if (!this.grounded) {
      this.verticalVel += GRAVITY * dt;
      this.position.y += this.verticalVel * dt;
      this.airTime += dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.grounded = true;
        if (this.trickState === 'trick') { this.applyBoost(0.4, 1.1); AudioSys.SFX.land(); }
        else AudioSys.SFX.land();
        this.trickState = 'none';
      }
    }

    // progress tracking (u handles lap wrap)
    let du = u - (this.lapProgressU % 1);
    if (du > 0.5) du -= 1;
    if (du < -0.5) du += 1;
    this.lapProgressU += du;
    this.uNow = u;

    // boost pad check
    if (world.isBoostSegment && world.isBoostSegment(u)) this.applyBoost(0.35, 1.3);
  }

  doTrick() {
    if (!this.grounded && this.trickState === 'air') { this.trickState = 'trick'; }
  }

  get forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }
}

/** Simple circular collision resolution + knockback based on relative weight. */
function resolveKartCollisions(karts) {
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
      const dist = Math.hypot(dx, dz);
      const minDist = a.radius + b.radius;
      if (dist > 0 && dist < minDist) {
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist, nz = dz / dist;
        const wa = a.perf.weight, wb = b.perf.weight;
        const totalW = wa + wb;
        a.position.x -= nx * overlap * (wb / totalW) * 1.6;
        a.position.z -= nz * overlap * (wb / totalW) * 1.6;
        b.position.x += nx * overlap * (wa / totalW) * 1.6;
        b.position.z += nz * overlap * (wa / totalW) * 1.6;
        // speed bump
        const rel = Math.abs(a.speed - b.speed);
        a.speed -= rel * 0.05 * (wb / totalW);
        b.speed -= rel * 0.05 * (wa / totalW);
      }
    }
  }
}
