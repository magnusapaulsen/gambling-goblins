#!/usr/bin/env node
'use strict';
// ===================================================================
// Console test suite for game.js
// ===================================================================
// Loads the REAL game files (boss-art.js + game.js, unmodified) into a Node vm context
// with a stubbed `document`, then calls the game's own functions against the same code
// the browser runs. No dependencies, no build step: `node tools/engine-tests.js`.
//
// The stub document is generous (every element exists, classList works, children
// accumulate) so the full render path -- renderCombat, openMarket, showScreen -- runs
// headless without the game knowing it isn't in a browser.
// ===================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

// ---------- DOM stub ----------

function stubElement(id) {
  const classes = new Set();
  return {
    id,
    classes,
    classList: {
      add: (...cs) => cs.forEach(c => classes.add(c)),
      remove: (...cs) => cs.forEach(c => classes.delete(c)),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
      contains: c => classes.has(c),
    },
    style: {},
    dataset: {},
    innerHTML: '',
    textContent: '',
    children: [],
    appendChild(x) { this.children.push(x); return x; },
    disabled: false,
    draggable: false,
    onclick: null,
    ondragstart: null,
    ondragend: null,
    ondragover: null,
    getBoundingClientRect() { return { left: 0, width: 0 }; },
  };
}

function stubDocument() {
  const els = {};
  return {
    _els: els,                                // tests can peek at recorded screens
    getElementById(id) { return els[id] || (els[id] = stubElement(id)); },
    querySelectorAll() { return []; },
    createElement() { return stubElement(); },
    addEventListener() {},
  };
}

// ---------- Load the game ----------

