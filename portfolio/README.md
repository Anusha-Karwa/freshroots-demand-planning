# Anusha Karwa · Portfolio

A single-page, scroll-driven portfolio set in a night meadow: sky lanterns, a river, fireflies and a waterfall, built in WebGL with Three.js.

- `index.html` is the standalone site. Open it in a browser or deploy it to any static host.
- `site.html` is the source (page body without the document wrapper). Edit this one, then run `./build.sh` to regenerate `index.html`.
- Add `?lite` to the URL to force the low-power scene (fewer grass blades, lower resolution).

## What scroll does
1. **Story**: the intro sentence writes itself word by word, with 3D objects popping in inline. The bar at the bottom is draggable. Hover an object to dim everything else and read its caption.
2. **Camera**: the 3D camera drifts in the sky during the story, then descends into the meadow and travels upstream to the waterfall by the footer.
3. **Name / manifesto / trail**: a giant wordmark, a paragraph that lights up word by word, and two marquees that speed up with scroll velocity.
4. **Work**: sticky cards that stack, shrink and dim as the next one covers them.
5. **Projects**: cards rise into place in staggered columns.
6. **Roots**: education as stepping stones along a glowing line.
7. **Lanterns I've lit**: a scroll wheel of achievements with a tilted card that follows the active item.
8. **Invitation**: a giant wavy line of text that slides sideways.
9. **Footer**: contact links, a giant surname, and the waterfall behind it.

Extras: the night/dawn toggle and generated ambient sound (river, wind, chimes, crickets) live in the side pill. Click anywhere in the sky to release a lantern.
