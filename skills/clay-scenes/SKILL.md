---
name: clay-scenes
description: Turn a song lyric line into an animated claymation-style scene (SVG + a clay texture filter), with one recurring mascot, a mood backdrop and the line's key word in clay lettering. Use when generating music-video scenes for lyrics.
---

# Clay scenes

Every lyric line becomes one scene that a viewer understands at a glance: **one clear idea, drawn literally**, on a soft clay backdrop, with the same mascot reacting to it. No image model: the scene is SVG code, and the clay look comes from one shared SVG filter.

## Look

- **Material:** matte plasticine. Thick, rounded shapes. No thin lines: strokes are 5px or more, with round caps and joins.
- **Palette** (use only these):
  - cream `#fffaf0`, paper `#f3ecdf`, sand `#d9cfc0`
  - brown `#8a5a3c`, terracotta `#c96f4a`, rose `#f08a8a`
  - mustard `#e3b448`, yellow `#ffd23f`
  - leaf `#7cbf6a`, grass `#5ea85a`, stem `#4f9a62`
  - teal `#7fd1c7`, deep teal `#3f8f87`, blue `#3f6fc0`
  - night `#2f2a3a`, ink `#2a2622`
- **Clay filter:** one filter, `#clay`, applied to every visible group (backdrop, props, mascot, lettering): fractal-noise bump lighting multiplied over the colour, plus a soft drop shadow.

```xml
<filter id="clay" x="-15%" y="-15%" width="130%" height="130%">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n"/>
  <feDiffuseLighting in="n" lighting-color="#fff" surfaceScale="1.4" result="l"><feDistantLight azimuth="225" elevation="58"/></feDiffuseLighting>
  <feComposite in="l" in2="SourceGraphic" operator="in" result="t"/>
  <feBlend in="SourceGraphic" in2="t" mode="multiply" result="b"/>
  <feDropShadow dx="4" dy="7" stdDeviation="5" flood-color="#5a4a3a" flood-opacity=".3"/>
</filter>
```

Never apply the filter to a group that has a negative scale (a mirrored mascot). Wrap it instead: `<g filter="url(#clay)"><g transform="... scale(-1 1)">...</g></g>`. A negative scale on the filtered group renders it solid black.

## Canvas and layers

`viewBox="0 0 800 450"`, back to front:

1. **Backdrop** (renderer): flat clay colour picked by mood.
   - day `#f3ecdf`, dream `#efe6f2`, night `#2f2a3a` (with small yellow stars), warm `#f6e3c8`, sea `#e3f1ef`.
2. **Ground** (optional, from the scene): a gentle clay hill along the bottom, y ≈ 330–450.
3. **Props** (from the LLM): one to three objects that show the line. Main prop centred or slightly right, filling about 35–55% of the width.
4. **Mascot** (renderer): pose and position come from the scene spec.
5. **Lettering** (renderer): the line at the top, with the key word large.

## The mascot (drawn by the renderer, never by the LLM)

A yellow (`#ffd23f`) bean, 100 units tall: rounded body, a darker side shade (`#e8b41f`), two dot eyes with a white glint, rosy cheeks, thin ink arms and legs.

Poses: `stand`, `sit`, `walk`, `blow`, `lookup`, `puzzled`, `sleep`, `wave`, `hug`, `jump`. The renderer animates between poses and adds small idle motion (breathing, blinking).

## Lettering

- Rounded display font (Chewy or similar), clay filter applied.
- The **key word** (the image the line is about) in uppercase at about 1.7× size. Other words are small and lowercase.
- Colour: deep teal `#2f6f7a` on light backdrops, cream `#fff4d6` on night.
- Words appear one at a time, in time with the singing (word timings come from the music provider).

## Scene spec (what the LLM returns, as JSON)

