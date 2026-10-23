# Pintland Tap

A daily map-guessing game for the Pintland Isles Minecraft server, played on the server's live Dynmap tiles.

```
game/                 everything here is uploaded to plugins/dynmap/web/pintland/
  index.html          the daily game: http://51.161.71.220:8128/pintland/index.html
  js/game.js          game flow: rounds, reveal, results, stats
  locations.json      the locations the game picks from (export from the placer)
  placer.html         place every location, export locations.json
  js/core.js          CRS, Dynmap tile layer, scoring, daily picks, storage
  vendor/leaflet/     Leaflet 1.9.4 (our own copy; Dynmap bundles 1.7.1)
tools/mock_dynmap.py  local stand-in for Dynmap: serves game/ at /pintland/, fake tiles, /up/configuration
tests/                core.test.js (unit), placer.e2e.js (Playwright)
LORE-GAPS.md          running list of locations the lore docs miss or barely cover
```

## Deploy

1. Upload the contents of `game/` to `plugins/dynmap/web/pintland/` on the PebbleHost server
   (file manager or SFTP), keeping the folders: `pintland/index.html`, `pintland/locations.json`,
   `pintland/placer.html`, `pintland/js/core.js`, `pintland/js/game.js`, `pintland/vendor/leaflet/...`.
2. Log in to Dynmap at `http://51.161.71.220:8128/` (the tiles need the login cookie).
3. Play at `http://51.161.71.220:8128/pintland/index.html`. The placer is at `/pintland/placer.html`.

Dynmap's web server doesn't serve folder index pages, so always link `index.html` (the share text does).
If a page returns 404 right after uploading, run `dynmap reload` in the console.

To add or move locations later: open the placer, Import the current `locations.json`, edit, Export, and
upload the new `locations.json` over the old one. Anyone who has already started today's puzzle keeps
their five; everyone else gets picks from the new file, so upload changes just after midnight Eastern.

## The game

- One puzzle a day, the same for everyone: puzzle #1 is `meta.epoch` (2026-10-24), and it rolls over at
  midnight in `meta.tz` (America/New_York). Days before the epoch play as an unnumbered "Preview" with
  unlimited games: **Play again** on the results draws five new locations, and preview games don't count
  toward stats. To get the preview back for more testing, move `meta.epoch` later in `locations.json`.
- Five rounds following `meta.mix`, easiest first: 1 medium, 2 hard, 2 expert (the players know the map, so easy
  locations sit out). Picks don't repeat until a difficulty's pool is used up, and no two picks on the same day
  are within 50 blocks of each other (`meta.minGap`), so a building and its NPC never give each other away.
- Guesses snap to whole blocks. Score = 100 for the exact block (`perfect: 0`), otherwise
  `round(100 · e^(−d/k))` capped at 99, with `k = 200`: 25 off → 88, 100 → 61, 200 → 37, 500 → 8.
- Each locked guess is saved to `localStorage` immediately; reloading can't re-guess. A finished day
  opens on results. Played / streak / best / average live in `localStorage` too (per browser).
- The share text is the leaderboard: `Pintland Tap #12 — 372/500`, the squares, and the link.

The draft autosaves to this browser's `localStorage`. Export often anyway: **Export → Download locations.json**.

## Using the placer

- Click an unplaced wishlist row to arm it, then click the map. Esc cancels.
- Drag a pin to nudge it. Click a pin to edit it. **Move** re-arms a placed location.
- **+ Add location** adds a custom entry (small builds, NPCs), then click the map to place it.
- Positions are whole block coordinates, the same as F3. The pin tip sits on the centre of that block.
- "go to" takes `x, z` or F3's `x y z`.
- **Check pins for the zoom shift** lists every placed pin with close-ups of its spot and of the spots 32, 96,
  224, 480 and 992 blocks south. Before the zoom fix, zoomed-out views were drawn that far north, so a pin
  placed there is that far north of its real spot. Click the right close-up to move the pin, or mark it
  **Looks right**. Pins whose block looks like water are flagged and listed first.
- **+ Add another spot** (in a placed location's editor) gives it extra spots, such as several sewer entrances or
  both Tome Monuments. The game scores a guess against whichever spot is closest and shows the others faded.
  Extra spots export as `"alt": [{"x": …, "z": …}]`.
- **Placement note** is a reminder shown only in the placer (e.g. "place it at the entrance to the street").
  It exports as `note`; the game ignores it. The 58 lore picks come with their lore clue as the note.
- New wishlist batches merge into an older draft or an imported file once (tracked by `wishlistBatch`).
- Delete a location with the × on its row, the Delete button in its editor, or the Delete key while it's
  selected.
- Ctrl/⌘+Z undoes the last change (placing, moving, deleting, editing, importing).
- Export writes placed locations to `locations` and keeps unplaced ones in `unplaced`, so a re-import
  loses nothing. The game reads `locations` only.

## Test locally

```sh
python3 tools/mock_dynmap.py --port 8128 &                  # http://127.0.0.1:8128/pintland/placer.html
python3 tools/mock_dynmap.py --port 8129 --login-required &
node tests/core.test.js
NODE_PATH=$(npm root -g) node tests/placer.e2e.js /tmp/screens
NODE_PATH=$(npm root -g) node tests/game.e2e.js /tmp/screens
```

The mock world is synthetic. It paints a red block at every x, z that are both multiples of 100 and a white
block at 0, 0, so the e2e test can check the cursor readout against tile pixels block for block.
