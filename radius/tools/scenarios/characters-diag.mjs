// Boot cost probe: how long one frame takes with the world thinned to different levels.
import { thin } from './enemies-core-lib.mjs';
const wait1 = async (api, label) => {
  const f0 = await api.run('window.__radius.ctx.frame');
  const t = Date.now();
  await api.page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + 1, { timeout: 200000, polling: 200 }).catch((e) => console.log(label, 'FAILED', e.message));
  console.log(label, Date.now() - t, 'ms');
};
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true; window.__radius.start();');
  await api.wait(500);
  await wait1(api, 'frame unthinned');
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
  console.log('hidden1', await thin(api, 1));
  await wait1(api, 'frame thin1');
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
  console.log('hidden2', await thin(api, 2));
  await wait1(api, 'frame thin2');
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
