"""Far From the Tree - story intro cutscene generator.

Builds the editable Tesseract document (intro.tsrct) from code:
  python build.py            -> writes .tesseract-work/editable.json
then commit with tsrct (see README in render.sh).

Everything is authored in "pixel units" (P) on a 320x180 grid; P * 6 = canvas px
(1920x1080). A custom 'pixelate' shader on the Scene group snaps the whole frame to
6px blocks so the vector layers render as crisp pixel art.

Timeline (seconds)
  0.0 -  5.5  Summer in Battery Park (slow drift, sailboat, swaying canopy)
  5.5 - 15.0  Time-lapse: days race (sun arcs, clouds, day/night), leaves turn
 15.0 - 26.0  Autumn gusts strip the tree; leaves blow right toward the city
 26.0 - 36.5  Bare tree, one leaf, cold pale sky, first snow; camera pushes in
 35.8 - 42.3  Title card + subtitle
 42.3 - 44.0  Clean hold on the leaf (game cuts to the same moment in 3D)
"""
import json, math, random, os

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, ".tesseract-work")
S = 6                      # px per art pixel
DUR = 44.0                 # seconds
DMS = int(DUR * 1000)

rng = random.Random(7)

# --------------------------------------------------------------------------------------
# Timing model (shared by Python and the JS animators)
# --------------------------------------------------------------------------------------
LAPSE_IN = (5.5, 9.0)      # time-lapse ramps up
LAPSE_OUT = (12.0, 16.5)   # and back down
PEAK = 1.45                # days per second at peak (solved below to land the phase)
START_PHASE = 0.53         # early afternoon
END_PHASE = 0.585          # pale cold afternoon at the end
GUSTS = [(16.2, 0.55), (18.4, 0.75), (20.5, 0.9), (22.5, 1.0), (24.4, 0.85)]


def ss(a, b, x):
    x = min(1.0, max(0.0, (x - a) / (b - a)))
    return x * x * (3 - 2 * x)


TAIL = 0.02               # slow drift after the lapse (solved)
MORNING = (15.6, 0.36)    # the lapse lands on a bright morning for the autumn gusts


def rate(t, peak, tail=None):
    tail = TAIL if tail is None else tail
    up = ss(*LAPSE_IN, t)
    down = 1 - ss(*LAPSE_OUT, t)
    base = 0.004  # very slow drift of the sun outside the lapse
    return base + peak * up * down + tail * up * (1 - down) * (1 - ss(23, 29, t))


def integrate(peak, tail, dt=0.01):
    ph = START_PHASE
    out = [(0.0, ph)]
    t = 0.0
    while t < DUR + 0.3:
        ph += rate(t + dt / 2, peak, tail) * dt
        t += dt
        out.append((t, ph))
    return out


def at(seq, t):
    return seq[min(int(round(t / 0.01)), len(seq) - 1)][1]


def solve(f, target, lo, hi):
    for _ in range(60):
        mid = (lo + hi) / 2
        if f(mid) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


for _ in range(3):
    m = at(integrate(PEAK, TAIL), MORNING[0])
    PEAK = solve(lambda p: at(integrate(p, TAIL), MORNING[0]), math.floor(m) + MORNING[1], 0.5, 3.0)
    seq = integrate(PEAK, TAIL)
    need = END_PHASE - MORNING[1] + (at(seq, MORNING[0]) - math.floor(at(seq, MORNING[0])) - MORNING[1])
    base_end = at(seq, MORNING[0])
    TAIL = solve(lambda tl: at(integrate(PEAK, tl), DUR) - base_end, END_PHASE - MORNING[1], 0.0, 0.2)
PHASE = integrate(PEAK, TAIL)
DAYS = PHASE[-1][1] - START_PHASE


def table(fn, step=0.1):
    vals = []
    t = 0.0
    while t <= DUR + 0.2001:
        vals.append(round(fn(t), 5))
        t += step
    return vals


def phase_at(t):
    i = min(int(t / 0.01), len(PHASE) - 1)
    return PHASE[i][1]


def wind_py(t):
    w = 0.12
    for g, a in GUSTS:
        w += a * math.exp(-((t - g) / 0.8) ** 2)
    w += 0.18 * ss(25, 28, t) * (0.6 + 0.4 * math.sin(t * 1.3))
    return w


def cloud_at_builder():
    vals = [0.0]
    acc = 0.0
    n = int((DUR + 0.3) / 0.01)
    for i in range(n):
        t = i * 0.01
        acc += (2.0 + 240 * rate(t, PEAK) + 25 * wind_py(t)) * 0.01
        vals.append(acc)
    return lambda t: vals[min(int(t / 0.01), len(vals) - 1)]


cloud_at = cloud_at_builder()

PHASE_TABLE = table(phase_at)
CLOUD_TABLE = table(cloud_at)

JS_HELPERS = """
function ss(a,b,x){x=Math.min(1,Math.max(0,(x-a)/(b-a)));return x*x*(3-2*x);}
function lerp(a,b,p){return a+(b-a)*p;}
function tab(T,t){var f=Math.max(0,t)/0.1;var i=Math.floor(f);if(i>=T.length-1)return T[T.length-1];return T[i]+(T[i+1]-T[i])*(f-i);}
function wind(t){var w=0.12;var G=%s;for(var i=0;i<G.length;i++){var d=(t-G[i][0])/0.8;w+=G[i][1]*Math.exp(-d*d);}w+=0.18*ss(25,28,t)*(0.6+0.4*Math.sin(t*1.3));return w;}
""" % json.dumps([list(g) for g in GUSTS])

PHASE_JS = "var PH=%s;function phase(t){return tab(PH,t);}" % json.dumps(PHASE_TABLE)
CLOUD_JS = "var CL=%s;function cloud(t){return tab(CL,t);}" % json.dumps(CLOUD_TABLE)
LIGHT_JS = """
function sunE(t){return Math.sin(6.2831853*(phase(t)-0.25));}
function dayL(t){return ss(-0.34,0.08,sunE(t));}
function cold(t){return ss(21,28.5,t);}
function season(t){return ss(7.5,18,t);}
"""

# Camera: final framing focuses on the hero leaf
LEAF = (150.0, 70.0)          # twig tip where the last leaf hangs (P)
CAM_END = (112.0, 86.0)       # where that point sits on screen at the end (P)
ZOOM = 3.0
PUSH = (25.5, 36.5)
CAM_JS = """
function push(t){var x=Math.min(1,Math.max(0,(t-%f)/(%f)));return x<0.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;}
function pan(t){return 10*(1-ss(0,9,t));}
""" % (PUSH[0], PUSH[1] - PUSH[0])

# --------------------------------------------------------------------------------------
# Document builders
# --------------------------------------------------------------------------------------
_next_id = [10]


def nid():
    _next_id[0] += 1
    return _next_id[0]


ENTRIES = []


def anim(layer_id, prop, code, helpers=""):
    ENTRIES.append({"target": {"kind": "layer", "layerId": layer_id, "propertyType": prop},
                    "animator": {"type": "jsScript", "layerTimeJsCode": helpers + code}})


def anim_fx(effect_id, param, code, helpers=""):
    ENTRIES.append({"target": {"kind": "effectProperty", "effectId": effect_id, "paramName": param},
                    "animator": {"type": "jsScript", "layerTimeJsCode": helpers + code}})


def keys(layer_id, prop, pts, kind="float"):
    kf = []
    for i, (tm, v, ease) in enumerate(pts):
        e = {"type": "linear"} if ease == "lin" else ({"type": "hold"} if ease == "hold" else
                                                      {"type": "cubicBezier", "x1": 0.3, "y1": 0, "x2": 0.2, "y2": 1})
        kf.append({"id": "k%d_%s_%d" % (layer_id, prop, i), "layerTime": int(tm * 1000),
                   "value": {"type": kind, "value": v}, "easing": e})
    ENTRIES.append({"target": {"kind": "layer", "layerId": layer_id, "propertyType": prop},
                    "animator": {"type": "keyframes", "enabled": True, "keyframes": kf}})


def tr(pos=(0, 0), anchor=(0, 0), scale=(100, 100), rot=0, op=100):
    return {"anchorPoint": [anchor[0], anchor[1]], "position": [pos[0], pos[1]],
            "scale": [scale[0], scale[1]], "rotation": rot, "opacity": op}


def rng_ms(start, dur):
    return {"start": int(start * 1000), "duration": int(dur * 1000)}


def playback(start=0.0, dur=DUR):
    d = int(dur * 1000)
    return {"type": "windowed", "inputRange": {"start": int(start * 1000), "duration": d},
            "mapping": {"type": "linear", "input": {"start": int(start * 1000), "duration": d},
                        "output": {"start": 0, "duration": d}}, "inputOffsetMs": 0}


