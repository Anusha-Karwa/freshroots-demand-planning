# Anusha Karwa · Portfolio

A single-page, scroll-driven portfolio set in a night meadow: sky lanterns, a river, fireflies and a waterfall, built in WebGL with Three.js.

- `index.html` is the standalone site. Open it in a browser or deploy it to any static host.
- `site.html` is the source (page body without the document wrapper). Edit this one, then run `./build.sh` to regenerate `index.html`.
- Add `?lite` to the URL to force the low-power scene (fewer grass blades, lower resolution).

## What scroll does
1. **Loader**: fireflies drift in from the dark and gather into the name.
2. **Story**: one line at a time. Each line is swept into light, holds, then lifts away and fades like a released lantern while the next rises in. 3D objects float above each line (hover for captions). The lantern string on the left lights up per chapter and jumps to it on click.
3. **Camera**: the 3D camera stays in the sky during the story, then descends into the meadow and travels upstream to the waterfall by the footer.
4. **Name**: the name sits on a glowing horizon with a rippling reflection in the water below.
5. **Manifesto**: a lantern light travels through the dark paragraph (or follows the cursor) and reveals the words.
6. **Trail**: places drift downstream on paper boats in three depth lanes; the current speeds up with scroll speed.
7. **Work**: the page turns sideways and follows a glowing river path; each role is a stop along it.
8. **Builds**: cards tilt toward the cursor and turn over on click.
9. **Roots**: education as stepping stones along a glowing line.
10. **Moments**: 14 achievements are stars that draw a lantern constellation; the last star is the flame that lights it.
11. **Finale**: at the waterfall, "Light a lantern with me" releases lanterns into the 3D sky, then contact links and a hand-drawn signature.

Extras: the hanging lantern (bottom left) toggles generated ambient sound (river, wind, chimes, crickets); the moon toggles night/dawn. Click the sky anywhere to release a lantern.
