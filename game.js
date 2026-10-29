// ===================================================================
// GAMBLING GOBLINS — prototype roguelike deckbuilder
// Slay the Spire flow + Clank!-simple cards + Balatro-style combo scoring
// ===================================================================

// ---------- Card definitions ----------
// type: 'attack' | 'block' | 'loot' | 'skill'
// 'skill' covers both draw-effect cards (drawOnPlay) and energy-effect cards (energyGain) --
// mechanically different but sharing one color/category, so the desc is what tells them
// apart, not the type.
// Attack and block cards both scale with a per-turn combo multiplier (more of that
// type hitting this turn = bigger multiplier on each one) -- small/cheap cards lean on
// that, while big/expensive cards trade the multiplier for higher flat single-card value.
// The counters tick per HIT, not per card: a `hits: 4` card advances the combo four
// steps and takes the multiplier on each of its four hits. Card descs say "per ... hit"
// to match.
// A card with `discardCost` makes the player click that many hand cards to discard --
// usually as a cost BEFORE its own drawOnPlay/energyGain resolve (see
// beginDiscardSelection()). A card with `drawFirst: true` flips that order: it draws
// first, then asks for discards out of the bigger hand. Only Overdraw uses it.

const CARD_LIBRARY = {
  // ==================== ATTACK ====================
  strike: { key: 'strike',            name: 'Strike',          type: 'attack', cost: 1, baseDamage: 6,                                                               desc: 'Deal {baseDamage} damage.' },
  quickStab: { key: 'quickStab',        name: 'Quick Stab',      type: 'attack', cost: 1, baseDamage: 4,                          drawOnPlay: 1,                       price: 25, desc: 'Deal {baseDamage} damage. Draw {drawOnPlay} card.' },
  comboStrike: { key: 'comboStrike',      name: 'Combo Strike',    type: 'attack', cost: 1, baseDamage: 4,           comboBonus: 3,                                      price: 40, desc: 'Deal {baseDamage} damage (+{comboBonus} per attack hit this turn).' },
  twinBlades: { key: 'twinBlades',       name: 'Twin Blades',     type: 'attack', cost: 2, baseDamage: 8,  hits: 2,                                                     price: 45, desc: 'Deal {baseDamage} damage, {hits} times.' },
  heavyStrike: { key: 'heavyStrike',      name: 'Heavy Strike',    type: 'attack', cost: 3, baseDamage: 30,                                                              price: 70, desc: 'Deal {baseDamage} damage.' },
  thousandCuts: { key: 'thousandCuts',     name: 'Thousand Cuts',   type: 'attack', cost: 2, baseDamage: 2,  hits: 5,                                                     price: 45, desc: 'Deal {baseDamage} damage, {hits} times.' },

  // Shares deferredAttack/combo-counting mechanics with the High Roller loot cards
  // (see the comment above rollTheBones in the LOOT group) even though this one is a
  // straight attack card, not a gold-cost gamble. The miss threshold lives in the
  // `rollHit` field (read by onPlay), so tuning it updates the desc automatically.
  glassCannon: { key: 'glassCannon',      name: 'Glass Cannon',    type: 'attack', cost: 0, baseDamage: 30, rollHit: 4,                            deferredAttack: true, price: 50, desc: 'Roll a die: {rollHit}+ deals {baseDamage} damage, else this card is destroyed.',
    onPlay(card) {
      const combatId = game.combat.combatId;
      rollDie(game.combat, 6, (roll) => {
        if (game.combat.combatId !== combatId) return; // stale callback, combat replaced
        if (roll >= card.rollHit) {
          const { damage, mult } = resolveAttackHit(gambleBaseDamage(card.baseDamage));
          logMsg(`Glass Cannon: rolled ${roll}, hit for ${damage} damage.`);
          if (mult > 1.001) showComboPopup(`ATK x${mult.toFixed(2)}!`);
        } else {
          logMsg(`Glass Cannon: rolled ${roll}, misses completely.`);
          trashCard(card);
        }
        renderCombat();
        checkCombatEnd();
      });
    },
  },

  // Ambush: rewards playing it as your FIRST attack this turn.
  // Base 4 damage, but if turnAttackCount is 0 (no attacks yet), deals +10 and gains 1 Energy.
  // Strong opener, falls off if you combo into it. Cost 1 keeps it accessible.
  ambush: { key: 'ambush', name: 'Ambush', type: 'attack', cost: 1, baseDamage: 4, price: 35, firstStrike: 10, firstStrikeEnergy: 1, desc: 'Deal {baseDamage} damage. If this is your first attack this turn, deal +{firstStrike} damage and gain {firstStrikeEnergy} Energy.' },

  // ==================== BLOCK ====================
  // Block mirrors attack: turnBlockCount ticks once per hit, so `hits` buys triggers here
  // the same way it does on the attack side, and blockComboBonus is the block twin of
  // comboBonus. Remember block does not carry over -- c.block is wiped every endTurn --
  // so everything here is single-turn value.
  guard: { key: 'guard',              name: 'Guard',           type: 'block',  cost: 1, block: 5,                                                                                                   desc: 'Gain {block} block.' },
  shieldWall: { key: 'shieldWall',       name: 'Shield Wall',     type: 'block',  cost: 2, block: 14,                                                                                                  price: 30, desc: 'Gain {block} block.' },
  armor: { key: 'armor',            name: 'Armor',           type: 'block',  cost: 3, block: 24,                                                                                                  price: 40, desc: 'Gain {block} block.' },
  brace: { key: 'brace',            name: 'Brace',           type: 'block',  cost: 0, block: 2,                                                                                                   price: 25, desc: 'Gain {block} block.' },
  bulwark: { key: 'bulwark',          name: 'Bulwark',         type: 'block',  cost: 2, block: 3,  hits: 4,                                                                                         price: 50, desc: 'Gain {block} block, {hits} times.' },
  stonewall: { key: 'stonewall',        name: 'Stonewall',       type: 'block',  cost: 1, block: 4,           blockComboBonus: 4,                                                                     price: 40, desc: 'Gain {block} block (+{blockComboBonus} per block hit this turn).' },
  shieldBash: { key: 'shieldBash',       name: 'Shield Bash',     type: 'block',  cost: 2, block: 8,                               damageFromBlockPercent: 1.0,                     isAttackToo: true, price: 55, desc: 'Gain {block} block, then deal damage equal to your block.' },
  brambleGuard: { key: 'brambleGuard',     name: 'Bramble Guard',   type: 'block',  cost: 2, block: 10,                                                           retaliateDamage: 5,                    price: 50, desc: 'Gain {block} block. Retaliate for {retaliateDamage} damage when attacked this combat.',
    onPlay(card) {
      addStatus('playerAttacked', () => {
        const c = game.combat;
        const target = c.bosses.find(b => b.hp > 0);
        if (target) target.hp = Math.max(0, target.hp - card.retaliateDamage);
        logMsg(`Bramble Guard retaliates for ${card.retaliateDamage} damage!`);
      });
    },
  },

  // ==================== LOOT ====================
  // Pure economy: none of these deal damage or grant block, so each one trades tempo in
  // the current fight for buying power at the next market. Every gain routes through
  // gainGold() so the Gold Loot trinket applies -- note that gainGold rounds, so small
  // per-tick amounts (Skim at 1-2, Kickback at 3) can round the bonus away.
  treasureGrab: { key: 'treasureGrab',     name: 'Treasure Grab',   type: 'loot',   cost: 1, gold: 4,                                                                                                                      desc: 'Gain {gold} gold.' },
  shakedown: { key: 'shakedown',        name: 'Shakedown',       type: 'loot',   cost: 1, gold: 5,                                                                                                                      price: 30, desc: 'Gain {gold} gold.' },
  skim: { key: 'skim',             name: 'Skim',            type: 'loot',   cost: 0,                        goldPerAttack: 1,                                                                                      price: 35, desc: 'Gain {goldPerAttack} gold per attack hit this turn.',
    onPlay(card) {
      const n = game.combat.turnAttackCount;
      if (n <= 0) {
        logMsg('Skim: no attacks played this turn -- nothing to skim.');
        return;
      }
      const g = gainGold(n * card.goldPerAttack);
      logMsg(`Skim: ${n} attack(s) this turn, gained ${g} gold.`);
    },
  },
  crackTheVault: { key: 'crackTheVault',    name: 'Crack the Vault', type: 'loot',   cost: 3, gold: 15,                                                                                                                     price: 45, desc: 'Gain {gold} gold.' },
  protectionRacket: { key: 'protectionRacket', name: 'Kickback',        type: 'loot',   cost: 1,                                          goldPerTurn: 3,                                                                      price: 50, desc: 'Gain {goldPerTurn} gold at the start of each turn, starting next turn.',
    onPlay(card) {
      // Statuses live until startCombat() replaces the whole combat object at the next
      // fight, so this keeps paying every turn for the rest of the fight. Each copy played
      // registers its own listener, so copies stack.
      addStatus('turnStart', () => {
        const g = gainGold(card.goldPerTurn);
        logMsg(`Kickback: collected ${g} gold.`);
      });
      logMsg('Kickback: the arrangement starts paying next turn.');
    },
  },
  bloodMoney: { key: 'bloodMoney',       name: 'Blood Money',     type: 'loot',   cost: 0, gold: 8,                                                 selfDamage: 5,                                                       price: 35, desc: 'Lose {selfDamage} HP. Gain {gold} gold.' },

  // The deck's answer to its own gamble cards. Registers a listener for the `cardMissed`
  // event, fired by trashCard (Glass Cannon 1-3) and resolveGoldCardOutcome (Double Up
  // tails): a whiff stops being dead value and turns into resources --
  // which also makes it a reason to keep pitching the coin when the smart play is to pass.
  // The listener lives until startCombat() replaces the combat object, and each copy
  // registers its own listener, so copies stack.
  hedge: { key: 'hedge',            name: 'Hedge',           type: 'loot',   cost: 1,                                          goldPerMiss: 4,                  blockPerMiss: 3,                                                                price: 50, desc: 'Whenever one of your cards misses this combat, gain {goldPerMiss} gold and {blockPerMiss} block.',
    onPlay(card) {
      addStatus('cardMissed', () => {
        const c = game.combat;
        const g = gainGold(card.goldPerMiss);
        // Straight onto c.block, not through resolveBlockGain: a miss is not a block
        // "hit", so it must not tick turnBlockCount or take the block combo multiplier.
        // Same distinction Bramble Guard's retaliation makes for the attack counters.
        c.block += card.blockPerMiss;
        logMsg(`Hedge: collected ${g} gold and ${card.blockPerMiss} block.`);
      });
    },
  },

  // Both gamble cards below are free to acquire (price: 0) and free in energy (cost: 0),
  // and charge gold per play (goldCost) instead. All the tunable numbers live on the card
  // defs: goldCost is the per-play price, damagePerPip / winDamage are the payouts. Change
  // them here; the desc strings are generated from the same fields and can't drift.
  //
  // Both COUNT FOR COMBO: the roll/flip decides the base damage and resolveAttackHit
  // scales it, so they increment turnAttackCount and take the multiplier exactly like any
  // other attack. A failed gamble does not -- see the tails branch on Double Up below.
  //
  // They carry `deferredAttack` because they resolve their damage inside onPlay once the
  // animation settles. It is redundant while their type is 'loot' (playCard's automatic
  // attack branch only fires for 'attack' / isAttackToo), but it stops them double-dipping
  // if that type is ever changed. Glass Cannon (ATTACK group) shares this same mechanic.
  rollTheBones: { key: 'rollTheBones',     name: 'Bones',           type: 'loot',   cost: 0,           goldCost: 5,                                                  damagePerPip: 2,                deferredAttack: true, price: 0, desc: 'Pay {goldCost} gold. Roll a die: deal {damagePerPip}x the roll in damage.',
    onPlay(card) {
      const combatId = game.combat.combatId;
      rollDie(game.combat, 6, (roll) => {
        if (game.combat.combatId !== combatId) return;
        const { damage, mult } = resolveAttackHit(gambleBaseDamage(roll * card.damagePerPip));
        logMsg(`Bones: rolled a ${roll}, dealt ${damage} damage.`);
        if (mult > 1.001) showComboPopup(`ATK x${mult.toFixed(2)}!`);
        renderCombat();
        checkCombatEnd();
      });
    },
  },
  doubleOrNothing: { key: 'doubleOrNothing',  name: 'Double Up',       type: 'loot',   cost: 0,           goldCost: 5,                                                                   winDamage: 15, deferredAttack: true, price: 0, desc: 'Pay {goldCost} gold. Coin flip: heads deals {winDamage} damage, tails nothing.',
    onPlay(card) {
      const combatId = game.combat.combatId;
      flipCoin(game.combat, (heads) => {
        if (game.combat.combatId !== combatId) return;
        if (heads) {
          const { damage, mult } = resolveAttackHit(gambleBaseDamage(card.winDamage));
          logMsg(`Double Up: heads! Dealt ${damage} damage.`);
          if (mult > 1.001) showComboPopup(`ATK x${mult.toFixed(2)}!`);
        } else {
          // Tails matches Glass Cannon's miss: resolveAttackHit is never called, so no
          // damage and no turnAttackCount increment -- a whiff must not inflate the combo
          // for cards played after it.
          logMsg('Double Up: tails. Nothing happens.');
        }
        resolveGoldCardOutcome(card, heads);
        renderCombat();
        checkCombatEnd();
      });
    },
  },

  // ==================== SKILL ====================
  sidestep: { key: 'sidestep',         name: 'Sidestep',        type: 'skill',  cost: 0, block: 2,                drawOnPlay: 2,                                      price: 45, desc: 'Gain {block} block. Draw {drawOnPlay} cards.' },
  gather: { key: 'gather',           name: 'Gather',          type: 'skill',  cost: 0,                          drawOnPlay: 3,                                      price: 25, desc: 'Draw {drawOnPlay} cards.' },
  overdraw: { key: 'overdraw',         name: 'Overdraw',        type: 'skill',  cost: 0,                          drawOnPlay: 4, discardCost: 2, drawFirst: true,               price: 40, desc: 'Draw {drawOnPlay} cards. Discard {discardCost} cards.' },
  spark: { key: 'spark',            name: 'Spark',           type: 'skill',  cost: 0,           energyGain: 1,                                                     price: 30, desc: 'Gain {energyGain} energy.' },
  overcharge: { key: 'overcharge',       name: 'Overcharge',      type: 'skill',  cost: 0,           energyGain: 1,                discardCost: 1,                      price: 45, desc: 'Discard {discardCost} card. Gain {energyGain} energy.' },
  burnout: { key: 'burnout',          name: 'Burnout',         type: 'skill',  cost: 0,           energyGain: 3, drawOnPlay: 3,                 exhaustOnPlay: true, price: 50, desc: 'Gain {energyGain} energy. Draw {drawOnPlay} cards. Exhausts after use.' },

  // Named "Loaded Dice" like the trinket, but a different thing (a played card, not a
  // passive) -- distinct key so the two don't collide, flagged to the user as a naming
  // overlap worth knowing about.
  loadedDiceCard: { key: 'loadedDiceCard',   name: 'Loaded Dice',     type: 'skill',  cost: 0,                                                                              price: 40, desc: 'Your next roll or flip this turn is guaranteed to hit its best outcome.',
    onPlay(card) { game.combat.forcedNextRoll = 'max'; },
  },
};