def group(name, layers, transform=None, effects=None, start=0.0, dur=DUR, gid=None, desc=None):
    g = {"type": "Group", "id": gid or nid(), "name": name, "blendMode": "normal",
         "playback": playback(start, dur), "transform": transform or tr(), "layers": layers}
    if effects:
        g["effects"] = effects
    if desc:
        g["description"] = desc
    return g


def fill(color, op=100):
    return {"paint": {"type": "solid", "color": list(color)}, "fillRule": "nonZeroWinding",
            "blendMode": "normal", "opacity": op}


def area(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def polys_to_cmds(polys):
    cmds = []
    for poly in polys:
        if area(poly) < 0:   # consistent winding so overlaps never cancel (nonZero fill)
            poly = poly[::-1]
        for i, (x, y) in enumerate(poly):
            cmds.append({"type": "moveTo" if i == 0 else "lineTo", "x": round(x * S, 2), "y": round(y * S, 2)})
        cmds.append({"type": "close"})
    return cmds


def shape(name, polys, color, start=0.0, dur=DUR, pos=(0, 0), anchor=(0, 0), lid=None, op=100, blend="normal"):
    return {"type": "Shape", "id": lid or nid(), "name": name, "blendMode": blend,
            "activeRange": rng_ms(start, dur), "transform": tr((pos[0] * S, pos[1] * S), (anchor[0] * S, anchor[1] * S), op=op),
            "shape": {"path": {"commands": polys_to_cmds(polys)}, "fills": [fill(color)]}}


def ellipse(name, center, size, color, start=0.0, dur=DUR, lid=None, op=100):
    return {"type": "Shape", "id": lid or nid(), "name": name, "blendMode": "normal",
            "activeRange": rng_ms(start, dur), "transform": tr((center[0] * S, center[1] * S), op=op),
            "shape": {"path": {"commands": []}, "ellipse": {"size": [size[0] * S, size[1] * S], "position": [0, 0]},
                      "fills": [fill(color)]}}


def rect(name, x, y, w, h, color, start=0.0, dur=DUR, lid=None, anchor_center=False, op=100):
    if anchor_center:
        t = tr(((x + w / 2) * S, (y + h / 2) * S), (w * S / 2, h * S / 2), op=op)
    else:
        t = tr((x * S, y * S), op=op)
    return {"type": "Rect", "id": lid or nid(), "name": name, "blendMode": "normal",
            "activeRange": rng_ms(start, dur), "transform": t,
            "rect": {"size": [w * S, h * S], "fillColor": list(color)}}


def rects(name, boxes, color, **kw):
    """Many axis-aligned boxes (x, y, w, h) merged into one Shape layer."""
    polys = [[(x, y), (x + w, y), (x + w, y + h), (x, y + h)] for (x, y, w, h) in boxes]
    return shape(name, polys, color, **kw)


def circle_poly(cx, cy, r, n=10, sx=1.0, sy=1.0):
    return [(cx + math.cos(2 * math.pi * i / n) * r * sx, cy + math.sin(2 * math.pi * i / n) * r * sy) for i in range(n)]


def jag(cx, cy, r, sx=1.0, sy=1.0, n=14, rnd=None, amp=0.2):
    """Irregular leafy blob: alternating radii with noise."""
    rnd = rnd or random
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r * (1 + (amp if i % 2 == 0 else -amp * 0.4) + rnd.uniform(-amp, amp) * 0.6)
        out.append((cx + math.cos(a) * rr * sx, cy + math.sin(a) * rr * sy))
    return out


def camera_group(name, k, layers, desc=None):
    """Parallax camera: depth k (0 = sky, 1 = tree plane)."""
    g = group(name, layers, transform=tr((LEAF[0] * S, LEAF[1] * S), (LEAF[0] * S, LEAF[1] * S)), desc=desc)
    gid = g["id"]
    h = JS_HELPERS + CAM_JS
    anim(gid, "positionX", "var t=input.time.seconds;var e=push(t);var cx=%f+pan(t)+e*(%f);return (%f+(cx-%f)*%f)*%d;"
         % (LEAF[0], CAM_END[0] - LEAF[0], LEAF[0], LEAF[0], k, S), h)
    anim(gid, "positionY", "var t=input.time.seconds;var e=push(t);var cy=%f+e*(%f);return (%f+(cy-%f)*%f)*%d;"
         % (LEAF[1], CAM_END[1] - LEAF[1], LEAF[1], LEAF[1], k, S), h)
    for p in ("scaleX", "scaleY"):
        anim(gid, p, "var e=push(input.time.seconds);return 100*(1+%f*e);" % ((ZOOM - 1) * k), h)
    return g


# --------------------------------------------------------------------------------------
# Shaders
# --------------------------------------------------------------------------------------
VS = """struct VertexInput { @location(0) position: vec2<f32>, @location(1) tex_coords: vec2<f32>, @location(2) color: vec4<f32>, };
struct VertexOutput { @builtin(position) clip_position: vec4<f32>, @location(0) tex_coords: vec2<f32>, };
@vertex fn vs_main(input: VertexInput) -> VertexOutput { var out: VertexOutput; out.clip_position = vec4<f32>(input.position, 0.0, 1.0); out.tex_coords = input.tex_coords; return out; }
"""

PIXELATE = VS + """
struct Params { block: f32, levels: f32, _p0: f32, _p1: f32, };
@group(0) @binding(0) var t_texture: texture_2d<f32>;
@group(0) @binding(1) var s_sampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
fn smp(p: vec2<f32>, dims: vec2<f32>) -> vec4<f32> { return textureSampleLevel(t_texture, s_sampler, p / dims, 0.0); }
fn dsum(a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32>, e: vec4<f32>) -> f32 {
  return distance(a, b) + distance(a, c) + distance(a, d) + distance(a, e);
}
@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let dims = vec2<f32>(textureDimensions(t_texture));
  let b = max(params.block, 1.0);
  let cell = (floor(input.tex_coords * dims / b) + 0.5) * b;
  let o = b * 0.3;
  // five samples per block; keep the medoid so anti-aliased edges snap to a real colour
  let s0 = smp(cell, dims);
  let s1 = smp(cell + vec2<f32>(-o, -o), dims);
  let s2 = smp(cell + vec2<f32>(o, -o), dims);
  let s3 = smp(cell + vec2<f32>(-o, o), dims);
  let s4 = smp(cell + vec2<f32>(o, o), dims);
  var best = s0; var bd = dsum(s0, s1, s2, s3, s4);
  let d1 = dsum(s1, s0, s2, s3, s4); if (d1 < bd) { best = s1; bd = d1; }
  let d2 = dsum(s2, s0, s1, s3, s4); if (d2 < bd) { best = s2; bd = d2; }
  let d3 = dsum(s3, s0, s1, s2, s4); if (d3 < bd) { best = s3; bd = d3; }
  let d4 = dsum(s4, s0, s1, s2, s3); if (d4 < bd) { best = s4; bd = d4; }
  var c = best;
  if (c.a > 0.001) {
    var rgb = c.rgb / c.a;
    let L = max(params.levels, 2.0);
    rgb = floor(rgb * L + 0.5) / L;
    c = vec4<f32>(rgb * c.a, c.a);
  }
  return vec4<f32>(clamp(c.rgb, vec3<f32>(0.0), vec3<f32>(c.a)), c.a);
}
"""

GRADE = VS + """
struct Params { tintR: f32, tintG: f32, tintB: f32, desat: f32, };
@group(0) @binding(0) var t_texture: texture_2d<f32>;
@group(0) @binding(1) var s_sampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let c = textureSample(t_texture, s_sampler, input.tex_coords);
  let l = dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));
  var rgb = mix(c.rgb, vec3<f32>(l), params.desat) * vec3<f32>(params.tintR, params.tintG, params.tintB);
  return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(c.a)), c.a);
}
"""

SKY = VS + """
struct Params { animationTime: f32, phase: f32, cloudShift: f32, cold: f32, cover: f32, _p0: f32, _p1: f32, _p2: f32, };
@group(0) @binding(0) var t_texture: texture_2d<f32>;
@group(0) @binding(1) var s_sampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
fn hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x), mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn fbm(p: vec2<f32>) -> f32 { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 7.1) + 0.15 * vnoise(p * 4.1 + 3.3); }
fn bayer(p: vec2<f32>) -> f32 {
  let x = i32(p.x) & 3; let y = i32(p.y) & 3;
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[y * 4 + x] + 0.5) / 16.0;
}
fn cloudMask(P: vec2<f32>, shift: f32, cover: f32) -> f32 {
  let q = vec2<f32>((P.x - shift) / 46.0, P.y / 11.0);
  let band = smoothstep(4.0, 22.0, P.y) * (1.0 - smoothstep(62.0, 92.0, P.y));
  let n = fbm(q) * band;
  return step(1.0 - cover * 0.62, n + 0.28 * band);
}
@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let dims = vec2<f32>(textureDimensions(t_texture));
  let P = floor(input.tex_coords * dims / (dims.x / 320.0));
  let th = 6.2831853 * (params.phase - 0.25);
  let e = sin(th);
  let sun = vec2<f32>(160.0 - 175.0 * cos(th), 104.0 - 92.0 * e);
  let moon = vec2<f32>(160.0 + 175.0 * cos(th), 104.0 + 92.0 * e);
  let day = smoothstep(-0.34, 0.08, e);
  let cold = params.cold;
  let v = clamp(P.y / 100.0 + (bayer(P) - 0.5) * 0.09, 0.0, 1.0);
  let vq = floor(v * 9.0) / 9.0;
  let dayTop = mix(vec3<f32>(0.20, 0.45, 0.82), vec3<f32>(0.58, 0.64, 0.72), cold);
  let dayBot = mix(vec3<f32>(0.62, 0.83, 0.95), vec3<f32>(0.86, 0.87, 0.88), cold);
  let nightTop = vec3<f32>(0.03, 0.04, 0.12);
  let nightBot = vec3<f32>(0.10, 0.12, 0.26);
  var col = mix(mix(nightTop, nightBot, vq), mix(dayTop, dayBot, vq), day);
  // dawn / dusk glow towards the sun
  let dusk = (1.0 - smoothstep(0.0, 0.32, abs(e + 0.04))) * (1.0 - cold * 0.7);
  let side = 1.0 - clamp(abs(P.x - sun.x) / 300.0, 0.0, 1.0);
  let glow = dusk * vq * vq * (0.4 + 0.6 * side);
  let glowQ = floor(glow * 5.0 + bayer(P) * 0.9) / 5.0;
  col = mix(col, vec3<f32>(1.0, 0.52, 0.34), clamp(glowQ, 0.0, 0.85));
  // stars
  let h = hash(P);
  if (h > 0.9935 && P.y < 85.0) {
    let tw = 0.55 + 0.45 * sin(params.animationTime * (2.0 + h * 9.0) + h * 80.0);
    col = mix(col, vec3<f32>(0.95, 0.93, 0.80), (1.0 - day) * tw * (1.0 - cold * 0.5));
  }
  // sun
  let ds = length(P - sun);
  let sunCol = mix(mix(vec3<f32>(1.0, 0.62, 0.30), vec3<f32>(1.0, 0.95, 0.70), smoothstep(0.0, 0.3, e)), vec3<f32>(0.97, 0.96, 0.90), cold);
  if (ds < 13.0) { col = mix(col, sunCol, 0.18 * day * (1.0 - cold * 0.5)); }
  if (ds < 9.5) { col = mix(col, sunCol, 0.22 * day); }
  if (ds < 6.5) { col = mix(col, sunCol, 1.0 - cold * 0.45); }
  // moon (crescent)
  let dm = length(P - moon);
  let dm2 = length(P - moon - vec2<f32>(2.0, -1.0));
  if (dm < 4.5 && dm2 > 4.0) { col = mix(col, vec3<f32>(0.93, 0.92, 0.82), 1.0 - day); }
  // clouds (two-tone pixel clouds with lit tops)
  let m = cloudMask(P, params.cloudShift, params.cover);
  if (m > 0.5) {
    let below = cloudMask(P + vec2<f32>(0.0, 2.0), params.cloudShift, params.cover);
    let above = cloudMask(P - vec2<f32>(0.0, 3.0), params.cloudShift, params.cover);
    let body = mix(mix(vec3<f32>(0.16, 0.18, 0.30), vec3<f32>(0.93, 0.95, 0.98), day), vec3<f32>(0.81, 0.83, 0.86), cold * day);
    let lit = mix(mix(vec3<f32>(0.25, 0.27, 0.41), vec3<f32>(1.0, 1.0, 1.0), day), vec3<f32>(0.87, 0.88, 0.90), cold * day);
    let shade = mix(mix(vec3<f32>(0.10, 0.12, 0.22), vec3<f32>(0.70, 0.78, 0.91), day), vec3<f32>(0.73, 0.75, 0.80), cold * day);
    let duskC = vec3<f32>(1.0, 0.70, 0.62);
    var c = body;
    if (above < 0.5) { c = lit; }
    if (below < 0.5) { c = shade; }
    c = mix(c, duskC * mix(0.6, 1.0, day), dusk * 0.55);
    col = c;
  }
  return vec4<f32>(col, 1.0);
}
"""

# --------------------------------------------------------------------------------------
# Palette (base colours, daylight; the grade shader handles time of day)
# --------------------------------------------------------------------------------------
C = {
    "shore": (0.50, 0.60, 0.66, 1), "shore2": (0.42, 0.52, 0.60, 1),
    "isle": (0.28, 0.45, 0.36, 1), "isletree": (0.20, 0.36, 0.30, 1),
    "fort": (0.72, 0.70, 0.62, 1), "stone": (0.80, 0.76, 0.64, 1), "stone2": (0.62, 0.59, 0.52, 1),
    "copper": (0.50, 0.74, 0.65, 1), "copper2": (0.33, 0.54, 0.50, 1), "flame": (0.98, 0.80, 0.30, 1),
    "water": (0.13, 0.34, 0.48, 1), "water2": (0.20, 0.45, 0.58, 1), "waterHi": (0.62, 0.80, 0.86, 1),
    "bldA": (0.47, 0.55, 0.66, 1), "bldB": (0.38, 0.45, 0.57, 1), "bldC": (0.56, 0.62, 0.70, 1),
    "bldEdge": (0.70, 0.76, 0.82, 1), "win": (0.30, 0.36, 0.46, 1), "winLit": (1.0, 0.82, 0.45, 1),
    "rail": (0.10, 0.13, 0.13, 1), "wall": (0.55, 0.53, 0.50, 1), "wall2": (0.42, 0.41, 0.40, 1),
    "pave": (0.74, 0.70, 0.64, 1), "pave2": (0.64, 0.60, 0.56, 1),
    "grass": (0.30, 0.55, 0.22, 1), "grass2": (0.22, 0.44, 0.18, 1), "grassHi": (0.45, 0.68, 0.28, 1),
    "bark": (0.24, 0.17, 0.13, 1), "bark2": (0.36, 0.26, 0.19, 1), "barkHi": (0.48, 0.37, 0.27, 1),
    "bench": (0.20, 0.32, 0.22, 1), "benchWood": (0.55, 0.38, 0.22, 1),
    "hull": (0.93, 0.47, 0.16, 1), "cabin": (0.96, 0.94, 0.88, 1), "sail": (0.98, 0.97, 0.92, 1),
    "seed": (0.52, 0.33, 0.17, 1), "seedHi": (0.80, 0.60, 0.35, 1),
}

# canopy seasonal ramp: (green, yellow, orange, red) for dark / mid / light tones
RAMP = {
    "dark": [(0.10, 0.30, 0.16), (0.42, 0.42, 0.12), (0.58, 0.26, 0.08), (0.42, 0.09, 0.08)],
    "mid": [(0.19, 0.46, 0.19), (0.70, 0.64, 0.16), (0.88, 0.47, 0.12), (0.72, 0.19, 0.10)],
    "light": [(0.42, 0.68, 0.25), (0.94, 0.86, 0.32), (0.99, 0.70, 0.26), (0.92, 0.40, 0.18)],
}


def ramp_js(tone):
    return "var R=%s;function rc(s){s=Math.min(1,Math.max(0,s))*3;var i=Math.min(2,Math.floor(s));var f=s-i;f=Math.floor(f*4+0.5)/4;return [R[i][0]+(R[i+1][0]-R[i][0])*f,R[i][1]+(R[i+1][1]-R[i][1])*f,R[i][2]+(R[i+1][2]-R[i][2])*f,1];}" % json.dumps(RAMP[tone])


def ramp_py(tone, s):
    s = min(1, max(0, s)) * 3
    i = min(2, int(s))
    f = s - i
    a, b = RAMP[tone][i], RAMP[tone][i + 1]
    return tuple(a[j] + (b[j] - a[j]) * f for j in range(3)) + (1,)


# --------------------------------------------------------------------------------------
# Harbour plane (k = 0.3): far shore, Liberty Island + statue, water, boats
# --------------------------------------------------------------------------------------
def build_harbour():
    L = []
    # Water body (extends far below so the push-in never exposes the sky)
    L.append(rect("Harbour water", -80, 100, 480, 140, C["water"]))
    L.append(rect("Harbour water near horizon", -80, 100, 480, 6, C["water2"]))
    L.append(rect("Horizon line", -80, 100, 480, 1, C["waterHi"], op=60))
    # far shore (New Jersey / Brooklyn haze) with low blocky silhouettes
    bumps = []
    x = -80
    r2 = random.Random(3)
    while x < 400:
        w = r2.randint(4, 12)
        h = r2.choice([1, 1, 2, 2, 3, 4])
        if 170 < x < 230:
            h = 1
        bumps.append((x, 99 - h, w, h + 1))
        x += w
    L.append(rects("Far shore skyline", bumps, C["shore"]))
    L.append(rect("Far shore", -80, 98.5, 480, 2, C["shore2"]))
    # cranes on the far shore (whimsical detail, left side)
    cr = [(22, 88, 1, 10), (16, 88, 12, 1), (27, 89, 1, 2), (58, 90, 1, 8), (52, 90, 10, 1)]
    L.append(rects("Far cranes", cr, C["shore2"]))

    # Liberty Island + star fort + pedestal + statue, centred x=200, ground y=98
    cx, gy = 200.0, 98.0
    L.append(shape("Liberty Island", [[(178, 100), (182, 97.2), (218, 97.2), (224, 100)]], C["isle"]))
    trees = [rects("Island trees", [(180, 95.5, 4, 2), (184, 96, 3, 1.5), (213, 95.5, 5, 2), (218, 96.2, 3, 1.4)], C["isletree"])]
    L.extend(trees)
    L.append(shape("Star fort", [[(cx - 13, gy), (cx - 11, gy - 2.5), (cx - 5, gy - 3.2), (cx + 5, gy - 3.2), (cx + 11, gy - 2.5), (cx + 13, gy)]], C["fort"]))
    ped = [[(cx - 4.4, gy - 3), (cx - 3.9, gy - 12), (cx - 4.6, gy - 12.5), (cx - 4.6, gy - 13.6), (cx + 4.6, gy - 13.6),
            (cx + 4.6, gy - 12.5), (cx + 3.9, gy - 12), (cx + 4.4, gy - 3)]]
    L.append(shape("Pedestal", ped, C["stone"]))
    L.append(shape("Pedestal shade", [[(cx + 1.2, gy - 3), (cx + 1.0, gy - 12), (cx + 3.9, gy - 12), (cx + 4.4, gy - 3)]], C["stone2"]))
    L.append(rects("Pedestal windows", [(cx - 2.5, gy - 10, 1, 2), (cx - 0.5, gy - 10, 1, 2), (cx + 1.5, gy - 10, 1, 2)], C["stone2"]))
    top = gy - 13.6  # statue feet
    robe = [(cx - 3.4, top), (cx - 2.6, top - 6), (cx - 2.2, top - 11), (cx - 2.4, top - 14.5), (cx - 1.4, top - 16),
            (cx + 1.6, top - 16), (cx + 2.6, top - 14.5), (cx + 2.4, top - 11), (cx + 2.9, top - 6), (cx + 3.6, top)]
    head = circle_poly(cx, top - 17.6, 1.35, 10)
    arm = [(cx - 2.1, top - 14.2), (cx - 3.7, top - 22), (cx - 3.4, top - 27), (cx - 2.2, top - 27), (cx - 2.2, top - 22.5), (cx - 0.9, top - 15.5)]
    torch = [(cx - 3.9, top - 27), (cx - 4.1, top - 28.3), (cx - 1.5, top - 28.3), (cx - 1.7, top - 27)]
    tablet = [(cx + 1.6, top - 12.5), (cx + 3.8, top - 13.8), (cx + 4.4, top - 9.6), (cx + 2.3, top - 8.6)]
    crown = []
    hc = (cx, top - 18.2)
    for a in (-160, -125, -90, -55, -20):
        r = math.radians(a)
        px, py = hc[0] + math.cos(r) * 4.2, hc[1] + math.sin(r) * 4.0
        nx, ny = -math.sin(r) * 0.55, math.cos(r) * 0.55
        crown.append([(hc[0] + nx, hc[1] + ny), (px, py), (hc[0] - nx, hc[1] - ny)])
    L.append(shape("Statue body", [robe, head, arm, tablet] + crown, C["copper"]))
    L.append(shape("Statue shade", [[(cx + 0.6, top), (cx + 0.9, top - 7), (cx + 0.5, top - 13), (cx + 1.6, top - 16), (cx + 2.6, top - 14.5),
                                     (cx + 2.4, top - 11), (cx + 2.9, top - 6), (cx + 3.6, top)],
                                    [(cx + 2.3, top - 8.6), (cx + 4.4, top - 9.6), (cx + 4.1, top - 11.6), (cx + 2.4, top - 10.6)]], C["copper2"]))
    L.append(shape("Torch", [torch], C["copper2"]))
    flame_id = nid()
    L.append(shape("Torch flame", [[(cx - 3.8, top - 28.3), (cx - 3.4, top - 30.4), (cx - 2.7, top - 31.6), (cx - 2.3, top - 29.8), (cx - 1.8, top - 28.3)]],
                   C["flame"], lid=flame_id, pos=(cx - 2.8, top - 28.3), anchor=(cx - 2.8, top - 28.3)))
    anim(flame_id, "scaleY", "var t=input.time.seconds;return 100+12*Math.sin(t*9)+8*Math.sin(t*23);")

    # shimmer dashes in two sets that slide in opposite directions
    for si, (dirn, opv) in enumerate([(1, 85), (-1, 60)]):
        r3 = random.Random(11 + si)
        dashes = []
        for _ in range(70):
            y = r3.choice([101.5, 103, 105, 107, 109.5, 112, 115, 118, 121, 124])
            w = r3.randint(2, 6) if y < 110 else r3.randint(3, 9)
            dashes.append((r3.uniform(-60, 380), y, w, 0.6 if y < 108 else 1))
        lid = nid()
        L.append(rects("Water shimmer %d" % (si + 1), dashes, C["waterHi"], lid=lid, op=opv))
        anim(lid, "positionX", "var t=input.time.seconds;return %d*(3*Math.sin(t*0.9+%d)+ (cloud(t)*0.08)%%24)*%d;" % (dirn, si * 2, S),
             JS_HELPERS + CLOUD_JS)

    # Orange ferry crossing once per (time-lapse) day, sailboat drifting in summer
    fid = nid()
    ferry = group("Harbour ferry", [
        rects("Ferry cabin", [(2, -4, 10, 2), (4, -5.5, 6, 1.5), (7, -7, 1, 1.5)], C["cabin"]),
        rects("Ferry windows", [(3, -3.4, 8, 0.7)], C["win"]),
        shape("Ferry hull", [[(0, -2), (15, -2), (14, 0), (1, 0)]], C["hull"]),
    ], transform=tr((0, 104.5 * S)), gid=fid)
    L.append(ferry)
    anim(fid, "positionX", "var t=input.time.seconds;var p=phase(t)*1.0+0.62;var f=p-Math.floor(p);return (340-f*420)*%d;" % S,
         JS_HELPERS + PHASE_JS)
    sid = nid()
    sail = group("Sailboat", [
        shape("Sail", [[(3, -1), (3, -9), (7.5, -1)], [(2.4, -1), (2.4, -6.5), (0, -1)]], C["sail"]),
        rect("Mast", 2.6, -9.5, 0.6, 8.5, C["rail"]),
        shape("Sailboat hull", [[(-0.5, -1), (8.5, -1), (7.5, 0.6), (0.5, 0.6)]], C["stone2"]),
    ], transform=tr((0, 112 * S)), gid=sid)
    L.append(sail)
    anim(sid, "positionX", "var t=input.time.seconds;return (128+t*3.2+ss(5.5,11,t)*260)*%d;" % S, JS_HELPERS)
    return L[::-1]


# --------------------------------------------------------------------------------------
# Skyline plane (k = 0.5): lower Manhattan towers at the right edge
# --------------------------------------------------------------------------------------
def build_skyline():
    L = []
    r4 = random.Random(21)
    blds = []
    x = 246
    specs = [(9, 72, "bldC"), (7, 58, "bldA"), (11, 40, "bldB"), (8, 52, "bldC"), (13, 20, "bldA"),
             (9, 34, "bldB"), (12, 46, "bldC"), (10, 28, "bldA"), (14, 38, "bldB"), (12, 56, "bldC")]
    for w, ytop, col in specs:
        blds.append((x, ytop, w, col))
        x += w - 1
    base = 120
    windows_day = []
    windows_lit = []
    for (bx, by, bw, col) in blds:
        L.append(rect("Tower %d" % len(L), bx, by, bw, base - by, C[col]))
        L.append(rect("Tower edge %d" % len(L), bx, by, 1, base - by, C["bldEdge"], op=70))
        for wy in range(int(by) + 3, base - 2, 3):
            for wx in range(int(bx) + 2, int(bx + bw) - 1, 2):
                if r4.random() < 0.55:
                    windows_day.append((wx, wy, 1, 1))
                    if r4.random() < 0.45:
                        windows_lit.append((wx, wy, 1, 1))
    # tallest tower gets a crown and spire
    L.append(rects("Tower crown", [(279.5, 16, 10, 4), (283, 6, 3, 10), (284, -6, 1, 12)], C["bldC"]))
    L.append(rects("Tower windows", windows_day, C["win"]))
    # Battery Park City shore the towers stand on
    L.append(shape("Manhattan shore", [[(214, 121), (226, 112), (420, 112), (420, 124), (214, 124)]], C["wall2"]))
    L.append(rect("Shore edge", 226, 112, 200, 1, C["wall"]))
    # waterfront trees of the park in front of the towers (seasonal hedge)
    hedge = []
    for i in range(16):
        rr = random.Random(i)
        hx = 222 + i * 7 + rr.uniform(-2, 2)
        hedge.append(jag(hx, 112 + rr.uniform(-1, 1), 5.0, 1.0, 0.8, 12, rr, 0.25))
    hid = nid()
    L.append(shape("Park trees by the water", hedge, (0.18, 0.40, 0.20, 1), lid=hid))
    anim(hid, "fillColor", "var t=input.time.seconds;var c=rc(season(t)*0.92);var k=1-0.8*ss(21,27,t);return [c[0]*k+0.36*(1-k),c[1]*k+0.33*(1-k),c[2]*k+0.33*(1-k),1];",
         JS_HELPERS + PHASE_JS + LIGHT_JS + ramp_js("dark"))
    return L[::-1], windows_lit


# --------------------------------------------------------------------------------------
# Promenade plane (k = 0.8): railing, lamps, bench, seawall
# --------------------------------------------------------------------------------------
def build_promenade():
    L = []
    posts = [(x, 120, 1, 9) for x in range(-60, 380, 6)]
    rails = [(-60, 120, 440, 1), (-60, 124, 440, 0.8)]
    L.append(rects("Railing", posts + rails, C["rail"]))
    L.append(rect("Seawall cap", -60, 129, 440, 2, C["wall"]))
    L.append(rect("Seawall", -60, 131, 440, 3, C["wall2"]))
    lamps = []
    for lx in (22, 262):
        lamps += [(lx - 0.5, 98, 1, 31), (lx - 1.5, 127, 3, 2), (lx - 1.5, 96, 3, 3.5), (lx - 1, 95, 2, 1), (lx - 2, 99.2, 4, 0.8)]
    L.append(rects("Lamp posts", lamps, C["rail"]))
    bench = [(116, 124.5, 18, 1.2), (116, 126.6, 18, 1.0)]
    L.append(rects("Bench slats", bench, C["benchWood"]))
    L.append(rects("Bench frame", [(117, 124, 1, 7), (132, 124, 1, 7), (116, 128, 18, 0.8)], C["bench"]))
    return L[::-1]


# --------------------------------------------------------------------------------------
# Ground plane (k = 1): paving and lawn
# --------------------------------------------------------------------------------------
def build_ground():
    L = []
    gid = nid()
    L.append(rect("Lawn", -60, 140, 440, 80, C["grass"], lid=gid))
    anim(gid, "fillColor", "var t=input.time.seconds;var a=season(t);var c=cold(t);return [0.30+0.14*a-0.04*c,0.55-0.12*a-0.08*c,0.22-0.02*a+0.08*c,1];",
         JS_HELPERS + PHASE_JS + LIGHT_JS)
    r5 = random.Random(5)
    tufts = [(r5.uniform(-60, 380), r5.choice([142, 145, 149, 154, 160, 167, 175]), r5.randint(1, 3), 1) for _ in range(160)]
    tid = nid()
    L.append(rects("Lawn tufts", tufts, C["grass2"], lid=tid))
    anim(tid, "fillColor", "var t=input.time.seconds;var a=season(t);var c=cold(t);return [0.22+0.14*a-0.03*c,0.44-0.13*a-0.06*c,0.18-0.02*a+0.07*c,1];",
         JS_HELPERS + PHASE_JS + LIGHT_JS)
    L.append(rect("Promenade paving", -60, 134, 440, 7, C["pave"]))
    joints = [(x, 134, 0.6, 7) for x in range(-60, 380, 9)] + [(-60, 137.5, 440, 0.5)]
    L.append(rects("Paving joints", joints, C["pave2"]))
    L.append(rect("Lawn edge", -60, 140, 440, 1, C["grass2"]))
    # soft tree shadow on the lawn
    sh = nid()
    L.append({"type": "Shape", "id": sh, "name": "Tree shadow", "blendMode": "multiply", "activeRange": rng_ms(0, DUR),
                 "transform": tr((100 * S, 152 * S)),
                 "shape": {"path": {"commands": []}, "ellipse": {"size": [90 * S, 14 * S], "position": [0, 0]},
                           "fills": [fill((0.55, 0.62, 0.55, 1))]}})
    keys(sh, "opacity", [(0, 100, "lin"), (17, 100, "lin"), (26, 25, "ease")])
    return L[::-1]


# --------------------------------------------------------------------------------------
# Tree (k = 1): trunk + branches, canopy clusters, the hero leaf
# --------------------------------------------------------------------------------------
TRUNK_BASE = (92.0, 150.0)


def seg_poly(p0, p1, w0, w1):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    ln = math.hypot(dx, dy) or 1
    nx, ny = -dy / ln, dx / ln
    return [(p0[0] + nx * w0 / 2, p0[1] + ny * w0 / 2), (p1[0] + nx * w1 / 2, p1[1] + ny * w1 / 2),
            (p1[0] - nx * w1 / 2, p1[1] - ny * w1 / 2), (p0[0] - nx * w0 / 2, p0[1] - ny * w0 / 2)]


def bez(pts, n=8):
    """Catmull-Rom through pts."""
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for j in range(n):
            t = j / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
                                    (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in range(2)))
    out.append(pts[-1])
    return out


