// "physical storage rooms not just a locker that magically fits everything"
// Vanno now has fifteen containers standing in five rooms. Prove they are fifteen separate stashes and
// not fifteen doors onto one: stow different things in different containers, reopen each, and check each
// holds only its own. Then fill one and check it refuses the next thing rather than swallowing it.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  const base = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    return { containers: ctx.base?.containers || [], rooms: Object.keys(ctx.base?.rooms || {}), floorY: ctx.base?.floorY ?? null };
  })()`);
  console.log('BASE ' + JSON.stringify(base));

  const out = await api.run(`(() => {
    const ctx = window.__radius.ctx, inv = ctx.inventory, P = ctx.panels;
    const put = (container, name, id, n) => {
      inv.add(id, n);
      P.open('storage', { container, name });
      // drive the panel's own handler, so this tests the sheet and not a private helper
      const root = document.querySelector('#panels .p-storage');
      // panel_* modules take act() from menus.js, which writes data-x (panels.js has its own act() on data-a)
      const btn = root && [...root.querySelectorAll('button.act')].find((b) => (b.dataset.x || '').startsWith('in:i:' + id + ':'));
      if (btn) btn.click(); else {
        const any = root ? [...root.querySelectorAll('button.act')].map((b) => b.dataset.x).slice(0, 8) : null;
        return { container, id, clicked: false, sawActions: any };
      }
      return { container, id, clicked: true, action: btn.dataset.x };
    };
    const log = [];
    log.push(put('shelf_a', 'Shelf 3-A', 'bandage', 3));
    log.push(put('med_cabinet', 'Medical cabinet', 'medkit', 1));
    log.push(put('ammo_cabinet', 'Ammunition cabinet', '9x18_fmj', 40));
    P.close();
    const by = ctx.state.data.storage.by || {};
    const contents = {};
    for (const k of Object.keys(by)) contents[k] = by[k].items || {};
    return { log, contents, keys: Object.keys(by) };
  })()`);
  console.log('SEPARATE ' + JSON.stringify(out, null, 1));

  // capacity: the medical cabinet holds 25 kg; push far past it and it must refuse, not swallow
  const cap = await api.run(`(() => {
    const ctx = window.__radius.ctx, inv = ctx.inventory, P = ctx.panels;
    inv.add('9x18_fmj', 4000);                       // ~48 kg of loose rounds
    P.open('storage', { container: 'med_cabinet', name: 'Medical cabinet' });
    const root = document.querySelector('#panels .p-storage');
    // take the "all N" button, which is the one that will not fit
    const btns = root ? [...root.querySelectorAll('button.act')].filter((b) => (b.dataset.x || '').startsWith('in:i:9x18_fmj:')) : [];
    const btn = btns[btns.length - 1];
    if (btn) btn.click();
    const st = ctx.state.data.storage.by.med_cabinet || { items: {} };
    const notice = document.querySelector('#panels .notice')?.textContent || document.querySelector('#panels .p-hd .notice')?.textContent || '';
    const strip = document.querySelector('#panels .p-storage .strip')?.textContent || '';
    P.close();
    return { stowedRounds: st.items['9x18_fmj'] || 0, stillCarried: inv.count('9x18_fmj'), strip: strip.trim(), notice: notice.trim() };
  })()`);
  console.log('CAPACITY ' + JSON.stringify(cap, null, 1));

  const keys = out.keys || [];
  const distinct = keys.length >= 3 && JSON.stringify(out.contents.shelf_a) !== JSON.stringify(out.contents.med_cabinet);
  console.log(`SUMMARY containers=${base.containers.length} rooms=${base.rooms.length} stashes=${keys.length} distinct=${distinct} capacityHeld=${cap.stowedRounds === 0 || cap.stillCarried > 0}`);
  console.log('STATS ' + JSON.stringify(await api.run(`window.__radius.stats()`)));
}
