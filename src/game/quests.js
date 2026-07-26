/**
 * WYRMHOLD — quests, dialogue and the people who give them.
 *
 * Quests are data: a list of stages, each with objectives that the game layer
 * ticks via `notify(event, payload)`. Dialogue is a graph of nodes whose
 * options can carry conditions (skill checks, items, quest state) and actions.
 */

export const NPCS = {
  jarl: {
    name: 'Jarl Halvard', title: 'of Hearthwatch', preset: 'guard',
    torso: 'clothRed', hood: false, helmet: false, cloak: true, essential: true,
    schedule: 'hall',
  },
  sigrid: {
    name: 'Sigrid', title: 'Alewife', preset: 'villager', torso: 'clothGreen',
    merchant: { markup: 1.25, gold: 400, stock: ['potionHealth', 'potionStamina', 'bread', 'mead', 'venison', 'lockpick'] },
    essential: true,
  },
  bjorn: {
    name: 'Bjorn Iron-Hand', title: 'Blacksmith', preset: 'guard', torso: 'leatherDark',
    merchant: { markup: 1.3, gold: 600, stock: ['ironSword', 'steelSword', 'ironAxe', 'woodShield', 'ironCuirass', 'leatherArmor', 'arrow', 'steelArrow', 'ironIngot'] },
    essential: true,
  },
  astrid: {
    name: 'Astrid', title: 'Herbalist', preset: 'villager', torso: 'clothBlue',
    merchant: { markup: 1.2, gold: 350, stock: ['potionMagicka', 'potionResist', 'mountainFlower', 'frostMirriam', 'glowCap', 'bookNords'] },
    essential: true,
  },
  torvald: {
    name: 'Torvald', title: 'Hunter', preset: 'bandit', torso: 'leatherDark',
    essential: true,
  },
  guard1: { name: 'Hearthwatch Guard', preset: 'guard', guard: true, essential: true },
  guard2: { name: 'Hearthwatch Guard', preset: 'guard', guard: true, essential: true },
};

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const QUESTS = {
  wardstone: {
    id: 'wardstone', name: 'The Wardstone Broken', main: true,
    blurb: 'The Jarl of Hearthwatch says the Wardstone Circle has gone quiet, and that quiet is worse than any noise.',
    stages: [
      { id: 0, objectives: [{ id: 'talk', text: 'Speak with Jarl Halvard' }] },
      { id: 1, objectives: [{ id: 'visit', text: 'Examine the Wardstone Circle', marker: 'wardstone' }] },
      {
        id: 2, objectives: [
          { id: 'shard', text: 'Recover the Wardstone Shard from Hollowmere Barrow', marker: 'barrow' },
        ]
      },
      { id: 3, objectives: [{ id: 'return', text: 'Set the shard in the Wardstone', marker: 'wardstone' }] },
      { id: 4, objectives: [{ id: 'dragon', text: 'Slay Skarnvald at the peak', marker: 'peak' }] },
      { id: 5, objectives: [{ id: 'reward', text: 'Return to Jarl Halvard', marker: 'hearthwatch' }] },
    ],
    reward: { gold: 1200, xp: 800, items: [{ id: 'ancientBlade', qty: 1 }] },
  },

  hunter: {
    id: 'hunter', name: 'The Missing Hunter',
    blurb: 'Sigrid has not seen Torvald in four days. He was hunting toward Elk Hollow.',
    stages: [
      { id: 0, objectives: [{ id: 'note', text: 'Search Elk Hollow Lodge', marker: 'lodge' }] },
      { id: 1, objectives: [{ id: 'troll', text: 'Kill the frost troll' }] },
      { id: 2, objectives: [{ id: 'tell', text: 'Tell Sigrid what you found', marker: 'hearthwatch' }] },
    ],
    reward: { gold: 250, xp: 220, items: [{ id: 'potionHealth', qty: 3 }] },
  },

  crowfoot: {
    id: 'crowfoot', name: 'Crowfoot Debt',
    blurb: 'Bandits on the south road have been taking a toll nobody agreed to.',
    stages: [
      { id: 0, objectives: [{ id: 'clear', text: 'Clear Crowfoot Camp', marker: 'banditcamp', count: 4 }] },
      { id: 1, objectives: [{ id: 'report', text: 'Report to Jarl Halvard', marker: 'hearthwatch' }] },
    ],
    reward: { gold: 400, xp: 300, items: [{ id: 'steelShield', qty: 1 }] },
  },

  deepiron: {
    id: 'deepiron', name: 'Deep Iron',
    blurb: 'Bjorn needs ore from Ashenvein, and will not go himself.',
    stages: [
      { id: 0, objectives: [{ id: 'ore', text: 'Bring Bjorn 5 iron ore', count: 5, marker: 'mine' }] },
    ],
    reward: { gold: 220, xp: 160, items: [{ id: 'steelSword', qty: 1 }] },
  },

  songs: {
    id: 'songs', name: 'Nine Stones, Nine Songs',
    blurb: 'Astrid wants a copy of an old hall-song book. They turn up in barrows.',
    stages: [
      { id: 0, objectives: [{ id: 'book', text: 'Find "Songs of the Nine Stones"' }] },
      { id: 1, objectives: [{ id: 'give', text: 'Bring the book to Astrid', marker: 'hearthwatch' }] },
    ],
    reward: { gold: 180, xp: 140, items: [{ id: 'ringMage', qty: 1 }] },
  },
};

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

