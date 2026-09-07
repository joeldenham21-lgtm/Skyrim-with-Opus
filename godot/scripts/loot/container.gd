extends Node3D
## Interactable behaviour for a container a structure marked with meta "container" (crate locker safe desk cabinet bag
## corpse shelf, or a table name from data/containers.json) and meta "poi". Loot attaches this script to marked nodes
## that carry no script of their own (Loot.adopt); structures may also use it directly. The player raycast finds the
## node through group "interactable" and calls prompt() / interact().
func _ready() -> void:
	if not is_in_group("interactable"): add_to_group("interactable")
func prompt() -> String:
	return Game.loot.prompt_for(self) if Game.loot != null else "[E] SEARCH"
func interact(_player: Node) -> void:
	if Game.loot != null: Game.loot.open_container(self)