// Trinkets are repeatable purchases: each buy stacks by calling apply(game) again,
// which nudges a plain constant on `game`. No per-effect special-casing elsewhere.
// Listed with shopSize first so it's always visible in the base 3 trinket slots --
// otherwise it could hide behind its own "+1 shop slot" effect and never be reachable.
// effectAmount is read by apply() via `this` (each apply is always called as
// `offer.apply(game)`, a method call, so `this` is the trinket object) rather than being
// a literal in the function body.
// desc strings are templates (see cardDescText): {effectAmount} prints the trinket's
// per-stack effect, so tuning a number updates both the effect and its printed text from
// one edit. Percent-style trinkets use {effectAmount:x100} so 0.10 prints as "10%".
const TRINKET_LIBRARY = {
  shopSize:      { key: 'shopSize',      name: 'Shop Size',      price: 45, effectAmount: 1,    desc: '+{effectAmount} card & trinket slot in the market.', apply(game) { game.shopSizeBonus += this.effectAmount; } },
  maxHp:         { key: 'maxHp',         name: 'Max HP',         price: 35, effectAmount: 10,   desc: '+{effectAmount} Max HP.',                          apply(game) { game.maxHp += this.effectAmount; game.hp += this.effectAmount; } },
  handSize:      { key: 'handSize',      name: 'Hand Size',      price: 50, effectAmount: 1,    desc: '+{effectAmount} card drawn per turn.',               apply(game) { game.handSizeBonus += this.effectAmount; } },
  goldLoot:      { key: 'goldLoot',      name: 'Gold Loot',      price: 35, effectAmount: 0.10, desc: '+{effectAmount:x100}% gold gained.',                    apply(game) { game.goldLootBonus += this.effectAmount; } },
  shopDiscount:  { key: 'shopDiscount',  name: 'Shop Discount',  price: 35, effectAmount: 0.10, desc: '-{effectAmount:x100}% market prices.',                  apply(game) { game.shopDiscount += this.effectAmount; } },
  luckyCoin:     { key: 'luckyCoin',     name: 'Lucky Coin',     price: 45, effectAmount: 0.15, desc: '+{effectAmount:x100}% damage on rolls and flips.',      apply(game) { game.gambleBonus += this.effectAmount; } },
  bloodVial:     { key: 'bloodVial',     name: 'Blood Vial',     price: 35, effectAmount: 5,    desc: 'Heal {effectAmount} HP after each boss.',            apply(game) { game.healAfterKill += this.effectAmount; } },

  // --- NEW TRINKETS -----------------------------------------------------------
  // +1 energy per turn. The most impactful resource buff in the game; costs 60g
  // and stacks per purchase. Reads in startCombat (initial energy) and endTurn
  // (energy per turn).
  energyCore:    { key: 'energyCore',    name: 'Energy Core',    price: 60, effectAmount: 1,    desc: '+{effectAmount} energy per turn.',                  apply(game) { game.energyBonus += this.effectAmount; } },

  // +0.1 combo step. Multiplies the value of every combo card. Stacks additively:
  // 0.2 -> 0.3 -> 0.4 ... Scales every combo card in the deck. Costs 50g.
  comboMaster:   { key: 'comboMaster',   name: 'Combo Master',   price: 50, effectAmount: 0.1,  desc: '+{effectAmount} combo step.',                    apply(game) { game.comboStepBonus += this.effectAmount; } },

  // +2 base damage on EVERY attack hit. Flat, honest, stacks linearly. Makes
  // starter Strikes relevant late and feeds combo engines. Needs a new
  // game.attackBonus read in resolveAttackHit (added).
  whetstone:     { key: 'whetstone',     name: 'Whetstone',      price: 40, effectAmount: 2,    desc: '+{effectAmount} base damage on every attack.',      apply(game) { game.attackBonus += this.effectAmount; } },

  // +2 base block on EVERY block hit. Mirror of Whetstone. Pairs obscenely
  // with Shield Bash (damage = block). Needs game.blockBonus in
  // resolveBlockGain (added).
  ironwoodCharm: { key: 'ironwoodCharm', name: 'Ironwood Charm',  price: 40, effectAmount: 2,    desc: '+{effectAmount} base block on every block.',        apply(game) { game.blockBonus += this.effectAmount; } },

  // +8 gold every market visit. Pure economy, no combat hook. Payout in
  // openMarket before rendering.
  coinPurse:     { key: 'coinPurse',     name: 'Coin Purse',     price: 30, effectAmount: 8,    desc: '+{effectAmount} gold every market visit.',          apply(game) { game.marketGold += this.effectAmount; } },

  // +10 HP on Rest & Heal. Makes the heal service scale into late run
  // instead of falling behind Lich/Void Herald damage.
  fieldMedic:    { key: 'fieldMedic',    name: 'Field Medic',    price: 35, effectAmount: 10,   desc: '+{effectAmount} HP on Rest & Heal.',               apply(game) { game.healBonus += this.effectAmount; } },

  // Second Wind: once per combat, survive lethal damage at 1 HP.
  // Needs a per-combat flag and a hook in endTurn where boss damage lands.
  secondWind:    { key: 'secondWind',    name: 'Second Wind',    price: 45, effectAmount: 1,    desc: 'Once per combat, survive lethal damage at 1 HP.', apply(game) { game.secondWind += this.effectAmount; } },
};

const STARTER_DECK_KEYS = ['strike', 'strike', 'strike', 'strike', 'strike', 'guard', 'guard', 'guard', 'guard', 'treasureGrab'];
const SHOP_POOL_KEYS = [
  'quickStab', 'shieldWall', 'sidestep', 'comboStrike', 'twinBlades', 'heavyStrike', 'gather', 'overdraw', 'spark', 'overcharge',
  'thousandCuts', 'armor', 'burnout',
  'brace', 'bulwark', 'stonewall', 'shieldBash', 'brambleGuard',
  'shakedown', 'skim', 'crackTheVault', 'protectionRacket', 'bloodMoney', 'hedge',
  'rollTheBones', 'doubleOrNothing', 'glassCannon', 'loadedDiceCard', 'ambush',
];

// 10-boss curve (up from 4) so a run means more market visits and more time building
// the deck. HP steps get bigger each fight (18, 24, 30, 38, 45, 55, 65, 75, 80) rather
// than scaling linearly -- early fights are easy on a starter deck with 3 energy/turn,
// and the ramp steepens later once the player has had several markets to buy cards and
// trinkets.
//
// Every pattern includes one 0 -- a real "boss does nothing this turn" beat, telegraphed
// by the intent display like anything else -- paired with a spike roughly 2x the old max
// hit. This closes off stalling out a fight on purpose (playing only loot/skip turns to
// reshuffle the deck and re-farm gold cards indefinitely): the free turn is real, but the
// cycle's other beats hit hard enough that turtling through many cycles to grind gold
// still costs meaningful HP, rather than the old flat, low patterns that a starter deck
// could tank forever. Early bosses got the biggest relative jump since they were the
// easiest to stall on. God keeps its "no escape" flavor -- still no single dominant
// spike -- but now also has one dead beat like every other boss.
const BOSSES = [
  { name: 'Rat Swarm',    maxHp: 45,  pattern: [0, 5, 8, 4] },
  { name: 'Cave Troll',   maxHp: 60,  pattern: [0, 7, 11, 5] },
  { name: 'Bandit Chief', maxHp: 80,  pattern: [0, 8, 14, 6] },
  { name: 'Rock Golem',   maxHp: 105, pattern: [0, 9, 16, 7] },
  { name: 'Swamp Hag',    maxHp: 135, pattern: [0, 10, 18, 8] },
  { name: 'Iron Sentinel',maxHp: 170, pattern: [0, 11, 20, 9] },
  { name: 'The Dragon',   maxHp: 210, pattern: [0, 12, 22, 10] },
  { name: 'Lich',         maxHp: 260, pattern: [0, 13, 24, 11] },
  { name: 'Void Herald',  maxHp: 315, pattern: [0, 14, 26, 12] },
  { name: 'God',          maxHp: 380, pattern: [0, 12, 14, 16, 12] },
];

// ---------- Events ----------
// Random story beats at the two junctions of a run: after winning a fight (before the
// market, 'premarket') and after leaving the market (before the next fight, 'prefight').
// Each one shows a scene and two LABELED-BUT-UNEXPLAINED choices; the outcome text is
// only revealed after choosing. Options whose outcome uses a die or coin show the same
// animation as combat gambles (the dice overlay), drawn from the run's seeded stream so
// a whole run -- fights, markets AND events -- replays under the same ?seed=.
// Pre-fight events apply to the NEXT fight only, via game.pendingFight, which
// startCombat() consumes and clears (see the 'pendingFight' notes there). Pre-market
// events resolve on the spot.
// An event is never drawn twice until the whole pool for its junction has been used.
const EVENT_CHANCE = 0.4; // per junction; fishing the run's key moments, not every leg

const EVENT_LIBRARY = {
  // ==================== PRE-FIGHT ====================
  footprints: {
    key: 'footprints', when: 'prefight',
    name: 'Someone Follows',
    story: 'You are walking through the woods when you hear footsteps behind you. What do you do?',
    options: [
      {
        label: 'Climb up a tree',
        outcome(done) {
          game.pendingFight = { ...game.pendingFight, attackBonus: 2 };
          done('You wedge yourself into the crook of a thick branch as whatever-it-was slinks past below. From up here you will hit hard: +2 damage on all attacks for the coming fight.');
        },
      },
      {
        label: 'Ask who is there',
        outcome(done) {
          done('The footsteps stop. For a long moment there is only breathing that is not yours. Then the woods are simply quiet again, and the path goes on. (Nothing happened.)');
        },
      },
    ],
  },

  campfire: {
    key: 'campfire', when: 'prefight',
    name: 'The Abandoned Campfire',
    story: 'Someone fled this campsite in a hurry. A cold fire smoulders among scattered gear; one unopened flask sits on a flat rock. What do you do?',
    options: [
      {
        label: 'Search the ashes',
        outcome(done) {
          rollDie(game.event, 6, (roll) => {
            if (roll >= 4) {
              const g = gainGold(25);
              done(`Under the warm top layer you find coins someone scooped for in panic, and missed: +${g} gold.`);
            } else {
              // Clamped at 1 HP: an event should carry a cost, never a loss on its own.
              game.hp = Math.max(1, game.hp - 5);
              done('The ashes shift, and hot embers find your bare hand. You pull back fast, palm scorched: lose 5 HP.');
            }
          });
        },
      },
      {
        label: 'Take the intact flask',
        outcome(done) {
          const healed = Math.min(game.maxHp - game.hp, 10);
          game.hp += healed;
          done(healed > 0
            ? `The stopper comes free and the contents taste like pine and peace. Restore ${healed} HP.`
            : 'It smells like pine and peace, but you are already unhurt, so it mostly tastes like regret. (No effect.)');
        },
      },
    ],
  },

  luckyWell: {
    key: 'luckyWell', when: 'prefight',
    name: 'The Lucky Well',
    story: 'A mossy well hunches beside the path, deep enough that thrown coins do not echo when they land. What do you do?',
    options: [
      {
        label: 'Toss in 10 gold and wish',
        outcome(done) {
          if (game.gold < 10) {
            done('You pat your pockets and find mostly lint and one dead beetle. The well has no mercy for the broke. (No effect.)');
            return;
          }
          game.gold -= 10;
          game.pendingFight = { ...game.pendingFight, firstAttackBonus: 8 };
          done('The coins vanish without a splash. The air hums faintly, settling on your weapon: your first attack of the coming fight lands +8 damage harder.');
        },
      },
      {
        label: 'Read the graffiti',
        outcome(done) {
          game.pendingFight = { ...game.pendingFight, blockHitBonus: 1 };
          done('Scratched into the moss by a dozen bored goblins is a prayer, or possibly a shopping list about vigilance: every block hit this fight grants +1 extra block.');
        },
      },
    ],
  },

  shrine: {
    key: 'shrine', when: 'prefight',
    name: "The Gambler's Shrine",
    story: 'At the crossroads squats a one-eyed stone gambler, moss in the sockets. A carved die rests at his feet, left there as an offering. What do you do?',
    options: [
      {
        label: 'Bow to it',
        outcome(done) {
          game.pendingFight = { ...game.pendingFight, blockHitBonus: 4 };
          done('You bow lower than dignity allows. The stone gaze holds a beat longer than physics suggests. Gain +4 block on every block hit this fight.');
        },
      },
      {
        label: 'Pocket the carved die',
        outcome(done) {
          flipCoin(game.event, (heads) => {
            if (heads) {
              const g = gainGold(15);
              done(`The heist is clean. The idol does not move, the moss does not rustle, and you are richer: +${g} gold.`);
            } else {
              game.pendingFight = { ...game.pendingFight, energyDelta: -1 };
              done('Old carved stone is heavier than it looks, and it bites. Your hand goes cold and stays cold: you start the coming fight one Energy short.');
            }
          });
        },
      },
    ],
  },

  shortcut: {
    key: 'shortcut', when: 'prefight',
    name: 'The Shortcut',
    story: 'A suspicious goblin-sized burrow cuts away into the dark, and the roadside sign promises it skips most of the feared road ahead. What do you do?',
    options: [
      {
        label: 'Squeeze through',
        outcome(done) {
          game.hp = Math.max(1, game.hp - 5);
          game.pendingFight = { ...game.pendingFight, bossHpFactor: 0.8 };
          done('You arrive scraped, dusty and slightly less alive (lose 5 HP) -- but the Crew you were headed to had no time to build a warm welcome: the boss starts the fight at 80% HP.');
        },
      },
      {
        label: 'Take the long road',
        outcome(done) {
          done('You walk the long way. It takes longer. That is all. You arrive rested and unbattered. (Nothing happens.)');
        },
      },
    ],
  },

  totem: {
    key: 'totem', when: 'prefight',
    name: 'The Warning Totem',
    story: 'A crude skull-on-a-fork looms over the trailhead, scratched and cold, its many knots reading "TURN BACK." What do you do?',
    options: [
      {
        label: 'Heed it',
        outcome(done) {
          game.pendingFight = { ...game.pendingFight, startBlock: 8 };
          done('You leave the trailhead itself untouched, approach wide through the brush, and take position first: start the coming fight with 8 block.');
        },
      },
      {
        label: 'Kick it over',
        outcome(done) {
          flipCoin(game.event, (heads) => {
            if (heads) {
              done('It thuds into the ferns and lies there, impotent and fake. An ordinary bluff by an ordinary goblin. (Nothing happens.)');
            } else {
              game.pendingFight = { ...game.pendingFight, ambushAttacks: 2 };
              done('The knotwork was not decoration: a horn blows somewhere in the brush, answered by a second farther off. The boss will open with DOUBLED attacks -- its next two swings, red-hot.');
            }
          });
        },
      },
    ],
  },

  // ==================== PRE-MARKET ====================
  droppedPouch: {
    key: 'droppedPouch', when: 'premarket',
    name: 'The Dropped Pouch',
    story: 'You are walking through the bustling market when the goblin in front of you drops their pouch of gold. What do you do?',
    options: [
      {
        label: 'Return it',
        outcome(done) {
          const name = grantRandomTrinket();
          done(`Their eyes shine. "Honest fins are rare around here." They press something into your hands: a ${name}!`);
        },
      },
      {
        label: 'Snatch it',
        outcome(done) {
          const g = gainGold(30);
          done(`You palm the pouch in one smooth motion and melt into the crowd: +${g} gold. The goblin is still shrugging at everyone who is not you.`);
        },
      },
    ],
  },

  fortuneTent: {
    key: 'fortuneTent', when: 'premarket',
    name: 'The Fortune Teller',
    story: 'A tent of faded purple sits between two stalls. The teller fans two cards face down across the table. "Sitting goblin: one of these holds your fortune." What do you do?',
    options: [
      {
        label: 'Turn the left card',
        outcome(done) {
          rollDie(game.event, 6, (roll) => {
            if (roll >= 4) {
              const name = grantRandomCard();
              done(`The card blooms into the real thing as you touch it: a ${name} joins your deck. The teller collects her needle-pointed tip. "Told you."`);
            } else {
              done('The card is blank on both sides. The teller shrugs. "Was not your fortune." (Nothing happens.)');
            }
          });
        },
      },
      {
        label: 'Turn the right card',
        outcome(done) {
          const g = gainGold(15);
          done(`The right card shows an ordinary, loaded coin purse. Sliding it back wordlessly, the teller leaves a modest pouch on the felt: +${g} gold.`);
        },
      },
    ],
  },

  storyteller: {
    key: 'storyteller', when: 'premarket',
    name: 'The Storyteller',
    story: 'A grizzle-muzzled old goblin props up a bench near the stalls and claims he was the greatest blocker the vault ever saw. "The last secret is cheap to those who value it." What do you do?',
    options: [
      {
        label: 'Pay 10 gold to learn',
        outcome(done) {
          if (game.gold < 10) {
            done('He squints at your purse and shakes his head slowly. "You are not ready. Or you are broke. Probably broke." (No effect.)');
            return;
          }
          game.gold -= 10;
          const name = upgradeRandomCard();
          done(name
            ? `He walks you through the stone-wall parry one more time, arms like old rope, and it sticks: your ${name} is upgraded (+4 damage/block).`
            : 'He refuses gently: "Every card you own already knows more than it wants to. Nothing left to teach." (Your gold stays.)');
        },
      },
      {
        label: 'Give him 5 gold out of kindness',
        outcome(done) {
          if (game.gold < 5) {
            done('You have less than five gold and he waves it off with a snort. "Keep it, tiny gambler." (No effect.)');
            return;
          }
          game.gold -= 5;
          const healed = Math.min(game.maxHp - game.hp, 5);
          game.hp += healed;
          done(healed > 0
            ? 'He pockets the coin, claps your back with surprising strength, and shares his breathing trick: restore 5 HP.'
            : 'He pockets the coin, claps your back with surprising strength, and shares his breathing trick. You were already breathing perfectly. (No effect.)');
        },
      },
    ],
  },
};

