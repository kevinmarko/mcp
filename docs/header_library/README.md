# Header library v2 (D83)

`header_wave_doodle_options_v2.html` is Kevin's doodle sheet (the 20 ONE Maritime header scenes, same page, same cards, same 1:1 preview and 2.2x inspector) with every scene
upgraded for detail and smoother motion. Open it in a browser (it loads Tailwind from a CDN, like the original). It is a review copy: **none of the upgraded scenes is in the app
yet** (the app still draws its three seasonal scenes from the D78 ports). `poster_frames_light.png` is every scene with all animation removed, the image the app shows after idle time.

## What is new in the page
- **Still view (idle)** button: removes every animation, exactly what the app shows after 60 s idle, off screen, hidden, or with reduced motion.
- The counter next to the title now also says how many animations a scene runs.

## What changed in the scenes
Shared (every scene benefits): the sea drifts continuously in one direction (each layer moves by exactly one period of its repeating path, so it never reverses or snaps; the
old waves oscillated back and forth), sine-eased calm bobs with their own durations and negative delays, fades that start and end invisible (steam, petals, fireworks), the ONE
flagship with a shaded hull, shaded container tiers, a waterline reflection and lit windows at night, dolphins that really leap in a parabola through the waterline, a few twinkling
water glints, a moon (not a dimmed sun) in dark mode in scenes that use the sky helper, a pivoting lighthouse beam.
Per scene: see the table. All motion is `transform` and `opacity` only.

| Scene | Highlights |
|---|---|
| opt5 Port to Sea, combo Panorama, opt4 Convoy | hazy ridge and far ship, chimney smoke, lit town at night; pilot launch with crew and pennant, three dolphins on real arcs, far sailboat |
| opt11 Dock-to-Rail, opt8 Canal Lock | viaduct and train detail with a headlamp beam; lock gates and ship lift with smoother motion |
| opt7 Mt. Fuji, opt9 Aurora, opt10 Arctic | Fuji cloud band, torii lantern, sakura petals; aurora bands; iceberg depth and a penguin group sway |
| opt12 NYC Harbour | skyline with glowing windows, harbour reflection, ferry |
| opt6 Whale, opt3 Flags, opt1 Regatta | whale arc and spout; flags fluttering on bunting; sails that breathe |
| opt13 Halloween, opt14 Autumn, opt15 Xmas | witch drift, three bat cycles, ghost-ship shimmer; autumn trees, barn glow, leaves and geese; sleigh, tree lights, snowman |
| opt16 NYE, opt17 Lunar NY, opt18 Earth Day, opt19 Muertos, opt20 Jul 4 | ball drop that eases down and holds, three bursts on three periods (opt16 went from 260 to 122 nodes); Marina Bay Sands, Merlion and lanterns on three periods, the dragon boat drawn in place (the original's translate was overridden by its animation); rotors that turn about the hub; swaying banners, monarchs and candle flicker; Ferris wheel and flags |

## Numbers (Chromium, from the render tool; the tool counts the 1:1 strip and the 2.2x strip, so animations per strip are half the "running" figure)
All 40 renders (20 scenes x light and dark): animated properties are only `transform` and `opacity` (lint `nonCompositor=[]`), every infinite loop is seamless (`nonSeamlessLoop=[]`),
no scene is over 132 SVG nodes or 15.8 KB minified. Per-strip animations range from 13 (opt5) to 22 (opt16 and opt20 run the most); the originals ran 12-36 per strip with some
loops that popped (steam puffs, petals).

## Not verified
Motion was judged from lint, keyframes and frame strips, not watched live; the CPU cost of the new waves, glints and dolphins was not measured; only Chromium was used; the scenes are
not ported to the app (the app draws its scene as a CSS background image, so its shared gradients and CSS must be inlined into the image: see `bfdImageUrl`).
## Porting into the app
Halloween (opt13), Muertos (opt19) and Autumn (opt14) are the three scenes the app shows; porting the upgraded versions means re-doing the D78 port for each (see `docs/DECISIONS.md` D78 and D83).
