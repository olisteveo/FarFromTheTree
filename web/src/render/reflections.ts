// What shiny things reflect by day, without rendering the city twice: glass (buildings.ts) and paint (vehicleLook.ts).
// Needs h21(), vnoise() and uniform vec3 uSun declared before it.

export const REFLECT_GLSL = /* glsl */ `
        // What glass reflects by day, without rendering the city twice: the sky (the same colours as the dome in
        // stage.ts) and two imagined rows of buildings, one across the street and a skyline behind it.
        vec3 reflSky(vec3 d) {
          float h = max(d.y, 0.0);
          float az = pow(max(dot(normalize(d.xz + vec2(1e-5)), normalize(uSun.xz)), 0.0), 4.0);
          vec3 c = mix(mix(vec3(0.53, 0.60, 0.70), vec3(0.80, 0.68, 0.56), az * 0.85), vec3(0.21, 0.31, 0.47), pow(smoothstep(0.0, 1.0, h), 0.6));
          c += vec3(0.30, 0.22, 0.13) * pow(max(dot(d, uSun), 0.0), 12.0);
          float cloud = vnoise(d.xz / (h + 0.14) * 1.7);
          return mix(c, vec3(0.62, 0.64, 0.68), smoothstep(0.45, 0.8, cloud) * smoothstep(0.02, 0.2, h) * 0.7);
        }
        vec3 reflRow(vec3 c, vec3 P, vec3 R, float D, float block, float lo, float hi, float seed, float sunny) {
          float rl = length(R.xz) + 1e-4, t = D / rl, y = P.y + R.y * t;
          vec2 hit = P.xz + R.xz * t;
          float u = hit.x + hit.y, id = floor(u / block), k = h21(vec2(id, seed));
          float top = mix(lo, hi, k * k);
          if (y > top) return c;
          // brick, stone or dark glass, lit from the sun's side
          vec3 tone = k < 0.4 ? vec3(0.27, 0.15, 0.11) : k < 0.72 ? vec3(0.42, 0.38, 0.33) : vec3(0.13, 0.16, 0.20);
          tone *= 0.42 + sunny * 0.7;
          float fade = (1.0 - clamp(fwidth(u) / 1.4, 0.0, 1.0)) * 0.55;
          float win = smoothstep(0.34, 0.62, fract(u / 3.1)) * smoothstep(0.26, 0.5, fract(y / 3.7));
          tone = mix(tone, tone * 0.45 + vec3(0.06, 0.07, 0.09), win * fade);
          return mix(c, tone * (0.85 + 0.3 * vnoise(vec2(u * 0.09, y * 0.07))), smoothstep(top, top - 0.6, y));
        }
        vec3 reflCity(vec3 P, vec3 R) {
          vec3 c = reflSky(R);
          float sunny = pow(max(dot(normalize(R.xz + vec2(1e-5)), -normalize(uSun.xz)), 0.0), 1.5);
          c = reflRow(c, P, R, 180.0, 46.0, 60.0, 260.0, 3.0, sunny * 0.6);
          c = reflRow(c, P, R, 42.0, 19.0, 16.0, 70.0, 7.0, sunny);
          return R.y < 0.0 && P.y + R.y * 42.0 / (length(R.xz) + 1e-4) < 0.0 ? vec3(0.09, 0.09, 0.10) : c;
        }
`;
