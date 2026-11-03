# Anusha Karwa · Portfolio

A single-page, scroll-driven portfolio set in a night meadow: sky lanterns, a river, fireflies and a waterfall, built in WebGL with Three.js.

- `index.html` is the standalone site. Open it in a browser or deploy it to any static host.
- `site.html` is the source (page body without the document wrapper). Edit this one, then run `./build.sh` to regenerate `index.html`.
- Add `?lite` to the URL to force the low-power scene (fewer grass blades, lower resolution).

## What scroll does (top to bottom)
1. **Loader**: a lantern fills with light while a rolling counter runs to 100.
2. **Header**: studio-style columns and a "Let's talk" button; after the hero it collapses to a hamburger that opens a full-screen menu.
3. **Name**: a giant wordmark with a rippling reflection on a glowing horizon.
4. **Story**: the intro sentence writes itself word by word with 3D objects inline. Hovering an object dims the rest and shows a caption. The lantern rope on the left shows progress and can be dragged.
5. **What I bring**: four service-style cards that rise in staggered columns.
6. **Trail**: two logo marquees that speed up with scroll, then a short "Building useful things, daily" interlude with a link.
7. **Proof collage**: eight tiles (stickers, a warning sign, an arrow block, big numbers) fly in from every side.
8. **Manifesto**: a paragraph with an inline image that lights up word by word.
9. **Work**: tilted postcard cards that stack, shrink and dim as the next one covers them.
10. **Wavy band**: "Engineer · Builder · Seller · Storyteller" slides sideways with wobbling letters.
11. **Builds**: project cards that rise in staggered columns.
12. **Roots**: education as stepping stones along a glowing line.
13. **Lanterns I've lit**: a huge heading with a featured list, then achievements on a 3D drum with a hanging card.
14. **Invitation**: letters rise out of the river one by one.
15. **Footer**: "Build it once. Build it right.", contact links, a light-a-lantern button, a signature and a giant "KARWA".

The 3D camera stays in the sky until the story ends, then descends into the meadow and travels upstream to the waterfall. The hanging lantern (bottom left) toggles generated ambient sound, the moon toggles night/dawn, and clicking the sky releases a lantern.
