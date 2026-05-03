# Far from the Tree

A leaf physics roguelike built in s&box. Ride wind currents through five zones of stylised Manhattan from Battery Park to Central Park.

## Status

- **Phase**: First-flight POC — testing whether the leaf feels fun
- **Engine**: s&box (Source 2 / C#)
- **Project ident**: `farfromthetree`
- **Scope**: Battery Park (tutorial) → Chinatown → SoHo → Midtown → Central Park, all 3 vertical layers, 7 Days to Die-tier visuals
- **Mode**: Nature's Way only at v1 (one life, leaderboard, instant restart)

## Repo layout

```
Assets/scenes/             # .scene files (JSON GameObject hierarchies)
Code/                      # gameplay C# (compiled into your game assembly)
  LeafController.cs        # the leaf — tilt input, drag/lift, tumble, wind accumulator
  WindZone.cs              # trigger volume that pushes overlapping leaves
  LeafCamera.cs            # auto chase cam, FOV widens with speed
Editor/                    # editor-only C# (custom menus, tooling)
farfromthetree.sbproj      # s&box project manifest
```

## Project location

`C:\Dev\FarFromTheTree` — outside OneDrive so build artifacts and the s&box editor cache don't fight with sync.

## Editor setup — first flight

The components are written; the scene needs them attached. After opening the project:

### 1. Open the project
1. Launch `sbox.exe`
2. **File → Open Project** → select `farfromthetree.sbproj`
3. Open `Assets/scenes/minimal.scene`

You should see a flat green plane and a few falling cubes. We'll modify this scene into a leaf flight test.

### 2. Make the leaf
1. **Right-click in the scene → Create Object → Empty**, name it `Leaf`
2. With Leaf selected, in the Inspector add components (one at a time, click *Add Component*):
   - **Model Renderer** — set Model to `models/dev/box.vmdl`, Tint to a warm orange/red, Scale `(0.3, 0.5, 0.05)` so it's leaf-shaped
   - **Box Collider** — leave defaults
   - **Rigidbody** — Gravity ON, LinearDamping 0, AngularDamping 0.5
   - **Leaf Controller** (our component) — leave properties at defaults for now; the Body field auto-populates
3. Position the Leaf around `(0, 0, 200)` so it starts in the air

### 3. Make a wind zone
1. **Create Object → Empty**, name it `TestWind`
2. Add components:
   - **Box Collider** — set IsTrigger ON, scale up to `(500, 500, 500)`
   - **Wind Zone** — Direction `(1, 0, 0.5)` (forward + slight upward), Strength `3000`
3. Position somewhere the leaf will fall through, e.g. `(200, 0, 50)`

### 4. Set up the camera
1. The scene already has a default camera. Find it (or create a new GameObject with **Camera Component**), name it `LeafCam`
2. Add the **Leaf Camera** component, set its Target to the Leaf GameObject
3. The camera will auto-follow on play

### 5. Press play
Hit play. The leaf should fall, you should be able to tilt it with WASD. If you fly through the wind zone, you should feel the push.

## What to watch for during first flight

- Does the leaf feel **floaty** (good) or **draggy** (drag too high) or **like a brick** (lift too low)?
- Does WASD tilt feel **responsive** (good) or **sluggish** (TiltLerpRate too low) or **twitchy** (too high)?
- Does the wind zone feel like a real **push** (good) or **invisible** (Strength too low)?
- Camera lag: comfortable or **disorienting**?

All values are `[Property]`-exposed, tune them in the Inspector while playing. When something feels right, write the number down — that's the value we bake in.

## Known unknowns

The C# uses standard s&box API patterns but a couple of method names are educated guesses (e.g. `Body.ApplyForce`, `Body.ApplyTorque`). If the editor flags compile errors, paste them in chat and we'll correct.

## Next

Once flight feels right:
1. Build the **Battery Park tutorial scene** properly (tree, harbour, Statue silhouette, first gust)
2. Add the **RunTimer + restart** system
3. Stretch to Chinatown