// ---------- Tunable run constants ----------
const HAND_SIZE = 5;
const BASE_ENERGY = 3;
const COMBO_STEP = 0.2;
const START_HP = 100;
const START_MAX_HP = 100;
const START_GOLD = 10;
const BOSS_REWARD_BASE = 15;       // gainGold(BOSS_REWARD_BASE + BOSS_REWARD_PER_BOSS * bossIndex)
const BOSS_REWARD_PER_BOSS = 5;
const HEAL_COST_BASE = 15;         // healCost() = discountedPrice(HEAL_COST_BASE); heal amount itself stays a fixed 15, not tunable
const REMOVE_COST_BASE = 25;
const UPGRADE_COST_BASE = 40;      // upgradeCost() = discountedPrice(UPGRADE_COST_BASE); the +4 itself is fixed, like the heal amount
const REROLL_COST_START = 1;       // game.rerollCost starts here each newRun()
const REROLL_COST_STEP = 1;        // and climbs by this much every rerollShop()

// ---------- Seeded randomness ----------
// One seeded PRNG (mulberry32) drives ALL gameplay randomness -- deck shuffles, die
// rolls, coin flips, market offers -- and its seed is fixed when a run starts. Same seed
// + same decisions = identical run, so a bug or a lucky streak can be shared and
// replayed with ?seed=N in the address bar (the run's seed is printed to the combat log
// at the start of every fight... once per run, actually: newRun logs it).
// Purely cosmetic randomness (the faces the die/coin flickers through while spinning)
// uses raw Math.random and does not touch this stream.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seed for the next run: a ?seed=N query parameter wins (replay / share a specific run),
// otherwise something effectively unique in the session.
function pickSeed() {
  if (typeof location !== 'undefined' && location.search) {
    const m = /[?&]seed=(\d{1,10})/.exec(location.search);
    if (m) return Number(m[1]);
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
}

// The gameplay random source. Replaced with the seeded generator at newRun(); stays
// Math.random before that (and if anything ever runs before a run starts).
let rand = Math.random;

// ---------- Game state ----------
let game = null;
let uidCounter = 0;

function newRun(requestedSeed) {
  // Only accept an actual number: button onclick handlers invoke newRun with a click
  // event as the argument, which must fall through to pickSeed() rather than become
  // (event >>> 0) -- a meaningless garbage seed.
  const seed = typeof requestedSeed === 'number' && Number.isFinite(requestedSeed)
    ? requestedSeed >>> 0
    : pickSeed();
  rand = mulberry32(seed);
  game = {
    seed,
    hp: START_HP,
    maxHp: START_MAX_HP,
    gold: START_GOLD,
    deck: STARTER_DECK_KEYS.map(k => instantiateCard(k)),
    // trinket-driven constants -- each trinket purchase nudges one of these, nothing else
    handSizeBonus: 0,
    goldLootBonus: 0,
    shopDiscount: 0,
    shopSizeBonus: 0,
    gambleBonus: 0,       // Lucky Coin: fractional bonus to roll/flip damage, stacks
    healAfterKill: 0,     // Blood Vial: HP restored in checkCombatEnd's boss-kill branch
    energyBonus: 0,       // Energy Core: +energy per turn, stacks
    comboStepBonus: 0,    // Combo Master: additive combo step, stacks
    attackBonus: 0,       // Whetstone: flat damage added to every attack hit
    blockBonus: 0,        // Ironwood Charm: flat block added to every block hit
    marketGold: 0,        // Coin Purse: gold per market visit
    healBonus: 0,         // Field Medic: extra HP on Rest & Heal
    secondWind: 0,        // Second Wind: once per combat survive lethal at 1 HP
    trinketLevels: Object.fromEntries(Object.keys(TRINKET_LIBRARY).map(k => [k, 0])),
    // Cost of the next market card reroll -- climbs by 1 each use and never resets between
    // shop visits (only newRun() resets it), so rerolling repeatedly across a whole run
    // gets steadily more expensive.
    rerollCost: REROLL_COST_START,
    bossIndex: 0,
    // Fight-scoped buffs granted by pre-fight events: a plain object of overrides
    // (attackBonus, blockHitBonus, firstAttackBonus, startBlock, energyDelta,
    // bossHpFactor, ambushAttacks) consumed and cleared by startCombat().
    pendingFight: null,
    // Events actually served this run, so a run with many junctions doesn't tell the
    // same story twice drawn from a small library; refilled only when a pool runs dry.
    usedEvents: new Set(),
    // An event shown between rounds (story + hidden-outcome choices); null when none.
    event: null,
    // combat-only state, set by startCombat
    combat: null,
  };
  startCombat();
  logMsg(`Run seed: ${game.seed} (replay with ?seed=${game.seed})`);
}

function instantiateCard(key) {
  uidCounter++;
  return { ...CARD_LIBRARY[key], uid: uidCounter };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function currentHandSize() { return HAND_SIZE + game.handSizeBonus; }

// Routes every gold gain through the goldLoot trinket bonus; returns the actual amount added.
function gainGold(amount) {
  const actual = Math.round(amount * (1 + game.goldLootBonus));
  game.gold += actual;
  return actual;
}

// The Math.max(1, ...) floor stops a discount from ever making a paid item free, but a
// deliberately free item (price: 0) has to survive it -- so 0 short-circuits out first.
// Written as `<= 0` rather than a falsy check so an undefined price still behaves exactly
// as it did before (starter cards carry no price and never reach the market).
function discountedPrice(basePrice) {
  if (basePrice <= 0) return 0;
  return Math.max(1, Math.round(basePrice * (1 - game.shopDiscount)));
}

// Single seam for gamble damage, the way gainGold is the single seam for gold gains:
// every die roll and coin flip routes its base damage through the Lucky Coin bonus.
// Rounds so a fractional bonus still lands whole damage (15 * 1.15 -> 17, not 17.25).
function gambleBaseDamage(base) {
  return Math.round(base * (1 + game.gambleBonus));
}

function cardShopSlots() { return Math.min(SHOP_POOL_KEYS.length, 4 + game.shopSizeBonus); }
function trinketShopSlots() { return Math.min(Object.keys(TRINKET_LIBRARY).length, 3 + game.shopSizeBonus); }

// ---------- Combat setup ----------
// BACKUP MECHANIC: after 10 turns, a second copy of the boss joins the fight.
// Both bosses attack each turn; player must kill both. Damage targets the first living boss.
const BACKUP_TURN_THRESHOLD = 10;

function startCombat() {
  const bossDef = BOSSES[game.bossIndex];
  // A pre-fight event may have left buffs/expenses on the hook; consume and clear them
  // here so they apply to exactly this one fight.
  const f = game.pendingFight || null;
  game.pendingFight = null;
  const energyThisTurn = Math.max(0,
    BASE_ENERGY + (game.energyBonus || 0) + (f?.energyDelta || 0));
  game.combat = {
    bosses: [{
      name: bossDef.name,
      // bossHpFactor (the Shortcut event): the crew had no time to prepare fully.
      hp: Math.max(1, Math.round(bossDef.maxHp * (f?.bossHpFactor ?? 1))),
      maxHp: bossDef.maxHp, pattern: bossDef.pattern, patternIndex: 0, isBackup: false,
    }],
    drawPile: shuffle(game.deck),
    hand: [],
    discardPile: [],
    block: 0,
    energy: energyThisTurn,
    turnAttackCount: 0,
    turnBlockCount: 0,
    discardSelection: null,
    exhaustPile: [],
    statuses: [],       // { on: 'turnStart' | 'playerAttacked' | 'cardMissed', effect() } -- see addStatus
    forcedNextRoll: null, // 'max' consumed by the next rollDie/flipCoin call
    rolling: false,     // true for the ~1s a die/coin is spinning -- blocks playing cards and ending the turn
    ended: false,       // set once by checkCombatEnd -- makes a second call for this fight a no-op
    log: [],
    secondWindUsed: false,  // Second Wind: once per combat
    combatId: ++uidCounter, // unique ID to detect stale callbacks after newRun()
    turnCount: 0,
    backupSpawned: false,
    // Fight-scoped event modifiers (plain numbers; also mirrored in the card previews):
    attackHitBonus: f?.attackBonus || 0,       // flat damage on every attack hit this fight
    firstAttackBonus: f?.firstAttackBonus || 0, // flat damage on this fight's first attack (of any turn)
    blockHitBonus: f?.blockHitBonus || 0,      // flat block on every block hit this fight
    ambushAttacks: f?.ambushAttacks || 0,      // the boss's next N attacks deal doubled damage
  };
  // Careful approach (warning totem): block granted before the first card is played.
  if (f?.startBlock) {
    game.combat.block += f.startBlock;
    logMsg(`Careful approach: you start the fight with ${f.startBlock} block.`);
  }
  // Spoken once, so the event's effects are visible on the fight screen too -- an event's
  // outcome text scrolls away in the event screen, but the fight log is right there.
  if (f?.attackBonus) logMsg(`High ground: attacks deal +${f.attackBonus} damage this fight.`);
  if (f?.firstAttackBonus) logMsg(`Wish granted: your first attack lands +${f.firstAttackBonus} extra damage.`);
  if (f?.blockHitBonus) logMsg(`Blessed: every block hit grants +${f.blockHitBonus} extra block this fight.`);
  if (f?.energyDelta) logMsg(`Cold hand: the fight starts one Energy short.`);
  if (f?.bossHpFactor) logMsg(`They had no time to prepare: the boss starts the fight at ${Math.round(f.bossHpFactor * 100)}% HP.`);
  if (f?.ambushAttacks) logMsg(`*** Ambush! The boss's next ${f.ambushAttacks} attacks are doubled. ***`);
  drawCards(currentHandSize());
  logMsg(`--- ${bossDef.name} appears! ---`);
  showScreen('screen-combat');
  renderCombat();
}

function drawCards(n) {
  const c = game.combat;
  for (let i = 0; i < n; i++) {
    if (c.drawPile.length === 0) {
      if (c.discardPile.length === 0) break; // nothing left to draw
      c.drawPile = shuffle(c.discardPile);
      c.discardPile = [];
      logMsg('Shuffled discard pile into draw pile.');
    }
    c.hand.push(c.drawPile.pop());
  }
  assignHandSlots();
}

// A card's number-key slot is sticky: it's assigned here (on draw or reorder) and then
// left alone as cards are played/discarded out of hand, so playing card 1 never shifts
// what 2-5 mean -- only a fresh draw or a manual reorder renumbers the hand.
function assignHandSlots() {
  game.combat.hand.forEach((card, i) => { card.handSlot = i; });
}

function logMsg(msg) {
  game.combat.log.unshift(msg);
  if (game.combat.log.length > 30) game.combat.log.pop();
}

// ---------- Playing cards ----------
// COMBO_STEP is declared with the other tunable run constants, above.

// ---------- Status effects (Kickback's per-turn payout, Bramble Guard's retaliation, etc.) --
// A tiny pub/sub: cards register a status with an `addStatus(eventName, effect)`, and
// fireEvent calls every status listening for that event. Statuses live until
// startCombat() replaces the combat object, i.e. the whole rest of the current fight --
// which matches Kickback ("starting next turn"), Bramble Guard and Hedge, the three
// subscribers. Each copy of a card registers its own listener, so copies stack.
function addStatus(on, effect) {
  game.combat.statuses.push({ on, effect });
}

function fireEvent(eventName, payload) {
  // Iterate a snapshot so listeners that call addStatus for the same event
  // don't affect the current dispatch (avoids infinite loops / skipped entries).
  for (const status of [...game.combat.statuses]) {
    if (status.on === eventName) status.effect(payload);
  }
}

// Trashes a card out of the run for good -- for Glass Cannon's missed roll. Removing it
// from game.deck alone is not enough: the card was already pushed into a combat zone by
// playCard, so it has to come out of every zone too, or it gets reshuffled and replayed
// for the rest of the fight. Also counts as a "miss" for Hedge-style passives.
function trashCard(card) {
  if (!game.combat) return; // defensive: never called outside combat, but guard anyway
  const remainingDeck = game.deck.filter(x => x.uid !== card.uid);
  if (remainingDeck.length === 0) {
    // Never let a trash effect empty the run deck -- with nothing left to draw, the run
    // is unwinnable. The card is spared from game.deck and simply goes wherever playCard
    // already put it in combat (the discard pile, same as any other played card), instead
    // of being stripped out of every zone the way a real trash does below.
    logMsg(`${card.name} survives the trash -- it's the last card in your deck.`);
    fireEvent('cardMissed', { card });
    return;
  }
  game.deck = remainingDeck;
  const c = game.combat;
  c.drawPile = c.drawPile.filter(x => x.uid !== card.uid);
  c.hand = c.hand.filter(x => x.uid !== card.uid);
  c.discardPile = c.discardPile.filter(x => x.uid !== card.uid);
  c.exhaustPile = c.exhaustPile.filter(x => x.uid !== card.uid);
  logMsg(`${card.name} is trashed -- removed from your deck for good!`);
  fireEvent('cardMissed', { card });
}

// Pure combo math, shared by the resolvers below and the hand preview (see
// previewCardNumbers). Given the count of prior hits this turn, what does the next
// hit deal or grant? No state touched here -- the resolvers bump the counters, this
// only computes -- so the number on the card face and the number that actually lands
// are produced by the same formula and can never drift apart.
function attackHitOutcome(baseDamage, comboBonus, priorHits) {
  const mult = 1 + (COMBO_STEP + (game.comboStepBonus || 0)) * priorHits;
  return { damage: Math.round((baseDamage + comboBonus * priorHits) * mult), mult };
}
function blockHitOutcome(blockAmount, blockComboBonus, priorHits) {
  const mult = 1 + (COMBO_STEP + (game.comboStepBonus || 0)) * priorHits;
  return { block: Math.round((blockAmount + blockComboBonus * priorHits) * mult), mult };
}

// One attack hit: bumps the per-turn attack combo, applies the multiplier, and lands the
// damage. Shared by the normal attack branch in playCard and by cards whose damage
// resolves later (Glass Cannon's roll), so a deferred hit scores exactly like an
// immediate one instead of duplicating the combo formula.
// Whetstone adds flat damage to EVERY hit (baseDamage passed in includes per-card
// comboBonus, we add the global attackBonus here so multi-hit cards get it per hit).
// Pre-fight event bonuses: attackHitBonus (high ground) applies to every hit exactly
// like Whetstone; firstAttackBonus applies once, to the first attack hit of any turn
// this fight (the bonus is consumed the moment it lands).
function resolveAttackHit(baseDamage, comboBonus = 0) {
  const c = game.combat;
  let baseWithBonuses = baseDamage + (game.attackBonus || 0) + (c.attackHitBonus || 0);
  if (c.turnAttackCount === 0 && c.firstAttackBonus) {
    baseWithBonuses += c.firstAttackBonus;
    c.firstAttackBonus = 0;
  }
  const { damage, mult } = attackHitOutcome(baseWithBonuses, comboBonus, c.turnAttackCount);
  c.turnAttackCount++;
  // Target the first living boss
  const target = c.bosses.find(b => b.hp > 0);
  if (target) target.hp = Math.max(0, target.hp - damage);
  return { damage, mult };
}

// One block gain: bumps the per-turn block combo, applies the multiplier, and banks the
// block. Deliberately the mirror image of resolveAttackHit -- same counter-then-multiply
// order, same rounding, same optional per-trigger bonus -- so both halves of the combo
// system score identically and multi-hit block cards (Bulwark) tick once per hit exactly
// like multi-hit attacks do.
// Ironwood Charm adds flat block to EVERY hit (mirror of Whetstone).
// blockHitBonus (lucky well / shrine events) is the event twin: flat block on every
// block hit this fight, mirrored in the preview exactly like the other bonuses.
function resolveBlockGain(blockAmount, blockComboBonus = 0) {
  const c = game.combat;
  const blockWithCharm = blockAmount + (game.blockBonus || 0) + (c.blockHitBonus || 0);
  const { block, mult } = blockHitOutcome(blockWithCharm, blockComboBonus, c.turnBlockCount);
  c.turnBlockCount++;
  c.block += block;
  return { block, mult };
}

// Shared "did a gold-cost gamble pay off" handling: notifies Hedge-style passives
// on a miss. Kept as its own seam so every gold-card outcome reports through one place.
function resolveGoldCardOutcome(card, succeeded) {
  if (!succeeded) fireEvent('cardMissed', { card });
}

// ---------- Dice & coin animations ----------
// These take a STATE object -- either game.combat or a game.event -- rather than reading
// game.combat directly, so combat gambles and event gambles share one implementation:
// same overlay, same spinning animation. `state.rolling` is the lock the state's owner
// honors (canPlayCard/endTurn for combat, runEventOption/renderEvent for events), and a
// state may carry `forcedNextRoll: 'max'` (Loaded Dice) -- events simply don't.
// The final value is the one seeded draw that matters; the spinning faces use raw
// Math.random so the animation doesn't consume outcome rolls from the run stream.
function showDiceOverlay() { document.getElementById('dice-overlay').classList.remove('hidden'); }
function hideDiceOverlay() { document.getElementById('dice-overlay').classList.add('hidden'); }

// Standard 6-sided die pip layouts, as positions in a 3x3 grid (0-8, row-major).
const DICE_PIP_PATTERNS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// The two face renderers are the only things that touch the die/coin classes, and each
// one asserts BOTH directions -- adds its own, removes the other. That way a flip after a
// roll (or the reverse) can never leave a stale class on the shared #dice-face element.
function renderDiePips(value) {
  const faceEl = document.getElementById('dice-face');
  faceEl.classList.add('die');
  faceEl.classList.remove('coin');
  const filled = new Set(DICE_PIP_PATTERNS[value] || []);
  faceEl.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement('div');
    pip.className = 'pip' + (filled.has(i) ? ' pip-on' : '');
    faceEl.appendChild(pip);
  }
}

function renderCoinFace(letter) {
  const faceEl = document.getElementById('dice-face');
  faceEl.classList.add('coin');
  faceEl.classList.remove('die');
  faceEl.textContent = letter;
}

function rollDie(state, sides, onResult) {
  state.rolling = true;
  const forced = state.forcedNextRoll === 'max';
  if (forced) state.forcedNextRoll = null;
  const finalValue = forced ? sides : 1 + Math.floor(rand() * sides);

  const resultEl = document.getElementById('dice-result-text');
  resultEl.classList.remove('landed');
  resultEl.textContent = '';
  // Paint a face BEFORE the overlay is shown, or the first 60ms displays whatever the
  // previous roll or flip left on #dice-face.
  renderDiePips(1 + Math.floor(Math.random() * sides));
  showDiceOverlay();

  let ticks = 0;
  const spin = setInterval(() => {
    renderDiePips(1 + Math.floor(Math.random() * sides));
    ticks++;
    if (ticks > 10) {
      clearInterval(spin);
      renderDiePips(finalValue);
      resultEl.textContent = `Rolled a ${finalValue}!`;
      resultEl.classList.add('landed');
      setTimeout(() => { hideDiceOverlay(); state.rolling = false; onResult(finalValue); }, 400);
    }
  }, 60);
}

function flipCoin(state, onResult) {
  state.rolling = true;
  const forced = state.forcedNextRoll === 'max';
  if (forced) state.forcedNextRoll = null;
  const heads = forced ? true : rand() < 0.5;

  const resultEl = document.getElementById('dice-result-text');
  resultEl.classList.remove('landed');
  resultEl.textContent = '';
  // Same pre-paint as rollDie, for the same reason.
  renderCoinFace(Math.random() < 0.5 ? 'H' : 'T');
  showDiceOverlay();

  let ticks = 0;
  const spin = setInterval(() => {
    renderCoinFace(Math.random() < 0.5 ? 'H' : 'T');
    ticks++;
    if (ticks > 10) {
      clearInterval(spin);
      renderCoinFace(heads ? 'H' : 'T');
      resultEl.textContent = heads ? 'Heads!' : 'Tails...';
      resultEl.classList.add('landed');
      setTimeout(() => { hideDiceOverlay(); state.rolling = false; onResult(heads); }, 400);
    }
  }, 60);
}

// Single source of truth for "can this card be played right now". Both playCard and the
// render layer call it, so a card the UI greys out is exactly a card playCard refuses.
// A discardCost is a hard requirement, not a clamped one: the card needs that many OTHER
// cards in hand to pay with (the card itself is still in hand here, hence length - 1),
// A discardCost is a hard requirement, not a clamped one: the card needs that many OTHER
// cards in hand to pay with (the card itself is still in hand here, hence length - 1),
// otherwise it is unplayable rather than resolving at a reduced cost. For drawFirst
// cards (Overdraw) this is conservative -- the draw would supply discards on its own --
// but it guarantees the follow-up selection can always complete, so no softlock.
function canPlayCard(card) {
  const c = game.combat;
  // Also refuses while a die/coin is spinning -- a deferred attack's combo trigger isn't
  // final until it resolves, and End Turn is blocked for the same reason (see rollDie).
  if (!c || c.discardSelection || c.rolling) return false;
  if (card.cost > c.energy) return false;
  if (card.goldCost && card.goldCost > game.gold) return false;
  if (card.discardCost) {
    const available = c.hand.length - 1;
    if (available < card.discardCost) return false;
  }
  // Self-damage must never be lethal or reduce you to 0 -- Blood Money greys itself out
  // at low HP rather than letting you cash yourself in.
  if (card.selfDamage && card.selfDamage >= game.hp) return false;
  return true;
}

function playCard(uid) {
  const c = game.combat;
  if (c.discardSelection) return; // must resolve the pending discard cost first
  const idx = c.hand.findIndex(card => card.uid === uid);
  if (idx === -1) return;
  const card = c.hand[idx];
  if (!canPlayCard(card)) return;

  c.energy -= card.cost;
  if (card.goldCost) game.gold -= card.goldCost;
  c.hand.splice(idx, 1);
  (card.exhaustOnPlay ? c.exhaustPile : c.discardPile).push(card);

  const comboTexts = [];

  // BLOCK RESOLVES BEFORE ATTACK. Only cards carrying both (isAttackToo) can tell the
  // difference, and Shield Bash needs it this way round: it gains block first, then hits
  // for the block it is now standing on. `hits` drives the loop here exactly as it does
  // for attacks -- cards without it default to 1 and behave as they always did.
  if (card.block) {
    const hits = card.hits || 1;
    let totalBlock = 0;
    let lastMult = 1;
    for (let h = 0; h < hits; h++) {
      const { block, mult } = resolveBlockGain(card.block, card.blockComboBonus || 0);
      totalBlock += block;
      lastMult = mult;
    }
    logMsg(`${card.name} grants ${totalBlock} block.`);
    if (lastMult > 1.001) comboTexts.push(`BLK x${lastMult.toFixed(2)}`);
  }

  // `deferredAttack` cards (Glass Cannon) resolve their own damage inside onPlay once a
  // die settles, so the automatic branch has to skip them -- otherwise they'd land damage
  // and burn a combo trigger before the roll decides whether they even hit.
  if ((card.type === 'attack' || card.isAttackToo) && !card.deferredAttack) {
    const hits = card.hits || 1;
    // Shield Bash-style cards take their base damage from the block they are standing on
    // (the block branch above has already run), rather than from a flat baseDamage. The
    // block is read, not spent -- nothing here zeroes c.block.
    let baseDmg = card.damageFromBlockPercent
      ? Math.round(c.block * card.damageFromBlockPercent)
      : (card.baseDamage || 0);
    // First-strike bonus (Ambush): if this is the first attack this turn, add bonus damage
    // and mark that we'll grant energy in onPlay. Checked before the first hit resolves.
    let firstStrikeGranted = false;
    if (card.firstStrike && c.turnAttackCount === 0) {
      baseDmg += card.firstStrike;
      firstStrikeGranted = true;
    }
    let totalDmg = 0;
    let lastMult = 1;
    for (let h = 0; h < hits; h++) {
      const { damage, mult } = resolveAttackHit(baseDmg, card.comboBonus || 0);
      totalDmg += damage;
      lastMult = mult;
    }
    logMsg(`Played ${card.name}: dealt ${totalDmg} damage.`);
    if (lastMult > 1.001) comboTexts.push(`ATK x${lastMult.toFixed(2)}`);
    // Grant first-strike energy after damage resolves (so energy is available for rest of turn)
    if (firstStrikeGranted && card.firstStrikeEnergy) {
      c.energy += card.firstStrikeEnergy;
      logMsg(`${card.name}: first strike! +${card.firstStrikeEnergy} Energy.`);
    }
  }

  if (card.selfDamage) {
    game.hp = Math.max(0, game.hp - card.selfDamage);
    logMsg(`${card.name} costs you ${card.selfDamage} HP.`);
  }

  if (card.gold) {
    const g = gainGold(card.gold);
    logMsg(`${card.name} grants ${g} gold.`);
  }

  if (card.discardCost) {
    // drawFirst cards (Overdraw) draw up front so the player picks discards out of the
    // bigger hand, freshly drawn cards included. The selection remembers the draw is
    // done so the completion path doesn't draw a second time.
    if (card.drawFirst && card.drawOnPlay) {
      drawCards(card.drawOnPlay);
      beginDiscardSelection(card, card.discardCost, true);
    } else {
      beginDiscardSelection(card, card.discardCost);
    }
    // For cards with discardCost, defer onPlay until after the cost is paid
    // (see selectDiscard). Exception: deferredAttack cards must NOT start their
    // roll/flip while a discard selection is open, so their onPlay is also deferred.
  } else {
    resolveDeferrableEffects(card);
    if (card.onPlay) card.onPlay(card);
  }

  if (comboTexts.length) showComboPopup(comboTexts.join(' / ') + '!');

  renderCombat();
  checkCombatEnd();
}

// energyGain and drawOnPlay are the two effects a discardCost can gate behind an
// upfront discard -- pulled into one place so both the immediate and deferred paths
// (see beginDiscardSelection) apply them identically. skipDraw is for drawFirst cards
// (Overdraw), whose draw already happened before the selection opened.
function resolveDeferrableEffects(card, skipDraw = false) {
  const c = game.combat;
  if (card.energyGain) {
    c.energy += card.energyGain;
    logMsg(`${card.name} grants ${card.energyGain} energy.`);
  }
  if (!skipDraw && card.drawOnPlay) {
    drawCards(card.drawOnPlay);
  }
}

// ---------- Discard-cost cards (an "offering" paid before the card's effect fires) ----------
// canPlayCard guarantees enough other cards are in hand before the card is ever played,
// so there is no clamping or skip-the-cost path here -- the discard always happens in full.
// drawDone marks a drawFirst selection (Overdraw): the draw resolved up front in
// playCard, so only the energy half (if any) is still pending at completion.
function beginDiscardSelection(card, count, drawDone = false) {
  game.combat.discardSelection = { forCard: card, remaining: count, drawDone };
  logMsg(`${card.name}: choose ${count} card(s) to discard.`);
}

function selectDiscard(uid) {
  const c = game.combat;
  if (!c.discardSelection) return;
  const idx = c.hand.findIndex(card => card.uid === uid);
  if (idx === -1) return;
  const [discarded] = c.hand.splice(idx, 1);
  c.discardPile.push(discarded);
  c.discardSelection.remaining--;
  if (c.discardSelection.remaining <= 0) {
    const finishedCard = c.discardSelection.forCard;
    const skipDraw = !!c.discardSelection.drawDone;
    c.discardSelection = null;
    resolveDeferrableEffects(finishedCard, skipDraw);
    if (finishedCard.onPlay) finishedCard.onPlay(finishedCard);
  }
  renderCombat();
}

function showComboPopup(text) {
  const el = document.getElementById('combo-popup');
  el.textContent = text;
  el.classList.remove('hidden');
  // restart animation
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(showComboPopup._t);
  showComboPopup._t = setTimeout(() => el.classList.add('hidden'), 1400);
}

function endTurn() {
  const c = game.combat;
  if (!c || game.hp <= 0 || c.discardSelection || c.rolling) return;

  // Check if all bosses are dead (should be caught by checkCombatEnd, but guard anyway)
  const livingBosses = c.bosses.filter(b => b.hp > 0);
  if (livingBosses.length === 0) {
    checkCombatEnd();
    return;
  }

  // discard remaining hand
  c.discardPile.push(...c.hand);
  c.hand = [];

  // Increment turn counter and check for backup spawn
  c.turnCount++;
  if (!c.backupSpawned && c.turnCount >= BACKUP_TURN_THRESHOLD) {
    spawnBackup(c);
  }

  // All living bosses attack
  let totalDealt = 0;
  let attackLogs = [];
  for (const boss of livingBosses) {
    const dmg = boss.pattern[boss.patternIndex];
    boss.patternIndex = (boss.patternIndex + 1) % boss.pattern.length;
    // Ambush (warning totem): the boss's next N attacks deal doubled damage. The
    // indicator counts every attack -- a 0-damage "does nothing" beat still spends one,
    // which is exactly what "next two attacks are doubled" promises on the nose.
    const ambush = c.ambushAttacks > 0;
    const effective = dmg * (ambush ? 2 : 1);
    if (ambush) c.ambushAttacks--;
    fireEvent('playerAttacked', { damage: effective, boss }); // Bramble Guard-style retaliation
    const dealt = Math.max(0, effective - c.block);
    totalDealt += dealt;
    if (dmg === 0) {
      attackLogs.push(`${boss.name}${boss.isBackup ? ' (Backup)' : ''} does nothing this turn.`);
    } else {
      attackLogs.push(`${boss.name}${boss.isBackup ? ' (Backup)' : ''} attacks for ${effective}${ambush ? ' (AMBUSH, doubled!)' : ''}${c.block > 0 ? ` (blocked ${Math.min(effective, c.block)})` : ''}, you take ${dealt}.`);
    }
  }
  game.hp = Math.max(0, game.hp - totalDealt);
  attackLogs.forEach(logMsg);
  c.block = 0;

  // Second Wind: survive lethal damage once per combat
  if (game.hp <= 0 && (game.secondWind || 0) > 0 && !c.secondWindUsed) {
    game.hp = 1;
    c.secondWindUsed = true;
    logMsg(`Second Wind triggers! You survive at 1 HP.`);
  }

  if (game.hp <= 0) {
    renderCombat();
    checkCombatEnd();
    return;
  }

  // Retaliation (Bramble Guard) can finish off bosses, so check if all dead
  const stillLiving = c.bosses.filter(b => b.hp > 0);
  if (stillLiving.length === 0) {
    renderCombat();
    checkCombatEnd();
    return;
  }

  // new player turn
  c.energy = BASE_ENERGY + (game.energyBonus || 0);
  c.turnAttackCount = 0;
  c.turnBlockCount = 0;
  c.forcedNextRoll = null; // Loaded Dice only promises "this turn"
  drawCards(currentHandSize() - c.hand.length);
  // Fired last, once the new turn is fully built: after the death check above (a dead
  // player collects nothing), after the counters reset (a listener sees a clean turn),
  // after the draw (a listener can act on the new hand), and before renderCombat() so
  // anything it grants is on screen immediately. Protection Racket listens here.
  fireEvent('turnStart', {});
  renderCombat();
}

function spawnBackup(c) {
  c.backupSpawned = true;
  const primary = c.bosses[0];
  // Backup is a copy with full HP, same pattern, but starts at a different pattern index
  // so their attacks are offset (more dangerous)
  const backupPatternIndex = (primary.patternIndex + Math.floor(primary.pattern.length / 2)) % primary.pattern.length;
  const backup = {
    name: primary.name,
    hp: primary.maxHp,
    maxHp: primary.maxHp,
    pattern: primary.pattern,
    patternIndex: backupPatternIndex,
    isBackup: true,
  };
  c.bosses.push(backup);
  logMsg(`*** ${primary.name} calls for backup! A second ${primary.name} joins the fight! ***`);
}

function checkCombatEnd() {
  const c = game.combat;
  // Idempotency guard: once this fight has already been resolved (either branch below),
  // a second call is a no-op. Without this, calling checkCombatEnd() twice while
  // c.boss.hp is still 0 (it stays 0 for the whole market visit -- nothing resets it
  // until startCombat() replaces the combat object for the next fight) would re-grant
  // the gold reward and re-open the market, which reshuffles cardOffers and clears
  // boughtCardKeys, making an already-bought card buyable again.
  if (c.ended) return;
  // Player-death is checked before boss-death on purpose: if both hit 0 HP on the same
  // boss attack (e.g. a lethal hit landing the same turn Bramble Guard's retaliation
  // finishes the boss), a mutual kill resolves as a LOSS, not a win. Don't reorder these
  // two checks -- that would silently flip the mutual-kill ruling to a win.
  if (game.hp <= 0) {
    c.ended = true;
    showScreen('screen-gameover');
    // Use primary boss (first in array) for gameover message
    const primaryBoss = c.bosses[0];
    document.getElementById('gameover-text').textContent =
      `${primaryBoss.name} finished you off on boss ${game.bossIndex + 1} of ${BOSSES.length}.`;
    return;
  }
  // Check if ALL bosses are dead
  const allBossesDead = c.bosses.every(b => b.hp <= 0);
  if (allBossesDead) {
    c.ended = true;
    const reward = gainGold(BOSS_REWARD_BASE + BOSS_REWARD_PER_BOSS * game.bossIndex);
    const primaryBoss = c.bosses[0];
    logMsg(`${primaryBoss.name} defeated! +${reward} gold.`);
    // Blood Vial pays out here, once per kill, before the market opens. Capped at max
    // HP and silent at full health -- a 0-heal log line would just be noise.
    if (game.healAfterKill > 0) {
      const healed = Math.min(game.maxHp - game.hp, game.healAfterKill);
      if (healed > 0) {
        game.hp += healed;
        logMsg(`Blood Vial restores ${healed} HP.`);
      }
    }
    // The road to the market may hold an event; otherwise open it right here.
    maybeEvent('premarket', openMarket);
  }
}

// ---------- Market ----------
let marketState = null;

function openMarket() {
  const cardOffers = shuffle(SHOP_POOL_KEYS).slice(0, cardShopSlots()).map(k => ({ ...CARD_LIBRARY[k] }));
  marketState = { cardOffers, trinketOrder: rollTrinketOrder(), boughtCardKeys: new Set() };
  // Coin Purse: +gold per market visit
  if (game.marketGold > 0) {
    const gained = Math.round(game.marketGold);
    game.gold += gained;
    logMsg(`Coin Purse grants ${gained} gold.`);
  }
  showScreen('screen-market');
  renderMarket();
}

// Trinket shelf order: Shop Size is always first (it must stay reachable -- otherwise it
// could hide behind its own "+1 shop slot" effect), the rest are shuffled fresh every
// market visit so a bigger library still means real choice instead of the same 3 faces.
// Cached on marketState per visit (not recomputed per render) so buying one trinket
// doesn't reshuffle the others out from under the player mid-visit.
function rollTrinketOrder() {
  const rest = shuffle(Object.keys(TRINKET_LIBRARY).filter(k => k !== 'shopSize'));
  return ['shopSize', ...rest];
}

// Rerolls the card offers AND reshuffles the trinket shelf, at the same ever-climbing
// price (see rerollCost's comment in newRun).
function rerollShop() {
  if (game.gold < game.rerollCost) return;
  game.gold -= game.rerollCost;
  game.rerollCost += REROLL_COST_STEP;
  marketState.cardOffers = shuffle(SHOP_POOL_KEYS).slice(0, cardShopSlots()).map(k => ({ ...CARD_LIBRARY[k] }));
  marketState.trinketOrder = rollTrinketOrder();
  marketState.boughtCardKeys = new Set();
  renderMarket();
}

// Trinket offers are the cached visit order, sliced to the current shopSize level --
// slicing live (rather than caching the sliced list) means buying Shop Size mid-visit
// immediately reveals the extra slot, the same way growCardOffersToShopSize does for cards.
function currentTrinketOffers() {
  const order = (marketState && marketState.trinketOrder) || ['shopSize', ...Object.keys(TRINKET_LIBRARY).filter(k => k !== 'shopSize')];
  return order.slice(0, trinketShopSlots()).map(k => TRINKET_LIBRARY[k]);
}

// If Shop Size was just bought, grow this visit's card list immediately instead of
// making the player wait for the next market to see the extra slot. Matches openMarket's
// no-duplicates rule -- draws from pool keys not already on offer, same as the initial
// shuffle-and-slice does implicitly by construction. If the pool runs out of unused keys
// (only possible if cardShopSlots() somehow exceeded SHOP_POOL_KEYS.length, which it can't
// today since cardShopSlots() is itself capped at the pool size) this just stops adding
// offers short of the slot count rather than duplicating or looping forever.
function growCardOffersToShopSize() {
  const usedKeys = new Set(marketState.cardOffers.map(o => o.key));
  const available = shuffle(SHOP_POOL_KEYS.filter(k => !usedKeys.has(k)));
  while (marketState.cardOffers.length < cardShopSlots() && available.length) {
    const key = available.pop();
    marketState.cardOffers.push({ ...CARD_LIBRARY[key] });
  }
}

function buyMarketCard(idx) {
  const offer = marketState.cardOffers[idx];
  if (!offer || marketState.boughtCardKeys.has(idx)) return;
  const price = discountedPrice(offer.price);
  if (game.gold < price) return;
  game.gold -= price;
  game.deck.push(instantiateCard(offer.key));
  marketState.boughtCardKeys.add(idx);
  renderMarket();
}

// Trinkets are repeatable: buying one just re-runs its apply(game) and bumps its level.
function buyMarketTrinket(idx) {
  const offer = currentTrinketOffers()[idx];
  if (!offer) return;
  const price = discountedPrice(offer.price);
  if (game.gold < price) return;
  game.gold -= price;
  offer.apply(game);
  game.trinketLevels[offer.key]++;
  growCardOffersToShopSize();
  renderMarket();
}

function healCost() { return discountedPrice(HEAL_COST_BASE); }
function removeCost() { return discountedPrice(REMOVE_COST_BASE); }
function upgradeCost() { return discountedPrice(UPGRADE_COST_BASE); }

function doHeal() {
  const cost = healCost();
  if (game.gold < cost || game.hp >= game.maxHp) return;
  game.gold -= cost;
  const healAmount = 15 + (game.healBonus || 0);
  game.hp = Math.min(game.maxHp, game.hp + healAmount);
  if (game.healBonus > 0) logMsg(`Field Medic restores ${game.healBonus} additional HP.`);
  renderMarket();
}

function openRemoveScreen() {
  if (game.gold < removeCost()) return;
  showScreen('screen-remove');
  renderRemoveScreen();
}

function renderRemoveScreen() {
  const el = document.getElementById('remove-deck-list');
  el.innerHTML = '';
  game.deck.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = `card shop-card ${card.type}`;
    div.innerHTML = cardFaceHTML(card, null);
    div.onclick = () => {
      game.deck.splice(i, 1);
      game.gold -= removeCost();
      showScreen('screen-market');
      renderMarket();
    };
    el.appendChild(div);
  });
}

