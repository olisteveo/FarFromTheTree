"""
The street closures' modelled pieces (world/blockers.ts, drawn by src/render/blockers.ts).

Run headless (idle priority, 8 threads):  tools/closures/run.cmd        (or: blender -b -t 8 --factory-startup --python closures_blender.py)
Writes web/public/models/closures.glb and a contact-sheet render tools/closures/previews/closures.png.

Everything is flat vertex colour (no textures: lean on phones). Each piece is one object, metres, origin on the
ground under it (unless noted), modelled with Blender -Y forward and +Z up, which glTF turns into three.js +Z
forward and +Y up. Material slots: "paint" (vertex colours, lit), "glow_a" / "glow_b" (flashing red / blue
lights: the game pulses them out of phase), "glow_c" (amber, flashing), "glow_d" (floodlights, steady), "glass".

  scaffold_bay    one bay of tube-and-fitting scaffold: 2.5 m wide (x 0..2.5), 2 m tall, 1.2 m deep (forward)
  crane_mast      a 3 m section of tower-crane mast, 2 m square
  crane_top       the slewing top: cab, 46 m jib along +x, counter-jib with counterweights, apex and ties
                  (origin at the top of the mast)
  crane_load      a bundle of steel beams on slings (origin at the hook, the load hangs below)
  hook            the hook block (origin at its top)
  nypd_truck      an NYPD box truck, lightbar on the cab
  dsny_truck      a sanitation collection truck, amber beacons
  dep_truck       a DEP emergency utility truck (water mains), amber and red lights
  bike_rack       a steel crowd-control barricade, 2.4 m
  sawhorse        a blue police sawhorse barricade, 2.4 m
  water_barrier   an orange water-filled road barrier, 1.8 m
  cone            a traffic cone
  hydrant         an NYC fire hydrant
  cab             a yellow cab (the one sinking into the burst main's crater)
  slab_a/b/c      broken slabs of asphalt
  scaffold_bay_lo the scaffold bay for phones (square tubes, one deck)
  scaffold_base   sole boards and base plates under a bay
  ladder          an aluminium ladder up one lift
  jersey          a concrete jersey barrier, 3 m
  barrel          an orange-and-white traffic drum with its amber lamp
  warning_lamp    an amber site lamp on a bracket
  work_light      a crew's light mast trailer (floodlights: glow_d, steady)
  fdny_engine     an FDNY pumper, red and white, ladder on top, lights going
  sandbags        a low wall of sandbags, 2.4 m
  aframe          an orange ROAD CLOSED A-frame sign
  worker          a crew member in hi-vis and a hard hat
  shed_bay        a bay of NYC sidewalk shed: posts, deck, green plywood parapet, lights under (2.5 x 5.5 m)
  concrete_pump   a truck-mounted concrete pump (the boom is drawn by the game)
  grandstand      parade bleachers, 8 m wide, 5 rows
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(WEB, "public", "models", "closures.glb")
PREV = os.path.join(HERE, "previews")

# ------------------------------------------------------------------------------------------- palette
C = {
    "galv": (0.58, 0.6, 0.62), "galv_dk": (0.36, 0.38, 0.4), "plank": (0.52, 0.42, 0.28), "plank_dk": (0.38, 0.3, 0.2),
    "crane": (0.93, 0.72, 0.08), "crane_dk": (0.55, 0.42, 0.05), "concrete": (0.6, 0.6, 0.58), "black": (0.06, 0.06, 0.07),
    "white": (0.9, 0.91, 0.92), "nypd": (0.08, 0.2, 0.55), "nypd_lt": (0.25, 0.45, 0.85), "tyre": (0.05, 0.05, 0.05),
    "rim": (0.6, 0.6, 0.6), "steel": (0.3, 0.31, 0.33), "rust": (0.42, 0.2, 0.1), "green": (0.12, 0.42, 0.25),
    "orange": (0.95, 0.38, 0.05), "red": (0.72, 0.08, 0.06), "cab": (0.97, 0.74, 0.08), "asphalt": (0.13, 0.13, 0.14),
    "asphalt_lt": (0.2, 0.2, 0.21), "base": (0.33, 0.29, 0.25), "yellow_paint": (0.9, 0.75, 0.15), "silver": (0.75, 0.76, 0.78),
    "seat": (0.16, 0.2, 0.32), "bunting_o": (0.92, 0.45, 0.08), "bunting_b": (0.4, 0.22, 0.1), "bunting_g": (0.95, 0.75, 0.2),
    "dark": (0.12, 0.12, 0.13), "glass": (0.08, 0.1, 0.13), "light_r": (1, 0.12, 0.08), "light_b": (0.15, 0.35, 1),
    "light_a": (1, 0.6, 0.1), "head": (1, 0.95, 0.8),
}


def lin(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


class Mesh:
    def __init__(self):
        self.v, self.f, self.col, self.mat = [], [], [], []
        self.mats = []
        self.M = Matrix.Identity(4)

    def m(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def face(self, pts, col, mat="paint"):
        base = len(self.v)
        for p in pts:
            self.v.append(tuple(self.M @ Vector(p)))
        self.f.append(tuple(range(base, base + len(pts))))
        self.col.append(lin(C[col] if isinstance(col, str) else col))
        self.mat.append(self.m(mat))

    def box(self, c, s, col, mat="paint", rot=None, taper=1.0):
        """box at centre c, size s; rot: a Matrix applied about its centre; taper scales the top face"""
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        R = rot or Matrix.Identity(3)
        def P(x, y, z):
            k = taper if z > 0 else 1.0
            return Vector(c) + R @ Vector((x * k, y * k, z))
        v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)]
        for ids in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
            self.face([v[i] for i in ids], col, mat)

    def tube(self, a, b, r, col, n=6, mat="paint"):
        a, b = Vector(a), Vector(b)
        d = b - a
        if d.length < 1e-6:
            return
        d.normalize()
        t = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        s = d.cross(t).normalized()
        u = d.cross(s).normalized()
        ring = lambda o: [o + (s * math.cos(2 * math.pi * i / n) + u * math.sin(2 * math.pi * i / n)) * r for i in range(n)]
        ra, rb = ring(a), ring(b)
        for i in range(n):
            j = (i + 1) % n
            self.face([ra[i], ra[j], rb[j], rb[i]], col, mat)
        self.face(list(reversed(ra)), col, mat)
        self.face(rb, col, mat)

    def cyl(self, c, r, h, col, n=10, axis="z", mat="paint", r2=None):
        """a cylinder (or cone, r2) centred at c along an axis"""
        c = Vector(c)
        ax = {"x": Vector((1, 0, 0)), "y": Vector((0, 1, 0)), "z": Vector((0, 0, 1))}[axis]
        t = Vector((0, 0, 1)) if axis != "z" else Vector((1, 0, 0))
        s = ax.cross(t).normalized(); u = ax.cross(s).normalized()
        r2 = r if r2 is None else r2
        a, b = c - ax * h / 2, c + ax * h / 2
        ra = [a + (s * math.cos(2 * math.pi * i / n) + u * math.sin(2 * math.pi * i / n)) * r for i in range(n)]
        rb = [b + (s * math.cos(2 * math.pi * i / n) + u * math.sin(2 * math.pi * i / n)) * r2 for i in range(n)]
        for i in range(n):
            j = (i + 1) % n
            self.face([ra[i], ra[j], rb[j], rb[i]], col, mat)
        self.face(list(reversed(ra)), col, mat)
        if r2 > 1e-4:
            self.face(rb, col, mat)

    def build(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        ca = me.color_attributes.new("Color", "FLOAT_COLOR", "CORNER")
        for n_ in self.mats:
            me.materials.append(material(n_))
        for poly in me.polygons:
            poly.material_index = self.mat[poly.index]
            poly.use_smooth = False
            c = self.col[poly.index]
            for li in poly.loop_indices:
                ca.data[li].color = (*c, 1.0)
        me.color_attributes.active_color = ca
        me.color_attributes.render_color_index = 0
        me.validate(clean_customdata=False)
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        TRIS[name] = sum(len(p.vertices) - 2 for p in me.polygons)
        return ob


TRIS = {}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.diffuse_color = (1, 1, 1, 1)
    return m


def rz(a):
    return Matrix.Rotation(a, 3, "Z")


def rx(a):
    return Matrix.Rotation(a, 3, "X")


def ry(a):
    return Matrix.Rotation(a, 3, "Y")


# =========================================================================================== pieces

def scaffold_bay():
    B = Mesh()
    W, H, D = 2.5, 2.0, 1.2
    r = 0.026
    for x in (0, W):
        for y in (0, -D):
            B.tube((x, y, 0), (x, y, H), r, "galv")
    for y in (0, -D):
        B.tube((0, y, H), (W, y, H), r, "galv")          # ledgers
        B.tube((0, y, 1.0), (W, y, 1.0), r * 0.9, "galv")  # guard rail / mid ledger
    for x in (0, W):
        B.tube((x, 0, H), (x, -D, H), r, "galv")          # transoms
    B.tube((0, -D, 0), (W, -D, H), r * 0.9, "galv_dk")   # facade brace (outer face, -y = forward)
    # the deck: five boards with a gap or two, and a toe board
    for i in range(5):
        y0 = -0.04 - i * 0.235
        B.box((W / 2, y0 - 0.1, H + 0.04), (W - 0.06, 0.2, 0.05), "plank" if i % 2 else "plank_dk")
    B.box((W / 2, -D + 0.02, H + 0.13), (W - 0.06, 0.03, 0.17), "plank_dk")
    # couplers
    for x in (0, W):
        for y in (0, -D):
            B.box((x, y, H), (0.08, 0.08, 0.08), "galv_dk")
    return B.build("scaffold_bay")


def crane_mast():
    B = Mesh()
    S, H = 2.0, 3.0
    h = S / 2
    corners = [(-h, -h), (h, -h), (h, h), (-h, h)]
    for x, y in corners:
        B.tube((x, y, 0), (x, y, H), 0.07, "crane", 6)
    for i in range(4):
        (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % 4]
        B.tube((x0, y0, 0.05), (x1, y1, 0.05), 0.035, "crane", 5)
        B.tube((x0, y0, 0.05), (x1, y1, H / 2), 0.03, "crane", 5)
        B.tube((x1, y1, H / 2), (x0, y0, H - 0.05), 0.03, "crane", 5)
    # the ladder up the inside
    B.tube((0.3, -0.5, 0), (0.3, -0.5, H), 0.02, "crane_dk", 4)
    B.tube((-0.3, -0.5, 0), (-0.3, -0.5, H), 0.02, "crane_dk", 4)
    return B.build("crane_mast")


def lattice(B, x0, x1, w, hgt, z0, col="crane", step=2.0, top=True):
    """a triangular lattice boom along x from x0 to x1: two bottom chords w apart, one top chord hgt up"""
    for y in (-w / 2, w / 2):
        B.tube((x0, y, z0), (x1, y, z0), 0.06, col, 5)
    if top:
        B.tube((x0, 0, z0 + hgt), (x1, 0, z0 + hgt), 0.06, col, 5)
    n = max(1, int(abs(x1 - x0) / step))
    for i in range(n):
        a = x0 + (x1 - x0) * i / n
        b = x0 + (x1 - x0) * (i + 1) / n
        B.tube((a, -w / 2, z0), (a, w / 2, z0), 0.03, col, 4)
        if top:
            for y in (-w / 2, w / 2):
                B.tube((a, y, z0), ((a + b) / 2, 0, z0 + hgt), 0.03, col, 4)
                B.tube(((a + b) / 2, 0, z0 + hgt), (b, y, z0), 0.03, col, 4)


def crane_top():
    B = Mesh()
    # turntable and slewing unit
    B.cyl((0, 0, 0.4), 1.4, 0.8, "crane_dk", 12)
    B.box((0, 0, 1.3), (2.4, 2.4, 1.0), "crane")
    # the cab, on the jib side, white with a dark windscreen
    B.box((1.2, -1.6, 1.6), (1.6, 1.4, 2.0), "white")
    B.box((1.95, -1.6, 1.8), (0.1, 1.2, 1.2), "glass", "glass")
    # jib (46 m) and counter-jib (14 m)
    lattice(B, 1.0, 46.0, 1.6, 1.8, 2.0)
    lattice(B, -1.0, -14.0, 2.2, 0.0, 2.0, top=False)
    B.box((-7.5, 0, 2.05), (13, 2.4, 0.12), "steel")         # counter-jib walkway
    for i in range(4):                                       # concrete counterweights
        B.box((-11.0 - i * 0.75, 0, 0.9), (0.7, 2.2, 2.2), "concrete")
    B.box((-4.5, 0, 2.7), (2.5, 1.8, 1.2), "crane_dk")      # the hoist winch house
    # the apex (cat head) and pendant ties
    for y in (-0.9, 0.9):
        B.tube((-1.0, y, 1.8), (0, 0, 9.5), 0.08, "crane", 6)
        B.tube((1.0, y, 1.8), (0, 0, 9.5), 0.08, "crane", 6)
    B.tube((0, 0, 9.5), (30, 0, 3.8), 0.035, "dark", 4)
    B.tube((0, 0, 9.5), (14, 0, 3.8), 0.035, "dark", 4)
    B.tube((0, 0, 9.5), (-13, 1.0, 2.1), 0.035, "dark", 4)
    B.tube((0, 0, 9.5), (-13, -1.0, 2.1), 0.035, "dark", 4)
    # jib tip and the red aircraft lights
    B.box((46.2, 0, 2.6), (0.4, 1.8, 1.4), "crane")
    B.box((0, 0, 9.8), (0.3, 0.3, 0.3), "light_r", "glow_a")
    B.box((46.3, 0, 3.5), (0.3, 0.3, 0.3), "light_r", "glow_a")
    return B.build("crane_top")


def crane_load():
    B = Mesh()
    # spreader bar and four slings down to a bundle of I-beams 7 m long
    B.box((0, 0, -0.6), (0.3, 3.4, 0.2), "crane")
    for y in (-1.6, 1.6):
        B.tube((0, 0, 0), (0, y, -0.6), 0.03, "dark", 4)
        for x in (-2.8, 2.8):
            B.tube((0, y, -0.6), (x, y * 0.35, -3.0), 0.025, "dark", 4)
    for i, (y, z) in enumerate([(-0.45, -3.2), (0, -3.2), (0.45, -3.2), (-0.22, -2.85), (0.22, -2.85)]):
        col = "rust"
        B.box((0, y, z), (7.0, 0.04, 0.3), col)             # web
        B.box((0, y, z + 0.16), (7.0, 0.3, 0.03), col)      # flanges
        B.box((0, y, z - 0.16), (7.0, 0.3, 0.03), col)
    return B.build("crane_load")


def hook():
    B = Mesh()
    B.box((0, 0, -0.5), (0.6, 0.35, 1.0), "crane")
    B.box((0, 0, -0.5), (0.62, 0.2, 0.25), "black")
    B.cyl((0, 0, -1.2), 0.08, 0.5, "steel", 6)
    B.tube((0, 0, -1.45), (0.25, 0, -1.75), 0.06, "steel", 5)
    B.tube((0.25, 0, -1.75), (0.05, 0, -1.95), 0.06, "steel", 5)
    return B.build("hook")


def wheels(B, xs, track, R=0.5, w=0.3):
    for x in xs:
        for s in (-1, 1):
            B.cyl((s * track / 2, x, R), R, w, "tyre", 10, axis="x")
            B.cyl((s * (track / 2 + w / 2 + 0.005), x, R), R * 0.55, 0.02, "rim", 8, axis="x")


def lightbar(B, x0, y, z, w, a="glow_a", b="glow_b", ca="light_r", cb="light_b"):
    B.box((x0, y, z), (w, 0.35, 0.06), "black")
    n = 4
    for i in range(n):
        x = x0 - w / 2 + (i + 0.5) * w / n
        left = i < n / 2
        B.box((x, y, z + 0.1), (w / n - 0.04, 0.3, 0.14), ca if left else cb, a if left else b)


def nypd_truck():
    """box truck, 7.6 m, forward is -y"""
    B = Mesh()
    L0 = -3.8
    # cab (front at y = -3.8)
    B.box((0, -2.75, 1.55), (2.4, 2.1, 1.9), "white")
    B.box((0, -3.82, 1.95), (2.2, 0.06, 0.8), "glass", "glass")              # windscreen
    for s in (-1, 1):
        B.box((s * 1.205, -2.9, 2.0), (0.04, 1.0, 0.65), "glass", "glass")   # side windows
        B.box((s * 1.21, -2.5, 1.2), (0.03, 2.0, 0.28), "nypd")              # blue band on the door
    B.box((0, -3.81, 0.95), (2.3, 0.08, 0.5), "dark")                          # grille / bumper
    for s in (-1, 1):
        B.box((s * 0.85, -3.83, 1.15), (0.35, 0.04, 0.18), "head", "glow_c")
    # the box body
    B.box((0, 0.85, 1.85), (2.5, 5.0, 2.9), "white")
    for s in (-1, 1):
        B.box((s * 1.255, 0.85, 1.55), (0.03, 4.9, 0.55), "nypd")             # the broad blue band
        B.box((s * 1.26, 0.85, 1.92), (0.03, 4.9, 0.08), "nypd_lt")
        B.box((s * 1.26, 0.85, 2.7), (0.03, 2.4, 0.42), "nypd")               # NYPD panel
    B.box((0, 3.36, 1.85), (2.4, 0.04, 2.7), "galv")                           # roller door
    B.box((0, 0.85, 0.35), (2.2, 5.0, 0.3), "dark")                            # chassis
    wheels(B, [-2.75, 2.1], 2.1)
    lightbar(B, 0, -2.6, 2.55, 1.9)
    for s in (-1, 1):                                                            # beacons on the box corners
        B.box((s * 1.1, 3.25, 3.35), (0.18, 0.18, 0.12), "light_r" if s < 0 else "light_b", "glow_a" if s < 0 else "glow_b")
    return B.build("nypd_truck")


def dsny_truck():
    """a rear-loading collection truck, 9.4 m, forward is -y"""
    B = Mesh()
    # low cab-forward cab
    B.box((0, -3.9, 1.6), (2.5, 1.9, 2.4), "white")
    B.box((0, -4.86, 2.0), (2.3, 0.06, 1.0), "glass", "glass")
    for s in (-1, 1):
        B.box((s * 1.255, -3.95, 2.1), (0.04, 1.2, 0.8), "glass", "glass")
    B.box((0, -4.88, 0.85), (2.4, 0.1, 0.5), "dark")
    B.box((0, -3.9, 1.0), (2.52, 1.9, 0.18), "green")
    for s in (-1, 1):
        B.box((s * 0.9, -4.9, 1.2), (0.3, 0.04, 0.16), "head", "glow_c")
    # the body: tall, slightly tapered, with the green stripe
    B.box((0, -0.4, 2.05), (2.5, 5.0, 3.0), "white", taper=0.97)
    for s in (-1, 1):
        B.box((s * 1.255, -0.4, 1.0), (0.03, 5.0, 0.22), "green")
        B.box((s * 1.255, -0.4, 3.05), (0.03, 5.0, 0.12), "green")
    # the rear hopper and packer
    B.box((0, 3.1, 1.75), (2.45, 2.0, 2.6), "galv", rot=rx(0.12))
    B.box((0, 4.05, 1.0), (2.3, 0.3, 0.9), "dark")
    B.box((0, 4.2, 0.55), (2.3, 0.2, 0.12), "galv_dk")                         # riding step
    B.box((0, -0.4, 0.4), (2.2, 8.0, 0.3), "dark")
    wheels(B, [-3.9, 1.3, 2.4], 2.1)
    for s in (-1, 1):
        B.box((s * 0.9, -4.0, 2.88), (0.25, 0.25, 0.16), "light_a", "glow_c")
        B.box((s * 1.0, 4.15, 3.2), (0.2, 0.2, 0.14), "light_a", "glow_c")
    return B.build("dsny_truck")


def dep_truck():
    """a utility crew truck with a ladder rack and lockers, 6.8 m, forward is -y"""
    B = Mesh()
    B.box((0, -2.3, 1.45), (2.3, 2.0, 1.7), "white")
    B.box((0, -3.32, 1.85), (2.1, 0.06, 0.75), "glass", "glass")
    for s in (-1, 1):
        B.box((s * 1.155, -2.45, 1.85), (0.04, 0.9, 0.6), "glass", "glass")
        B.box((s * 1.16, -2.0, 1.1), (0.03, 1.8, 0.2), "orange")
    B.box((0, -3.33, 0.85), (2.2, 0.1, 0.45), "dark")
    for s in (-1, 1):
        B.box((s * 0.8, -3.36, 1.05), (0.3, 0.04, 0.16), "head", "glow_c")
    # the locker body with orange chevrons on the back
    B.box((0, 1.1, 1.35), (2.4, 4.3, 1.9), "white")
    for s in (-1, 1):
        B.box((s * 1.205, 1.1, 1.0), (0.03, 4.2, 0.25), "orange")
        for k in range(4):
            B.box((s * 1.21, -0.5 + k * 1.05, 1.6), (0.03, 0.9, 0.9), "galv")      # locker doors
    for k in range(5):
        B.box((-0.8 + k * 0.4, 3.26, 1.3), (0.18, 0.03, 1.0), "orange" if k % 2 else "white", rot=ry(0.6))
    # ladder rack and a ladder
    for y in (-0.6, 2.8):
        B.box((0, y, 2.45), (2.3, 0.08, 0.08), "galv")
    for s in (-0.4, 0.4):
        B.box((s, 1.1, 2.55), (0.06, 4.0, 0.06), "galv_dk")
    B.box((0, 0.2, 0.35), (2.0, 6.4, 0.3), "dark")
    wheels(B, [-2.3, 2.1], 2.0, R=0.45)
    lightbar(B, 0, -2.2, 2.35, 1.7, "glow_c", "glow_a", "light_a", "light_r")
    return B.build("dep_truck")


def bike_rack():
    """steel crowd-control barricade, 2.4 m long along x, 1.1 m tall"""
    B = Mesh()
    L, H = 2.4, 1.1
    B.tube((-L / 2, 0, 0.12), (L / 2, 0, 0.12), 0.022, "galv", 5)
    B.tube((-L / 2, 0, H), (L / 2, 0, H), 0.022, "galv", 5)
    for x in (-L / 2, L / 2):
        B.tube((x, 0, 0.12), (x, 0, H), 0.022, "galv", 5)
    for i in range(1, 12):
        x = -L / 2 + L * i / 12
        B.tube((x, 0, 0.12), (x, 0, H), 0.01, "galv", 4)
    for x in (-L / 2 + 0.2, L / 2 - 0.2):
        B.box((x, 0, 0.03), (0.06, 0.8, 0.04), "galv_dk")
        B.tube((x, 0, 0.05), (x, 0, 0.12), 0.02, "galv_dk", 4)
    return B.build("bike_rack")


def sawhorse():
    """NYPD blue sawhorse, 2.4 m along x"""
    B = Mesh()
    B.box((0, 0, 0.95), (2.4, 0.05, 0.25), "nypd")
    B.box((0, 0.028, 0.95), (2.2, 0.01, 0.06), "white")
    for x in (-0.95, 0.95):
        for s in (-1, 1):
            B.box((x, s * 0.22, 0.47), (0.08, 0.05, 1.0), "nypd", rot=rx(s * 0.45))
        B.box((x, 0, 0.82), (0.1, 0.2, 0.08), "nypd")
    return B.build("sawhorse")


def water_barrier():
    B = Mesh()
    B.box((0, 0, 0.45), (1.8, 0.5, 0.9), "orange", taper=0.7)
    B.box((0, 0, 0.92), (1.3, 0.22, 0.06), "white")
    for x in (-0.5, 0.5):
        B.box((x, 0, 0.62), (0.4, 0.4, 0.12), "white")
    return B.build("water_barrier")


def cone():
    B = Mesh()
    B.box((0, 0, 0.02), (0.38, 0.38, 0.04), "black")
    B.cyl((0, 0, 0.38), 0.15, 0.68, "orange", 10, r2=0.025)
    B.cyl((0, 0, 0.45), 0.105, 0.12, "white", 10, r2=0.085)
    return B.build("cone")


def hydrant():
    B = Mesh()
    B.cyl((0, 0, 0.05), 0.2, 0.1, "red", 10)
    B.cyl((0, 0, 0.42), 0.13, 0.65, "red", 10)
    B.cyl((0, 0, 0.78), 0.16, 0.08, "silver", 10)
    B.cyl((0, 0, 0.87), 0.12, 0.12, "silver", 10, r2=0.05)
    for s in (-1, 1):
        B.cyl((s * 0.17, 0, 0.5), 0.06, 0.14, "silver", 8, axis="x")
    B.cyl((0, -0.17, 0.45), 0.08, 0.14, "silver", 8, axis="y")
    return B.build("hydrant")


def cab():
    """a yellow cab, 4.9 m, forward is -y"""
    B = Mesh()
    B.box((0, 0, 0.62), (1.85, 4.9, 0.7), "cab")
    B.box((0, 0.25, 1.22), (1.7, 2.4, 0.55), "cab", taper=0.88)
    B.box((0, -0.92, 1.2), (1.6, 0.06, 0.48), "glass", "glass", rot=rx(-0.7))
    B.box((0, 1.45, 1.2), (1.6, 0.06, 0.45), "glass", "glass", rot=rx(0.7))
    for s in (-1, 1):
        B.box((s * 0.86, 0.25, 1.24), (0.03, 2.1, 0.4), "glass", "glass")
        B.box((s * 0.93, 0, 0.6), (0.02, 4.6, 0.1), "black")             # checker line
    B.box((0, 0.3, 1.58), (0.8, 0.25, 0.28), "white")                       # roof sign
    B.box((0, -2.46, 0.6), (1.7, 0.06, 0.25), "dark")
    for s in (-1, 1):
        B.box((s * 0.6, -2.47, 0.75), (0.3, 0.03, 0.12), "head", "glow_c")
    wheels(B, [-1.45, 1.45], 1.55, R=0.33, w=0.22)
    return B.build("cab")


def slab(name, seed):
    import random
    rnd = random.Random(seed)
    B = Mesh()
    n = 6
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + rnd.uniform(-0.3, 0.3)
        r = rnd.uniform(0.7, 1.3)
        pts.append((math.cos(a) * r, math.sin(a) * r))
    t = 0.32
    top = [(x, y, t) for x, y in pts]
    bot = [(x * 0.95, y * 0.95, 0) for x, y in pts]
    B.face(top, "asphalt")
    B.face(list(reversed(bot)), "base")
    for i in range(n):
        j = (i + 1) % n
        B.face([bot[i], bot[j], top[j], top[i]], "base")
    if seed % 2:
        B.box((0, 0, t + 0.005), (1.4, 0.12, 0.01), "yellow_paint")
    return B.build(name)


def grandstand():
    """parade bleachers: 8 m wide along x, five rows rising backwards (+y), facing -y (the street)"""
    B = Mesh()
    W = 8.0
    for i in range(5):
        y, z = i * 0.8, 0.5 + i * 0.45
        B.box((0, y + 0.3, z), (W, 0.4, 0.06), "seat")                     # seat plank
        B.box((0, y - 0.05, z - 0.25), (W, 0.4, 0.05), "galv_dk")          # foot board
        B.box((0, y + 0.48, z - 0.22), (W, 0.04, 0.45), "galv_dk")         # riser
    for x in (-W / 2, -W / 4, 0, W / 4, W / 2):
        B.tube((x, -0.2, 0), (x, -0.2, 0.3), 0.04, "galv", 5)
        B.tube((x, 3.7, 0), (x, 3.7, 2.8), 0.04, "galv", 5)
        B.tube((x, -0.2, 0.3), (x, 3.7, 2.4), 0.035, "galv", 5)
    B.tube((-W / 2, 3.7, 3.2), (W / 2, 3.7, 3.2), 0.03, "galv", 5)           # back rail
    for s in (-1, 1):
        B.tube((s * W / 2, -0.2, 0.9), (s * W / 2, 3.7, 3.2), 0.03, "galv", 5)
    # bunting along the front
    cols = ["bunting_o", "bunting_b", "bunting_g"]
    for k in range(10):
        x = -W / 2 + (k + 0.5) * W / 10
        B.face([(x - 0.38, -0.25, 0.42), (x + 0.38, -0.25, 0.42), (x, -0.26, 0.05)], cols[k % 3])
        B.face([(x + 0.38, -0.24, 0.42), (x - 0.38, -0.24, 0.42), (x, -0.23, 0.05)], cols[k % 3])
    return B.build("grandstand")


def scaffold_bay_lo():
    """the phone version: square tubes, no couplers, one deck slab"""
    B = Mesh()
    W, H, D = 2.5, 2.0, 1.2
    r = 0.03
    for x in (0, W):
        for y in (0, -D):
            B.tube((x, y, 0), (x, y, H), r, "galv", 4)
    for y in (0, -D):
        B.tube((0, y, H), (W, y, H), r, "galv", 4)
        B.tube((0, y, 1.0), (W, y, 1.0), r, "galv", 4)
    B.tube((0, -D, 0), (W, -D, H), r, "galv_dk", 4)
    B.box((W / 2, -D / 2, H + 0.04), (W - 0.06, D - 0.05, 0.05), "plank")
    B.box((W / 2, -D + 0.02, H + 0.13), (W - 0.06, 0.03, 0.17), "plank_dk")
    return B.build("scaffold_bay_lo")


def scaffold_base():
    """sole boards and base plates under a bay's feet (2.5 x 1.2)"""
    B = Mesh()
    for y in (0, -1.2):
        B.box((1.25, y, 0.02), (2.9, 0.24, 0.04), "plank_dk")
        for x in (0, 2.5):
            B.box((x, y, 0.05), (0.16, 0.16, 0.02), "galv_dk")
            B.tube((x, y, 0.05), (x, y, 0.3), 0.02, "galv_dk", 5)
    return B.build("scaffold_base")


