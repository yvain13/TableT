# Wall Target Pong

A projector shows circles on a wall. Hit them with an orange table tennis ball: a hit circle
bursts, scores, and a new one appears. One static web page on an iPad draws the game and
tracks the ball with the phone's (or tablet's) rear camera. There is no server, no network in the hit path,
and no AI: classic computer vision only.

## Run it

The camera needs a secure page (HTTPS, or `localhost` on the same machine).

**On a laptop (quick check):**

```sh
python3 -m http.server 8000      # then open http://localhost:8000
```

**On the phone during development:** serve over HTTPS from the laptop, for example
`npx cloudflared tunnel --url http://localhost:8000`, or `mkcert` plus any HTTPS static server,
and open the URL in Safari over Wi-Fi.

**Deploy:** push the folder to GitHub Pages, Netlify or Railway as static files. No build step.
On iPhone, Safari → Share → Add to Home Screen; it then opens full screen (iPhone Safari can't go full screen otherwise), and the service worker
keeps it working offline after the first load. Set Auto-Lock to Never (the page also asks
for a Wake Lock).

## Play

1. **Start**: tap Calibrate (or Play once a calibration is saved). This asks for the camera
   and goes full screen.
2. **Calibrate**: the screen goes black, then shows 4 green dots. The page finds them and
   solves the camera-to-screen mapping. If it can't find all 4, tap the dots in the camera view
   in order (top-left, top-right, bottom-right, bottom-left). Check that the green grid sits on
   the projected cyan grid, then play.
3. **Play**: hit circles inside the white frame. Each size has one colour and one value:
   green small (11 cm) = 10, cyan medium (20 cm) = 5, purple large (35 cm) = 2.
   The frame pulses when a game starts; a bounce just outside it flashes OUT on that edge.

Hidden controls: tap the score to pause or resume; hold it for about a second to reset.
The faint ⚙ in the top-left opens Settings.

**Set "Projected width" in Settings** to the measured width of the image on your wall. Target
sizes (10–40 cm) and the 2 cm hit margin are worked out from it.

## Settings

- Live camera view (greyscale, so the projected view never shows an orange ball to the
  tracker) with overlays: wall outline, matching pixels, ball and trail, last hit.
- Sliders: hue range, minimum saturation, minimum brightness, motion threshold, minimum blob
  size, turn angle, minimum move, projected width.
- Toggles: size check (rejects paddle hits), show ball dot on wall, test mode (tap = hit).
- Readouts: camera resolution, delivered frames per second, per-frame processing time,
  detections per second, calibration time, last rejected bounce and why.
- Recalibrate, Reset score, Default tuning.

Settings and calibration are saved in browser storage, and fall back to defaults when storage
is unavailable.

**Projector lag timer** (Start screen): a millisecond clock. Film the phone and the wall together
in 240 fps slow motion; the difference between the two readings is the projector's lag.

## How it works

| File | Job |
| --- | --- |
| `js/camera.js` | Rear camera at up to 60 fps; one callback per new frame (`requestVideoFrameCallback`), so slow frames are dropped, never queued |
| `js/calibration.js` | Black frame and dot frame, green difference, blobs, corner order, homography; tap fallback; grid check |
| `js/homography.js` | 8x8 solve, apply, invert |
| `js/tracker.js` | Orange and newly orange pixels in the region of interest, densest 16 px cell, 48 px centroid window, mapped to the screen |
| `js/bounce.js` | Turn sharper than the threshold → lines through the points before and after → their crossing is the hit |
| `js/game.js` | Targets, hit test, score, burst, ripple, pop-in |
| `js/settings.js` | Tuning panel |
| `js/app.js` | Wires the modules and the screens |

Details beyond the spec:

- The ball's **size** is the width of its streak (the short axis of the pixel spread), so motion
  blur doesn't make a fast ball look bigger and set off the paddle check.
- The hit-point fit tries the candidate frame on either side of the contact and keeps the
  better-fitting pair of lines.
- Once a turn is rejected (floor bounce, paddle hit), the next two candidates, which span the
  same turn, are skipped too.
- The orange level is (red − blue) / (red + green + blue), a ratio, so shadows moving on the wall
  (which change brightness, not colour) don't register as the ball.
- Open with `?debug` to get `window.wtp` (game, tracker, bounce, camera…) in the console.

## Tests

```sh
npm test    # node --test: homography, dot finding, ball detection, bounce detection, hit test, placement
```

## Milestones (from the spec)

1. Table test: live tracking and readouts on the iPad; measure fps and projector lag.
2. Calibration: a ball held on the wall maps within 2 cm at the 4 corners and the centre.
3. Bounce detection: at least 9 of 10 hits in 20 casual throws; at most 1 false hit in 2 minutes.
4. Game: a 5-minute session with no reload.
5. Mount and polish: from power-on to playing in under 5 minutes.