// ---------- Card upgrades ----------
// Attack/block cards only: +4 to baseDamage and/or block, once per card. Loot/skill
// cards have no flat number an upgrade could honestly touch (their value lives in
// onPlay closures and per-turn counters), so they're excluded rather than given a
// fake +1. The type-line stat and the generated desc both read the live fields, so
// upgraded numbers show up everywhere automatically.
const UPGRADE_BONUS = 4;

function upgradeableCards() {
  return game.deck.filter(card => !card.upgraded && (card.baseDamage != null || card.block != null));
}

function openUpgradeScreen() {
  if (game.gold < upgradeCost() || upgradeableCards().length === 0) return;
  showScreen('screen-upgrade');
  renderUpgradeScreen();
}

function renderUpgradeScreen() {
  const el = document.getElementById('upgrade-deck-list');
  el.innerHTML = '';
  upgradeableCards().forEach((card) => {
    const div = document.createElement('div');
    div.className = `card shop-card ${card.type}`;
    div.innerHTML = cardFaceHTML(card, null);
    div.onclick = () => {
      if (card.baseDamage != null) card.baseDamage += UPGRADE_BONUS;
      if (card.block != null) card.block += UPGRADE_BONUS;
      // No note string and no desc rewrite needed: the desc is generated from the live
      // fields, so +UPGRADE_BONUS is already visible on the face (and the type-line
      // stat) the moment the numbers change.
      card.upgraded = true;
      card.name += ' +';
      game.gold -= upgradeCost();
      showScreen('screen-market');
      renderMarket();
    };
    el.appendChild(div);
  });
}