const ctx = vm.createContext({
  console,
  document: stubDocument(),
  window: {},
  // Node timers -- game.js's dice/coin spin and the combo-popup reset use them.
  setTimeout, setInterval, clearTimeout, clearInterval,
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'boss-art.js'), 'utf8'), ctx, { filename: 'boss-art.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), ctx, { filename: 'game.js' });

// Export the game's internals. A second script in the same context shares the global
// lexical environment, so the game's top-level const/let are visible here. Getters are
// used for state that gets reassigned (game, marketState).
vm.runInContext(`
globalThis.A = {
  getG: () => game,
  getMarket: () => marketState,
  getEvent: () => game.event,
  setRand: (fn) => { rand = fn; },            // test-only: force junction/die outcomes
  mulberry32,
  newRun, endTurn, playCard, canPlayCard, trashCard, checkCombatEnd, rerollShop,
  maybeEvent, chooseEventOption: runEventOption, eventContinue, startCombat,
  attackHitOutcome, blockHitOutcome, resolveAttackHit, resolveBlockGain,
  gainGold, discountedPrice, gambleBaseDamage, cardDescText, shuffle, fireEvent,
  previewCardNumbers, BASE_ENERGY,
  CARD_LIBRARY, TRINKET_LIBRARY, BOSSES, SHOP_POOL_KEYS, STARTER_DECK_KEYS, SPRITES,
  BOSS_PORTRAITS, BOSS_VIEWS,
}`, ctx);
const A = ctx.A;

// ---------- Tiny test runner ----------
// Sequential (awaited) -- one test uses real timers for a dice-rolled event outcome,
// and the rest stay synchronous.

let passed = 0;
const failures = [];
const queue = [];

function section(title) {
  queue.push({ name: null, fn: null, title });
}

function test(name, fn) {
  queue.push({ name, fn, title: null });
}

async function runAll() {
  for (const { name, fn, title } of queue) {
    if (title) { console.log(`\n${title}`); continue; }
    try {
      await fn();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (err) {
      failures.push({ name, err });
      console.log(`FAIL  ${name}`);
      console.log(`      ${err.message.split('\n')[0]}`);
    }
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nfailures in detail:');
    for (const f of failures) {
      console.log(`\n--- ${f.name}`);
      console.log(f.err.stack);
    }
    process.exit(1);
  }
}

// Plays the whole first fight headlessly: repeatedly play the first normally-resolvable
// playable card (deferring gambles, gold-cost cards, discard-cost cards and self-damage,
// whose resolution is out of scope here), then end the turn. Deterministic for a fixed
// seed, which is what the determinism tests lean on.
function autobattle(maxSteps = 500) {
  for (let steps = 0; steps < maxSteps; steps++) {
    const c = A.getG().combat;
    if (!c || c.ended) return c;
    const playable = c.hand.find(card =>
      A.canPlayCard(card) &&
      !card.deferredAttack &&   // dice/coin gambles -- skipped, not simulated
      !card.goldCost &&
      !card.discardCost &&
      !card.selfDamage);
    if (playable) {
      A.playCard(playable.uid);
    } else {
      A.endTurn();
    }
  }
  throw new Error('autobattle did not end within maxSteps');
}

// Walks through any junction event that is blocking the flow: picks the LAST option of
// every first-batch event (deliberately plain -- no dice overlay, no timers) and hits
// Continue. Deterministic, and lets tests that only care about the market run to it.
function resolvePendingEvents() {
  let guard = 0;
  while (A.getEvent() && guard++ < 10) {
    A.chooseEventOption(1);   // last option: plain in every first-batch event
    A.eventContinue();
  }
}

console.log('engine-tests: game.js loaded from disk, running in Node vm\n');// ===================================================================
// Library integrity
// ===================================================================

test('every shop-pool and starter-deck key is a real card', () => {
  for (const key of [...A.SHOP_POOL_KEYS, ...A.STARTER_DECK_KEYS]) {
    assert.ok(A.CARD_LIBRARY[key], `unknown card key: ${key}`);
  }
});

test('every card has a sprite', () => {
  for (const key of Object.keys(A.CARD_LIBRARY)) {
    assert.ok(A.SPRITES[key], `missing sprite for card: ${key}`);
  }
});

test('every boss has a portrait and a view rect', () => {
  for (const boss of A.BOSSES) {
    assert.ok(A.BOSS_PORTRAITS[boss.name], `no portrait for boss: ${boss.name}`);
    assert.ok(A.BOSS_VIEWS[boss.name], `no view rect for boss: ${boss.name}`);
  }
});

test('every boss pattern contains a 0 turn and only positive hits', () => {
  for (const boss of A.BOSSES) {
    assert.ok(boss.maxHp > 0 && boss.pattern.length > 0, `bad boss def: ${boss.name}`);
    assert.ok(boss.pattern.includes(0), `${boss.name} lost its "does nothing" beat`);
    assert.ok(boss.pattern.every(h => h >= 0), `${boss.name} has a negative hit`);
  }
});

// ===================================================================
// Generated descriptions
// ===================================================================

test('every card desc renders with no missing fields or leftover braces', () => {
  for (const card of Object.values(A.CARD_LIBRARY)) {
    const text = A.cardDescText(card);
    assert.ok(!text.includes('{'), `${card.key}: desc still contains a brace: ${text}`);
    assert.ok(!text.includes('MISSING:'), `${card.key}: desc references a missing field: ${text}`);
    assert.ok(!text.includes('undefined'), `${card.key}: desc contains 'undefined': ${text}`);
  }
});

test('every trinket desc renders with no missing fields or leftover braces', () => {
  for (const trinket of Object.values(A.TRINKET_LIBRARY)) {
    const text = A.cardDescText(trinket);
    assert.ok(!text.includes('{'), `${trinket.key}: desc still contains a brace: ${text}`);
    assert.ok(!text.includes('MISSING:'), `${trinket.key}: desc references a missing field: ${text}`);
  }
});

test('descs are actually templated (most cards interpolate fields)', () => {
  const templated = Object.values(A.CARD_LIBRARY).filter(c => /\{\w+\}/.test(c.desc)).length;
  assert.ok(templated >= 25, `expected most card descs to be templates, got ${templated}`);
});

test('a desc change to the data updates the printed text', () => {
  // Strike's damage flows from baseDamage; retune it, the text follows.
  const strike = { ...A.CARD_LIBRARY.strike };
  strike.baseDamage = 7;
  assert.strictEqual(A.cardDescText(strike), 'Deal 7 damage.');
});

test('percent trinket descs read as whole percents', () => {
  const texts = Object.values(A.TRINKET_LIBRARY)
    .map(t => A.cardDescText(t));
  assert.ok(texts.includes('+10% gold gained.'), `Gold Loot desc wrong: got: ${texts.join(' | ')}`);
  assert.ok(texts.includes('+15% damage on rolls and flips.'), 'Lucky Coin desc wrong');
});

test('upgrading a card shows the upgrade in the desc with no extra note', () => {
  const strike = { ...A.CARD_LIBRARY.strike };
  strike.baseDamage += 4;
  strike.upgraded = true;
  assert.strictEqual(A.cardDescText(strike), 'Deal 10 damage.');
});

// ===================================================================
// Combo math
// ===================================================================

test('attackHitOutcome: base card, no combo', () => {
  A.newRun(1);
  const g = A.getG();
  g.comboStepBonus = 0;
  const o = A.attackHitOutcome(6, 0, 0);
  assert.strictEqual(o.mult, 1);
  assert.strictEqual(o.damage, 6);
});

test('attackHitOutcome: combo bonus scales with prior hits', () => {
  A.newRun(1);
  A.getG().comboStepBonus = 0;
  const o = A.attackHitOutcome(4, 3, 3);   // (4+3*3) * (1+0.2*3) = 13 * 1.6 = 20.8
  assert.strictEqual(o.mult, 1.6);
  assert.strictEqual(o.damage, 21);
});

test('attackHitOutcome reads comboStepBonus live (Combo Master)', () => {
  A.newRun(1);
  const g = A.getG();
  g.comboStepBonus = 0.1;
  const o = A.attackHitOutcome(10, 0, 1);  // (10) * (1+0.3*1) = 13
  assert.strictEqual(o.mult, 1.3);
  assert.strictEqual(o.damage, 13);
});

test('blockHitOutcome mirrors attackHitOutcome', () => {
  A.newRun(1);
  A.getG().comboStepBonus = 0;
  const o = A.blockHitOutcome(3, 4, 4);    // (3+4*4) * 1.8 = 34.2
  assert.strictEqual(o.mult, 1.8);
  assert.strictEqual(o.block, 34);
});

test('resolveAttackHit damages the first living boss and ticks the combo', () => {
  A.newRun(1);
  A.getG().comboStepBonus = 0;
  const c = A.getG().combat;
  const hpBefore = c.bosses[0].hp;
  A.resolveAttackHit(6);
  assert.strictEqual(c.bosses[0].hp, hpBefore - 6);
  assert.strictEqual(c.turnAttackCount, 1);
  // Second hit scores at mult 1.2 exactly like a combo card would.
  const { damage } = A.resolveAttackHit(10);
  assert.strictEqual(damage, 12);
  assert.strictEqual(c.bosses[0].hp, hpBefore - 18);
});

test('Whetstone-style attackBonus applies per hit', () => {
  A.newRun(1);
  A.getG().comboStepBonus = 0;
  A.getG().attackBonus = 2;
  const c = A.getG().combat;
  const hpBefore = c.bosses[0].hp;
  A.resolveAttackHit(6);
  assert.strictEqual(c.bosses[0].hp, hpBefore - 8);
});

// ===================================================================
// Economy math
// ===================================================================

test('gainGold rounds the Gold Loot bonus away and returns the actual amount', () => {
  A.newRun(1);
  const g = A.getG();
  g.goldLootBonus = 0.1;
  const goldBefore = g.gold;
  assert.strictEqual(A.gainGold(4), 4);    // 4.4 -> 4
  assert.strictEqual(g.gold, goldBefore + 4);
});

test('discountedPrice: free stays free, discount never makes things free', () => {
  A.newRun(1);
  const g = A.getG();
  assert.strictEqual(A.discountedPrice(0), 0);
  g.shopDiscount = 0.1;
  assert.strictEqual(A.discountedPrice(35), 32);   // round(31.5)
  g.shopDiscount = 0.99;
  assert.strictEqual(A.discountedPrice(50), 1);    // floor at 1
});

test('gambleBaseDamage rounds once so fractional bonuses land whole', () => {
  A.newRun(1);
  A.getG().gambleBonus = 0.15;
  assert.strictEqual(A.gambleBaseDamage(15), 17);  // round(17.25)
});

// ===================================================================
// Play gating
// ===================================================================

test('canPlayCard: no energy, no play', () => {
  A.newRun(1);
  const c = A.getG().combat;
  const strike = { ...A.CARD_LIBRARY.strike };
  c.energy = 0;
  assert.strictEqual(A.canPlayCard(strike), false);
  c.energy = 1;
  assert.strictEqual(A.canPlayCard(strike), true);
});

test('canPlayCard: self-damage that would kill you blocks Blood Money', () => {
  A.newRun(1);
  const g = A.getG();
  const bloodMoney = { ...A.CARD_LIBRARY.bloodMoney };
  g.hp = 5;
  assert.strictEqual(A.canPlayCard(bloodMoney), false);  // 5 dmg on 5 HP is lethal
  g.hp = 6;
  assert.strictEqual(A.canPlayCard(bloodMoney), true);
});

test('canPlayCard: discarded roll in progress blocks everything', () => {
  A.newRun(1);
  const c = A.getG().combat;
  const strike = { ...A.CARD_LIBRARY.strike };
  c.rolling = true;
  assert.strictEqual(A.canPlayCard(strike), false);
  c.rolling = false;
  assert.strictEqual(A.canPlayCard(strike), true);
});

test('canPlayCard: a discard cost needs that many OTHER cards (no clamping)', () => {
  A.newRun(1);
  const c = A.getG().combat;
  const overdraw = { ...A.CARD_LIBRARY.overdraw };       // discardCost 2
  c.hand = [{ uid: 1 }, { uid: 2 }, { uid: 987654 }];
  assert.strictEqual(A.canPlayCard(overdraw), true);     // card itself + 2 others
  c.hand = [{ uid: 1 }, { uid: 2 }];
  assert.strictEqual(A.canPlayCard(overdraw), false);    // only 1 other
});

// ===================================================================
// Seeded randomness
// ===================================================================

test('same seed => same shuffle, different seed => different shuffle', () => {
  A.newRun(4242);
  const order1 = A.getG().combat.drawPile.map(c => c.key).join(',');
  A.newRun(4242);
  const order2 = A.getG().combat.drawPile.map(c => c.key).join(',');
  A.newRun(9999);
  const order3 = A.getG().combat.drawPile.map(c => c.key).join(',');
  assert.strictEqual(order1, order2, 'same seed produced different draws');
  assert.notStrictEqual(order1, order3, 'different seed produced identical draws');
});

test('a seeded run replays identically end to end', () => {
  const fingerprint = (seed) => {
    A.newRun(seed);
    autobattle();
    resolvePendingEvents();                      // any junction event on the way to the market
    const g = A.getG();
    const market = A.getMarket();
    return JSON.stringify({
      seed,
      hp: g.hp,
      gold: g.gold,
      bossIndex: g.bossIndex,
      offers: market ? market.cardOffers.map(o => o.key) : null,
    });
  };
  assert.strictEqual(fingerprint(777), fingerprint(777), 'seed 777 did not reproduce');
  assert.notStrictEqual(fingerprint(777), fingerprint(778), 'different seeds did not diverge');
});

test('a seeded run beats boss 1 and opens the market exactly once', () => {
  A.newRun(777);
  const g = A.getG();
  autobattle();
  resolvePendingEvents();
  assert.ok(g.combat.ended, 'combat should be over');
  assert.ok(g.combat.bosses.every(b => b.hp <= 0), 'boss 1 should be dead');
  // 10 start + 15 base reward = 25 minimum EXCEPT the storyteller event's option 2
  // (a -5g kindness donation): the last option is the cheapest path to the market.
  assert.ok(g.gold >= 20, `reward not granted: gold=${g.gold}`);
  const market = A.getMarket();
  assert.ok(market, 'market should have opened');
  assert.strictEqual(market.boughtCardKeys.size, 0, 'no accidental auto-buys');
});

test('checkCombatEnd is idempotent: the reward is granted and market re-opened once', () => {
  A.newRun(1);
  const g = A.getG();
  g.combat.bosses[0].hp = 0;
  A.checkCombatEnd();
  resolvePendingEvents();                       // an event may sit between the kill and the market
  const market1 = A.getMarket();
  const gold1 = g.gold;
  const offers1 = market1.cardOffers.map(o => o.key);
  A.checkCombatEnd();
  assert.strictEqual(A.getMarket(), market1, 'market was re-opened');
  assert.strictEqual(g.gold, gold1, 'reward paid twice');
  assert.deepStrictEqual(A.getMarket().cardOffers.map(o => o.key), offers1, 'offers were rerolled');
});

// ===================================================================
// Death / deck safety
// ===================================================================

test('lethal damage ends the run on the gameover screen', () => {
  A.newRun(1);
  const g = A.getG();
  g.hp = 1;
  A.endTurn();                                 // boss pattern [0,...] or damage: either ends it
  // Force the deterministic branch if the first turn didn't kill (e.g. a 0-damage beat).
  if (!g.combat.ended) {
    g.hp = 1;
    g.combat.bosses[0].pattern[g.combat.bosses[0].patternIndex] = 99;
    A.endTurn();
  }
  assert.ok(g.combat.ended, 'combat should have ended');
  assert.ok(ctx.document.getElementById('screen-gameover').classList.contains('active'),
    'gameover screen should show');
});

test('trashCard removes a card from every zone', () => {
  A.newRun(1);
  const g = A.getG();
  const guard = g.deck.find(c => c.key === 'guard');
  A.trashCard(guard);
  assert.strictEqual(g.deck.filter(c => c.uid === guard.uid).length, 0, 'still in deck');
  const c = g.combat;
  for (const pile of ['drawPile', 'hand', 'discardPile', 'exhaustPile']) {
    assert.strictEqual(c[pile].filter(x => x.uid === guard.uid).length, 0, `still in ${pile}`);
  }
});

test('trashCard refuses to empty the run deck (last-card protection)', () => {
  A.newRun(1);
  const g = A.getG();
  // Hand the run a deck of exactly one card and put it into the current hand.
  const last = g.deck[0];
  g.deck = [last];
  g.combat.hand = [last];
  A.trashCard(last);
  assert.strictEqual(g.deck.length, 1, 'deck was emptied');
  assert.strictEqual(g.combat.hand.length, 1, 'card should be spared where it sits');
  assert.ok(/survives the trash/.test(g.combat.log[0]), `log top: ${g.combat.log[0]}`);
});

// ===================================================================
// Event system
// ===================================================================

test('fireEvent dispatches registered listeners and copies stack', () => {
  A.newRun(1);
  let hits = 0;
  A.__testStatus = () => { hits++; };   // not used; keep straight via addStatus below
  const g = A.getG();
  g.combat.statuses = [];
  g.combat.statuses.push({ on: 'turnStart', effect: () => { hits++; } });
  g.combat.statuses.push({ on: 'turnStart', effect: () => { hits++; } });
  A.fireEvent('turnStart', {});
  assert.strictEqual(hits, 2, 'listeners did not all fire');
  // A listener registering another listener mid-dispatch must not corrupt iteration.
  g.combat.statuses = [];
  g.combat.statuses.push({ on: 'turnStart', effect: () => { hits++; g.combat.statuses.push({ on: 'turnStart', effect: () => { hits += 100; } }); } });
  A.fireEvent('turnStart', {});
  assert.strictEqual(hits, 3, 'newly added listener must not fire in the same dispatch');
  A.fireEvent('turnStart', {});
  assert.strictEqual(hits, 4 + 100, 'newly added listener must fire on the next dispatch');
});

// ===================================================================
// Utility actions
// ===================================================================

test('rerollShop charges and escalates, and offers actually change', () => {
  A.newRun(1);
  const g = A.getG();
  autobattle();                              // get to the market; a fight over it is open
  g.gold = 1000;
  const before = A.getMarket().cardOffers.map(o => o.key).join(',');
  A.rerollShop();
  assert.strictEqual(g.rerollCost, 2, 'reroll cost should climb by REROLL_COST_STEP');
  const after1 = A.getMarket().cardOffers.map(o => o.key).join(',');
  assert.notStrictEqual(before, after1, 'offers did not change on reroll');
  g.gold = 0;
  const offers = A.getMarket().cardOffers.map(o => o.key).join(',');
  A.rerollShop();
  assert.strictEqual(A.getMarket().cardOffers.map(o => o.key).join(','), offers, 'poor player rerolled for free');
  assert.strictEqual(g.rerollCost, 2, 'failed reroll should not charge or escalate');
});

// ===================================================================
// Events
// ===================================================================

test('maybeEvent honors EVENT_CHANCE and defers the junction next-step', () => {
  A.newRun(1);
  let nextRan = false;
  // ALWAYS above EVENT_CHANCE -> straight through, no event.
  A.setRand(() => 0.99);
  A.maybeEvent('premarket', () => { nextRan = true; });
  assert.ok(nextRan, 'no event should have fired');
  assert.strictEqual(A.getEvent(), null, 'no event state should exist');
  // ALWAYS below -> an event fires and next stays deferred behind it.
  A.setRand(() => 0);
  nextRan = false;
  A.maybeEvent('premarket', () => { nextRan = true; });
  assert.ok(!nextRan, 'the junction should be blocked behind the event');
  const ev = A.getEvent();
  assert.ok(ev && ev.phase === 'choice', 'event should be waiting for a choice');
  assert.strictEqual(ev.def.when, 'premarket');
  assert.strictEqual(ev.def.options.length, 2, 'events are choose-one-of-two');
  assert.ok(ev.def.options.every(o => typeof o.label === 'string' && o.label.length > 0));
  // Restore the seeded stream so later tests are unaffected.
  A.setRand(A.mulberry32(1));
});

test('choosing reveals the outcome; continue then proceeds to the market', () => {
  A.newRun(1);
  const g = A.getG();
  // Force an event at the premarket junction; the junction's own next-step is marked.
  A.setRand(() => 0);
  let nextRan = false;
  A.maybeEvent('premarket', () => { nextRan = true; });
  A.setRand(A.mulberry32(1));
  const goldBefore = g.gold;
  A.chooseEventOption(1);                       // last option: plain in every first-batch event
  const ev = A.getEvent();
  assert.strictEqual(ev.phase, 'result', 'the reveal should be shown after choosing');
  assert.ok(ev.result.length > 0, 'outcome text should exist');
  A.eventContinue();
  assert.strictEqual(A.getEvent(), null, 'event should be over after continue');
  // The junction's deferred next-run happens exactly on Continue.
  assert.ok(nextRan, 'junction next-step should run on Continue');
});

test('the event pool never repeats a story before running dry', () => {
  A.newRun(1);
  A.setRand(() => 0);                            // every junction fires an event
  const seen = [];
  for (let i = 0; i < 4; i++) {                  // 3 premarket defs exist: the 4th draws from a refilled pool
    A.maybeEvent('premarket', () => { throw new Error('deflected: next ran during event'); });
    seen.push(A.getEvent().def.key);
    A.eventContinue();
  }
  const uniqueFirst = seen.slice(0, 3);
  assert.strictEqual(new Set(uniqueFirst).size, 3, 'no repeats before pool refill');
  assert.strictEqual(new Set(seen).size, 3, 'the refill draw repeats one of the three');
  A.setRand(A.mulberry32(1));
});

test('an event option with a die/coin shows its roll before the reveal', async () => {
  A.newRun(1);
  A.setRand(() => 0);
  A.maybeEvent('premarket', () => {});
  A.setRand(A.mulberry32(1));
  A.chooseEventOption(0);                       // first option: the gamble in several events
  // Wait for the dice overlay animation to finish (real timers: 11 ticks x 60ms + 400ms).
  const deadline = Date.now() + 4000;
  while (A.getEvent().phase === 'choice' && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50));
  }
  const final = A.getEvent();
  assert.strictEqual(final.phase, 'result', 'rolling should resolve into the reveal');
  assert.ok(final.result.length > 0, 'a rolled event still reveals a text outcome');
});