def ladder():
    """an aluminium ladder up one 2 m lift, leaning in the bay (origin at its foot)"""
    B = Mesh()
    for x in (-0.22, 0.22):
        B.box((x, 0, 1.15), (0.05, 0.08, 2.4), "silver", rot=rx(0.18))
    for k in range(8):
        z = 0.2 + k * 0.29
        B.box((0, -math.sin(0.18) * (z - 1.15), z), (0.44, 0.04, 0.035), "silver")
    return B.build("ladder")


def jersey():
    """a concrete jersey barrier, 3 m along x, 0.82 m tall, with lifting holes"""
    B = Mesh()
    L = 3.0
    prof = [(-0.3, 0), (-0.3, 0.08), (-0.22, 0.25), (-0.08, 0.82), (0.08, 0.82), (0.22, 0.25), (0.3, 0.08), (0.3, 0)]
    for i in range(len(prof) - 1):
        (y0, z0), (y1, z1) = prof[i], prof[i + 1]
        B.face([(-L / 2, y0, z0), (L / 2, y0, z0), (L / 2, y1, z1), (-L / 2, y1, z1)], "concrete")
    for x in (-L / 2, L / 2):
        pts = [(x, y, z) for y, z in prof]
        B.face(pts if x > 0 else list(reversed(pts)), "concrete")
    B.box((0, 0, 0.83), (L - 0.4, 0.17, 0.02), (0.5, 0.5, 0.48))
    for x in (-0.9, 0.9):
        B.box((x, 0, 0.12), (0.25, 0.62, 0.1), "dark")
    return B.build("jersey")


