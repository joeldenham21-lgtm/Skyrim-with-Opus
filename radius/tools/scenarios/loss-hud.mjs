// What the Explorer can actually read while it is going wrong. Drives hud.update() directly in a
// handful of states and prints the bottom-left block and the Tab watch, so the sparseness is a measured
// thing and not a hope: an intact Explorer in daylight must produce an empty status block.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true; window.__radius.start();`);

  const states = await api.run(`(() => {
    const ctx = window.__radius.ctx, d = ctx.state.data;
    const status = () => document.getElementById('status').innerHTML;
    const watch = () => document.getElementById('watch').innerHTML.replace(/\\s+/g, ' ').trim();
    const tick = () => { for (let i = 0; i < 4; i++) ctx.hud.update(0.5); };
    const out = {};
    ctx.player.teleport(-130, 60);
    // 1. nothing wrong
    d.hp = 100; d.bleeding = false; d.fracture = false; d.flashlight.on = false; d.caches = [];
    tick(); out.healthy = status();
    // 2. the walk home: hurt, bleeding, a broken leg, a body out there, a dying torch
    d.hp = 24; d.bleeding = true; ctx.damage.breakLeg();
    d.flashlight.on = true; d.flashlight.battery = 12;
    ctx.loot.dropCache([{ kind: 'item', id: 'bandage', count: 2 }], { x: -60, z: -140 }, { kind: 'explorer', name: 'EXPLORER 61' });
    tick(); out.walkingHome = status();
    // 3. the shot clock
    d.day = d.tideDay; d.hour = 4.4;
    tick(); out.tideSoon = status();
    // 4. the watch, held
    const down = ctx.input.down.bind(ctx.input);
    ctx.input.down = (a) => (a === 'watch' ? true : down(a));
    d.money = -450;
    tick(); out.watch = watch();
    ctx.input.down = down;
    out.lines = { healthy: out.healthy ? out.healthy.split('<br>').length : 0, walkingHome: out.walkingHome.split('<br>').length, tideSoon: out.tideSoon.split('<br>').length };
    return out;
  })()`);
  for (const [k, v] of Object.entries(states)) console.log(k.toUpperCase() + ' ' + (typeof v === 'string' ? v : JSON.stringify(v)));

  // no screenshot: SwiftShader on a loaded box needs minutes for one frame and the assertions above are
  // the point — this scenario reads the DOM the player reads, not pixels.
}
