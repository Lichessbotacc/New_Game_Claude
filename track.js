/**
 * track.js — procedural track definitions.
 * Each track is a closed Catmull-Rom spline (control points in XZ plane, with Y for elevation)
 * plus metadata: width, boost pads, item box slots, ramps, moving hazards and checkpoints.
 * Geometry is built generically in rendering.js from this data — new tracks = new data only.
 */
const TRACKS = {
  sunset_speedway: {
    id: 'sunset_speedway', name: 'Sunset Speedway', laps: 3,
    skyTop: '#ff8a5c', skyBottom: '#2a1a4a', groundColor: '#3a7d44', roadColor: '#3c3c46',
    points: [
      [0, 0, 0], [40, 0, -20], [80, 0, -10], [100, 0, 20], [90, 2, 60], [50, 4, 80],
      [0, 4, 85], [-50, 2, 70], [-90, 0, 40], [-100, 0, 0], [-80, 0, -30], [-40, 0, -30],
    ],
    width: 16,
    boostPads: [2, 8],
    ramps: [4],
    itemBoxSlots: [1, 3, 5, 7, 9, 11],
    hazards: [{ type: 'rotor', segment: 6, radius: 10 }],
    startSegment: 0,
  },
  frost_pass: {
    id: 'frost_pass', name: 'Frost Pass', laps: 3,
    skyTop: '#bfe3ff', skyBottom: '#e8f6ff', groundColor: '#dfeeff', roadColor: '#556075',
    points: [
      [0, 0, 0], [30, 2, -40], [20, 6, -80], [-20, 8, -95], [-60, 6, -70], [-70, 3, -30],
      [-50, 0, 10], [-10, 0, 30], [30, 0, 20], [55, 0, -10],
    ],
    width: 14,
    boostPads: [0, 5],
    ramps: [2, 7],
    itemBoxSlots: [1, 3, 4, 6, 8, 9],
    hazards: [{ type: 'swinger', segment: 3, radius: 12 }],
    startSegment: 0,
  },
  cinder_canyon: {
    id: 'cinder_canyon', name: 'Cinder Canyon', laps: 3,
    skyTop: '#ff5e3a', skyBottom: '#210a08', groundColor: '#4a2418', roadColor: '#2b2320',
    points: [
      [0, 0, 0], [50, 0, 0], [80, 0, 30], [80, 0, 70], [50, 4, 100], [0, 4, 100],
      [-30, 8, 80], [-30, 8, 40], [0, 4, 15], [-40, 0, -10], [-70, 0, -10], [-90, 0, 20],
    ],
    width: 15,
    boostPads: [1, 6, 10],
    ramps: [3, 8],
    itemBoxSlots: [0, 2, 4, 5, 7, 9, 11],
    hazards: [{ type: 'rotor', segment: 9, radius: 9 }, { type: 'lavaPuddle', segment: 4 }],
    startSegment: 0,
  },
  coral_coast: {
    id: 'coral_coast', name: 'Coral Coast', laps: 3,
    skyTop: '#7fd8ff', skyBottom: '#c9f7ea', groundColor: '#2f9e6b', roadColor: '#4a4458',
    points: [
      [0, 0, 0], [35, 0, 15], [55, 0, 50], [40, 3, 85], [0, 3, 95], [-40, 3, 85],
      [-60, 0, 50], [-45, 0, 10], [-15, 0, -15],
    ],
    width: 17,
    boostPads: [1, 4],
    ramps: [3],
    itemBoxSlots: [0, 2, 5, 6, 8],
    hazards: [{ type: 'swinger', segment: 6, radius: 11 }],
    startSegment: 0,
  },
  sky_gardens: {
    id: 'sky_gardens', name: 'Sky Gardens', laps: 3,
    skyTop: '#9ecbff', skyBottom: '#f4faff', groundColor: '#6fbf6f', roadColor: '#5a4a6a',
    points: [
      [0, 0, 0], [45, 4, -15], [75, 10, 10], [70, 14, 50], [35, 16, 70], [0, 12, 60],
      [-25, 8, 30], [-20, 4, -10],
    ],
    width: 14,
    boostPads: [0, 3],
    ramps: [1, 5],
    itemBoxSlots: [1, 2, 4, 6, 7],
    hazards: [{ type: 'rotor', segment: 2, radius: 8 }],
    startSegment: 0,
  },
  dune_drift: {
    id: 'dune_drift', name: 'Dune Drift', laps: 3,
    skyTop: '#ffd9a0', skyBottom: '#ffe9c7', groundColor: '#d9b56a', roadColor: '#8a6a42',
    points: [
      [0, 0, 0], [40, 0, 10], [70, 0, 40], [60, 0, 80], [20, 0, 95], [-25, 0, 80],
      [-55, 0, 45], [-50, 0, 5], [-20, 0, -15],
    ],
    width: 18,
    boostPads: [2, 5, 8],
    ramps: [4],
    itemBoxSlots: [0, 1, 3, 6, 7],
    hazards: [{ type: 'swinger', segment: 1, radius: 10 }],
    startSegment: 0,
  },
};

const CUPS = {
  bolt:  { id: 'bolt',  name: 'Bolt Cup',  icon: '⚡', tracks: ['sunset_speedway', 'frost_pass', 'cinder_canyon'] },
  shell: { id: 'shell', name: 'Shell Cup', icon: '🐚', tracks: ['coral_coast', 'sky_gardens', 'dune_drift'], unlock: { type: 'cup', id: 'bolt' } },
  flame: { id: 'flame', name: 'Flame Cup', icon: '🔥', tracks: ['cinder_canyon', 'sunset_speedway', 'dune_drift'], unlock: { type: 'cup', id: 'shell' } },
  wave:  { id: 'wave',  name: 'Wave Cup',  icon: '🌊', tracks: ['coral_coast', 'sky_gardens', 'frost_pass'], unlock: { type: 'cup', id: 'flame' } },
};

/** Catmull-Rom spline helpers over closed loop of 3D control points. */
class TrackSpline {
  constructor(trackDef) {
    this.def = trackDef;
    this.pts = trackDef.points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(this.pts, true, 'catmullrom', 0.5);
    this.samples = 800;
    this._lengths = this.curve.getLengths(this.samples);
    this.totalLength = this._lengths[this._lengths.length - 1];
  }
  // u in [0,1) around the loop -> world position
  pointAt(u) { return this.curve.getPointAt(((u % 1) + 1) % 1); }
  tangentAt(u) { return this.curve.getTangentAt(((u % 1) + 1) % 1); }
  // Given a world XZ position, approximate nearest u via coarse search (fine for small tracks)
  nearestU(pos, hintU = null) {
    let best = 0, bestD = Infinity;
    if (hintU !== null) hintU = ((hintU % 1) + 1) % 1;
    const range = hintU === null ? 200 : 40;
    const center = hintU === null ? 0 : hintU * this.samples;
    for (let i = 0; i < this.samples; i++) {
      if (hintU !== null) {
        let d = Math.abs(i - center);
        if (d > this.samples / 2) d = this.samples - d;
        if (d > range) continue;
      }
      const u = i / this.samples;
      const p = this.pointAt(u);
      const dx = p.x - pos.x, dz = p.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = u; }
    }
    return best;
  }
  widthAt(u) { return this.def.width; }
}

function segmentToU(trackDef, segIndex) {
  return segIndex / trackDef.points.length;
}