function continueFromMarket() {
  game.bossIndex++;
  if (game.bossIndex >= BOSSES.length) {
    showScreen('screen-win');
  } else {
    // The road to the next boss may hold an event; if not, the fight starts as usual.
    maybeEvent('prefight', startCombat);
  }
}

// ---------- Random gifting helpers (event outcomes) ----------
// One random draw each, straight off the run's seeded stream, so the same ?seed= replays
// the same gifts. Trinket gifts behave exactly like a market buy would (apply + level);
// card gifts pull the shop pool, and card upgrades mirror the upgrade service.
function grantRandomTrinket() {
  const keys = Object.keys(TRINKET_LIBRARY);
  const key = keys[Math.floor(rand() * keys.length)];
  TRINKET_LIBRARY[key].apply(game);
  game.trinketLevels[key]++;
  return TRINKET_LIBRARY[key].name;
}

function grantRandomCard() {
  const key = SHOP_POOL_KEYS[Math.floor(rand() * SHOP_POOL_KEYS.length)];
  game.deck.push(instantiateCard(key));
  return CARD_LIBRARY[key].name;
}

function upgradeRandomCard() {
  const card = game.deck.find(c => !c.upgraded && (c.baseDamage != null || c.block != null));
  if (!card) return null;
  if (card.baseDamage != null) card.baseDamage += UPGRADE_BONUS;
  if (card.block != null) card.block += UPGRADE_BONUS;
  card.upgraded = true;
  card.name += ' +';
  return card.name;
}

// ---------- Events flow ----------
// The one junction machinery: at a junction, roll (once, seeded) for whether an event
// happens at all, pick one the run hasn't seen yet, and DEFER `next` (openMarket /
// startCombat) behind the event screen. If the roll says no event, `next` runs right here.
function maybeEvent(when, next) {
  let pool = Object.keys(EVENT_LIBRARY).filter(k =>
    EVENT_LIBRARY[k].when === when && !game.usedEvents.has(k));
  if (pool.length === 0) {
    // Every story for this junction has been told this run; refill and draw from a full deck.
    for (const k of Object.keys(EVENT_LIBRARY)) {
      if (EVENT_LIBRARY[k].when === when) game.usedEvents.delete(k);
    }
    pool = Object.keys(EVENT_LIBRARY).filter(k => EVENT_LIBRARY[k].when === when);
  }
  if (rand() >= EVENT_CHANCE) {
    next();
    return;
  }
  const key = pool[Math.floor(rand() * pool.length)];
  game.usedEvents.add(key);
  game.event = { def: EVENT_LIBRARY[key], phase: 'choice', result: '', rolling: false, next };
  showScreen('screen-event');
  renderEvent();
}

// Choosing an option reveals only the outcome; options carry no descriptions. Options
// that gamble call rollDie/flipCoin on game.event (see the generalized signatures there),
// so the player sees the exact same dice overlay as combat gambles before the reveal.
function runEventOption(idx) {
  const ev = game.event;
  if (!ev || ev.phase !== 'choice' || ev.rolling) return;
  ev.def.options[idx].outcome((text) => {
    ev.result = text;
    ev.phase = 'result';
    renderEvent();
  });
}

