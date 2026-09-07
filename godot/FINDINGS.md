# RADIUS — orchestrator findings queue
Observations made by the orchestrator from committed screenshots and logs. The fix wave must address every
open item or explain why it is wrong. Owners are by the file ownership in GODOT.md.

## Open
1. **Exposure is blown out; the image has no contrast.** `.shots/zzreview/*.png` and several `.shots/sky/*.png`
   are near-white: ground, sky and fog all sit at the top of the range, so the frame reads as washed-out haze
   rather than a bleak overcast zone. The reference is dark, desaturated and heavy. Owner: sky/lighting.
   Check tonemap exposure and white point, fog light energy, ambient sky contribution, and the auto-exposure
   settings if any are enabled.
2. **The verification scenario proves nothing.** `.shots/zzreview/01-mimic-close.png` is named for a mimic and
   contains no mimic: empty ground and sky. Scenarios that do not frame their subject are worse than no
   scenario, because they get reported as evidence. Owner: whoever wrote `tools/scenarios/zzreview.gd`.
   Every scenario must assert its subject is on screen (check the node exists and is in front of the camera)
   and print that assertion.
3. **Terrain relief looks alpine, not Pechorsk.** `.shots/sky/09-column-overcast-1200.png` shows steep spiky
   peaks with visible texture tiling. The zone is northern Russian lowland: bog, low ridges, river valley,
   quarry cuts, forest. If that shot came from the sky module's stand-in relief, the stand-in must be replaced
   by the real heightfield so lighting is judged against the real shape. Owner: sky + terrain.
