extends SceneTree
## Loader probe: compiles every panel script after the autoloads exist (a -s script cannot name them at parse time).
func _initialize() -> void:
	var paths := ["res://scripts/ui/panels/paper.gd", "res://scripts/ui/panels/widgets.gd", "res://scripts/ui/panels/kit.gd",
		"res://scripts/ui/panels/panel_base.gd", "res://scripts/ui/panel_host.gd",
		"res://scripts/ui/panels/panel_inventory.gd", "res://scripts/ui/panels/panel_workbench.gd",
		"res://scripts/ui/panels/panel_loot.gd", "res://scripts/ui/panels/panel_supply.gd",
		"res://scripts/ui/panels/panel_terminal.gd", "res://scripts/ui/panels/panel_storage.gd",
		"res://scripts/ui/panels/panel_map.gd", "res://scripts/ui/panels/panel_bed.gd", "res://scripts/ui/panels/panel_death.gd"]
	var bad := 0
	for p in paths:
		if not ResourceLoader.exists(p):
			print("skip ", p); continue
		var s: Variant = load(p)
		if s == null: print("FAIL ", p); bad += 1
		else: print("ok   ", p)
	print("probe: %d failed" % bad)
	quit()
