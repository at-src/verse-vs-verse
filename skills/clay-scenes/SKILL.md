---
name: clay-scenes
description: Make a readable, animated claymation scene for each song line using the shared coded prop library and expressive mascot renderer.
---

# Clay scenes

Make one clear literal image per line. The renderer draws the recurring mascot, named props, lettering, camera and animation. Prefer its 40 hand-drawn coded props over model-written SVG: a cat should look like the catalog cat every time. Use custom SVG only when the lyric's concrete noun is absent from the catalog.

## Look and palette

Matte plasticine, thick soft silhouettes, rounded joins and friendly faces. Use this palette only: cream `#fffaf0`, paper `#f3ecdf`, sand `#d9cfc0`, brown `#8a5a3c`, terracotta `#c96f4a`, rose `#f08a8a`, mustard `#e3b448`, yellow `#ffd23f`, leaf `#7cbf6a`, grass `#5ea85a`, stem `#4f9a62`, teal `#7fd1c7`, deep teal `#3f8f87`, blue `#3f6fc0`, night `#2f2a3a`, ink `#2a2622`, shade `#e8b41f`.

Canvas `800 × 450`. Keep the upper 100 px open for the keyword. Keep the bottom lyric band (y 378–436) unobstructed. Put props around x 500, y 270, scale 1.0–1.5; put the mascot to their left and above the lyric band. Night backdrop is exactly `#2f2a3a`.

## Scene artist JSON schema

Return JSON only. Select the most visual noun in the line and use its exact library name where possible. Include one main action for the mascot. One to three props are enough.

```json
{
  "keyword": "cat",
  "mood": "night",
  "ground": true,
  "action": "point",
  "mascot": { "pose": "point", "x": 625, "y": 320, "scale": 1, "facing": "left" },
  "props": [
    { "prop": "cat", "x": 505, "y": 265, "scale": 1.3, "action": "tail", "enter": "pop" }
  ]
}
```

Allowed moods: `day`, `dream`, `night`, `warm`, `sea`. Allowed mascot actions/poses: `idle`, `sing`, `dance`, `jump`, `point`, `hold`, `shrug`, `cheer`, `sleepy`, `surprised`, `stand`, `sit`, `walk`, `blow`, `lookup`, `puzzled`, `sleep`, `wave`, `hug`. Choose the one that acts out this line, not a generic stand pose. Allowed entrance: `pop`, `drop`, `grow`, `slide`, `drift`, `draw`.

### Named prop library

Use one of these exact `prop` names. Each has a hand-authored SVG silhouette, a named `center` and `hand` anchor, and a default motion in `skills/clay-scenes/props/`. The renderer accepts aliases from the lyric and falls back to custom SVG only for a noun outside this list.

`cat`, `dog`, `bird`, `fish`, `chai cup`, `coffee mug`, `pizza`, `cake`, `game controller`, `headset`, `keyboard`, `phone`, `guitar`, `microphone`, `speaker`, `music notes`, `heart`, `star`, `moon`, `sun`, `cloud`, `rain cloud`, `umbrella`, `puddle`, `city skyline`, `house`, `car`, `bike`, `rocket`, `tree`, `flower`, `fire`, `crown`, `trophy`, `ghost`, `robot`, `balloon`, `gift`, `book`, `clock`.

Prop actions/motions: `tail`, `flutter`, `swim`, `steam`, `bob`, `tilt`, `pulse`, `float`, `twinkle`, `rain`, `sway`, `ripple`, `city`, `roll`, `launch`, `flicker`, `cheer`, `strum`, `tick`, `flip`. Let the renderer use a prop's default when unsure. Never draw a second mascot.

If there is no library noun, return `{ "prop": "custom", "x": 505, "y": 265, "scale": 1.2, "action": "bob", "enter": "pop", "svg": "<g>...</g>" }`. Custom SVG must contain only basic `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`, gradients and stops; palette colors only; no text, scripts, images, links, event attributes or external URLs. Keep it under 30 shapes and within the canvas.

## Rendering and motion

`public/scene-renderer.js` is the source of truth for live and exported scenes. It is pure SVG plus deterministic time math: always pass absolute clip time, scene start, timed words and BPM (100 if unknown). It renders beat bounce and squash/stretch, idle breathing, a blink every few seconds, per-word singing mouth, and expressive pose/action. `hold` reaches toward the catalog prop's named `hand` anchor. Props pop on line entry, move continuously using their named default motion, and react to the beat. A sung keyword makes the camera punch in, its prop pop, and a few palette-colored clay flecks appear.

Each shot gets a gentle push/pan. Repeated lines get a different camera phase; line changes cut cleanly. The live overlay and export must call this same renderer with the same scene time and word timings. Do not add CSS keyframe or wall-clock animation: given the same scene and time, the SVG must be identical.

## Worked examples

| Lyric | Keyword / prop | Mascot action |
|---|---|---|
| “in a field of dandelions” | `dandelions` / custom flower field | `sit` |
| “wishing on every one that you'd be mine” | `wishing` / `flower`, `heart` | `blow` |
| “and I see forever in your eyes” | `eyes` / custom eye | `lookup` |
| “kabhi uljhe jawaab sa” | `jawaab` / custom knotted rope | `puzzled` |

For an abstract line, choose a concrete library prop that carries the feeling and keep the lettering keyword from the actual line. Prefer one strong prop and one clear mascot reaction over a pile of decoration.
