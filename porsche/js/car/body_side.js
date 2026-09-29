'use strict';
// car/body_side.js — body feature "side" (order 30). STUB: registers an empty feature; a feature agent implements it later.
// Contract (see js/car/body.js header): common (GLSL shared helpers, identifiers prefixed "side"), sdf (float feat_side(vec3 p, float d), p.z mirrored >= 0,
// change d only locally), shade (void shade_side(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw)).
(function () {
  PG.body.registerFeature({
    name: 'side', order: 30,
    common: '',
    sdf: 'float feat_side(vec3 p, float d) { return d; }',
    shade: 'void shade_side(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw) {}',
  });
})();