def build_tree():
    r = random.Random(42)
    polys = []
    hi_polys = []
    ends = []   # canopy anchor points
    # trunk with root flare
    trunk = [(80, 151), (85, 147), (87, 132), (87.5, 112), (88.5, 98), (92, 92), (97, 92), (99.5, 99), (99, 114),
             (98.5, 132), (100, 147), (106, 151)]
    polys.append(trunk)
    hi_polys.append([(86, 146), (87.6, 130), (88, 112), (89, 99), (90.6, 99), (90, 113), (89.6, 131), (88.5, 146)])

    def limb(pts, w0, w1, depth, hero=False):
        curve = bez(pts, 6)
        n = len(curve) - 1
        for i in range(n):
            a = w0 + (w1 - w0) * i / n
            b = w0 + (w1 - w0) * (i + 1) / n
            polys.append(seg_poly(curve[i], curve[i + 1], a, b))
            polys.append(circle_poly(curve[i + 1][0], curve[i + 1][1], b / 2, 6))
        if depth > 0:
            for i in range(2, n, 3 if depth > 1 else 2):
                p = curve[i]
                if hero and p[0] > 140:
                    continue
                d = (curve[i + 1][0] - curve[i - 1][0], curve[i + 1][1] - curve[i - 1][1])
                ang = math.atan2(d[1], d[0]) + r.choice([-1, 1]) * r.uniform(0.45, 0.95)
                ang -= 0.25 * math.cos(ang) * (1 if ang < 0 else 0)
                ln = r.uniform(7, 15) * (1 if depth > 1 else 0.6)
                q = (p[0] + math.cos(ang) * ln, p[1] + math.sin(ang) * ln - r.uniform(1, 4))
                m = ((p[0] + q[0]) / 2 + r.uniform(-1.5, 1.5), (p[1] + q[1]) / 2 + r.uniform(-1.5, 1.5))
                wb = max(0.6, (w0 + (w1 - w0) * i / n) * 0.55)
                limb([p, m, q], wb, 0.5, depth - 1)
        ends.append(curve[-1])
        ends.append(curve[len(curve) // 2])

    limb([(91, 96), (78, 82), (62, 66), (44, 54), (28, 46)], 5.5, 0.8, 2)
    limb([(92, 93), (86, 72), (80, 48), (74, 28), (70, 16)], 5.5, 0.8, 2)
    limb([(95, 92), (99, 70), (104, 46), (106, 26), (108, 12)], 5.5, 0.8, 2)
    limb([(97, 93), (112, 74), (124, 52), (136, 36), (146, 26)], 5.0, 0.8, 2)
    limb([(98, 100), (116, 88), (132, 78), (142, 73), (LEAF[0], LEAF[1])], 4.6, 0.9, 2, hero=True)
    limb([(90, 102), (74, 96), (58, 92), (46, 92)], 3.6, 0.7, 1)
    limb([(99, 104), (114, 100), (126, 100)], 2.6, 0.6, 1)

    branches = shape("Trunk and branches", polys, C["bark"])
    bark_hi = shape("Bark highlight", hi_polys, C["barkHi"])
    knots = rects("Bark texture", [(91, 120, 1, 3), (95, 108, 1, 2), (93, 136, 2, 1), (96, 128, 1, 3), (90, 102, 1, 2)], C["bark2"])

    # ---- canopy clusters --------------------------------------------------------------
    r = random.Random(9)
    pts = []
    for (x, y) in ends:
        if y < 104:
            pts.append((x, y))
    # fill the crown evenly
    for _ in range(70):
        a = r.uniform(0, 2 * math.pi)
        rr = math.sqrt(r.random())
        pts.append((96 + math.cos(a) * 62 * rr, 52 + math.sin(a) * 38 * rr))
    # thin to a minimum spacing
    chosen = []
    for p in sorted(pts, key=lambda p: r.random()):
        if all(math.hypot(p[0] - q[0], p[1] - q[1]) > 9.5 for q in chosen):
            chosen.append(p)
    # make sure there is a cluster on the hero leaf
    chosen = [q for q in chosen if math.hypot(q[0] - LEAF[0], q[1] - LEAF[1]) > 9]
    chosen.append((LEAF[0] - 1, LEAF[1] + 3))
    hero_idx = len(chosen) - 1

    # release schedule: a few during the time-lapse, the rest on the gusts, hero cluster last
    order = list(range(len(chosen)))
    order.remove(hero_idx)
    r.shuffle(order)
    # outer clusters first (higher distance from trunk centre goes earlier)
    order.sort(key=lambda i: -math.hypot(chosen[i][0] - 96, chosen[i][1] - 55) + r.uniform(-14, 14))
    release = {}
    early = order[:4]
    for j, i in enumerate(early):
        release[i] = 11.5 + j * 1.0
    rest = order[4:]
    for j, i in enumerate(rest):
        gi = min(len(GUSTS) - 1, int(j * len(GUSTS) / len(rest)))
        release[i] = GUSTS[gi][0] - 0.35 + r.uniform(0, 1.0)
    release[hero_idx] = 24.6

    clusters = []
    particles = []
    pal_js = {k: ramp_js(k) for k in RAMP}
    H = JS_HELPERS + PHASE_JS + LIGHT_JS
    for i, (x, y) in enumerate(chosen):
        rad = r.uniform(8.5, 11.5) if i != hero_idx else 7.5
        off = r.uniform(-0.12, 0.12)  # some clusters turn earlier
        rel = release[i]
        kids = []
        rr = random.Random(1000 + i)
        dark = [jag(0.12 * rad, 0.14 * rad, rad, 1.0, 0.82, 22, rr, 0.13)]
        mid = [jag(-0.1 * rad, -0.12 * rad, rad * 0.8, 1.0, 0.8, 18, rr, 0.14)]
        light = [jag(-0.38 * rad + rr.uniform(-1, 1), -0.42 * rad, rad * 0.36, 1.0, 0.75, 10, rr, 0.25),
                 jag(0.12 * rad, -0.55 * rad + rr.uniform(-1, 1), rad * 0.26, 1.0, 0.75, 9, rr, 0.25)]
        specks = []
        for _ in range(7):
            a = rr.uniform(0, 2 * math.pi)
            d = rr.uniform(0.2, 0.85) * rad
            specks.append([(math.cos(a) * d, math.sin(a) * d * 0.8), (math.cos(a) * d + 1, math.sin(a) * d * 0.8),
                           (math.cos(a) * d + 1, math.sin(a) * d * 0.8 + 1), (math.cos(a) * d, math.sin(a) * d * 0.8 + 1)])
        dspecks = []
        for _ in range(6):
            a = rr.uniform(0, 2 * math.pi)
            d = rr.uniform(0.1, 0.7) * rad
            x1, y1 = math.cos(a) * d, math.sin(a) * d * 0.7 + 0.2 * rad
            dspecks.append([(x1, y1), (x1 + 1, y1), (x1 + 1, y1 + 1), (x1, y1 + 1)])
        for tone, polys in (("light", light + specks), ("dark", dspecks), ("mid", mid), ("dark", dark)):
            lid = nid()
            kids.append(shape("Leaves %s" % tone, polys, RAMP[tone][0] + (1,), lid=lid))
            anim(lid, "fillColor", "var t=input.time.seconds;return rc(season(t)*1.08+(%f));" % off, H + pal_js[tone])
        gid = nid()
        g = group("Canopy cluster %d" % i, kids, transform=tr((x * S, y * S)), gid=gid, dur=min(DUR, rel + 1.2))
        clusters.append(g)
        ph = r.uniform(0, 6.28)
        anim(gid, "positionX", "var t=input.time.seconds;var w=wind(t);return (%f+Math.sin(t*1.7+%f)*(0.35+1.6*w)+w*1.2)*%d;" % (x, ph, S), JS_HELPERS)
        anim(gid, "positionY", "var t=input.time.seconds;return (%f+Math.sin(t*1.3+%f)*0.3)*%d;" % (y, ph, S), JS_HELPERS)
        for p in ("scaleX", "scaleY"):
            anim(gid, p, "var t=input.time.seconds;var k=1-ss(%f,%f,t);return 100*k;" % (rel, rel + 0.9), JS_HELPERS)
        # leaves this cluster sheds
        n_leaves = 7 if rel > 15 else 3
        s_at = ss(7.5, 18, rel) * 1.08 + off
        for j in range(n_leaves):
            t0 = rel + r.uniform(-0.2, 0.8)
            a = r.uniform(0, 2 * math.pi)
            x0, y0 = x + math.cos(a) * rad * 0.8, y + math.sin(a) * rad * 0.6
            tone = r.choice(["mid", "mid", "light", "dark"])
            particles.append((t0, x0, y0, ramp_py(tone, s_at + r.uniform(-0.05, 0.08)), wind_py(t0)))
    # hero leaf twig + leaf
    hero = build_hero()
    sway_kids = clusters[::-1] + [hero, knots, bark_hi, branches]
    sway = group("Tree sway", sway_kids, transform=tr((TRUNK_BASE[0] * S, TRUNK_BASE[1] * S), (TRUNK_BASE[0] * S, TRUNK_BASE[1] * S)))
    anim(sway["id"], "rotation", "var t=input.time.seconds;var w=wind(t);return Math.sin(t*1.1)*0.25+Math.sin(t*2.3)*0.12*w+w*0.5;", JS_HELPERS)
    return sway, particles


HERO_LEAF_POLY = None


def maple(cx, cy, size, ang):
    """A plane/maple leaf outline hanging along angle 'ang' (radians, 0 = down)."""
    # outline in local coords: stem at (0,0), leaf extends +y
    pts = [(0, 0), (0.12, 0.10), (0.30, 0.06), (0.52, 0.02), (0.44, 0.20), (0.62, 0.30), (0.46, 0.38),
           (0.50, 0.58), (0.30, 0.52), (0.20, 0.72), (0.10, 0.66), (0.0, 1.0), (-0.10, 0.66), (-0.20, 0.72),
           (-0.30, 0.52), (-0.50, 0.58), (-0.46, 0.38), (-0.62, 0.30), (-0.44, 0.20), (-0.52, 0.02), (-0.30, 0.06), (-0.12, 0.10)]
    ca, sa = math.cos(ang), math.sin(ang)
    out = []
    for (x, y) in pts:
        x, y = x * size, y * size
        out.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    return out


def build_hero():
    """The last leaf, its stem and seed. Anchored at the twig tip LEAF."""
    lx, ly = LEAF
    stem_end = (lx + 0.8, ly + 2.6)
    ang = -0.35  # tilt the hanging leaf slightly to the right
    body = maple(stem_end[0], stem_end[1], 9.0, ang)
    tip = (stem_end[0] - math.sin(ang) * 6.5, stem_end[1] + math.cos(ang) * 6.5)
    vein = [seg_poly(stem_end, tip, 0.5, 0.3)]
    hi = maple(stem_end[0] - 0.25, stem_end[1] + 0.2, 6.2, ang - 0.05)
    H = JS_HELPERS + PHASE_JS + LIGHT_JS
    body_id, hi_id = nid(), nid()
    leaf_body = shape("Hero leaf", [body], RAMP["mid"][0] + (1,), lid=body_id)
    leaf_hi = shape("Hero leaf light", [[body[0]] + body[11:]], RAMP["light"][0] + (1,), lid=hi_id)
    # the hero ends warm amber-red so it reads against the pale sky
    viv = "function viv(c,v,t){var k=ss(22,27,t);return [c[0]+(v[0]-c[0])*k,c[1]+(v[1]-c[1])*k,c[2]+(v[2]-c[2])*k,1];}"
    anim(body_id, "fillColor", "var t=input.time.seconds;return viv(rc(season(t)*0.93),[0.80,0.20,0.10],t);", H + viv + ramp_js("mid"))
    anim(hi_id, "fillColor", "var t=input.time.seconds;return viv(rc(season(t)*0.9),[1.0,0.45,0.16],t);", H + viv + ramp_js("light"))
    vein_l = shape("Hero leaf veins", vein, RAMP["dark"][0] + (1,), lid=nid())
    anim(vein_l["id"], "fillColor", "var t=input.time.seconds;return viv(rc(season(t)*0.95),[0.50,0.09,0.07],t);", H + viv + ramp_js("dark"))
    stem = shape("Hero stem", [seg_poly((lx, ly), stem_end, 0.8, 0.6)], C["bark2"])
    seed = ellipse("Seed", (lx + 1.3, ly + 1.1), (2.6, 2.9), C["seed"])
    seed_hi = ellipse("Seed glint", (lx + 0.85, ly + 0.55), (0.9, 0.9), C["seedHi"])
    gid = nid()
    g = group("Hero leaf (the player)", [seed_hi, seed, vein_l, leaf_hi, leaf_body, stem],
              transform=tr((lx * S, ly * S), (lx * S, ly * S)), gid=gid,
              desc="The last leaf and its seed. Rotation trembles with the wind.")
    anim(gid, "rotation", "var t=input.time.seconds;var w=wind(t);return Math.sin(t*2.1)*3+Math.sin(t*7.3)*(1.5+9*w)+Math.sin(t*13.1)*(0.5+5*w)*ss(24,30,t)+w*10;", JS_HELPERS)
    return g


def build_particles(particles):
    L = []
    for (t0, x0, y0, col, w0) in particles:
        life = 5.5
        lid = nid()
        size = random.Random(int(t0 * 1000) + int(x0)).choice([(3, 2), (2.5, 2.5), (3, 2.2), (2, 1.6)])
        L.append({"type": "Rect", "id": lid, "name": "Falling leaf", "blendMode": "normal",
                  "activeRange": rng_ms(t0, life), "transform": tr((x0 * S, y0 * S), (size[0] * S / 2, size[1] * S / 2)),
                  "rect": {"size": [size[0] * S, size[1] * S], "fillColor": list(col)}})
        rr = random.Random(lid)
        v = 6 + 22 * w0 + rr.uniform(0, 8)
        acc = 10 + 46 * w0 + rr.uniform(0, 10)
        fall = rr.uniform(7, 13)
        R = rr.uniform(3, 7)
        om = rr.uniform(2.5, 5.5)
        ph = rr.uniform(0, 6.28)
        lift = rr.uniform(0, 1) * w0 * 7
        anim(lid, "positionX", "var u=input.time.seconds;return (%f+%f*u+0.5*%f*u*u+%f*Math.sin(%f*u+%f))*%d;" % (x0, v, acc, R, om, ph, S))
        anim(lid, "positionY", "var u=input.time.seconds;return (%f+%f*u-%f*Math.sin(Math.min(u,1.8)*1.7)+%f*0.6*Math.cos(%f*u+%f)-%f*0.6)*%d;" % (y0, fall, lift, R, om, ph, R, S))
        anim(lid, "rotation", "var u=input.time.seconds;return %f+u*%f;" % (ph * 57, rr.choice([-1, 1]) * rr.uniform(200, 520)))
    # summer-to-autumn strays: a handful of single leaves drifting down during the lapse
    return L


def build_streaks():
    L = []
    r = random.Random(77)
    for gi, (g, a) in enumerate(GUSTS + [(27.5, 0.45), (30.5, 0.4), (33.6, 0.4)]):
        for k in range(4 if a > 0.5 else 2):
            lid = nid()
            t0 = g - 0.7 + r.uniform(0, 0.8)
            y = r.uniform(20, 120)
            w = r.uniform(8, 22)
            L.append({"type": "Rect", "id": lid, "name": "Wind streak", "blendMode": "normal",
                      "activeRange": rng_ms(t0, 1.6), "transform": tr((0, y * S), op=0),
                      "rect": {"size": [w * S, 0.8 * S], "fillColor": [0.95, 0.97, 1.0, 1]}})
            x0 = r.uniform(-30, 160)
            sp = r.uniform(120, 200)
            anim(lid, "positionX", "var u=input.time.seconds;return (%f+%f*u)*%d;" % (x0, sp, S))
            anim(lid, "positionY", "var u=input.time.seconds;return (%f+Math.sin(u*4+%f)*2)*%d;" % (y, r.uniform(0, 6), S))
            anim(lid, "opacity", "var u=input.time.seconds;return 55*Math.sin(Math.min(1,u/1.6)*3.14159)*%f;" % min(1, a + 0.2))
    return L


def build_snow():
    """Screen-space snow, starting with a single first flake."""
    L = []
    r = random.Random(31)
    flakes = [(28.6, 118, 1.5)]
    for i in range(34):
        flakes.append((30.0 + i * 0.36 + r.uniform(0, 0.3), r.uniform(-10, 330), r.choice([1, 1.5, 1.5, 2])))
    for (t0, x0, sz) in flakes:
        lid = nid()
        life = DUR - t0 + 0.5
        L.append({"type": "Rect", "id": lid, "name": "Snowflake", "blendMode": "normal",
                  "activeRange": rng_ms(t0, min(life, DUR - t0)), "transform": tr((x0 * S, -4 * S)),
                  "rect": {"size": [sz * S, sz * S], "fillColor": [0.97, 0.98, 1.0, 1]}})
        sp = r.uniform(9, 15) if sz == 1 else r.uniform(13, 19)
        ph = r.uniform(0, 6.28)
        y0 = -4 if t0 > 29 else 30
        # the first flake drifts down past the leaf
        anim(lid, "positionX", "var u=input.time.seconds;return (%f+Math.sin(u*0.9+%f)*4+u*2.2)*%d;" % (x0, ph, S))
        anim(lid, "positionY", "var u=input.time.seconds;var y=%f+%f*u;return ((y+10)%%200-10)*%d;" % (y0, sp, S))
    return L


def build_emissive(windows_lit):
    H = JS_HELPERS + PHASE_JS + LIGHT_JS
    wid = nid()
    win = rects("Lit windows", windows_lit, C["winLit"], lid=wid)
    anim(wid, "opacity", "var t=input.time.seconds;var n=1-dayL(t);return 100*ss(0.25,0.75,n)*(0.85+0.15*Math.sin(t*37));", H)
    lamps = []
    glows = []
    for lx in (22, 262):
        lamps.append((lx - 1, 96.5, 2, 2.5))
        glows.append(circle_poly(lx, 98, 4.5, 10))
    lid = nid()
    lamp = rects("Lamp lights", lamps, (1.0, 0.88, 0.55, 1), lid=lid)
    gl = nid()
    glow = shape("Lamp glow", glows, (1.0, 0.75, 0.40, 1), lid=gl, op=0)
    lamp_code = "var t=input.time.seconds;var n=1-dayL(t);return %s*ss(0.3,0.7,n);"
    anim(lid, "opacity", lamp_code % "100", H)
    anim(gl, "opacity", lamp_code % "28", H)
    return [camera_group("Emissive: skyline windows (k=0.5)", 0.5, [win]),
            camera_group("Emissive: lamps (k=0.8)", 0.8, [lamp, glow])]


# --------------------------------------------------------------------------------------
# Title: hand-drawn 5x7 pixel font as native vector squares
# --------------------------------------------------------------------------------------
FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["111", "010", "010", "010", "010", "010", "111"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    ".": ["0", "0", "0", "0", "0", "0", "1"],
    " ": ["000", "000", "000", "000", "000", "000", "000"],
}


def bold(g):
    return ["".join("1" if (c == "1" or (j > 0 and line[j - 1] == "1")) else "0" for j, c in enumerate(line + "0")) for line in g]


def text_boxes(text, x0, y0, px, is_bold=False):
    """Return per-glyph lists of boxes, and total width."""
    glyphs = []
    x = x0
    for ch in text:
        g = bold(FONT[ch]) if is_bold else FONT[ch]
        boxes = []
        for row, line in enumerate(g):
            for col, bit in enumerate(line):
                if bit == "1":
                    boxes.append((x + col * px, y0 + row * px, px, px))
        glyphs.append((ch, boxes))
        x += (len(g[0]) + 1) * px
    return glyphs, x - x0 - px


def text_width(text, px, is_bold=False):
    return sum((len(FONT[c][0]) + (2 if is_bold else 1)) * px for c in text) - px


def build_title():
    L = []
    title = "FAR FROM THE TREE"
    px = 2
    w = text_width(title, px, True)
    x0 = int(160 - w / 2)
    y0 = 14
    glyphs, _ = text_boxes(title, x0, y0, px, True)
    t_in, t_out = 35.8, 42.3
    k = 0
    for i, (ch, boxes) in enumerate(glyphs):
        if not boxes:
            continue
        shadow = [(bx + dx, by + dy, bw, bh) for (bx, by, bw, bh) in boxes for (dx, dy) in ((-1, 0), (1, 0), (0, -1), (0, 1), (1, 2), (2, 2))]
        lid = nid()
        g = group("Title letter %s" % ch, [rects("Glyph", boxes, (0.99, 0.95, 0.86, 1)),
                                            rects("Glyph outline", shadow, (0.13, 0.12, 0.20, 1))],
                  gid=lid)
        L.append(g)
        ts = t_in + k * 0.07
        k += 1
        keys(lid, "opacity", [(0, 0, "hold"), (ts, 0, "hold"), (ts + 0.07, 45, "hold"), (ts + 0.14, 100, "hold"),
                              (t_out, 100, "hold"), (t_out + 0.12 + 0.02 * i, 50, "hold"), (t_out + 0.3 + 0.02 * i, 0, "hold")])
        keys(lid, "positionY", [(0, -S, "hold"), (ts, -S, "hold"), (ts + 0.14, 0, "hold")])
    # subtitle in two lines, 1 art pixel per font pixel
    sub = ["THE LAST LEAF IN THE CITY.", "GET THE SEED TO CENTRAL PARK."]
    for li, line in enumerate(sub):
        w = text_width(line, 1)
        glyphs, _ = text_boxes(line, int(160 - w / 2), 150 + li * 10, 1)
        boxes = [b for _, bx in glyphs for b in bx]
        shadow = [(bx + 1, by + 1, bw, bh) for (bx, by, bw, bh) in boxes]
        lid = nid()
        L.append(group("Subtitle line %d" % (li + 1), [rects("Text", boxes, (0.96, 0.94, 0.90, 1)),
                                                        rects("Shadow", shadow, (0.08, 0.10, 0.16, 1), op=85)], gid=lid))
        ts = 37.6 + li * 0.9
        keys(lid, "opacity", [(0, 0, "hold"), (ts, 0, "hold"), (ts + 0.1, 35, "hold"), (ts + 0.2, 70, "hold"), (ts + 0.3, 100, "hold"),
                              (t_out - 0.2, 100, "hold"), (t_out, 50, "hold"), (t_out + 0.2, 0, "hold")])
    return group("Title card", L, desc="Pixel title built from native squares (5x7 hand-drawn font).")


# --------------------------------------------------------------------------------------
# Assemble
# --------------------------------------------------------------------------------------
def build():
    harbour = build_harbour()
    skyline, lit = build_skyline()
    prom = build_promenade()
    import sys as _sys, people
    p_lawn, p_prom, p_bench = people.make(_sys.modules[__name__])
    prom = p_bench + prom
    ground = build_ground()
    tree, particles = build_tree()
    leaves = build_particles(particles)
    streaks = build_streaks()
    snow = build_snow()
    emissive = build_emissive(lit)

    grade_id = 900
    world = group("World (graded by time of day)", [
        camera_group("Wind streaks (k=1)", 1.0, streaks),
        camera_group("Blowing leaves (k=1)", 1.0, leaves),
        camera_group("People on the lawn (k=1)", 1.0, p_lawn, desc="Kids, ball, leaf pile (in front of the tree)."),
        camera_group("Tree (k=1)", 1.0, [tree]),
        camera_group("People on the promenade (k=1)", 1.0, p_prom, desc="Couple, runners, dog walker, businessman, passers-by, winter walker."),
        camera_group("Ground (k=1)", 1.0, ground),
        camera_group("Promenade (k=0.8)", 0.8, prom),
        camera_group("Skyline (k=0.5)", 0.5, skyline),
        camera_group("Harbour + Statue of Liberty (k=0.3)", 0.3, harbour),
    ], effects=[{"id": grade_id, "effect": {"type": "customShader", "name": "dayGrade",
                                           "description": "Time-of-day light: multiplies the world by a tint and desaturates for the cold late-November look.",
                                           "wgsl": GRADE, "params": [
                                               {"name": "tint.colorR", "description": "Light tint red", "min": 0, "max": 1.5, "default": 1},
                                               {"name": "tint.colorG", "description": "Light tint green", "min": 0, "max": 1.5, "default": 1},
                                               {"name": "tint.colorB", "description": "Light tint blue", "min": 0, "max": 1.5, "default": 1},
                                               {"name": "desat", "description": "Desaturation 0..1 (cold)", "min": 0, "max": 1, "default": 0}]}}])
    H = JS_HELPERS + PHASE_JS + LIGHT_JS
    tint_js = ("var t=input.time.seconds;var e=sunE(t);var d=ss(-0.34,0.08,e);var g=d*(1-ss(0.0,0.36,e+0.08));var c=cold(t);"
               "var night=[0.30,0.34,0.54];var gold=[1.06,0.80,0.64];var cool=[0.90,0.94,1.0];"
               "var v=night[%d]+(1-night[%d])*d;v=v*(1+(gold[%d]-1)*g*(1-0.7*c));v=v*(1+(cool[%d]-1)*c);return v;")
    for i, ch in enumerate("RGB"):
        anim_fx(grade_id, "tint.color" + ch, tint_js % (i, i, i, i), H)
    anim_fx(grade_id, "desat", "return 0.3*cold(input.time.seconds);", H)

    sky_id, sky_fx = nid(), 901
    sky = {"type": "Rect", "id": sky_id, "name": "Sky (procedural)", "blendMode": "normal", "activeRange": rng_ms(0, DUR),
           "transform": tr(), "rect": {"size": [1920, 1080], "fillColor": [0.4, 0.6, 0.9, 1]},
           "effects": [{"id": sky_fx, "effect": {"type": "customShader", "name": "pixelSky",
                                                 "description": "Pixel-art sky: day/night gradient, sun and moon arcs, dusk glow, stars and drifting two-tone clouds.",
                                                 "wgsl": SKY, "params": [
                                                     {"name": "animationTime", "description": "Engine clock (s)", "min": 0, "max": 3600, "default": 0},
                                                     {"name": "phase", "description": "Time of day 0..1 (0.5 = noon); may exceed 1 (wraps)", "min": 0, "max": 1000, "default": 0.5},
                                                     {"name": "cloudShift", "description": "Cloud drift in art pixels", "min": 0, "max": 1000, "default": 0},
                                                     {"name": "cold", "description": "Late-November pale sky 0..1", "min": 0, "max": 1, "default": 0},
                                                     {"name": "cover", "description": "Cloud cover 0..1", "min": 0, "max": 1, "default": 0.4}]}}]}
    anim_fx(sky_fx, "phase", "return phase(input.time.seconds);", JS_HELPERS + PHASE_JS)
    anim_fx(sky_fx, "cloudShift", "return cloud(input.time.seconds);", JS_HELPERS + CLOUD_JS)
    anim_fx(sky_fx, "cold", "return cold(input.time.seconds);", H)
    anim_fx(sky_fx, "cover", "var t=input.time.seconds;return 0.42+0.12*ss(8,16,t)+0.06*ss(20,28,t);", H)

    pix_id = 902
    scene = group("Scene (pixel art)", [group("Snow (screen space)", snow)] + emissive + [world, sky],
                  effects=[{"id": pix_id, "effect": {"type": "customShader", "name": "pixelate",
                                                     "description": "Snaps the frame to a 320x180 art-pixel grid (block px) with medoid sampling and per-channel colour levels for a limited palette.",
                                                     "wgsl": PIXELATE, "params": [
                                                         {"name": "block", "description": "Art pixel size in canvas px", "min": 1, "max": 32, "default": S},
                                                         {"name": "levels", "description": "Colour levels per channel", "min": 2, "max": 64, "default": 18}]}}])
    title = build_title()
    layers = [title, scene] + AUDIO_LAYERS
    doc = {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
           "dimensions": {"width": 1920, "height": 1080}, "duration": DUR,
           "composition": {"id": "main", "name": "Far From the Tree - intro", "layers": layers,
                           "dynamics": {"entries": ENTRIES}}}
    return doc


AUDIO_LAYERS = []


def audio_layer(asset, name, vol, dur_ms):
    AUDIO_LAYERS.append({"type": "Audio", "id": nid(), "name": name,
                         "playback": playback(0, dur_ms / 1000.0), "sourceRange": {"start": 0, "duration": dur_ms},
                         "sourceIntrinsicDuration": dur_ms, "source": {"assetId": asset}, "volume": vol, "captionsEnabled": False})


if __name__ == "__main__":
    import sys
    stems = os.path.join(HERE, "audio", "stems.json")
    if "--audio" in sys.argv and os.path.exists(stems):
        for s in json.load(open(stems)):
            audio_layer(s["assetId"], s["name"], s["volume"], s["durationMs"])
            if s.get("envelope"):
                anim(AUDIO_LAYERS[-1]["id"], "volume", s["envelope"])
    doc = build()
    out = os.path.join(WORK, "editable.json")
    json.dump(doc, open(out, "w"), indent=None)
    print("days in lapse: %.2f  peak %.3f d/s  layers/entries: %d" % (DAYS, PEAK, len(ENTRIES)))