/**
 * Node shape:
 *   { text, options: [{ text, tag?, next?, cond?(g), act?(g), end? }] }
 * `cond` gates the option; a failed skill check still shows, greyed out.
 */
export const DIALOGUE = {
  jarl: (g) => {
    const q = g.quests.state('wardstone');
    const cf = g.quests.state('crowfoot');
    const root = { text: '', options: [] };

    if (!q.started) {
      root.text = 'You have the look of someone who walks toward trouble rather than away. Good. I have some.';
      root.options.push({
        text: 'What trouble?', next: {
          text: 'The Wardstone Circle east of here. Nine stones, set by people whose names we lost. They hummed, all my life. Last week they stopped.',
          options: [
            {
              text: 'And that matters because…', next: {
                text: 'Because my grandmother told me what the humming was for. Go and look. If the circle is broken, I need to know what broke it.',
                options: [
                  { text: 'I\'ll go.', act: g2 => g2.quests.start('wardstone'), end: true },
                  { text: 'Not for free.', tag: 'Speech', cond: g2 => g2.stats.skills.oneHanded + g2.stats.level * 3 > 24,
                    next: {
                      text: 'Ha. Honest, at least. Two hundred septims up front, and more when it is done.',
                      options: [{ text: 'Then I\'ll go.', act: g2 => { g2.quests.start('wardstone'); g2.inventory.gold += 200; g2.notify('200 gold', '', 'skill'); }, end: true }],
                    } },
                  { text: 'Find someone else.', end: true },
                ],
              },
            },
          ],
        },
      });
    } else if (q.stage === 0) {
      root.text = 'The circle, then. East, past the ridge. Go and look with your own eyes.';
      root.options.push({ text: 'I\'m going.', act: g2 => g2.quests.advance('wardstone'), end: true });
    } else if (q.stage === 4) {
      root.text = 'You woke it. Gods help us all, you woke it. Kill it, or we are ash by winter.';
      root.options.push({ text: 'I intend to.', end: true });
    } else if (q.stage === 5) {
      root.text = 'They saw it fall from the wall. The whole village saw it. Whatever you are, you have my hall\'s thanks — and its purse.';
      root.options.push({ text: 'Take the payment.', act: g2 => g2.quests.complete('wardstone'), end: true });
    } else if (q.done) {
      root.text = 'Dragonslayer. Sit by my fire whenever you pass.';
      root.options.push({ text: 'Farewell.', end: true });
    } else {
      root.text = 'Still standing, I see. The stones wait.';
      root.options.push({ text: 'I know.', end: true });
    }

    if (!cf.started) {
      root.options.push({
        text: 'Is there other work?', next: {
          text: 'Bandits at Crowfoot, south of the wood. They call it a toll. I call it four men I will hang if you do not save me the rope.',
          options: [
            { text: 'Consider it done.', act: g2 => g2.quests.start('crowfoot'), end: true },
            { text: 'Another time.', end: true },
          ],
        },
      });
    } else if (cf.stage === 1) {
      root.options.push({
        text: 'Crowfoot is cleared.',
        act: g2 => g2.quests.complete('crowfoot'), end: true,
      });
    }
    root.options.push({ text: 'Nothing. Goodbye.', end: true });
    return root;
  },

  sigrid: (g) => {
    const q = g.quests.state('hunter');
    const root = { text: 'Mind the step. Ale\'s fresh, bread\'s yesterday, and I\'ll not apologise for either.', options: [] };
    root.options.push({ text: 'Let me see your goods.', act: g2 => g2.openShop('sigrid'), end: true });
    if (!q.started) {
      root.options.push({
        text: 'You look worried.', next: {
          text: 'Torvald. My brother. Four days out at Elk Hollow and he always comes back in two. Would you look? I can pay a little.',
          options: [
            { text: 'I\'ll look for him.', act: g2 => g2.quests.start('hunter'), end: true },
            { text: 'Sorry, no.', end: true },
          ],
        },
      });
    } else if (q.stage === 2) {
      root.options.push({
        text: 'I found Torvald\'s lodge.', next: {
          text: 'And the note. And the thing that made the tracks. …He always said the mere was bad ground. Thank you for going.',
          options: [{ text: 'I\'m sorry.', act: g2 => g2.quests.complete('hunter'), end: true }],
        },
      });
    }
    root.options.push({ text: 'Goodbye.', end: true });
    return root;
  },

  bjorn: (g) => {
    const q = g.quests.state('deepiron');
    const root = { text: 'Steel first, talk after. What do you need?', options: [] };
    root.options.push({ text: 'Show me your wares.', act: g2 => g2.openShop('bjorn'), end: true });
    if (!q.started) {
      root.options.push({
        text: 'Need anything hauled?', next: {
          text: 'Ore. Ashenvein still has iron in it, and something else besides, which is why I stopped going. Five lumps and I\'ll make it worth your walk.',
          options: [
            { text: 'Five lumps of iron. Fine.', act: g2 => g2.quests.start('deepiron'), end: true },
            { text: 'No.', end: true },
          ],
        },
      });
    } else if (!q.done && g.inventory.count('ironOre') >= 5) {
      root.options.push({
        text: 'I have your five ore.',
        act: g2 => { g2.inventory.remove('ironOre', 5); g2.quests.complete('deepiron'); }, end: true,
      });
    }
    root.options.push({ text: 'Nothing today.', end: true });
    return root;
  },

  astrid: (g) => {
    const q = g.quests.state('songs');
    const root = { text: 'Careful — half of what is on that shelf will kill you and the other half will only make you wish it had.', options: [] };
    root.options.push({ text: 'Let me browse.', act: g2 => g2.openShop('astrid'), end: true });
    if (!q.started) {
      root.options.push({
        text: 'Looking for anything?', next: {
          text: '"Songs of the Nine Stones." Old hall-songs. They turn up in barrows, and I do not go into barrows.',
          options: [
            { text: 'I\'ll keep an eye out.', act: g2 => g2.quests.start('songs'), end: true },
            { text: 'No promises.', end: true },
          ],
        },
      });
    } else if (!q.done && g.inventory.has('bookNords')) {
      root.options.push({
        text: 'I found your book.',
        act: g2 => { g2.inventory.remove('bookNords', 1); g2.quests.setStage('songs', 1); g2.quests.complete('songs'); }, end: true,
      });
    }
    root.options.push({ text: 'Goodbye.', end: true });
    return root;
  },

  torvald: (g) => ({
    text: 'Keep your voice down. There is something at the mere that does not like noise.',
    options: [
      {
        text: 'What is it?', next: {
          text: 'Big. Pale. Walks on two legs when it wants to. I put three arrows in it and it took them like rain.',
          options: [{ text: 'I\'ll be careful.', end: true }],
        },
      },
      { text: 'Goodbye.', end: true },
    ],
  }),

  guard1: (g) => ({
    text: g.bounty > 0
      ? 'I\'ve heard about you. Pay the fine or draw steel — your choice.'
      : 'Keep to the road and we\'ll have no trouble.',
    options: g.bounty > 0 ? [
      {
        text: `Pay the fine (${g.bounty} gold)`, cond: g2 => g2.inventory.gold >= g2.bounty,
        act: g2 => { g2.inventory.gold -= g2.bounty; g2.bounty = 0; g2.wanted = false; g2.notify('Fine paid', '', 'quest'); }, end: true,
      },
      { text: 'I\'d rather not.', end: true },
    ] : [
      { text: 'Anything I should know?', next: { text: 'Wolves on the west road. And do not go poking about the barrow after dark.', options: [{ text: 'Noted.', end: true }] } },
      { text: 'Goodbye.', end: true },
    ],
  }),
};
DIALOGUE.guard2 = DIALOGUE.guard1;

