/**
 * network.js — networking foundation.
 * The current build ships as a fully offline/local game (Grand Prix, Time Trial, VS and
 * Battle are all played against local CPU racers), but the race loop already speaks in
 * terms of a generic "RaceParticipant" state stream, so a real transport can be dropped
 * in here later without touching physics/AI/rendering.
 *
 * NetworkSys.connect() currently resolves to a local no-op "session" that simply loops
 * state back to itself — this keeps the API shape stable for future WebSocket/WebRTC work.
 */
const NetworkSys = (() => {
  let mode = 'offline';
  let listeners = [];

  function connect(roomCode) {
    mode = 'offline';
    return Promise.resolve({ ok: true, mode, roomCode: roomCode || null, localPlayerId: 'local' });
  }

  function disconnect() { mode = 'offline'; listeners = []; }

  /** Serialize a kart's transferable state — used locally today, over-the-wire later. */
  function serializeKartState(kart) {
    return {
      x: +kart.position.x.toFixed(2), y: +kart.position.y.toFixed(2), z: +kart.position.z.toFixed(2),
      h: +kart.heading.toFixed(3), spd: +kart.speed.toFixed(2), lap: kart.lap, item: kart.item,
    };
  }

  function onStateReceived(cb) { listeners.push(cb); }
  function broadcastState(payload) { listeners.forEach(l => l(payload)); }

  function isOnline() { return mode === 'online'; }

  return { connect, disconnect, serializeKartState, onStateReceived, broadcastState, isOnline };
})();