// Continue button on the outcome screen: hand control to whatever the junction was
// headed for (openMarket / startCombat), which apply the event's effects where relevant.
function eventContinue() {
  const ev = game.event;
  if (!ev || ev.phase !== 'result' || ev.rolling) return;
  game.event = null;
  ev.next();
}

function renderEvent() {
  const ev = game.event;
  if (!ev) return;
  document.getElementById('event-title').textContent = ev.def.name;
  document.getElementById('event-story').textContent = ev.def.story;
  const optsEl = document.getElementById('event-options');
  const choosing = ev.phase === 'choice';
  optsEl.classList.toggle('hidden', !choosing);
  if (choosing) {
    optsEl.innerHTML = '';
    ev.def.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'btn btn-event';
      b.textContent = opt.label;
      b.disabled = !!ev.rolling;
      b.onclick = () => runEventOption(i);
      optsEl.appendChild(b);
    });
  }
  document.getElementById('event-result').textContent = ev.phase === 'result' ? ev.result : '';
  document.getElementById('event-result').classList.toggle('hidden', ev.phase !== 'result');
  document.getElementById('btn-event-continue').classList.toggle('hidden', ev.phase !== 'result');
  document.getElementById('btn-event-continue').disabled = !!ev.rolling;
}

// ---------- Number-key hand shortcuts ----------
// Position in hand -> key label: 1..9 then 0 for the 10th card. Hands past 10 cards have
// no keybind for the overflow (click only) -- rebinding onto QWERTY would cover ground
// this game never needs, since hand size only grows in +1 steps via the Hand Size trinket.
function handKeyLabel(index) {
  if (index < 9) return String(index + 1);
  if (index === 9) return '0';
  return null;
}

// The wiring below (this listener and the block at the bottom of the file) only runs in
// a browser: it's wrapped so the SAME file can also be evaluated in Node by the console
// test suite (tools/engine-tests.js), where there is no document. Everything above the
// wiring is deliberately DOM-free, so tests load the file once and call the game's
// functions directly against the same code the browser runs.

const __inBrowser = typeof document !== 'undefined';

if (__inBrowser) document.addEventListener('keydown', (e) => {
  if (!game || !game.combat) return;
  if (!document.getElementById('screen-combat').classList.contains('active')) return;
  // Block all keyboard input while a die/coin is spinning -- prevents Tab+Space
  // bypassing the overlay and calling endTurn/playCard mid-roll.
  if (game.combat.rolling) return;

  // Space ends the turn -- preventDefault so it doesn't also scroll the page or, if an
  // <button> happens to have focus, double-fire via the browser's own space-to-click.
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    endTurn();
    return;
  }

  const key = e.key;
  let idx;
  if (key >= '1' && key <= '9') idx = key.charCodeAt(0) - '1'.charCodeAt(0);
  else if (key === '0') idx = 9;
  else return;

  const c = game.combat;
  const card = c.hand.find(h => h.handSlot === idx);
  if (!card) return;

  if (c.discardSelection) {
    selectDiscard(card.uid);
  } else if (canPlayCard(card)) {
    playCard(card.uid);
  }
});

// ---------- Rendering ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ---------- Generated descriptions ----------
// A desc string is a TEMPLATE: every {field} is replaced with the card's value for that
// field at render time, so tuning a number in a card/trinket def updates both the effect
// and the printed text from one edit -- the old hand-written strings simply drifted the
// moment any number changed.
// Transforms: {field:x100} prints a fraction as a whole percent (0.1 -> "10"). A
// placeholder with no matching field renders "MISSING:field" -- loud, so the console
// test suite (tools/engine-tests.js) can catch it and so a broken desc is visible
// on the face immediately, not silently stale.
// Upgrades need no special case: they mutate live fields and the templates read the
// card, so an upgraded Strike's desc shows the new damage by itself. Works identically
// for card offers (CARD_LIBRARY copies) and trinket offers (TRINKET_LIBRARY entries).
function cardDescText(card) {
  return String(card.desc).replace(/\{(\w+)(?::(\w+))?\}/g, (all, field, transform) => {
    const value = card[field];
    if (value == null) return `MISSING:${field}`;
    if (transform === 'x100') return `${Math.round(value * 100)}`;
    return String(value);
  });
}

// ---------- Card sprites (pixel art) ----------
// Each run is [col, row, widthCells, heightCells, ink] on a 32x20 grid. Ink 'C' resolves to
// the card's type color, 'W'/'K'/'R' are fixed white/black/red. Keyed by CARD_LIBRARY key --
// a missing entry just renders an empty grid rather than throwing (see spriteSVG below).
const GRID_W = 32, GRID_H = 20;
const SPRITES = {
strike:[[25,0,1,1,'W'],[24,1,1,1,'W'],[23,2,1,1,'W'],[22,3,1,1,'W'],[21,4,1,1,'W'],[20,5,1,1,'W'],[19,6,1,1,'W'],[18,7,1,1,'W'],[17,8,1,1,'W'],[16,9,1,1,'W'],[15,10,1,1,'W'],[14,11,1,1,'W'],[13,12,1,1,'W'],[12,13,1,1,'W'],[9,14,6,1,'W'],[10,19,4,1,'W'],[24,0,1,1,'C'],[23,1,1,1,'C'],[22,2,1,1,'C'],[21,3,1,1,'C'],[20,4,1,1,'C'],[19,5,1,1,'C'],[18,6,1,1,'C'],[17,7,1,1,'C'],[16,8,1,1,'C'],[15,9,1,1,'C'],[14,10,1,1,'C'],[13,11,1,1,'C'],[12,12,1,1,'C'],[11,13,1,1,'C'],[11,15,2,4,'C']],
quickStab:[[21,4,1,1,'W'],[20,5,1,1,'W'],[19,6,1,1,'W'],[18,7,1,1,'W'],[17,8,1,1,'W'],[16,9,1,1,'W'],[15,10,1,1,'W'],[14,11,1,1,'W'],[13,12,1,1,'W'],[10,13,6,1,'W'],[11,17,4,1,'W'],[20,4,1,1,'C'],[19,5,1,1,'C'],[18,6,1,1,'C'],[17,7,1,1,'C'],[16,8,1,1,'C'],[15,9,1,1,'C'],[14,10,1,1,'C'],[13,11,1,1,'C'],[12,12,1,1,'C'],[12,14,2,3,'C'],[2,2,6,1,'C'],[1,6,7,1,'C'],[2,10,6,1,'C']],
comboStrike:[[6,12,3,7,'C'],[13,8,3,11,'C'],[20,4,3,15,'C'],[6,11,3,1,'W'],[13,7,3,1,'W'],[20,3,3,1,'W']],
twinBlades:[[6,0,1,1,'W'],[7,1,1,1,'W'],[8,2,1,1,'W'],[9,3,1,1,'W'],[10,4,1,1,'W'],[11,5,1,1,'W'],[12,6,1,1,'W'],[13,7,1,1,'W'],[14,8,1,1,'W'],[15,9,1,1,'W'],[16,10,1,1,'W'],[17,11,1,1,'W'],[18,12,1,1,'W'],[19,13,1,1,'W'],[25,0,1,1,'W'],[24,1,1,1,'W'],[23,2,1,1,'W'],[22,3,1,1,'W'],[21,4,1,1,'W'],[20,5,1,1,'W'],[19,6,1,1,'W'],[18,7,1,1,'W'],[17,8,1,1,'W'],[16,9,1,1,'W'],[15,10,1,1,'W'],[14,11,1,1,'W'],[13,12,1,1,'W'],[12,13,1,1,'W'],[17,14,6,1,'W'],[9,14,6,1,'W'],[18,19,4,1,'W'],[10,19,4,1,'W'],[7,0,1,1,'C'],[8,1,1,1,'C'],[9,2,1,1,'C'],[10,3,1,1,'C'],[11,4,1,1,'C'],[12,5,1,1,'C'],[13,6,1,1,'C'],[14,7,1,1,'C'],[15,8,1,1,'C'],[16,9,1,1,'C'],[17,10,1,1,'C'],[18,11,1,1,'C'],[19,12,1,1,'C'],[20,13,1,1,'C'],[24,0,1,1,'C'],[23,1,1,1,'C'],[22,2,1,1,'C'],[21,3,1,1,'C'],[20,4,1,1,'C'],[19,5,1,1,'C'],[18,6,1,1,'C'],[17,7,1,1,'C'],[16,8,1,1,'C'],[15,9,1,1,'C'],[14,10,1,1,'C'],[13,11,1,1,'C'],[12,12,1,1,'C'],[11,13,1,1,'C'],[19,15,2,4,'C'],[11,15,2,4,'C']],
thousandCuts:[[3,8,2,1,'C'],[4,9,2,1,'C'],[5,10,2,1,'C'],[6,11,2,1,'C'],[9,8,2,1,'C'],[10,9,2,1,'C'],[11,10,2,1,'C'],[12,11,2,1,'C'],[15,8,2,1,'C'],[16,9,2,1,'C'],[17,10,2,1,'C'],[18,11,2,1,'C'],[21,8,2,1,'C'],[22,9,2,1,'C'],[23,10,2,1,'C'],[24,11,2,1,'C'],[27,8,2,1,'C'],[28,9,2,1,'C'],[29,10,2,1,'C'],[30,11,2,1,'C'],[3,7,2,1,'W'],[9,7,2,1,'W'],[15,7,2,1,'W'],[21,7,2,1,'W'],[27,7,2,1,'W']],
heavyStrike:[[9,3,15,1,'W'],[9,4,15,6,'C'],[15,10,3,10,'W'],[11,6,2,2,'K'],[20,6,2,2,'K']],
glassCannon:[[15,6,2,1,'C'],[14,7,4,1,'C'],[13,8,6,1,'C'],[12,9,8,2,'C'],[13,11,6,1,'C'],[14,12,4,1,'C'],[15,13,2,1,'C'],[11,5,1,1,'W'],[10,4,1,1,'W'],[9,3,1,1,'W'],[20,5,1,1,'W'],[21,4,1,1,'W'],[22,3,1,1,'W'],[11,14,1,1,'W'],[10,15,1,1,'W'],[9,16,1,1,'W'],[20,14,1,1,'W'],[21,15,1,1,'W'],[22,16,1,1,'W']],
ambush:[[15,4,2,1,'W'],[14,5,4,1,'W'],[13,6,6,1,'W'],[12,7,8,1,'W'],[11,8,10,1,'W'],[10,9,12,1,'W'],[15,4,2,1,'C'],[14,5,1,1,'C'],[17,5,1,1,'C'],[13,6,1,1,'C'],[18,6,1,1,'C'],[12,7,1,1,'C'],[19,7,1,1,'C'],[11,8,2,1,'C'],[10,9,1,1,'C'],[21,9,1,1,'C'],[10,10,1,1,'C'],[21,10,1,1,'C'],[10,11,1,1,'C'],[21,11,1,1,'C'],[10,12,1,1,'C'],[21,12,1,1,'C'],[11,13,2,1,'C'],[12,14,4,1,'C'],[11,14,1,2,'C'],[20,14,1,2,'C'],[12,16,4,2,'C'],[11,18,6,1,'C'],[10,19,8,1,'C'],[5,15,4,3,'W'],[23,15,4,3,'W'],[4,14,1,1,'W'],[27,14,1,1,'W'],[3,15,1,1,'W'],[28,15,1,1,'W'],[4,17,3,1,'W'],[25,17,3,1,'W'],[5,18,2,1,'W'],[25,18,2,1,'W'],[5,19,1,1,'W'],[26,19,1,1,'W'],[7,15,2,1,'K'],[23,15,2,1,'K'],[6,16,4,1,'K'],[22,16,4,1,'K'],[5,17,6,1,'K'],[21,17,6,1,'K']],
guard:[[11,3,10,1,'W'],[11,4,10,6,'C'],[12,10,8,2,'C'],[13,12,6,2,'C'],[14,14,4,1,'C'],[15,15,2,1,'C'],[11,4,1,6,'W'],[20,4,1,6,'W']],
brace:[[4,12,24,1,'W'],[4,13,24,3,'C'],[7,16,2,3,'C'],[23,16,2,3,'C']],
stonewall:[[4,5,24,1,'W'],[4,6,24,12,'C'],[4,9,24,1,'K'],[4,13,24,1,'K'],[11,6,1,3,'K'],[19,6,1,3,'K'],[7,10,1,3,'K'],[15,10,1,3,'K'],[23,10,1,3,'K'],[11,14,1,4,'K'],[19,14,1,4,'K']],
shieldWall:[[3,5,8,1,'W'],[12,5,8,1,'W'],[21,5,8,1,'W'],[3,6,8,5,'C'],[4,11,6,2,'C'],[5,13,4,1,'C'],[6,14,2,1,'C'],[12,6,8,5,'C'],[13,11,6,2,'C'],[14,13,4,1,'C'],[15,14,2,1,'C'],[21,6,8,5,'C'],[22,11,6,2,'C'],[23,13,4,1,'C'],[24,14,2,1,'C']],
bulwark:[[2,6,6,1,'W'],[9,6,6,1,'W'],[16,6,6,1,'W'],[23,6,6,1,'W'],[2,7,6,4,'C'],[3,11,4,2,'C'],[4,13,2,1,'C'],[9,7,6,4,'C'],[10,11,4,2,'C'],[11,13,2,1,'C'],[16,7,6,4,'C'],[17,11,4,2,'C'],[18,13,2,1,'C'],[23,7,6,4,'C'],[24,11,4,2,'C'],[25,13,2,1,'C']],
shieldBash:[[5,4,10,1,'W'],[5,5,10,6,'C'],[6,11,8,2,'C'],[7,13,6,2,'C'],[8,15,4,1,'C'],[9,16,2,1,'C'],[19,5,2,1,'R'],[22,3,2,1,'R'],[19,9,3,1,'R'],[24,9,3,1,'R'],[19,14,2,1,'R'],[22,16,2,1,'R']],
brambleGuard:[[10,5,12,1,'W'],[10,6,12,6,'C'],[11,12,10,2,'C'],[12,14,8,1,'C'],[14,15,4,1,'C'],[8,7,2,1,'W'],[8,10,2,1,'W'],[9,13,2,1,'W'],[22,7,2,1,'W'],[22,10,2,1,'W'],[21,13,2,1,'W'],[13,3,1,2,'W'],[18,3,1,2,'W']],
armor:[[8,0,16,1,'W'],[8,1,1,8,'W'],[23,1,1,8,'W'],[9,1,14,8,'C'],[9,9,14,3,'C'],[10,12,12,2,'C'],[12,14,8,1,'C'],[13,15,6,1,'C'],[14,16,4,1,'C'],[15,17,2,1,'C'],[15,3,2,11,'K'],[11,6,10,2,'K']],
treasureGrab:[[11,14,10,3,'C'],[10,10,12,3,'C'],[12,6,8,3,'C'],[11,14,10,1,'W'],[10,10,12,1,'W'],[12,6,8,1,'W'],[15,11,2,1,'K'],[15,15,2,1,'K']],
rollTheBones:[[8,0,20,20,'C'],[8,0,20,1,'W'],[8,0,1,20,'W'],[11,3,3,3,'K'],[22,3,3,3,'K'],[16,8,3,3,'K'],[11,14,3,3,'K'],[22,14,3,3,'K']],
doubleOrNothing:[[12,3,8,1,'C'],[10,4,12,1,'C'],[9,5,14,10,'C'],[10,15,12,1,'C'],[12,16,8,1,'C'],[12,3,8,1,'W'],[9,5,1,10,'W'],[12,7,2,6,'K'],[18,7,2,6,'K'],[14,9,4,2,'K']],
skim:[[5,13,5,4,'C'],[13,13,5,4,'C'],[21,13,5,4,'C'],[5,13,5,1,'W'],[13,13,5,1,'W'],[21,13,5,1,'W'],[4,8,1,1,'W'],[6,6,1,1,'W'],[9,5,1,1,'W'],[13,4,1,1,'W'],[17,4,1,1,'W'],[21,5,1,1,'W'],[24,6,1,1,'W'],[26,7,1,1,'W'],[26,8,1,1,'W'],[27,8,1,1,'W']],
bloodMoney:[[12,2,8,1,'C'],[10,3,12,1,'C'],[9,4,14,7,'C'],[10,11,12,1,'C'],[12,12,8,1,'C'],[12,2,8,1,'W'],[9,4,1,7,'W'],[15,14,2,1,'R'],[14,15,4,1,'R'],[13,16,6,2,'R'],[14,18,4,1,'R']],
hedge:[[14,4,4,1,'C'],[13,5,6,1,'C'],[12,6,8,2,'C'],[12,8,8,4,'C'],[12,12,8,2,'C'],[13,14,6,1,'C'],[14,15,4,1,'C'],[15,6,2,10,'K'],[13,6,2,1,'W'],[12,7,1,2,'W'],[2,10,5,1,'C'],[3,9,4,1,'C'],[3,11,4,1,'C'],[4,8,3,1,'C'],[4,12,3,1,'C'],[7,9,3,3,'C'],[22,9,3,3,'C'],[25,8,3,1,'C'],[25,12,3,1,'C'],[25,9,4,1,'C'],[25,11,4,1,'C'],[25,10,5,1,'C']],
shakedown:[[14,2,4,1,'W'],[13,3,6,1,'C'],[11,4,10,2,'C'],[10,6,12,10,'C'],[11,16,10,1,'C'],[13,17,6,1,'C'],[10,8,12,2,'K'],[15,11,2,4,'K'],[13,12,6,1,'K']],
protectionRacket:[[13,8,6,1,'C'],[11,9,10,6,'C'],[13,15,6,1,'C'],[13,8,6,1,'W'],[11,9,1,6,'W'],[8,6,1,1,'W'],[9,4,1,1,'W'],[11,3,2,1,'W'],[14,2,4,1,'W'],[19,3,2,1,'W'],[22,4,1,1,'W'],[23,6,1,1,'W'],[22,5,3,1,'W'],[24,6,1,2,'W'],[15,10,2,4,'K']],
crackTheVault:[[7,1,18,18,'C'],[9,3,14,14,'K'],[14,7,6,6,'C'],[7,1,18,1,'W'],[16,5,2,2,'W'],[16,13,2,2,'W'],[11,9,3,2,'W'],[20,9,3,2,'W']],
gather:[[4,6,9,12,'C'],[11,4,9,14,'C'],[18,6,9,12,'C'],[4,6,9,1,'W'],[11,4,9,1,'W'],[18,6,9,1,'W'],[10,4,1,14,'W'],[17,4,1,14,'W']],
spark:[[16,2,3,1,'C'],[15,3,3,1,'C'],[14,4,3,1,'C'],[13,5,3,1,'C'],[12,6,3,1,'C'],[11,7,12,2,'C'],[18,9,3,1,'C'],[17,10,3,1,'C'],[16,11,3,1,'C'],[15,12,3,1,'C'],[14,13,3,1,'C'],[13,14,3,1,'C'],[16,2,3,1,'W'],[11,7,12,1,'W']],
overdraw:[[3,5,10,13,'C'],[3,5,10,1,'W'],[18,3,2,5,'W'],[16,6,6,1,'W'],[17,5,4,1,'W'],[25,10,2,5,'W'],[23,11,6,1,'W'],[24,12,4,1,'W'],[18,1,2,2,'C'],[25,15,2,2,'C']],
loadedDiceCard:[[9,4,16,15,'C'],[9,4,16,1,'W'],[9,4,1,15,'W'],[12,7,3,2,'K'],[19,7,3,2,'K'],[12,10,3,2,'K'],[19,10,3,2,'K'],[12,14,3,2,'K'],[19,14,3,2,'K'],[26,1,1,3,'W'],[25,2,3,1,'W']],
sidestep:[[4,11,6,7,'C'],[19,3,6,7,'C'],[4,11,6,1,'W'],[19,3,6,1,'W'],[11,10,2,1,'W'],[13,9,2,1,'W'],[15,8,2,1,'W'],[17,7,2,1,'W'],[17,5,1,3,'W'],[15,7,3,1,'W']],
overcharge:[[5,5,20,12,'C'],[25,8,3,6,'W'],[5,5,20,1,'W'],[16,7,3,1,'K'],[15,8,3,1,'K'],[14,9,3,1,'K'],[12,10,8,1,'K'],[15,11,3,1,'K'],[14,12,3,1,'K'],[13,13,3,1,'K']],
burnout:[[15,2,2,1,'C'],[14,3,4,1,'C'],[13,4,6,2,'C'],[12,6,8,2,'C'],[11,8,10,8,'C'],[12,16,8,2,'C'],[15,2,2,1,'W'],[14,10,4,6,'W'],[13,12,6,3,'W']]
};
const TYPE_INK={attack:'#ff0000',block:'#0000ff',loot:'#ffff00',skill:'#a855f7'};
const GRID_OPACITY={attack:.35,block:.5,loot:.3,skill:.4};

