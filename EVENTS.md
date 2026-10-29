# Events — implemented + backlog

Living list for the junction events (`EVENT_LIBRARY` in `game.js`). The engine supports:

- **Junctions:** `'prefight'` (after leaving the market / before the next fight) and
  `'premarket'` (after winning a fight / before the market).
- **Pre-fight buffs** via `game.pendingFight`, consumed by `startCombat()`:
  `attackBonus`, `firstAttackBonus`, `blockHitBonus`, `startBlock`, `energyDelta`,
  `bossHpFactor` (also >1 for a fatter boss), `ambushAttacks`.
- **On-the-spot effects:** gold, HP (floors at 1 — events never kill the player),
  `grantRandomTrinket()`, `grantRandomCard()`, `upgradeRandomCard()`.
- **Gambles:** `rollDie(game.event, sides, cb)` / `flipCoin(game.event, cb)` — the
  roll is animated on the shared dice overlay before the outcome reveals.

## Implemented (first batch)

| # | Event | When | Shape |
|---|-------|------|-------|
| 1 | Someone Follows | prefight | climb tree: +2 dmg this fight · ask: nothing |
| 2 | The Abandoned Campfire | prefight | dig ashes: die → +25 gold or −5 HP · take flask: +10 HP |
| 3 | The Lucky Well | prefight | wish (−10g): first attack +8 · graffiti: +1 block per block hit |
| 4 | The Gambler's Shrine | prefight | bow: +4 block per hit · steal die: coin → +15 gold or start −1 energy |
| 5 | The Shortcut | prefight | burrow: −5 HP, boss at 80% HP · long road: nothing |
| 6 | The Warning Totem | prefight | heed: start +8 block · kick it: coin → nothing or ambush (doubled attacks) |
| 7 | The Dropped Pouch | premarket | return: random trinket · snatch: +30 gold |
| 8 | The Fortune Teller | premarket | left card: die → random card or nothing · right card: +15 gold |
| 9 | The Storyteller | premarket | pay 10g: upgrade a random card · give 5g: +5 HP |

## Backlog (next batch — prune freely)

Pre-fight:

1. **The Dice Den** — goblins around a bone die wave you in. *Sit down:* roll a die —
   4+: start the fight with +1 max energy (`energyDelta: +1`), else start −1 energy
   (heads they remember...) *Watch only:* nothing. (Hook: existing.)
2. **The Wandering Smith** — an old goblin offers to file your edge for a fee.
   *Pay 10 gold:* every attack +1 damage this fight (`attackBonus: 1`). *Move on:* nothing.
   (Hook: existing; new "pay, but only if you have it" pattern like the Well.)
3. **The Hot Spring** — steam curling off a pool off the path. *Soak:* restore 10 HP.
   *Scrub your gear:* start the fight with +6 block. (Hook: existing.)
4. **The Sleeping Troll** — a mountain of a troll snores across the tunnel.
   *Tip-toe past:* the boss starts at 90% HP (`bossHpFactor: 0.9` — you slip behind
   it before it gathers itself). *Poke it:* die — 5+: it lumbers off (nothing),
   else the boss enrages: +10% HP (`bossHpFactor: 1.1` — supports >1 today).
   (Hook: existing.)
5. **The Pickpocket** — small hands unzip your purse in the dark. *Chase:* coin —
   heads: catch them, +10 gold back, tails: they escape, −15 gold (min 0).
   *Let it go:* nothing. (Hook: existing.)

Pre-market:

6. **The Toll Bridge** — a troll with a lantern charges a crossing fee.
   *Pay 8 gold:* crossing granted, nothing else. *Hop the turnstile:* coin —
   caught in the act (−20 gold) or free ride.
   (Hook: existing.)
7. **The Rival Gambler** — a sharp-fanged goblin flips a coin of her own.
   *Call her flip:* coin — heads: +25 gold, tails: −15 gold. *Walk away:* nothing.
   (Hook: existing; the purest gambling event, deserves to exist.)
8. **The Lost Gobbling** — a gosling-sized goblin child is crying in an alley.
   *Help it home:* its grateful parent presses a trinket on you (`grantRandomTrinket()`).
   *Pocket its toy:* small gold, small shame (+10 gold). (Hook: existing.)

Needs a small engine hook first (a `pendingMarket` alongside `pendingFight`, consumed
by `openMarket()` — like pre-fight buffs, applied at the market screen):

9. **The Speakeasy** — buy the back room a round for *5 gold*: stall prices drop
   20% at the market you're about to enter.
10. **The Market Crier** — a herald will spread your legend for *5 gold*: the
    reroll button is free at this market (`pendingMarket: { freeReroll: true }`).

Hookless bonus, promote into the pre-market batch when we build it:

11. **The Cleared Stall** — a merchant is dragged off by debt collectors, stock
    spilling everywhere. *Loiter:* die — 5+: free random card (`grantRandomCard()`),
    else the collectors shake you down (−10 gold). *Keep walking:* nothing.

## Conventions for new events

- Two options, labels only — outcome text reveals after the choice.
- An option with a cost must check `game.gold` first and bail out gracefully when broke.
- Event outcomes never kill the player; HP changes floor at 1 (`Math.max(1, ...)`).
- Every event uses at most ONE gamble per option; the roll is shown, then the reveal.
- Keep the pool per junction even (currently 6/3) so refills stay varied.