def barrel():
    """an orange-and-white traffic drum with a black base"""
    B = Mesh()
    B.cyl((0, 0, 0.05), 0.4, 0.1, "black", 12)
    for k in range(5):
        B.cyl((0, 0, 0.16 + k * 0.17), 0.29 - k * 0.006, 0.17, "orange" if k % 2 == 0 else "white", 12)
    B.cyl((0, 0, 1.0), 0.25, 0.08, "orange", 12, r2=0.18)
    B.box((0, 0, 1.08), (0.14, 0.14, 0.1), "light_a", "glow_c")
    return B.build("barrel")


def warning_lamp():
    """an amber site lamp on a bracket clamped to a tube (origin at the clamp)"""
    B = Mesh()
    B.box((0, 0, 0), (0.1, 0.1, 0.1), "galv_dk")
    B.box((0, -0.15, 0.06), (0.04, 0.3, 0.04), "galv_dk")
    B.cyl((0, -0.32, 0.16), 0.11, 0.18, "light_a", 10, mat="glow_c")
    B.cyl((0, -0.32, 0.03), 0.12, 0.06, "black", 10)
    return B.build("warning_lamp")


def work_light():
    """a crew's light mast: a trailer, a telescopic pole, four floodlights (origin on the ground)"""
    B = Mesh()
    B.box((0, 0, 0.7), (1.3, 2.4, 0.9), "cab")
    B.box((0, 0, 1.17), (1.32, 2.42, 0.05), "dark")
    for s in (-1, 1):
        B.cyl((s * 0.72, 0.3, 0.32), 0.32, 0.2, "tyre", 10, axis="x")
    B.cyl((0, -0.6, 4.2), 0.07, 6.2, "galv", 8)
    B.box((0, -0.6, 7.2), (1.6, 0.12, 0.12), "galv_dk")
    for x in (-0.6, -0.2, 0.2, 0.6):
        B.box((x, -0.68, 7.42), (0.34, 0.12, 0.28), "dark")
        B.box((x, -0.745, 7.42), (0.28, 0.02, 0.22), "head", "glow_d")
    return B.build("work_light")