function spriteSVG(key,type){
  const runs=SPRITES[key]||[]; const ink=TYPE_INK[type]||'#ffffff';
  const pick=c=>c==='C'?ink:c==='W'?'#ffffff':c==='K'?'#000000':'#ff0000';
  let g='';
  for(const [x,y,w,h,c] of runs) g+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${pick(c)}"/>`;
  return `<svg viewBox="0 0 ${GRID_W} ${GRID_H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="pg-${key}" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0 L0 0 0 1" fill="none" stroke="${ink}" stroke-width="0.06" opacity="${GRID_OPACITY[type]||.35}"/></pattern></defs><rect width="${GRID_W}" height="${GRID_H}" fill="url(#pg-${key})"/>${g}</svg>`;
}

// ============================================================================
// BOSS PORTRAITS — the big pixel-art creature above the boss HP bar.
//
// The ART LIVES IN boss-art.js, one file up, as pure data. This block is only the
// renderer: it reads window.BOSS_ART and turns it into an <svg>. To redesign the
// bosses, edit boss-art.js (or the generator in tools/boss-art/) and change nothing
// in here. That split exists so the art can be reworked without a 130KB file, and
// so a broken art file can only ever produce a missing portrait, never a broken game.
//
// Self-contained: nothing outside this block depends on it. To strip the feature entirely,
// delete THIS WHOLE BLOCK, the whole of boss-art.js, the <script> tag for it in index.html,
// the #boss-portrait div, and the ".boss-portrait" rules in style.css.
//
// Art is pixel-run data on a larger grid than the cards (78x44 vs 32x20), same
// [col, row, width, height, ink] format. Keyed by boss NAME, not index, so
// reordering BOSSES can't mismatch a portrait to the wrong fight. A boss with no
// entry renders nothing and leaves the bar where it always was, so adding a new
// boss without art is safe.
// ============================================================================
const BOSS_GRID_W = 78, BOSS_GRID_H = 44;

// Read from boss-art.js. Defaults keep the game fully playable if that file is
// missing or malformed -- portraits quietly disappear instead of the game failing
// to boot, which matters because it is otherwise a single point of total failure.
const BOSS_ART = (typeof window !== 'undefined' && window.BOSS_ART) || {};
const BOSS_INK = BOSS_ART.ink || {};
const BOSS_PORTRAITS = BOSS_ART.portraits || {};
const BOSS_VIEWS = BOSS_ART.views || {};

// One line of feedback in the console, since the failure mode is otherwise a blank
// box that looks like a styling problem. Runs tools/boss-art/check.js for the full
// structural report.
if (typeof window !== 'undefined' && window.console && window.console.info) {
  const n = Object.keys(BOSS_PORTRAITS).length;
  window.console.info(
    n ? `[boss art] loaded ${n} portraits from boss-art.js`
      : '[boss art] boss-art.js loaded no portraits -- portraits are disabled');
}



// `variant` distinguishes the two stacked layers (base art + red hit-flash overlay) so
// the two <pattern> ids stay unique -- duplicate ids in one document are invalid, and
// the second copy would otherwise bind to the first copy's pattern.
// `className` is baked into the opening tag rather than applied by re-wrapping stripped
// content. An earlier version sliced the <svg ...> off and put a bare <svg> back, which
// silently dropped the viewBox and preserveAspectRatio -- and an SVG with no viewBox has
// no coordinate mapping, so every rect drew at 1 unit = 1 CSS pixel and the art came out
// tiny no matter how large the container was.
// `includeBackground` controls whether the pixel-grid pattern backdrop is drawn.
// For the 'flash' variant we set it FALSE so only the boss pixels turn red, not the empty space.
function bossPortraitSVG(bossName, variant, className, includeBackground = true) {
  // hasOwnProperty, not a plain lookup: BOSS_PORTRAITS['constructor'] (or 'toString',
  // 'valueOf', ...) otherwise resolves to something on Object.prototype, and iterating
  // that throws. Nothing here ever passes a non-literal name today, but the guard costs
  // nothing and keeps the lookup total.
  const runs = Object.prototype.hasOwnProperty.call(BOSS_PORTRAITS, bossName)
    ? BOSS_PORTRAITS[bossName] : null;
  if (!runs || !runs.length) return '';
  let g = '';
  for (const [x, y, w, h, ink] of runs) {
    g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${BOSS_INK[ink] || BOSS_INK.G}"/>`;
  }
  // The pixel-grid tint is a pattern over the whole cell rather than a shape, so it fills
  // the gaps between the outlined bodies and ties the portrait to the card art's look.
  // It is tinted with the boss's OWN dominant colour (the ink covering the most pixels,
  // ignoring the black outline and white highlights) so each portrait's backdrop matches
  // it -- grey for the rats, purple for the Lich, gold for God.
  // The id is slugged from the boss name so two portraits can never collide on one
  // page -- 'The Dragon' and 'Iron Sentinel' must not share an id just because they
  // happen to have the same number of runs.
  const area = {};
  for (const [x, y, w, h, ink] of runs) {
    if (ink === 'K' || ink === 'W') continue;
    area[ink] = (area[ink] || 0) + w * h;
  }
  const accent = Object.keys(area).sort((a, b) => area[b] - area[a])[0] || 'G';
  const slug = String(bossName).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const pid = `bp-${slug}${variant ? '-' + variant : ''}`;
  // Each boss gets its own viewBox, cropped tight to its art, so it fills the frame
  // instead of floating in a shared 78x44 box. The art data itself stays on one grid --
  // only the window onto it differs. CSS then fits the result inside a fixed box with
  // preserveAspectRatio="meet", so a tall narrow boss is height-limited and a wide
  // squat one is width-limited, and each is as large as its own shape allows.
  const [vx, vy, vw, vh] = BOSS_VIEWS[bossName] || [0, 0, BOSS_GRID_W, BOSS_GRID_H];
  const backgroundRect = includeBackground
    ? `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="url(#${pid})"/>`
    : '';
  return `<svg${className ? ` class="${className}"` : ''} viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="${pid}" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0 L0 0 0 1" fill="none" stroke="${BOSS_INK[accent]}" stroke-width="0.06" opacity="0.18"/></pattern></defs>${backgroundRect}${g}</svg>`;
}

// ---------- Hit reaction ----------
// Detected by COMPARING boss HP between renders rather than by hooking the damage
// sites. That keeps the whole reaction inside this block: nothing in resolveAttackHit,
// Bramble Guard's retaliation, or anywhere else in the game core has to know this
// exists, so stripping the block really does leave no traces.
let portraitLastName = null;
let portraitLastHp = null;
let portraitHitTimer = null;

function bossPortraitFlash() {
  const el = document.getElementById('boss-portrait');
  if (!el) return;
  // Remove-then-readd, forcing the CSS animation to restart. A second hit landing while
  // the first flash is still fading has to retrigger, and simply re-adding a class
  // that is already there is a no-op. Same reflow trick showComboPopup uses.
  el.classList.remove('hit');
  void el.offsetWidth;
  el.classList.add('hit');
  clearTimeout(portraitHitTimer);
  portraitHitTimer = setTimeout(() => el.classList.remove('hit'), 520);
}

// The one line outside this block that touches it. Guarded on the element so deleting
// the #boss-portrait div from index.html is a complete removal on its own -- the game
// keeps running with the portrait simply absent.
function renderBossPortrait(bossName, bossHp) {
  const el = document.getElementById('boss-portrait');
  if (!el) return;
  const base = bossPortraitSVG(bossName, 'base');
  if (!base) {
    el.innerHTML = '';
    el.classList.add('empty');
    portraitLastName = null;
    portraitLastHp = null;
    return;
  }
  // Two pixel-identical layers, each a complete <svg> with its own viewBox. CSS forces
  // every rect in the top one to red and fades its opacity, which reads as the whole
  // boss flashing red while the artwork underneath stays put -- no SVG filter, no second
  // set of pixel data, and the silhouette can't shift because the two layers share the
  // same viewBox and geometry exactly.
  // Flash layer excludes the background pattern (includeBackground=false) so ONLY the
  // boss pixels turn red, not the empty space around them.
  el.innerHTML = bossPortraitSVG(bossName, 'base', 'base', true)
               + bossPortraitSVG(bossName, 'flash', 'flash', false);
  el.classList.remove('empty');

  // A rising HP means a new fight or a heal, not a hit: rebase without flashing.
  if (bossName !== portraitLastName || bossHp > portraitLastHp) {
    portraitLastName = bossName;
    portraitLastHp = bossHp;
    return;
  }
  if (bossHp < portraitLastHp) {
    portraitLastHp = bossHp;
    bossPortraitFlash();
  }
}

// ---------- Card badges (the colored circles showing cost / hotkey) ----------
// One shared readout so a hand card and its shop listing always agree on what a card does --
// cardAttackDisplay/cardBlockDisplay are the single source of truth for "how much damage or
// block does this number actually represent", used by cornerBadges and the type-line stat.

// Not every attack card carries a flat baseDamage -- Shield Bash derives its hit from the
// block it just gained, and Double or Nothing has a flat payout under a different field
// name. Pure-gamble cards (Roll the Bones) have no single number to show and are skipped.
function cardAttackDisplay(card) {
  if (card.damageFromBlockPercent) return Math.round((card.block || 0) * card.damageFromBlockPercent);
  if (card.baseDamage != null) return card.baseDamage;
  if (card.winDamage != null) return card.winDamage;
  return null;
}

function cardBlockDisplay(card) {
  return card.block || null;
}

// Cost / gold-cost / hotkey badges, pinned to the card's corners. `keybind` is the hand-only
// hotkey label (null in the shop, where cards have no hotkey to show).
function cornerBadges(card, keybind) {
  return `
    <div class="badge badge-cost" title="Energy cost">${card.cost}</div>
    ${card.goldCost ? `<div class="badge badge-goldcost" title="Gold cost">${card.goldCost}</div>` : ''}
    ${keybind ? `<div class="badge badge-key" title="Hotkey">${keybind}</div>` : ''}
  `;
}