// ---------------------------------------------------------------------------

export class QuestLog {
  constructor(game) {
    this.game = game;
    this.states = {};
    for (const id of Object.keys(QUESTS)) {
      this.states[id] = { id, started: false, stage: 0, done: false, failed: false, counters: {} };
    }
    this.tracked = null;
  }

  state(id) { return this.states[id]; }
  def(id) { return QUESTS[id]; }

  start(id) {
    const s = this.states[id];
    if (!s || s.started) return;
    s.started = true;
    s.stage = 0;
    if (!this.tracked) this.tracked = id;
    this.game.notify(QUESTS[id].name, 'Quest started', 'quest');
    this.game.audio.play('ui', { kind: 'accept' });
    this.game.ui?.refreshJournal?.();
  }

  setStage(id, stage) {
    const s = this.states[id];
    if (!s || s.done) return;
    if (stage <= s.stage) return;
    s.stage = stage;
    s.counters = {};
    const st = QUESTS[id].stages[stage];
    if (st) this.game.notify(QUESTS[id].name, st.objectives[0]?.text || '', 'quest');
    this.game.ui?.refreshJournal?.();
  }

  advance(id) { this.setStage(id, this.states[id].stage + 1); }

  complete(id) {
    const s = this.states[id];
    if (!s || s.done) return;
    s.done = true;
    s.stage = QUESTS[id].stages.length;
    const r = QUESTS[id].reward;
    if (r) {
      if (r.gold) this.game.inventory.gold += r.gold;
      if (r.xp) this.game.stats.gainXp(r.xp);
      for (const it of r.items || []) this.game.inventory.add(it.id, it.qty);
    }
    this.game.notify(QUESTS[id].name, 'Quest complete', 'quest');
    this.game.audio.play('levelUp');
    if (this.tracked === id) {
      this.tracked = Object.keys(this.states).find(k => this.states[k].started && !this.states[k].done) || null;
    }
    this.game.ui?.refreshJournal?.();
  }

