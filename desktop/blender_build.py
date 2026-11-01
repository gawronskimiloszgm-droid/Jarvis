# Buduje projekt Studia 3D w Blenderze, bez okna: czesci z gotowych siatek, fazowanie i wygladzanie,
# wyciecia, materialy, render i animacja rozbierania. Dane to wylacznie liczby i napisy z pliku JSON;
# skrypt jest staly, nic z danych nie jest wykonywane jako kod.
import json
import math
import os
import sys
import time
import traceback

import bmesh
import bpy
from mathutils import Matrix, Vector


def progress(pct, text):
    print(f"JARVIS_PROGRESS {int(pct)} {text}", flush=True)


args = sys.argv[sys.argv.index("--") + 1:]
data = json.load(open(args[0], encoding="utf-8"))
out_dir = args[1]
opts = data.get("opcje", {})
parts = data["czesci"]
span = max(1.0, float(data.get("rozmiar", 1000)))
SF = 10.0 / span  # cala scena ma okolo 10 jednostek, niezaleznie od rozmiaru w mm
Y_UP = Matrix.Rotation(math.pi / 2, 4, "X")  # (x, y, z) projektu -> Blender z osia Z w gore
manifest = {"sf": SF, "pliki": {}, "uwagi": [], "czasy": {}}


def to_scene(v):
    return (Y_UP @ Vector((v[0] * SF, v[1] * SF, v[2] * SF, 1.0))).to_3d()


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
materials = {}
photo = data.get("zdjecie")
photo_mat = None
if photo:
    # Zdjecie-wzor na bokach czesci: te same piksele w tych samych miejscach co w podgladzie.
    try:
        image = bpy.data.images.load(os.path.join(out_dir, photo["plik"]))
        photo_mat = bpy.data.materials.new("Zdjecie")
        photo_mat.use_nodes = True
        tree = photo_mat.node_tree
        tex = tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        bsdf = tree.nodes.get("Principled BSDF")
        tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Metallic"].default_value = 0.15
        bsdf.inputs["Roughness"].default_value = 0.6
    except Exception as exc:
        manifest["uwagi"].append(f"Zdjęcie: {exc}")