// What this card would do if played right now, with the current turn's combo counts.
// Mirrors playCard's block-then-attack branches hit for hit (including multi-hit cards,
// whose later hits score at higher counts), but touches nothing -- pure read of
// game.combat. Deferred attacks (Glass Cannon) and gold-cost gambles (Bones, Double Up)
// are deliberately excluded: their outcome is random, so there is nothing honest to
// preview and they keep their static base numbers.
function previewCardNumbers(card) {
  const c = game.combat;
  const out = { atk: null, atkMult: 1, block: null, blockMult: 1, gold: null };
  // Block BEFORE attack, exactly like playCard: Shield Bash gains its block first and
  // then hits for the block it is standing on, so its preview base includes its own
  // block gain rather than just the block already banked.
  if (card.block) {
    const hits = card.hits || 1;
    let total = 0, mult = 1;
    for (let h = 0; h < hits; h++) {
      // Mirrors resolveBlockGain's base: Ironwood Charm + the event's blockHitBonus.
      const o = blockHitOutcome(
        card.block + (game.blockBonus || 0) + (c.blockHitBonus || 0),
        card.blockComboBonus || 0, c.turnBlockCount + h);
      total += o.block;
      mult = o.mult;
    }
    out.block = total;
    out.blockMult = mult;
  }
  if ((card.type === 'attack' || card.isAttackToo) && !card.deferredAttack) {
    const baseDmg = card.damageFromBlockPercent
      ? Math.round((c.block + (out.block || 0)) * card.damageFromBlockPercent)
      : (card.baseDamage || 0);
    const hits = card.hits || 1;
    let total = 0, mult = 1;
    for (let h = 0; h < hits; h++) {
      // Mirrors resolveAttackHit's base: Whetstone + the event's per-hit bonus, and the
      // first-attack-of-the-fight bonus when this would be that very first hit.
      let base = baseDmg + (game.attackBonus || 0) + (c.attackHitBonus || 0);
      if (h === 0 && c.turnAttackCount === 0 && c.firstAttackBonus) base += c.firstAttackBonus;
      const o = attackHitOutcome(base, card.comboBonus || 0, c.turnAttackCount + h);
      total += o.damage;
      mult = o.mult;
    }
    out.atk = total;
    out.atkMult = mult;
  }
  if (card.goldPerAttack) {
    out.gold = c.turnAttackCount * card.goldPerAttack;
  }
  return out;
}

// The type line's right-hand stat -- folds what used to be the separate attack/block badges
// into the same band as the card's type. Shield Bash is the only card with both an attack
// and a block value, shown as "atk/block"; cards with neither (Gather, Protection
// Racket, ...) show nothing rather than a placeholder.
//
// In hand (live=true) the numbers are the preview for playing the card RIGHT NOW --
// combo multiplier and per-hit bonuses applied, multi-hit cards summed -- instead of the
// flat base values the shop shows. A boosted number gets the .boosted chip so a combo
// working in your favour is visible before you commit to the play.
function typeLineStat(card, live = false) {
  const hits = card.hits || 1;
  // Static base values first -- the shop, the remove/upgrade screens, and any live card
  // with nothing previewable (deferred attacks, gambles: random outcome, nothing honest
  // to show) all display these.
  const atk = cardAttackDisplay(card);
  const block = cardBlockDisplay(card);
  let atkText = atk == null ? null : (hits > 1 ? `${atk}x${hits}` : `${atk}`);
  let blockText = block == null ? null : (hits > 1 ? `${block}x${hits}` : `${block}`);
  let boosted = false, title = '';
  if (live && game.combat) {
    const p = previewCardNumbers(card);
    if (p.atk != null) {
      atkText = `${p.atk}`;
      if (p.atkMult > 1.001) { boosted = true; title += `attack x${p.atkMult.toFixed(2)} `; }
    }
    if (p.block != null) {
      blockText = `${p.block}`;
      if (p.blockMult > 1.001) { boosted = true; title += `block x${p.blockMult.toFixed(2)} `; }
    }
    if (p.gold != null && atkText == null && blockText == null) {
      atkText = `${p.gold}g`;
    }
  }
  let text;
  if (atkText != null && blockText != null) text = `${atkText}/${blockText}`;
  else text = atkText != null ? atkText : (blockText != null ? blockText : '');
  if (!text) return '';
  return `<span class="stat${boosted ? ' boosted' : ''}"${title ? ` title="combo ${title.trim()}"` : ''}>${text}</span>`;
}

// Full card face -- badges, a framed art window, the type line, and the rules text. Shared
// by the hand, the shop, and the remove screen so a card looks identical everywhere it's shown.
// live=true only in the hand: the type-line stat becomes the combo-aware preview for
// playing the card right now (see typeLineStat). Everywhere else shows flat base values.
function cardFaceHTML(card, keybind, live = false) {
  return `
    ${cornerBadges(card, keybind)}
    <div class="name${card.goldCost ? ' has-goldcost' : ''}">${card.name}</div>
    <div class="name-rule"></div>
    <div class="art">${spriteSVG(card.key, card.type)}</div>
    <div class="typeline"><span>${card.type}</span>${typeLineStat(card, live)}</div>
    <div class="desc">${cardDescText(card)}</div>
  `;
}

function renderCombat() {
  const c = game.combat;
  if (!c) return;

  document.getElementById('player-hp-fill').style.width = `${Math.max(0, (game.hp / game.maxHp) * 100)}%`;
  document.getElementById('player-hp-text').textContent = `${game.hp}/${game.maxHp}`;
  document.getElementById('player-block-text').textContent = c.block;
  // BASE_ENERGY is energy-per-turn, not a cap -- Burnout and other energyGain effects can
  // push c.energy past it, where "x/3" would misleadingly read like a maximum. Only show
  // the denominator while energy is still at or under the normal per-turn amount.
  document.getElementById('player-energy-text').textContent =
    c.energy <= BASE_ENERGY ? `${c.energy}/${BASE_ENERGY}` : `${c.energy}`;
  document.getElementById('player-gold-text').textContent = game.gold;
  document.getElementById('deck-count-text').textContent = game.deck.length;

  // Primary boss portrait (always the first boss)
  const primaryBoss = c.bosses[0];
  renderBossPortrait(primaryBoss.name, primaryBoss.hp);

  // Render all bosses in the container
  const container = document.getElementById('bosses-container');
  container.innerHTML = '';
  c.bosses.forEach((boss, i) => {
    const isPrimary = i === 0;
    const living = boss.hp > 0;
    // Ambush doubles the boss's next effective hits -- the intent readout shows the
    // number that will actually land, not the pattern's plain number.
    const nextHitRaw = boss.pattern[boss.patternIndex];
    const nextHit = c.ambushAttacks > 0 ? nextHitRaw * 2 : nextHitRaw;
    const bossEl = document.createElement('div');
    bossEl.className = `boss-display${isPrimary ? ' primary' : ''}${!living ? ' dead' : ''}${boss.isBackup ? ' backup' : ''}`;
    bossEl.innerHTML = `
      <div class="boss-name">${boss.name}${boss.isBackup ? ' (Backup)' : ''}${isPrimary ? `  (Boss ${game.bossIndex + 1}/${BOSSES.length})` : ''}</div>
      <div class="bar boss-bar"><div class="bar-fill boss-fill" style="width:${Math.max(0, (boss.hp / boss.maxHp) * 100)}%"></div></div>
      <div class="boss-hp-text">${living ? `${boss.hp}/${boss.maxHp}` : 'DEFEATED'}</div>
      <div class="intent">${living ? (nextHit === 0 ? 'Intent: nothing next turn' : `Intent: ${nextHit} damage next turn${c.ambushAttacks > 0 && nextHitRaw > 0 ? ' (AMBUSH)' : ''}`) : ''}</div>
    `;
    container.appendChild(bossEl);
  });

  document.getElementById('draw-count').textContent = c.drawPile.length;
  document.getElementById('discard-count').textContent = c.discardPile.length;
  // The combo the NEXT card would score at: same formula the preview and the resolvers
  // share -- including Combo Master's comboStepBonus, which the resolvers and this
  // readout both fold in -- read at the current counts. Always visible so the multiplier
  // is plannable instead of something you only discover after committing to a play.
  const step = COMBO_STEP + (game.comboStepBonus || 0);
  document.getElementById('combo-text').textContent =
    `ATK x${(1 + step * c.turnAttackCount).toFixed(2)} · BLK x${(1 + step * c.turnBlockCount).toFixed(2)}`;
  // Only shown once something has actually been exhausted -- most fights never touch
  // this pile (only Burnout uses exhaustOnPlay today), so it stays out of the way until
  // it's relevant instead of sitting at a confusing permanent "0".
  document.getElementById('exhaust-row').classList.toggle('hidden', c.exhaustPile.length === 0);
  document.getElementById('exhaust-count').textContent = c.exhaustPile.length;

  const selecting = !!c.discardSelection;
  const handEl = document.getElementById('hand');
  handEl.innerHTML = '';
  c.hand.forEach(card => {
    const div = document.createElement('div');
    const playable = canPlayCard(card);
    const key = handKeyLabel(card.handSlot);
    div.className = `card ${card.type}${(!selecting && !playable) ? ' unplayable' : ''}${selecting ? ' discard-target' : ''}`;
    div.dataset.uid = card.uid;
    div.draggable = !selecting;
    div.innerHTML = cardFaceHTML(card, key, true);
    if (selecting) {
      div.onclick = () => selectDiscard(card.uid);
    } else {
      if (playable) div.onclick = () => playCard(card.uid);
      attachHandDragEvents(div);
    }
    handEl.appendChild(div);
  });
  handEl.ondragover = selecting ? null : (e) => {
    e.preventDefault();
    if (draggedCardEl && e.target === handEl) handEl.appendChild(draggedCardEl);
  };

  const promptEl = document.getElementById('discard-prompt');
  if (selecting) {
    promptEl.textContent = `Choose ${c.discardSelection.remaining} card(s) to discard for ${c.discardSelection.forCard.name}`;
    promptEl.classList.remove('hidden');
  } else {
    promptEl.classList.add('hidden');
  }
  document.getElementById('btn-end-turn').disabled = selecting || c.rolling;

  const logEl = document.getElementById('combat-log');
  logEl.innerHTML = c.log.slice(0, 6).map(m => `<div>${m}</div>`).join('');
}

// ---------- Hand drag-to-reorder (Balatro-style) ----------
// Reordering is purely cosmetic (what order you play cards in), so we move the actual
// DOM node live as you drag over neighbors, then sync game.combat.hand to match on drop --
// no full re-render mid-drag, which would otherwise yank the dragged node out from under
// the browser's native drag session.
let draggedCardEl = null;

function attachHandDragEvents(div) {
  div.ondragstart = (e) => {
    draggedCardEl = div;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', div.dataset.uid);
    setTimeout(() => div.classList.add('dragging'), 0);
  };
  div.ondragend = () => {
    div.classList.remove('dragging');
    draggedCardEl = null;
    syncHandOrderFromDOM();
    assignHandSlots();
    // Full re-render (safe now that the drag session is over) so each card's number
    // badge matches its new position -- reordering hand cards must swap their keybinds.
    renderCombat();
  };
  div.ondragover = (e) => {
    e.preventDefault();
    if (!draggedCardEl || draggedCardEl === div) return;
    const rect = div.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    div.parentNode.insertBefore(draggedCardEl, before ? div : div.nextSibling);
  };
}

function syncHandOrderFromDOM() {
  const c = game.combat;
  if (!c) return;
  const order = Array.from(document.querySelectorAll('#hand .card')).map(el => Number(el.dataset.uid));
  c.hand.sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid));
}

function renderMarket() {
  document.getElementById('market-hp-text').textContent = `${game.hp}/${game.maxHp}`;
  document.getElementById('market-gold-text').textContent = game.gold;
  document.getElementById('heal-cost').textContent = healCost();
  document.getElementById('remove-cost').textContent = removeCost();
  document.getElementById('upgrade-cost').textContent = upgradeCost();
  document.getElementById('reroll-cost').textContent = game.rerollCost;
  document.getElementById('btn-reroll').disabled = game.gold < game.rerollCost;

  // Every shop offer is a .shop-slot: the offer itself (a real .card for a purchasable
  // card, identical to how it looks in hand; a plain box for a trinket) stacked above its
  // own .shop-price element, so the price always sits below the thing being priced instead
  // of being baked into the card/box.
  const cardsEl = document.getElementById('market-cards');
  cardsEl.innerHTML = '';
  marketState.cardOffers.forEach((offer, i) => {
    const owned = marketState.boughtCardKeys.has(i);
    const price = discountedPrice(offer.price);
    const afford = game.gold >= price;

    const slot = document.createElement('div');
    slot.className = `shop-slot${owned ? ' owned' : ''}${!owned && !afford ? ' cant-afford' : ''}`;

    const div = document.createElement('div');
    div.className = `card shop-card ${offer.type}`;
    div.innerHTML = cardFaceHTML(offer, null);

    const priceEl = document.createElement('div');
    priceEl.className = 'shop-price';
    priceEl.textContent = owned ? 'Bought' : (price === 0 ? 'Free' : price + 'g');

    slot.appendChild(div);
    slot.appendChild(priceEl);
    if (!owned) slot.onclick = () => buyMarketCard(i);
    cardsEl.appendChild(slot);
  });

  // Trinkets are repeatable, so there's no "owned" state -- just a stacking level.
  const trinketsEl = document.getElementById('market-trinkets');
  trinketsEl.innerHTML = '';
  currentTrinketOffers().forEach((offer, i) => {
    const price = discountedPrice(offer.price);
    const afford = game.gold >= price;
    const level = game.trinketLevels[offer.key];

    const slot = document.createElement('div');
    slot.className = `shop-slot${!afford ? ' cant-afford' : ''}`;

    const div = document.createElement('div');
    div.className = 'market-card trinket';
    div.innerHTML = `<div class="name">${offer.name}${level > 0 ? ` (Lv ${level})` : ''}</div><div class="desc">${cardDescText(offer)}</div>`;

    const priceEl = document.createElement('div');
    priceEl.className = 'shop-price';
    priceEl.textContent = `${price}g`;

    slot.appendChild(div);
    slot.appendChild(priceEl);
    slot.onclick = () => buyMarketTrinket(i);
    trinketsEl.appendChild(slot);
  });

  document.getElementById('btn-heal').disabled = game.gold < healCost() || game.hp >= game.maxHp;
  document.getElementById('btn-remove').disabled = game.gold < removeCost() || game.deck.length === 0;
  document.getElementById('btn-upgrade').disabled = game.gold < upgradeCost() || upgradeableCards().length === 0;
}

// ---------- Wiring ----------
// (Browser-only -- see the __inBrowser note above.)
if (__inBrowser) {
  document.getElementById('btn-new-run').onclick = newRun;
  document.getElementById('btn-end-turn').onclick = endTurn;
  document.getElementById('btn-continue').onclick = continueFromMarket;
  document.getElementById('btn-reroll').onclick = rerollShop;
  document.getElementById('btn-heal').onclick = doHeal;
  document.getElementById('btn-remove').onclick = openRemoveScreen;
  document.getElementById('btn-upgrade').onclick = openUpgradeScreen;
  document.getElementById('btn-cancel-remove').onclick = () => { showScreen('screen-market'); renderMarket(); };
  document.getElementById('btn-cancel-upgrade').onclick = () => { showScreen('screen-market'); renderMarket(); };
  document.getElementById('btn-restart-lose').onclick = newRun;
  document.getElementById('btn-restart-win').onclick = newRun;
  document.getElementById('btn-event-continue').onclick = eventContinue;
}

if (__inBrowser) showScreen('screen-start');