test('pre-fight buffs ride the junction into startCombat and reset per fight', () => {
  A.newRun(1);
  const g = A.getG();
  g.pendingFight = { attackBonus: 2, firstAttackBonus: 8, blockHitBonus: 1, startBlock: 8, energyDelta: -1, bossHpFactor: 0.8, ambushAttacks: 2 };
  A.startCombat();
  const c = g.combat;
  assert.strictEqual(c.attackHitBonus, 2);
  assert.strictEqual(c.firstAttackBonus, 8);
  assert.strictEqual(c.blockHitBonus, 1);
  assert.strictEqual(c.block, 8);                // startBlock applied on the fight's opening block
  assert.strictEqual(c.energy, A.BASE_ENERGY - 1);
  assert.strictEqual(c.ambushAttacks, 2);
  assert.strictEqual(c.bosses[0].hp, Math.round(A.BOSSES[0].maxHp * 0.8), 'boss starts at 80% HP');
  assert.strictEqual(g.pendingFight, null, 'event buffs are consumed by the fight that uses them');
  // Consuming them again must not re-apply anything (no double-dipping):
  A.startCombat();
  assert.strictEqual(g.combat.attackHitBonus, 0, 'a second fight starts clean');
  assert.strictEqual(g.combat.block, 0);
});