def fdny_engine():
    """an FDNY pumper, 9.6 m, red with a white band, forward is -y"""
    B = Mesh()
    B.box((0, -3.6, 1.75), (2.5, 2.3, 2.5), "red")                               # cab
    B.box((0, -4.76, 2.25), (2.3, 0.06, 1.0), "glass", "glass")
    for s_ in (-1, 1):
        B.box((s_ * 1.255, -3.4, 2.3), (0.04, 1.6, 0.8), "glass", "glass")
        B.box((s_ * 1.26, -0.4, 1.3), (0.03, 8.6, 0.18), "white")              # the white band
        for k in range(4):
            B.box((s_ * 1.26, -1.6 + k * 1.3, 1.85), (0.03, 1.1, 0.9), "silver")  # compartment doors
    B.box((0, -4.8, 0.95), (2.4, 0.12, 0.6), "silver")                          # bumper
    for s_ in (-1, 1):
        B.box((s_ * 0.85, -4.85, 1.25), (0.35, 0.04, 0.2), "head", "glow_c")
    B.box((0, 0.6, 1.6), (2.5, 6.4, 2.2), "red")                                # body
    B.box((0, 0.6, 2.75), (2.2, 6.0, 0.1), "galv")                              # hose bed lid
    for s_ in (-0.5, 0.5):
        B.box((s_, 0.8, 3.05), (0.12, 6.4, 0.08), "silver")                     # the ladder on top
    for k in range(12):
        B.box((0, -2.2 + k * 0.55, 3.05), (1.0, 0.06, 0.06), "silver")
    B.box((0, -0.4, 0.45), (2.2, 9.0, 0.3), "dark")
    wheels(B, [-3.6, 2.2, 3.4], 2.1, R=0.52)
    lightbar(B, 0, -3.5, 3.05, 2.0, "glow_a", "glow_c", "light_r", "light_a")
    return B.build("fdny_engine")


