# Far from the Tree

A leaf physics roguelike built in s&box. Ride wind currents through three vertical layers of stylised Manhattan from Battery Park to Central Park.

See the [full plan](https://) and [POC plan](https://) for design details (HTML files, currently in Downloads).

## Status

- **Phase**: Pre-POC scaffolding
- **Engine**: s&box (Source 2 / C#)
- **Project ident**: `farfromthetree`
- **Scope**: Cut from full plan — Chinatown → Midtown → Central Park, all 3 layers, 7 Days to Die-tier visuals

## Repo layout

```
Assets/scenes/        # .scene files (JSON GameObject hierarchies)
Code/                 # gameplay C# (compiled into your game assembly)
Editor/               # editor-only C# (custom menus, tooling)
farfromthetree.sbproj # s&box project manifest
```

## Open in s&box

1. Launch `sbox.exe`
2. **File → Open Project** → select this folder (`farfromthetree.sbproj` is the manifest)
3. Open `Assets/scenes/minimal.scene` to see the starter greybox (sun, skybox, ground plane, three falling cubes)

The first time the editor opens the project it will auto-generate the `.csproj`, `.sln`, and `bin/`/`obj/` directories — all gitignored.

## Known caveat: OneDrive path

Project lives under `C:\Users\Ollie\OneDrive\Desktop\` — fine for now, but OneDrive can occasionally fight with build/cache files. The `.gitignore` excludes the heavy ones (`.sbox/`, `bin/`, `obj/`). If you start seeing weird sync conflicts during builds, move the project off OneDrive (e.g. `C:\Dev\FarFromTheTree`).

## Next

POC goal: prove the leaf is fun in one greybox block. Plan lives in the chat — once `LeafController.cs` has real physics, we add wind zones, then build the first block.
