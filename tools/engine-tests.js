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
  newRun, endTurn, playCard, canPlayCard, trashCard, checkCombatEnd, rerollShop,
  attackHitOutcome, blockHitOutcome, resolveAttackHit, resolveBlockGain,
  gainGold, discountedPrice, gambleBaseDamage, cardDescText, shuffle, fireEvent,
  CARD_LIBRARY, TRINKET_LIBRARY, BOSSES, SHOP_POOL_KEYS, STARTER_DECK_KEYS, SPRITES,
  BOSS_PORTRAITS, BOSS_VIEWS,
}`, ctx);
const A = ctx.A;

// ---------- Tiny test runner ----------

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message.split('\n')[0]}`);
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

console.log('engine-tests: game.js loaded from disk, running in Node vm\n');

// ===================================================================
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
  assert.ok(g.combat.ended, 'combat should be over');
  assert.ok(g.combat.bosses.every(b => b.hp <= 0), 'boss 1 should be dead');
  assert.ok(g.gold >= 25, `reward not granted: gold=${g.gold}`);   // 10 start + 15 base reward
  const market = A.getMarket();
  assert.ok(market, 'market should have opened');
  assert.strictEqual(market.boughtCardKeys.size, 0, 'no accidental auto-buys');
});

test('checkCombatEnd is idempotent: the reward is granted and market re-opened once', () => {
  A.newRun(1);
  const g = A.getG();
  g.combat.bosses[0].hp = 0;
  A.checkCombatEnd();
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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nfailures in detail:');
  for (const f of failures) {
    console.log(`\n--- ${f.name}`);
    console.log(f.err.stack);
  }
  process.exit(1);
}