def sandbags():
    """a low wall of sandbags, 2.4 m along x"""
    B = Mesh()
    for row in range(3):
        n = 6 - row
        for k in range(n):
            x = -1.2 + (k + 0.5 + row * 0.5) * 2.4 / 6
            B.box((x, 0, 0.1 + row * 0.18), (0.42, 0.3, 0.18), (0.62, 0.55, 0.4) if (k + row) % 2 else (0.56, 0.5, 0.36), taper=0.85)
    return B.build("sandbags")


def aframe():
    """an orange A-frame ROAD CLOSED sign (the sign face: a white band on orange, faces -y)"""
    B = Mesh()
    for s_ in (-1, 1):
        B.box((0, s_ * 0.3, 0.6), (1.2, 0.04, 1.25), "orange", rot=rx(s_ * 0.25))
        B.box((0, s_ * 0.3 - s_ * 0.02, 0.85), (1.0, 0.03, 0.3), "white", rot=rx(s_ * 0.25))
        B.box((0, s_ * 0.3 - s_ * 0.02, 0.4), (1.0, 0.03, 0.12), "black", rot=rx(s_ * 0.25))
    return B.build("aframe")


def worker():
    """a utility crew member in hi-vis and a hard hat, about 1.78 m (origin at the feet, facing -y)"""
    B = Mesh()
    for s_ in (-1, 1):
        B.box((s_ * 0.11, 0, 0.42), (0.15, 0.18, 0.84), "seat")                 # legs (navy work trousers)
        B.box((s_ * 0.11, -0.04, 0.05), (0.15, 0.28, 0.1), "black")             # boots
        B.box((s_ * 0.27, 0, 1.12), (0.11, 0.13, 0.55), "orange", rot=ry(s_ * 0.15))  # arms
    B.box((0, 0, 1.15), (0.44, 0.26, 0.62), "orange")                            # hi-vis jacket
    for z in (1.0, 1.25):
        B.box((0, -0.135, z), (0.45, 0.01, 0.05), "silver")                      # reflective bands
    B.box((0, 0, 1.55), (0.2, 0.22, 0.24), (0.78, 0.6, 0.48))                    # head
    B.cyl((0, 0, 1.7), 0.14, 0.1, "white", 10)                                   # hard hat
    B.cyl((0, -0.02, 1.65), 0.17, 0.02, "white", 10)
    return B.build("worker")