test('attackHitBonus and firstAttackBonus flow through resolveAttackHit', () => {
  A.newRun(1);
  const g = A.getG();
  A.startCombat();
  const c = g.combat;
  c.attackHitBonus = 2;
  c.firstAttackBonus = 8;
  c.turnAttackCount = 0;
  g.comboStepBonus = 0;
  // First hit of the fight gets BOTH bonuses, multiplies at x1, and consumes the first-attack bonus.
  assert.strictEqual(A.resolveAttackHit(6).damage, 16);  // 6 + 2 + 8
  assert.strictEqual(c.firstAttackBonus, 0, 'first-attack bonus consumed by its one hit');
  // Later hits only take the per-hit bonus (6 + 2 = 8, at mult 1.2 -> round(9.6) = 10).
  assert.strictEqual(A.resolveAttackHit(6).damage, 10);
});

test('blockHitBonus flows through resolveBlockGain and boosts every block hit', () => {
  A.newRun(1);
  A.startCombat();
  const c = A.getG().combat;
  c.blockHitBonus = 3;
  const { block } = A.resolveBlockGain(5);
  assert.strictEqual(block, 8);
});

test('ambush doubling applies to the boss attack loop and counts every attack', () => {
  A.newRun(1);
  A.startCombat();
  const g = A.getG();
  const c = g.combat;
  c.ambushAttacks = 2;
  const boss = c.bosses[0];
  boss.pattern = [5, 0];
  boss.patternIndex = 0;
  g.hp = 500;                                    // survive whatever comes
  c.block = 0;
  A.endTurn();                                   // the 5 lands doubled (10), one swing spent
  assert.strictEqual(c.ambushAttacks, 1, 'first attack spent one ambush swing');
  assert.ok(c.log.some(m => /AMBUSH/.test(m)), 'the log mentions the doubled hit');
  A.endTurn();                                   // the 0 ALSO spends the last ambush swing
  assert.strictEqual(c.ambushAttacks, 0, '"next two attacks are doubled", literally');
});

test('card previews mirror the event bonuses (the face shows the real numbers)', () => {
  A.newRun(1);
  A.startCombat();
  const c = A.getG().combat;
  A.getG().comboStepBonus = 0;
  c.attackHitBonus = 2;
  c.firstAttackBonus = 8;
  c.blockHitBonus = 3;
  const strike = { ...A.CARD_LIBRARY.strike, uid: 1 };
  const guard = { ...A.CARD_LIBRARY.guard, uid: 2 };
  const atk = A.previewCardNumbers(strike);      // 6 + 2 + 8 = 16 on the first hit
  assert.strictEqual(atk.atk, 16);
  const blk = A.previewCardNumbers(guard);       // 5 + 3 = 8
  assert.strictEqual(blk.block, 8);
});

// ===================================================================

runAll();
