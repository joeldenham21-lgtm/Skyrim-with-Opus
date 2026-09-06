extends "res://tools/scenarios/_driver.gd"
## The gate at 07:00, 12:00, 19:30 and 22:30 with the torch.
func run() -> void:
	await start(true)
	for s in [["gate-0700", 7.0, false], ["gate-1200", 12.0, false], ["gate-1930", 19.5, false], ["gate-2230", 22.5, true]]:
		teleport(0.0, 284.0); look(0.0, -0.05); set_hour(s[1]); torch(s[2])
		await frames(6)
		await shot(s[0])
	print("[stats] ", JSON.stringify(stats()))