def srgb(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material_for(p):
    key = (p.get("kolor", "#8fa6b8"), round(p.get("metal", 0.3), 2), round(p.get("szorstkosc", 0.55), 2))
    if key not in materials:
        m = bpy.data.materials.new(f"m{len(materials)}")
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        h = key[0].lstrip("#")
        bsdf.inputs["Base Color"].default_value = (srgb(int(h[0:2], 16) / 255), srgb(int(h[2:4], 16) / 255), srgb(int(h[4:6], 16) / 255), 1)
        bsdf.inputs["Metallic"].default_value = key[1]
        bsdf.inputs["Roughness"].default_value = key[2]
        materials[key] = m
    return materials[key]


def build_mesh(p):
    flat = p["siatka"]
    me = bpy.data.meshes.new(p["id"])
    bm = bmesh.new()
    lookup = {}
    tol = 1e-5 * 10.0

    def vert(i):
        co = (flat[i] * SF, flat[i + 1] * SF, flat[i + 2] * SF)
        key = (round(co[0] / tol), round(co[1] / tol), round(co[2] / tol))
        v = lookup.get(key)
        if v is None:
            v = bm.verts.new(co)
            lookup[key] = v
        return v

    for i in range(0, len(flat) - 8, 9):
        tri = [vert(i), vert(i + 3), vert(i + 6)]
        if len({id(t) for t in tri}) < 3:
            continue
        try:
            bm.faces.new(tri)
        except ValueError:
            pass  # powielona sciana (np. mostek otworu)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.normal_update()  # bez tego kat miedzy scianami wychodzi zero i wszystko sie wygladza
    if photo_mat and p.get("skora") and len(bm.verts):
        zs = [v.co.z for v in bm.verts]
        z_max, z_min = max(zs), min(zs)
        eps = (z_max - z_min) * 0.002 + 1e-6
        uv = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            # Czesc plaska: tylko strona ze zdjecia, bo na drugiej napisy bylyby w lustrzanym odbiciu.
            # Bryla obla nie ma plaskiej sciany: zdjecie na obu stronach (na drugiej jako odbicie), ranty bez niego.
            on_side = abs(f.normal.z) > 0.02 if p.get("oble") else (photo["flip"] > 0 and all(v.co.z > z_max - eps for v in f.verts)) or (photo["flip"] < 0 and all(v.co.z < z_min + eps for v in f.verts))
            if on_side:
                f.material_index = 1
                for loop in f.loops:
                    mm_x = loop.vert.co.x / SF + p["x"]
                    mm_y = loop.vert.co.y / SF + p["y"]
                    loop[uv].uv = ((mm_x / (photo["k"] * photo["flip"]) + photo["cx"]) / photo["w"], 1 - (photo["cy"] - mm_y / photo["k"]) / photo["h"])
    # Wygladzone sciany, ostre krawedzie zostaja ostre.
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = False
        else:
            try:
                e.smooth = e.calc_face_angle() < math.radians(35)
            except ValueError:
                e.smooth = False
    bm.to_mesh(me)
    tris = len(bm.faces)
    bm.free()
    return me, tris


collections = {}
objects = {}
cutters = []
t0 = time.time()
for idx, p in enumerate(parts):
    me, tris = build_mesh(p)
    ob = bpy.data.objects.new(p["id"], me)
    group = p.get("grupa", "Projekt")
    col = collections.get(group)
    if col is None:
        col = bpy.data.collections.new(group[:60])
        scene.collection.children.link(col)
        collections[group] = col
    col.objects.link(ob)
    me.materials.append(material_for(p))
    if photo_mat and p.get("skora"):
        me.materials.append(photo_mat)
    d = math.pi / 180
    pos = to_scene((p["x"], p["y"], p["z"]))
    # Macierz Rx*Ry*Rz jak w podgladzie, potem zamiana osi. Euler 'ZYX' w Blenderze to ten sam obrot.
    rot = Matrix.Rotation(p["rx"] * d, 4, "X") @ Matrix.Rotation(p["ry"] * d, 4, "Y") @ Matrix.Rotation(p["rz"] * d, 4, "Z")
    ob.matrix_world = Matrix.Translation(pos) @ Y_UP @ rot
    ob["nazwa"] = p.get("nazwa", p["id"])
    # Fazy projektu sa juz w siatce. Reszta dostaje mikrofaze, dzieki ktorej krawedzie lapia swiatlo.
    if not p.get("faza") and not p.get("gladki") and not p.get("oble") and tris < 3000:
        mod = ob.modifiers.new("Mikrofaza", "BEVEL")
        mod.width = 10.0 * 0.0007
        mod.segments = 1
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(40)
        mod.harden_normals = False
    if p.get("gladki") and tris < 6000:
        mod = ob.modifiers.new("Wygladzenie", "SUBSURF")
        mod.levels = 1
        mod.render_levels = 2
    if p.get("ciecie"):
        cutters.append(ob)
        ob.hide_render = True
        ob.hide_viewport = True
    objects[p["id"]] = ob
    if idx % 8 == 0:
        progress(5 + 20 * idx / max(1, len(parts)), f"Część {idx + 1} z {len(parts)}")

# Wyciecia dotycza czesci z tego samego podzespolu, ktore rzeczywiscie nachodza na bryle wycinajaca.
bpy.context.view_layer.update()


def world_box(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return [min(v[i] for v in pts) for i in range(3)], [max(v[i] for v in pts) for i in range(3)]


for c in cutters:
    lo, hi = world_box(c)
    cut_group = next(p for p in parts if p["id"] == c.name).get("grupa")
    for p in parts:
        ob = objects[p["id"]]
        if ob in cutters or p.get("grupa") != cut_group:
            continue
        a, b = world_box(ob)
        if all(a[i] <= hi[i] and lo[i] <= b[i] for i in range(3)):
            mod = ob.modifiers.new(f"Wyciecie {c.name}", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.solver = "EXACT"
            mod.object = c

visible = [objects[p["id"]] for p in parts if not p.get("ciecie")]
manifest["czasy"]["budowa"] = round(time.time() - t0, 1)
progress(28, "Eksport modelu")

# Model dla podgladu w aplikacji: wezly nazwane jak czesci, z zastosowanymi modyfikatorami.
glb = os.path.join(out_dir, "model.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_apply=True, export_yup=True, use_visible=True, export_animations=False, export_cameras=False, export_lights=False)
manifest["pliki"]["glb"] = "model.glb"

# ---------- animacja rozbierania ----------
steps = sorted({p.get("krok", 1) for p in parts if not p.get("ciecie")})
n_steps = max(1, len(steps))
STEP_FRAMES = max(8, min(24, 240 // n_steps))
OUT_FRAMES = STEP_FRAMES * n_steps
HOLD = 36
scene.frame_start = 1
scene.frame_end = 1 + OUT_FRAMES + HOLD + OUT_FRAMES
scene.render.fps = 24

min_z = float("inf")
for p in parts:
    if p.get("ciecie"):
        continue
    ob = objects[p["id"]]
    base = ob.location.copy()
    off = p.get("rozst") or [0, 0, 0]
    dest = base + (Y_UP @ Vector((off[0] * SF, off[1] * SF, off[2] * SF, 1.0))).to_3d()
    order = n_steps - 1 - steps.index(p.get("krok", 1))
    start = 1 + order * STEP_FRAMES
    end = start + STEP_FRAMES
    back_start = 1 + OUT_FRAMES + HOLD + (n_steps - 1 - order) * STEP_FRAMES
    back_end = back_start + STEP_FRAMES
    for frame, where in ((1, base), (start, base), (end, dest), (back_start, dest), (back_end, base)):
        ob.location = where
        ob.keyframe_insert("location", frame=frame)
    ob.location = base
    min_z = min(min_z, world_box(ob)[0][2] + (dest.z - base.z))

progress(34, "Scena i światła")

# ---------- swiatlo, podloga, kamera ----------
low = [min(world_box(o)[0][i] for o in visible) for i in range(3)]
high = [max(world_box(o)[1][i] for o in visible) for i in range(3)]
center = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2))
radius = max(0.5, (Vector(high) - Vector(low)).length / 2)
extras = bpy.data.collections.new("Scena")
scene.collection.children.link(extras)

world = bpy.data.worlds.new("Tlo")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.5, 0.6, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = world

floor_mat = bpy.data.materials.new("Podloga")
floor_mat.use_nodes = True
floor_bsdf = floor_mat.node_tree.nodes.get("Principled BSDF")
floor_bsdf.inputs["Base Color"].default_value = (0.03, 0.045, 0.065, 1)
floor_bsdf.inputs["Roughness"].default_value = 0.55
floor_bsdf.inputs["Metallic"].default_value = 0.0
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=radius * 60)
floor_me = bpy.data.meshes.new("Podloga")
bm.to_mesh(floor_me)
bm.free()
floor_me.materials.append(floor_mat)
floor = bpy.data.objects.new("Podloga", floor_me)
floor.location = (center.x, center.y, min(low[2], min_z) - radius * 0.01)
extras.objects.link(floor)


def add_light(name, kind, loc, energy, size, color):
    li = bpy.data.lights.new(name, kind)
    li.energy = energy
    li.color = color
    if kind == "AREA":
        li.size = size
    ob = bpy.data.objects.new(name, li)
    ob.location = loc
    extras.objects.link(ob)
    direction = center - Vector(loc)
    ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return ob


# Energia swiatla obszarowego rosnie z kwadratem odleglosci, stad radius**2.
# Kamera patrzy od strony ze zdjecia; +1 to strona +Z projektu (w Blenderze -Y).
VIEW_SIDE = -1 if photo and photo.get("flip", 1) < 0 else 1
key = center + Vector((radius * 2.2, -radius * 2.4 * VIEW_SIDE, radius * 2.8))
fill = center + Vector((-radius * 3.0, -radius * 1.2 * VIEW_SIDE, radius * 1.2))
rim = center + Vector((-radius * 0.5, radius * 3.2 * VIEW_SIDE, radius * 2.0))
add_light("Glowne", "AREA", key, 300 * radius ** 2, radius * 2.2, (1.0, 0.96, 0.9))
add_light("Wypelniajace", "AREA", fill, 110 * radius ** 2, radius * 3, (0.72, 0.84, 1.0))
add_light("Kontra", "AREA", rim, 220 * radius ** 2, radius * 1.6, (0.3, 0.8, 1.0))

cam_data = bpy.data.cameras.new("Kamera")
cam_data.lens = 50
cam_data.clip_end = radius * 200
cam = bpy.data.objects.new("Kamera", cam_data)
extras.objects.link(cam)
scene.camera = cam
target = bpy.data.objects.new("Cel", None)
target.location = center
extras.objects.link(target)
con = cam.constraints.new("TRACK_TO")
con.target = target
con.track_axis = "TRACK_NEGATIVE_Z"
con.up_axis = "UP_Y"


def frame_camera(lo, hi):
    # Odleglosc z narozy obrysu: 50 mm to okolo 40 stopni w poziomie i 23 w pionie. Dlugi przedmiot z boku.
    c = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
    target.location = c
    long_x = (hi[0] - lo[0]) >= (hi[1] - lo[1])
    d = (Vector((0.42, -0.87 * VIEW_SIDE, 0.26)) if long_x else Vector((0.87, -0.42 * VIEW_SIDE, 0.26))).normalized()
    right = Vector((0, 0, 1)).cross(d).normalized()
    up = d.cross(right).normalized()
    tan_h = math.tan(math.radians(19.8))
    tan_v = math.tan(math.radians(11.45))
    dist = 0.0
    for x in (lo[0], hi[0]):
        for y in (lo[1], hi[1]):
            for z in (lo[2], hi[2]):
                rel = Vector((x, y, z)) - c
                dist = max(dist, abs(rel.dot(right)) / tan_h + rel.dot(d), abs(rel.dot(up)) / tan_v + rel.dot(d))
    cam.location = c + d * (dist * 1.06)


def enable_gpu():
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
            try:
                prefs.compute_device_type = backend
            except TypeError:
                continue
            prefs.get_devices()
            found = [d for d in prefs.devices if d.type == backend]
            if found:
                for d in prefs.devices:
                    d.use = d.type == backend
                scene.cycles.device = "GPU"
                return backend
    except Exception as exc:
        manifest["uwagi"].append(f"GPU: {exc}")
    scene.cycles.device = "CPU"
    return "CPU"


def render_still(name, frame, lo, hi, samples, res):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.max_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    scene.frame_set(frame)
    frame_camera(lo, hi)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(out_dir, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    manifest["pliki"][name] = f"{name}.png"


scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"

if opts.get("render", True):
    manifest["silnik"] = enable_gpu()
    try:
        t1 = time.time()
        progress(42, f"Render ({manifest['silnik']})")
        render_still("podglad", 1, low, high, opts.get("probki", 48), (1280, 720))
        manifest["czasy"]["podglad"] = round(time.time() - t1, 1)
        t1 = time.time()
        progress(62, "Render rozłożonego modelu")
        # Rozlozony model: kamera obejmuje wszystko, co wyjechalo.
        scene.frame_set(1 + OUT_FRAMES)
        bpy.context.view_layer.update()
        lo2 = [min(world_box(o)[0][i] for o in visible) for i in range(3)]
        hi2 = [max(world_box(o)[1][i] for o in visible) for i in range(3)]
        render_still("rozlozony", 1 + OUT_FRAMES, lo2, hi2, opts.get("probki", 48), (1280, 720))
        manifest["czasy"]["rozlozony"] = round(time.time() - t1, 1)
    except Exception:
        manifest["uwagi"].append("Render się nie udał: " + traceback.format_exc()[-300:])
else:
    scene.frame_set(1 + OUT_FRAMES)
    bpy.context.view_layer.update()
    lo2 = [min(world_box(o)[0][i] for o in visible) for i in range(3)]
    hi2 = [max(world_box(o)[1][i] for o in visible) for i in range(3)]

scene.frame_set(1)
frame_camera(lo2, hi2)

# Plik do dalszej pracy: otwierany w Blenderze ma juz animacje na osi czasu.
progress(70, "Zapis pliku Blendera")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "projekt.blend"))
manifest["pliki"]["blend"] = "projekt.blend"

# Osobne STL kazdej czesci, w skali repliki: gotowe do krojenia.
if opts.get("stl", True) and len(visible) <= 500:
    progress(74, "Pliki STL części")
    stl_dir = os.path.join(out_dir, "czesci_stl")
    os.makedirs(stl_dir, exist_ok=True)
    k = (1.0 / SF) / max(1.0, float(data.get("skala", 1)))
    try:
        for ob in visible:
            for o in bpy.context.view_layer.objects:
                o.select_set(False)
            ob.select_set(True)
            safe = "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in str(ob.get("nazwa", ob.name)))[:60]
            bpy.ops.wm.stl_export(filepath=os.path.join(stl_dir, f"{safe}_{ob.name}.stl"), export_selected_objects=True, apply_modifiers=True, global_scale=k, forward_axis="Y", up_axis="Z")
        manifest["pliki"]["stl"] = "czesci_stl"
    except Exception:
        manifest["uwagi"].append("STL się nie udał: " + traceback.format_exc()[-300:])

# ---------- wideo ----------
if opts.get("wideo"):
    t1 = time.time()
    try:
        progress(78, "Wideo rozbierania")
        try:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
            scene.eevee.taa_render_samples = 16
        except TypeError:
            scene.render.engine = "CYCLES"
            scene.cycles.samples = 12
        scene.render.resolution_x, scene.render.resolution_y = (1280, 720)
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
        scene.render.filepath = os.path.join(out_dir, "rozbieranie.mp4")
        frame_camera(lo2, hi2)
        total = scene.frame_end

        def on_frame(sc, _dep=None):
            if sc.frame_current % 6 == 0:
                progress(78 + 20 * sc.frame_current / total, f"Wideo: klatka {sc.frame_current} z {total}")

        bpy.app.handlers.render_post.append(on_frame)
        bpy.ops.render.render(animation=True)
        manifest["pliki"]["wideo"] = "rozbieranie.mp4"
        manifest["czasy"]["wideo"] = round(time.time() - t1, 1)
    except Exception:
        manifest["uwagi"].append("Wideo się nie udało: " + traceback.format_exc()[-300:])

json.dump(manifest, open(os.path.join(out_dir, "wynik.json"), "w", encoding="utf-8"), ensure_ascii=False)
progress(100, "Gotowe")