def shed_bay():
    """one bay of a NYC sidewalk shed: 2.5 m wide (x 0..2.5), 5.5 m deep (forward edge at y 0, back to y 5.5), the
    deck at 3 m with the classic green-painted plywood parapet along its front edge, lights under the deck"""
    B = Mesh()
    W, D, H = 2.5, 5.5, 3.0
    green, green_dk = (0.12, 0.33, 0.2), (0.08, 0.24, 0.14)
    for x in (0.08, W - 0.08):
        for y in (0.1, D - 0.1):
            B.box((x, y, H / 2), (0.12, 0.12, H), green_dk)                  # steel posts, painted
            B.box((x, y, 0.02), (0.3, 0.3, 0.04), "galv_dk")                  # base plates
    for y in (0.1, D - 0.1):
        B.box((W / 2, y, H - 0.12), (W, 0.12, 0.24), green_dk)               # beams
    for x in (0.08, W - 0.08):
        B.box((x, D / 2, H - 0.1), (0.1, D, 0.2), green_dk)
        B.box((x, D / 2, H * 0.55), (0.05, D * 0.9, 0.05), green_dk, rot=rx(0.45))   # bracing
    B.box((W / 2, D / 2, H + 0.08), (W, D, 0.16), "plank")                   # the deck
    B.box((W / 2, D / 2, H - 0.02), (W - 0.1, D - 0.1, 0.02), green)         # its painted underside
    B.box((W / 2, 0.0, H + 0.6), (W, 0.06, 1.05), green)                      # parapet (front)
    B.box((W / 2, 0.03, H + 1.1), (W, 0.14, 0.06), green_dk)
    B.box((W / 2, D, H + 0.4), (W, 0.06, 0.65), green)                        # back rail
    for y in (1.4, 4.1):
        B.box((W / 2, y, H - 0.06), (0.5, 0.18, 0.05), "head", "glow_d")      # the lights under the deck
    return B.build("shed_bay")


