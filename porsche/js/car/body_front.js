'use strict';
// car/body_front.js — body feature "front" (order 20). STUB: registers an empty feature; a feature agent implements it later.
// Contract (see js/car/body.js header): common (GLSL shared helpers, identifiers prefixed "front"), sdf (float feat_front(vec3 p, float d), p.z mirrored >= 0,
// change d only locally), shade (void shade_front(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw)).
(function () {
  PG.body.registerFeature({
    name: 'front', order: 20,
    common: '',
    sdf: 'float feat_front(vec3 p, float d) { return d; }',
    shade: 'void shade_front(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw) {}',
  });
})();
