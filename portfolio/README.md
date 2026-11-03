# Anusha Karwa · Portfolio

A single-page, scroll-driven portfolio set in a night meadow: sky lanterns, a river, fireflies and a waterfall, built in WebGL with Three.js.

- `index.html` is the standalone site. Open it in a browser or deploy it to any static host.
- `site.html` is the source (page body without the document wrapper). Edit this one, then run `./build.sh` to regenerate `index.html`.
- Add `?lite` to the URL to force the low-power scene (fewer grass blades, lower resolution).

## What scroll does
1. **Story**: the intro sentence writes itself word by word in a centred, mixed-type layout, with 3D objects popping in inline. A vertical lantern rope on the left shows progress and can be dragged. Hover an object to make it spin inside a glow and read its caption.
2. **Camera**: the 3D camera drifts in the sky during the story, then descends into the meadow and travels upstream to the waterfall by the footer.
3. **Name / manifesto / trail**: a giant wordmark with a rippling reflection on a glowing horizon, a paragraph that lights up word by word, and two marquees that speed up with scroll velocity.
4. **Work**: tilted postcard-style cards (details on the left, visual on the right) that stack, shrink and dim as the next one covers them.
5. **Projects**: cards rise into place in staggered columns.
6. **Roots**: education as stepping stones along a glowing line.
7. **Lanterns I've lit**: achievements on a 3D rotating drum, with a hanging lantern card that shows the active item.
8. **Invitation**: letters rise out of the river one by one and settle into a glowing line.
9. **Footer**: contact links, a "light a lantern" button that releases lanterns into the sky, and a hand-drawn signature, with the waterfall behind.

Extras: the hanging lantern (bottom left) toggles generated ambient sound (river, wind, chimes, crickets) and the moon toggles night/dawn. Click anywhere in the sky to release a lantern, or use "Light a lantern before you go" in the footer.