def concrete_pump():
    """a truck-mounted concrete pump, 10.5 m, forward is -y; the boom is drawn by the game (origin on the ground,
    the boom turret at (0, 1.8, 3.5))"""
    B = Mesh()
    B.box((0, -4.2, 1.6), (2.5, 2.0, 2.3), "white")
    B.box((0, -5.22, 2.0), (2.3, 0.06, 0.9), "glass", "glass")
    for s_ in (-1, 1):
        B.box((s_ * 1.255, -4.2, 2.1), (0.04, 1.2, 0.7), "glass", "glass")
    B.box((0, -5.24, 0.9), (2.4, 0.1, 0.5), "dark")
    B.box((0, 0.6, 1.1), (2.5, 7.6, 0.6), "crane")                          # the yellow body and boom rest
    B.box((0, 1.4, 1.9), (1.6, 3.0, 1.0), "crane_dk")                         # the hopper and pump
    B.cyl((0, 1.8, 2.6), 0.9, 1.0, "crane", 12)                               # turret
    for y in (-2.4, 3.6):                                                     # outriggers, down
        for s_ in (-1, 1):
            B.box((s_ * 2.2, y, 0.9), (2.2, 0.3, 0.3), "crane", rot=ry(s_ * 0.35))
            B.box((s_ * 3.2, y, 0.15), (0.5, 0.5, 0.3), "dark")
    B.box((0, 4.6, 1.0), (2.2, 1.2, 1.0), "galv")                             # the hopper at the back
    B.box((0, 0, 0.4), (2.2, 9.6, 0.3), "dark")
    wheels(B, [-4.2, 1.5, 2.8], 2.1, R=0.52)
    for s_ in (-1, 1):
        B.box((s_ * 0.9, -4.3, 2.85), (0.25, 0.25, 0.16), "light_a", "glow_c")
    return B.build("concrete_pump")


