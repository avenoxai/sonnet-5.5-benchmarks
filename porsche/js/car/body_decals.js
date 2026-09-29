'use strict';
// car/body_decals.js — body feature "decals" (order 70). STUB: registers an empty feature; a feature agent implements it later.
// Contract (see js/car/body.js header): common (GLSL shared helpers, identifiers prefixed "decals"), sdf (float feat_decals(vec3 p, float d), p.z mirrored >= 0,
// change d only locally), shade (void shade_decals(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw)).
(function () {
  PG.body.registerFeature({
    name: 'decals', order: 70,
    common: '',
    sdf: 'float feat_decals(vec3 p, float d) { return d; }',
    shade: 'void shade_decals(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw) {}',
  });
})();
