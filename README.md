# Pintland Tap

A daily map-guessing game for the Pintland Isles Minecraft server, played on the server's live Dynmap tiles.

```
game/                 everything here is uploaded to plugins/dynmap/web/pintland/
  placer.html         step 1: place every location, export locations.json
  js/core.js          CRS, Dynmap tile layer, scoring, daily picks, storage
  vendor/leaflet/     Leaflet 1.9.4 (our own copy; Dynmap bundles 1.7.1)
tools/mock_dynmap.py  local stand-in for Dynmap: serves game/ at /pintland/, fake tiles, /up/configuration
tests/                core.test.js (unit), placer.e2e.js (Playwright)
```

## Deploy the placer

1. Upload the contents of `game/` to `plugins/dynmap/web/pintland/` on the PebbleHost server
   (file manager or SFTP), keeping the folders: `pintland/placer.html`, `pintland/js/core.js`,
   `pintland/vendor/leaflet/...`.
2. Log in to Dynmap at `http://51.161.71.220:8128/` (the tiles need the login cookie).
3. Open `http://51.161.71.220:8128/pintland/placer.html`.

If `/pintland/placer.html` returns 404 right after uploading, run `dynmap reload` in the console.

The draft autosaves to this browser's `localStorage`. Export often anyway: **Export → Download locations.json**.

## Using the placer

- Click an unplaced wishlist row to arm it, then click the map. Esc cancels.
- Drag a pin to nudge it. Click a pin to edit it. **Move** re-arms a placed location.
- **+ Add location** adds a custom entry (small builds, NPCs), then click the map to place it.
- Positions are whole block coordinates, the same as F3. The pin tip sits on the centre of that block.
- "go to" takes `x, z` or F3's `x y z`.
- Ctrl/⌘+Z undoes the last change (placing, moving, deleting, editing, importing).
- Export writes placed locations to `locations` and keeps unplaced ones in `unplaced`, so a re-import
  loses nothing. The game reads `locations` only.

## Test locally

```sh
python3 tools/mock_dynmap.py --port 8128 &                  # http://127.0.0.1:8128/pintland/placer.html
python3 tools/mock_dynmap.py --port 8129 --login-required &
node tests/core.test.js
NODE_PATH=$(npm root -g) node tests/placer.e2e.js /tmp/screens
```

The mock world is synthetic. It paints a red block at every x, z that are both multiples of 100 and a white
block at 0, 0, so the e2e test can check the cursor readout against tile pixels block for block.