def textures():
    """the Tesseract renders -> web/public/textures/closures: the hoarding as JPEG, the netting PNG (alpha) as is"""
    import shutil
    out = os.path.join(WEB, "public", "textures", "closures")
    os.makedirs(out, exist_ok=True)
    src = os.path.join(HERE, "tesseract", "Hoarding", "Hoarding.png")
    if os.path.exists(src):
        img = bpy.data.images.load(src)
        sc = bpy.context.scene
        sc.render.image_settings.file_format = "JPEG"
        sc.render.image_settings.quality = 84
        img.save_render(os.path.join(out, "hoarding.jpg"), scene=sc)
        sc.render.image_settings.file_format = "PNG"
    net = os.path.join(HERE, "tesseract", "Netting", "Netting.png")
    if os.path.exists(net):
        shutil.copyfile(net, os.path.join(out, "netting.png"))


def main():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    obs = [scaffold_bay(), scaffold_bay_lo(), scaffold_base(), ladder(), jersey(), barrel(), warning_lamp(), work_light(), crane_mast(), crane_top(), fdny_engine(), sandbags(), aframe(), worker(), shed_bay(), concrete_pump(), crane_load(), hook(), nypd_truck(), dsny_truck(), dep_truck(),
           bike_rack(), sawhorse(), water_barrier(), cone(), hydrant(), cab(), slab("slab_a", 1), slab("slab_b", 2),
           slab("slab_c", 3), grandstand()]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in obs:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True,
                              export_materials="EXPORT", export_image_format="NONE", export_normals=True,
                              export_texcoords=False, export_yup=True, export_animations=False, export_vertex_color="ACTIVE")
    print("wrote", OUT, os.path.getsize(OUT), "bytes;", sum(TRIS.values()), "tris:", TRIS)
    textures()
    if "--no-previews" in sys.argv:
        return
    # a contact sheet: everything laid out in a row, lit, workbench with vertex colours
    x = 0.0
    big = {"crane_top": 62, "crane_mast": 4, "grandstand": 10, "dsny_truck": 5, "nypd_truck": 5, "dep_truck": 5}
    for ob in obs:
        w = big.get(ob.name, 3.5)
        ob.location = (x + (14 if ob.name == "crane_top" else 0), 0, 0 if ob.name not in ("crane_load", "hook") else 4)
        x += w
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "VERTEX"
    sc.render.resolution_x, sc.render.resolution_y = 2400, 900
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = x + 10
    cam.location = (x / 2, -60, 22)
    cam.rotation_euler = (math.radians(78), 0, 0)
    sc.camera = cam
    os.makedirs(PREV, exist_ok=True)
    sc.render.filepath = os.path.join(PREV, "closures.png")
    bpy.ops.render.render(write_still=True)
    # and a close one of the small things
    cam.data.ortho_scale = 34
    cam.location = (x - 40, -40, 9)
    cam.rotation_euler = (math.radians(80), 0, 0)
    sc.render.filepath = os.path.join(PREV, "closures_small.png")
    bpy.ops.render.render(write_still=True)


main()
