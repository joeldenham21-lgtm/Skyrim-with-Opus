export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true; window.__radius.start();`);
  await api.wait(500);
  const r = await api.run(`(() => { const ctx = window.__radius.ctx; const gl = ctx.renderer.getContext(); const out = {};
    const rend = () => { const t0 = performance.now(); ctx.post.render(); gl.finish(); return +(performance.now() - t0).toFixed(0); };
    rend(); out.base = rend();
    const groups = {};
    ctx.scene.traverse((o) => { if (!o.geometry && !o.isPoints) return; const n = o.name || ''; const key = n === 'terrain' ? 'terrain' : /flora|grass|tree|bush|reed/i.test(n) ? 'flora' : o.isInstancedMesh || o.geometry?.isInstancedBufferGeometry ? 'instanced' : /:/.test(n) ? 'structures' : o.isPoints ? 'points' : o.isSprite ? 'sprite' : o.type === 'Mesh' && o.geometry.attributes.position.count > 50000 ? 'bigmesh' : 'misc'; (groups[key] = groups[key] || []).push(o); });
    out.sizes = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
    for (const k in groups) { for (const o of groups[k]) o.visible = false; out['without_' + k] = rend(); for (const o of groups[k]) o.visible = true; }
    ctx.lighting.sun.castShadow = false; out.noShadow = rend(); ctx.lighting.sun.castShadow = true;
    const sky = ctx.sky; const skyObjs = []; ctx.scene.traverse((o) => { if (o.material && o.material.fog === false && o.geometry && (o.geometry.type === 'SphereGeometry' || o.name.toLowerCase().includes('sky'))) skyObjs.push(o); }); out.skyObjs = skyObjs.map((o) => o.name || o.geometry.type);
    return out; })()`);
  console.log(JSON.stringify(r));
}
