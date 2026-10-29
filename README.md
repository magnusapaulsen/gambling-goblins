# Gambling Goblins

A prototype roguelike deckbuilder (Slay the Spire flow + Clank!-simple cards +
Balatro-style combo scoring) in plain vanilla JS — no dependencies, no build step.

## Run

Open `index.html` in a browser (or serve the folder with any static server).
The whole game is one file: `game.js`.

## Tests

The console test suite loads the real game files into a Node `vm` context with a
stubbed `document`, so it runs the same code the browser runs:

```
node tools/engine-tests.js
```

The wiring at the bottom of `game.js` (event listeners, initial screen) is guarded
with `if (typeof document !== 'undefined')` so the file evaluates cleanly outside a
browser. Everything above the wiring is deliberately DOM-free.

To keep tests meaningful, gameplay randomness is **seeded**: every run fixes a seed
(mulberry32) and all gameplay randomness — shuffles, rolls, flips, market offers —
comes from that one stream. A run can be shared/replayed with `?seed=N` in the
address bar; the seed is printed to the combat log at run start. Handle `newRun(seed)`
with care: the replay path must stay available for the test suite (see the click-event
guard in `newRun`).

## Card / trinket descriptions

Descriptions are templates, not hand-written strings: `{field}` is filled from the
card's own data at render time (`{field:x100}` prints a fraction as a percent), so
tuning a number updates both the effect and its printed text from one edit. An
unfilled placeholder renders as `MISSING:field` — loud in the UI, and the test suite
asserts it never happens.

## Tools

- `tools/boss-art/` — generator / checker for the boss portraits (`boss-art.js`).
- `tools/engine-tests.js` — the console test suite described above.