```json
{
  "keyword": "DANDELIONS",
  "mood": "day",
  "ground": true,
  "mascot": { "pose": "sit", "x": 370, "y": 352, "scale": 1, "facing": "right" },
  "props": [
    { "id": "field", "svg": "<g>...</g>", "enter": "grow" },
    { "id": "seeds", "svg": "<g>...</g>", "enter": "drift" }
  ]
}
```

- `keyword`: one word from the line, the most visual one.
- `mood`: one of the backdrop moods.
- `props[].svg`: an SVG group in the 800×450 canvas. Palette colours only, at most about 30 shapes per prop. No text, no `<image>`, no scripts or event attributes, no external references. The renderer strips anything else.
- `props[].enter`: how the renderer brings it in. One of `drop` (falls in and squashes), `grow` (scales up from its base), `slide` (from the side), `drift` (floats in slowly), `draw` (stroke draws itself, for ropes and paths), `pop` (scale bounce).

## How to pick what to draw

1. Find the most visual noun or idea in the line. If the line is abstract, pick one concrete object that stands for it: "tangled answer" → a knotted rope; "forever" → an infinity loop; "heartbreak" → a cracked clay heart.
2. Draw it literally and big. One idea per scene.
3. Give the mascot a pose that acts out the line: wishing → `blow`, dreaming → `sleep`, confused → `puzzled`, love → `hug`, looking at something → `lookup`.
4. Choose the mood from the line's feeling and time of day.
5. Keep space at the top (y < 110) clear for the lettering.

## Worked examples

| Line | Keyword | Mood | Props | Mascot |
|---|---|---|---|---|
| "in a field of dandelions" | DANDELIONS | day | grass hills; white dandelion puffs (stem plus 16 seed rays); small yellow flowers; 3 floating seeds | `sit` among them |
| "wishing on every one that you'd be mine" | WISHING | dream | a dandelion puff in hand; about 12 seeds drifting in an arc; a rose heart where they gather | `blow` |
| "and I see forever in your eyes" | FOREVER | night | one big eye: cream white, teal iris, ink pupil with a yellow infinity loop, a glint, brown lashes; stars | `lookup` at it |
| "kabhi uljhe jawaab sa" (like a tangled answer) | ULJHE | day | a big knotted terracotta rope with one loose end on the ground; a blue question mark | `puzzled`, holding the loose end |

Reference image of these four scenes: `skills/clay-scenes/reference.jpg`.

### Example prop: dandelion puff (stem plus seed rays)

```js
function dandelion(x, y, h, r) {
  const rays = [...Array(16)].map((_, i) => {
    const a = (i / 16) * Math.PI * 2, ex = x + Math.cos(a) * r, ey = y - h + Math.sin(a) * r;
    return `<path d="M${x} ${y - h} L${ex} ${ey}" stroke="#fffaf0" stroke-width="2.4"/><circle cx="${ex}" cy="${ey}" r="3.6" fill="#fffaf0"/>`;
  }).join('');
  return `<path d="M${x} ${y} q-6 ${-h / 2} 0 ${-h}" stroke="#4f9a62" stroke-width="5" fill="none" stroke-linecap="round"/>`
    + `<circle cx="${x}" cy="${y - h}" r="${r}" fill="#fffaf0" opacity=".35"/>${rays}<circle cx="${x}" cy="${y - h}" r="4" fill="#c9bfa8"/>`;
}
```

### Example prop: tangled rope

```xml
<g fill="none" stroke-linecap="round">
  <path d="M330 300 C250 220 360 140 440 190 C520 240 430 330 360 270 C300 220 400 150 480 170 C560 190 540 300 460 310 C380 320 330 250 380 210 C430 170 520 220 500 280" stroke="#c96f4a" stroke-width="22"/>
  <path d="M350 250 C330 170 450 150 500 210 C540 260 470 320 410 300 C350 280 380 200 450 220" stroke="#d98a5f" stroke-width="18"/>
  <path d="M500 280 C560 330 610 360 660 380" stroke="#c96f4a" stroke-width="20"/>
</g>
```
