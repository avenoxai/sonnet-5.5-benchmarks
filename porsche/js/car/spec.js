'use strict';
// spec.js — authoritative dimensions & anchors for the Porsche 911 GT3 RS (992.1).
// (Numbers cross-checked in REFERENCE.md; corrected after research: RS wheels 10J/13J, track 1.630/1.582, roof peak ~1.28,
//  1.322 m is the WING TOP.)
// COORDINATES (metres): origin on the ground plane at mid-wheelbase, on the centreline.
//   +X = forward (nose),  +Y = up,  +Z = car's RIGHT side (passenger side; the car is LHD so driver sits at -Z).
//   The car is left/right symmetric about Z = 0. Ground plane is Y = 0.
// Everything is in METRES. Angles in radians unless the name ends in Deg.
(function () {
  const PG = window.PG = window.PG || {};
  const inch = 0.0254;

  const spec = PG.spec = {
    // ---- overall (production: L 4572, W 1900 excl. mirrors / 2027 incl., H 1322 = wing top, wheelbase 2457 mm)
    length: 4.572, width: 1.900, widthWithMirrors: 2.027, height: 1.322, wheelbase: 2.457,
    noseX: 2.255,          // most forward point of the front splitter/bumper
    tailX: -2.317,         // most rearward point of the tail / diffuser
    frontAxleX: 1.2285, rearAxleX: -1.2285,
    groundClearance: 0.100, // underside of the flat floor / sills above ground
    splitterY: 0.095,       // lowest edge of the front splitter lip
    roofMaxY: 1.280,        // highest point of the roof (the wing top, 1.322, is the highest point of the car)
    halfWidthMax: 0.950,    // body half-width at the rear haunch / front fender

    // ---- wheels & tyres.  Front 275/35 ZR20 on 10J ET45, rear 335/30 ZR21 on 13J ET31, forged centre-lock, Michelin PS Cup 2 R.
    wheel: {
      front: { x: 1.2285, tireRadius: 0.350, tireWidth: 0.277, rimDiameter: 20 * inch, rimWidth: 0.254, track: 1.630, sidewall: 0.0963, rimOuterZ: 0.942, hubFaceZ: 0.860 },
      rear: { x: -1.2285, tireRadius: 0.364, tireWidth: 0.320, rimDiameter: 21 * inch, rimWidth: 0.330, track: 1.582, sidewall: 0.1005, rimOuterZ: 0.956, hubFaceZ: 0.822 },
      // wheel centre height above ground = tire radius. rimOuterZ = |z| of the outer rim lip, hubFaceZ = |z| of the hub mounting face.
      // brakes: front disc 408x36 (PCCB 410), 6-piston caliper; rear disc 380x30 (PCCB 390), 4-piston. Calipers: yellow (PCCB).
    },

    // ---- body silhouette (centre-line side profile x -> y).  Estimated; body agents refine.  See REFERENCE.md section 3.
    profile: {
      noseTopY: 0.60,        // front lid leading edge
      hoodMidY: 0.805,       // top of front lid around x=+1.35 (centre); fender crests ~0.865-0.875
      fenderCrestY: 0.87,    // front fender crest max (at x ~ +1.3, |z| ~ 0.80)
      cowlX: 0.72, cowlY: 0.965,       // windshield base / wiper base (rear edge of the front lid)
      roofFrontX: 0.02, roofFrontY: 1.270, // windshield top edge / roof leading edge (rake ~24 deg)
      roofPeakX: -0.30, roofPeakY: 1.280,
      rearWindowTopX: -0.85, rearWindowTopY: 1.240,
      deckStartX: -1.50, deckY: 1.045,  // fastback glass meets engine lid
      deckCrestX: -1.70, deckCrestY: 1.055, // engine-lid crown; falls to ~1.02 at the duck-tail
      ducktailY: 1.015,
      tailTopY: 0.965,                // top edge of the tail (above the light bar)
      tailBottomY: 0.42,              // bottom of rear fascia before the diffuser
      beltY: 0.985,                   // side-window sill line at the door
      rearHaunchCrestY: 1.035,        // rear fender crest (|z| ~ 0.84) at x ~ -1.2
    },
    // plan-view half-widths |z| of the widest point of the body: [x, |z|]  (REFERENCE.md 3.2)
    planHalfWidth: [[2.255, 0.62], [2.10, 0.80], [1.95, 0.86], [1.55, 0.925], [1.2285, 0.945], [0.80, 0.94], [0.55, 0.92], [-0.20, 0.90], [-0.60, 0.925], [-1.2285, 0.950], [-1.70, 0.92], [-2.10, 0.87], [-2.30, 0.80]],

    // ---- anchors the separate part modules rely on (body must honour these)
    anchors: {
      // Rear wing: swan-neck two-element DRS wing hanging from two uprights that rise from the engine lid and attach ON TOP of the main element.
      // Wing top (flap flat) = 1.322. Upswept duck-tail spoiler forms the rear edge of the engine lid.
      wing: { strutZ: 0.55, footX: -1.95, footY: 1.03, endplateZ: 0.90, leX: -1.92, teX: -2.30, topY: 1.322, mainChord: 0.29, flapChord: 0.20, flapMaxDeg: 34, mainUnderY: 1.24 },
      mirror: { x: 0.60, y: 0.99, z: 0.93 },          // base of the mirror stalk on the door top (per side); outer edge at |z| = 1.0135
      headlight: { x: 1.93, y: 0.73, z: 0.625 },       // centre of the lamp (per side)
      taillightBar: { x: -2.30, y: 0.95, halfWidth: 0.82 }, // full-width LED bar
      exhaust: { x: -2.30, y: 0.36, z: 0.13 },         // twin centre-exit tips (z = +/- 0.13)
      driverSeat: { x: -0.28, y: 0.42, z: -0.36 },     // seat pan front-centre (LHD)
      passengerSeat: { x: -0.28, y: 0.42, z: 0.36 },
      steeringWheel: { x: 0.36, y: 0.80, z: -0.36 },
      doorHandle: { x: -0.20, y: 0.93, z: 0.915 },     // recessed door handle (per side)
      hoodOutlet: { x: 1.68, z: 0.23, length: 0.44, width: 0.16 }, // L-shaped/boomerang front-lid outlets (per side)
      fenderLouvre: { x: 1.0, y: 0.845, z: 0.885, length: 0.30, width: 0.09 }, // louvre panel on the top of each front fender
      roofFin: { x: -0.70, z: 0.28, length: 0.25, height: 0.035 },             // two black roof fins near the rear roof edge
    },

    // ---- colours (sRGB hex) used by the UI. metallic is a hint for the paint shader (0 = solid gloss).
    paints: [
      { name: 'Guards Red', hex: '#c9151e', metallic: 0.0 },
      { name: 'Shark Blue', hex: '#1f6fc4', metallic: 0.0 },
      { name: 'Racing Yellow', hex: '#f5c400', metallic: 0.0 },
      { name: 'Arctic Grey', hex: '#9ea2a5', metallic: 0.0 },
      { name: 'Python Green', hex: '#55b02c', metallic: 0.0 },
      { name: 'Pure White', hex: '#f1f2f0', metallic: 0.0 },
      { name: 'GT Silver', hex: '#a4a8ac', metallic: 0.75 },
      { name: 'Jet Black', hex: '#0d0d10', metallic: 0.45 },
      { name: 'Gulf Orange', hex: '#e86a10', metallic: 0.0 },
      { name: 'Ruby Star', hex: '#8a1538', metallic: 0.6 },
    ],
    wheelFinishes: [
      { name: 'Satin Neodyme', hex: '#8f6a3c', metallic: 1.0, roughness: 0.34 },
      { name: 'Satin Black', hex: '#141416', metallic: 0.9, roughness: 0.38 },
      { name: 'Satin Platinum', hex: '#7c7f83', metallic: 1.0, roughness: 0.34 },
      { name: 'Guards Red', hex: '#c9151e', metallic: 0.6, roughness: 0.32 },
      { name: 'Python Green', hex: '#55b02c', metallic: 0.6, roughness: 0.32 },
    ],
  };

  // Helpers -------------------------------------------------------------
  // Wheel centre in car space for an axle ('front'|'rear') and side (+1 right(+Z) | -1 left(-Z)).
  spec.wheelCenter = (axle, side) => { const w = spec.wheel[axle]; return [w.x, w.tireRadius, side * w.track / 2]; };
  // Axis-aligned box that contains the whole car including mirrors and the raised wing (for grids/cameras/shadows).
  spec.bounds = { min: [-2.45, 0.0, -1.10], max: [2.40, 1.62, 1.10] };
  // Half-width of the body at x (linear interpolation of planHalfWidth)
  spec.halfWidthAt = x => {
    const t = spec.planHalfWidth; if (x >= t[0][0]) return t[0][1]; if (x <= t[t.length - 1][0]) return t[t.length - 1][1];
    for (let i = 0; i < t.length - 1; i++) if (x <= t[i][0] && x >= t[i + 1][0]) { const u = (x - t[i + 1][0]) / (t[i][0] - t[i + 1][0]); return t[i + 1][1] + (t[i][1] - t[i + 1][1]) * u; }
    return 0.9;
  };
})();
