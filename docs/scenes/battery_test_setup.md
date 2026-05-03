# Battery Test Scene — Setup Walkthrough

**Goal:** A harbour-themed scene that's just rich enough to feel like Battery Park, but simple enough to debug if the leaf physics misbehaves. Build this first, then iterate toward the real Battery Park scene.

This is not the final tutorial scene — it's the **first proper flight test in context**. Greybox primitives + maybe one community asset for the Statue silhouette.

## What you'll have at the end

- A sandy plane (the park ground)
- A flat blue plane below (visible water on three sides — south, east, west)
- A tall brown column (placeholder tree)
- An optional tall grey pyramid in the distance (placeholder Statue silhouette)
- The leaf hovering above the tree
- 3 wind zones forming a rough corridor heading north (toward where Chinatown will be)
- The chase camera following the leaf

## Steps

### 0. Save as a new scene

1. **File → Save Scene As** → `Assets/scenes/battery_test.scene`
2. From here on, you're editing this new scene. The original `minimal.scene` stays untouched.

### 1. Tidy the existing scene

1. In Hierarchy, **delete the 3 Cube GameObjects** (we don't need them)
2. Select the **Plane** GameObject
   - In Inspector, find the ModelRenderer's Tint
   - Change Tint to a **sandy beige**: roughly RGB `0.85, 0.75, 0.55`
3. Select the **Sun** (DirectionalLight)
   - Rotation: leave default for now
   - LightColor: warm white is fine

### 2. Add the water

1. **Hierarchy → + → Create Object → Empty**, name `Water`
2. Add Component: **Model Renderer**
   - Model: `models/dev/plane.vmdl`
   - Tint: deep blue, roughly RGB `0.15, 0.35, 0.55`
3. Set Local Position: `(0, 0, -50)` (just below the sand plane)
4. Set Local Scale: `(50, 50, 1)` so it spreads wide on all sides
5. **Don't** add a collider — the leaf shouldn't collide with water (it'd just die in it eventually, but not in this test)

### 3. Add the tree (placeholder)

1. **Create Object → Empty**, name `Tree`
2. Local Position: `(0, 0, 0)` (sitting on the sand)
3. Add Component: **Model Renderer**
   - Model: `models/dev/box.vmdl`
   - Tint: dark brown, roughly RGB `0.3, 0.2, 0.1`
4. Set Scale: `(0.3, 0.3, 4)` — thin tall column ~120cm wide × 4m tall
5. Add Component: **Box Collider** (so leaf doesn't pass through trunk)

### 4. Add the leaf

(Same as the README "Editor setup" section — repeated here for completeness.)

1. **Create Object → Empty**, name `Leaf`
2. Local Position: `(0, 0, 200)` — high above the tree, plenty of fall space
3. Add Component: **Model Renderer**
   - Model: `models/dev/box.vmdl`
   - Tint: warm orange/red, roughly RGB `0.9, 0.4, 0.2`
   - Scale on the **renderer** stays at 1; we set physical scale via Transform
4. Local Scale: `(0.3, 0.5, 0.05)` — leaf-shaped flat plate
5. Add Component: **Box Collider** (defaults are fine)
6. Add Component: **Rigidbody**
   - Gravity: ✓
   - LinearDamping: `0`
   - AngularDamping: `0.5`
7. Add Component: **Leaf Controller**
   - Body: should auto-populate (drag the Leaf's own Rigidbody if not)
   - Leave all other properties at default

### 5. Add wind zones

We want three in a row going north, simulating the harbour breeze pushing you toward Chinatown.

#### WindZone 1: gentle lift right under the tree

1. **Create Object → Empty**, name `Wind_TreeLift`
2. Local Position: `(0, 0, 100)` (centred over the tree, mid-height)
3. Add Component: **Box Collider**
   - **IsTrigger: ✓** (CRITICAL — without this, leaf slams into wall)
   - Scale: `(200, 200, 200)` — chunky lift volume
4. Add Component: **Wind Zone**
   - Direction: `(0, 0, 1)` (pure upward)
   - Strength: `1500`

#### WindZone 2: north-pushing breeze

1. **Create Object → Empty**, name `Wind_NorthBreeze`
2. Local Position: `(400, 0, 150)`  *(400 units = ~1m at default Source 2 unit scale ≈ ~25cm; positions are in s&box units)*
3. Add Component: **Box Collider**
   - IsTrigger: ✓
   - Scale: `(800, 400, 300)` — a long corridor
4. Add Component: **Wind Zone**
   - Direction: `(1, 0, 0.2)` (north + slight upward)
   - Strength: `2500`

#### WindZone 3: stronger gust further out

1. **Create Object → Empty**, name `Wind_Gust`
2. Local Position: `(1000, 0, 200)`
3. Add Component: **Box Collider**
   - IsTrigger: ✓
   - Scale: `(600, 400, 200)`
4. Add Component: **Wind Zone**
   - Direction: `(1, 0, 0)` (pure north)
   - Strength: `3500`

### 6. Set up the camera

1. The scene has a Main Camera already
2. Select **Main Camera**
3. Add Component: **Leaf Camera**
   - Target: drag the Leaf GameObject here
   - Camera: should auto-populate (the existing CameraComponent on Main Camera)
   - Leave other settings at default

### 7. Statue silhouette (optional, can skip for first test)

In the Asset Browser → search for "statue" or "obelisk" — if anything looks suitably tall and pointy, drop it in at far position like `(-2000, 0, 0)` (south, far away). If nothing useful, just create an Empty + ModelRenderer with `models/dev/box.vmdl` scaled to `(2, 2, 30)` and a grey-green tint.

## First flight

1. Save the scene (Ctrl+S)
2. Press **Play** (the play button at the top of the scene viewport)
3. The leaf should:
   - Fall from above the tree
   - Get pushed up by Wind_TreeLift if you drift over it
   - Get carried north when you drift into Wind_NorthBreeze
4. Use **WASD** to tilt
5. Press **Esc** or click stop to exit play mode

## What to report back

- **Compile errors?** Paste them.
- **Does the leaf fall at a reasonable rate** (a few seconds to fall 200 units), or does it fall like a brick / float forever?
- **Does WASD tilt do anything visible?** It should at least rotate the leaf model.
- **Do the wind zones feel like they push?** You'll probably want Strength way higher or lower — that's expected for first tune.
- **Camera lag** — comfortable, disorienting, or completely wrong direction?

We tune from there. Don't try to make it good yet — just confirm the foundation works.