  count(id, objId, amount = 1) {
    const s = this.states[id];
    if (!s || !s.started || s.done) return;
    const stage = QUESTS[id].stages[s.stage];
    const obj = stage?.objectives.find(o => o.id === objId);
    if (!obj) return;
    s.counters[objId] = (s.counters[objId] || 0) + amount;
    if (!obj.count || s.counters[objId] >= obj.count) this.advance(id);
    else this.game.ui?.refreshTracker?.();
  }

  /** Fires objective checks for a world event. */
  onEvent(type, payload = {}) {
    const S = this.states;
    switch (type) {
      case 'visited':
        if (S.wardstone.started && S.wardstone.stage === 1 && payload.id === 'wardstone') this.advance('wardstone');
        if (S.hunter.started && S.hunter.stage === 0 && payload.id === 'lodge') {
          this.game.inventory.add('huntersNote', 1);
          this.game.notify('Torvald\'s Note', 'Added to inventory', 'quest');
          this.advance('hunter');
          this.game.spawnTroll();
        }
        break;
      case 'itemTaken':
        if (payload.id === 'wardstoneShard' && S.wardstone.stage === 2) this.advance('wardstone');
        if (payload.id === 'bookNords' && S.songs.started && S.songs.stage === 0) this.advance('songs');
        break;
      case 'wardstoneUsed':
        if (S.wardstone.stage === 3) { this.advance('wardstone'); this.game.onRitual(); }
        break;
      case 'killed':
        if (payload.defId === 'troll' && S.hunter.stage === 1) this.advance('hunter');
        if (payload.faction === 'bandit' && S.crowfoot.started && S.crowfoot.stage === 0) this.count('crowfoot', 'clear');
        if (payload.dragon && S.wardstone.stage === 4) this.advance('wardstone');
        break;
      case 'gathered':
        if (payload.id === 'ironOre' && S.deepiron.started && !S.deepiron.done) this.game.ui?.refreshTracker?.();
        break;
    }
  }

  /** The active objectives to show in the HUD. */
  activeObjectives() {
    const out = [];
    for (const id of Object.keys(this.states)) {
      const s = this.states[id];
      if (!s.started || s.done) continue;
      const stage = QUESTS[id].stages[s.stage];
      if (!stage) continue;
      for (const o of stage.objectives) {
        let text = o.text;
        if (o.count) text += ` (${Math.min(o.count, s.counters[o.id] || 0)}/${o.count})`;
        out.push({ quest: id, name: QUESTS[id].name, text, marker: o.marker, main: QUESTS[id].main });
      }
    }
    out.sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0));
    return out;
  }

  serialize() { return { states: this.states, tracked: this.tracked }; }
  deserialize(d) {
    if (!d) return;
    for (const [k, v] of Object.entries(d.states || {})) if (this.states[k]) Object.assign(this.states[k], v);
    this.tracked = d.tracked || null;
  }
}
