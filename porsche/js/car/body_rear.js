'use strict';
// car/body_rear.js — body feature "rear" (order 40). STUB: registers an empty feature; a feature agent implements it later.
// Contract (see js/car/body.js header): common (GLSL shared helpers, identifiers prefixed "rear"), sdf (float feat_rear(vec3 p, float d), p.z mirrored >= 0,
// change d only locally), shade (void shade_rear(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw)).
(function () {
  PG.body.registerFeature({
    name: 'rear', order: 40,
    common: '',
    sdf: 'float feat_rear(vec3 p, float d) { return d; }',
    shade: 'void shade_rear(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw) {}',
  });
})();
