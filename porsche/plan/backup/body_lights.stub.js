'use strict';
// car/body_lights.js — body feature "lights" (order 60). STUB: registers an empty feature; a feature agent implements it later.
// Contract (see js/car/body.js header): common (GLSL shared helpers, identifiers prefixed "lights"), sdf (float feat_lights(vec3 p, float d), p.z mirrored >= 0,
// change d only locally), shade (void shade_lights(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw)).
(function () {
  PG.body.registerFeature({
    name: 'lights', order: 60,
    common: '',
    sdf: 'float feat_lights(vec3 p, float d) { return d; }',
    shade: 'void shade_lights(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw) {}',
  });
})();
