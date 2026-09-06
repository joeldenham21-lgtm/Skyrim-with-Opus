extends CharacterBody3D
## First-person body: movement, camera, stamina, head bob, landing dip, torch. Ports the browser controller.
const WALK := 3.6
const SPRINT := 6.2
const CROUCH := 1.8
const EYE := 1.7
const EYE_CROUCH := 1.05
@onready var head: Node3D = $Head
@onready var cam: Camera3D = $Head/Camera
@onready var torch: SpotLight3D = $Head/Camera/Torch
@onready var hands: Node3D = $Head/Camera/Hands
var weapons: Node = null      # set by scripts/weapons/weapons.gd when it attaches under Hands
var focus: Node = null        # interactable currently under the crosshair (group "interactable")
var focus_prompt := ""
var light_level := 0.5        # 0..1 how lit the player is (torch/headlamp/weapon light raise it; AI perception reads it)
var _interact_hold := 0.0
var yaw := 0.0
var pitch := 0.0
var crouched := false
var sprinting := false
var in_base := false
var in_water := false
var dead := false
var noise := 0.0
var speed_now := 0.0
var _bob_t := 0.0
var _bob_amt := 0.0
var _eye := EYE
var _land_dip := 0.0
var _land_vel := 0.0
var _strafe_roll := 0.0
var _was_grounded := true
var _step_acc := 0.0
var _move_lock := 0.0
var alive: bool:
	get: return not dead
var hp: float:
	get: return float(Game.state["hp"])
	set(v): Game.state["hp"] = v
var stamina: float:
	get: return float(Game.state["stamina"])
	set(v): Game.state["stamina"] = v

func _ready() -> void:
	set_look(0.0, 0.0)   # yaw 0 faces -z (north)

func eye_pos() -> Vector3: return cam.global_position
func look_dir() -> Vector3: return -cam.global_transform.basis.z
func make_noise(loudness: float) -> void: noise = maxf(noise, loudness)

func _update_focus(dt: float) -> void:
	var prev := focus
	focus = null; focus_prompt = ""
	if Game.mode == "playing" and not dead:
		var space := get_world_3d().direct_space_state
		var from := eye_pos(); var to := from + look_dir() * 2.6
		var q := PhysicsRayQueryParameters3D.create(from, to, 1 | 8 | 16, [get_rid()])
		q.collide_with_areas = true
		var hit := space.intersect_ray(q)
		if hit:
			var n: Node = hit.collider
			while n and not n.is_in_group("interactable"): n = n.get_parent()
			if n:
				focus = n
				focus_prompt = n.prompt() if n.has_method("prompt") else "[E]"
	if focus != prev: _interact_hold = 0.0
	if focus and Input.is_action_pressed("interact"):
		var need: float = float(focus.get("hold_time")) if "hold_time" in focus else 0.0
		_interact_hold += dt
		if _interact_hold >= need and (need > 0.0 or Input.is_action_just_pressed("interact")):
			_interact_hold = -999.0
			if focus.has_method("interact"): focus.interact(self)
	elif not Input.is_action_pressed("interact"): _interact_hold = 0.0

func set_look(y: float, p: float) -> void:
	yaw = y; pitch = p
	rotation.y = yaw; head.rotation.x = pitch

func teleport(x: float, z: float, y: float = NAN) -> void:
	var ground := y
	if is_nan(ground):
		ground = 8.0
		var w: Node = Game.world.get_node_or_null("Terrain") if Game.world else null
		if w and w.has_method("get_height"): ground = w.get_height(x, z)
	global_position = Vector3(x, ground + 0.1, z); velocity = Vector3.ZERO

func _unhandled_input(event: InputEvent) -> void:
	if Game.mode != "playing" or dead: return
	if event is InputEventMouseMotion:
		var sens: float = 0.0021 * float(Game.state["settings"].get("sensitivity", 1.0))
		yaw -= event.relative.x * sens; pitch -= event.relative.y * sens
		pitch = clampf(pitch, deg_to_rad(-85), deg_to_rad(85))
	if event.is_action_pressed("crouch"): crouched = not crouched
	if event.is_action_pressed("flashlight"):
		var f: Dictionary = Game.state["flashlight"]
		if f["battery"] <= 0.0 and not f["on"]: Audio.play("click")
		else: f["on"] = not f["on"]; Audio.play("flashlight")

func damage(amount: float, info: Dictionary = {}) -> void:
	if dead or amount <= 0.0: return
	hp = maxf(0.0, hp - amount)
	Events.player_damaged.emit(amount, info)
	Director.notify("damaged", { "amount": amount, "source": info.get("source") })
	if hp <= 0.0: die(info)
func heal(v: float) -> void: hp = minf(100.0, hp + v)
func stop_bleeding() -> void: Game.state["bleeding"] = false
func add_stamina(v: float) -> void: stamina = clampf(stamina + v, 0.0, 100.0)
func lock_movement(s: float) -> void: _move_lock = maxf(_move_lock, s)
func die(info: Dictionary = {}) -> void:
	if dead: return
	dead = true; Game.state["stats"]["deaths"] += 1; velocity = Vector3.ZERO
	Events.player_died.emit(info)
func revive() -> void:
	dead = false; hp = maxf(hp, 60.0); Game.state["bleeding"] = false; stamina = 100.0

func _physics_process(dt: float) -> void:
	_update_focus(dt)
	var playing := Game.mode == "playing" and not dead
	rotation.y = yaw
	_move_lock = maxf(0.0, _move_lock - dt)
	var input := Vector2.ZERO
	if playing and _move_lock <= 0.0: input = Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var want_sprint := playing and Input.is_action_pressed("sprint") and stamina > 5.0 and not crouched
	sprinting = want_sprint and input.y < 0.0
	var target := (CROUCH if crouched else (SPRINT if sprinting else WALK))
	if hp < 25.0: target *= 0.85
	if in_water: target *= 0.65
	var dir := (transform.basis * Vector3(input.x, 0.0, input.y)).normalized() * minf(1.0, input.length())
	var accel := 22.0 if is_on_floor() else 4.0
	velocity.x = lerpf(velocity.x, dir.x * target, 1.0 - exp(-accel * dt))
	velocity.z = lerpf(velocity.z, dir.z * target, 1.0 - exp(-accel * dt))
	if sprinting: stamina = maxf(0.0, stamina - 16.0 * dt)
	else: stamina = minf(100.0, stamina + (8.0 if crouched else 11.0) * dt)
	if not is_on_floor(): velocity.y -= 22.0 * dt
	elif playing and Input.is_action_just_pressed("jump") and not crouched and _move_lock <= 0.0 and stamina > 10.0:
		velocity.y = 6.2; stamina -= 6.0; Audio.play("jump", null, 0.5)
	var vy_before := velocity.y
	move_and_slide()
	if is_on_floor() and not _was_grounded:
		var fall := -vy_before
		_land_vel = clampf(fall * 0.12, 0.15, 1.2)
		if fall > 9.0:
			damage(floor((fall - 9.0) * 4.0), { "kind": "fall", "bleed": false }); Audio.play("land", global_position, 0.8)
		elif fall > 2.5: Audio.play("land", global_position, 0.35)
	_was_grounded = is_on_floor()
	speed_now = Vector2(velocity.x, velocity.z).length()
	_eye = lerpf(_eye, EYE_CROUCH if crouched else EYE, 1.0 - exp(-10.0 * dt))
	var bob_speed := clampf(speed_now / SPRINT, 0.0, 1.0)
	_bob_amt = lerpf(_bob_amt, bob_speed if is_on_floor() else 0.0, 1.0 - exp(-8.0 * dt))
	_bob_t += dt * (12.5 if sprinting else (6.5 if crouched else 9.0)) * clampf(speed_now / 1.5, 0.0, 1.0)
	var motion: float = float(Game.state["settings"].get("motion", 1.0))
	_land_dip += (_land_vel * 0.09 - _land_dip) * minf(1.0, dt * 18.0); _land_vel = lerpf(_land_vel, 0.0, 1.0 - exp(-9.0 * dt))
	var lateral := velocity.dot(transform.basis.x)
	_strafe_roll = lerpf(_strafe_roll, -lateral / SPRINT * 0.022 * motion, 1.0 - exp(-8.0 * dt))
	head.position = Vector3(sin(_bob_t) * 0.02 * _bob_amt * motion, _eye + sin(_bob_t * 2.0) * 0.028 * _bob_amt * motion - _land_dip * motion, 0.0)
	head.rotation = Vector3(pitch + _land_dip * 0.35 * motion, 0.0, sin(_bob_t) * 0.004 * _bob_amt * motion + _strafe_roll)
	_step_acc += speed_now * dt
	var stride := 0.75 if crouched else (1.55 if sprinting else 1.15)
	if is_on_floor() and _step_acc > stride and speed_now > 0.4:
		_step_acc = 0.0
		var surf := "grass"
		var w: Node = Game.world.get_node_or_null("Terrain") if Game.world else null
		if w and w.has_method("get_surface"): surf = w.get_surface(global_position.x, global_position.z)
		Audio.play("step_" + surf, global_position, 0.35 if crouched else (0.9 if sprinting else 0.6))
		Events.footstep.emit(surf, sprinting, crouched)
	noise = lerpf(noise, (0.15 * bob_speed) if crouched else (1.0 if sprinting else 0.45 * bob_speed), 1.0 - exp(-4.0 * dt))
	var f: Dictionary = Game.state["flashlight"]
	if f["on"]:
		f["battery"] = maxf(0.0, f["battery"] - dt * (100.0 / (7.0 * 60.0)))
		if f["battery"] <= 0.0: f["on"] = false
	var bat: float = f["battery"] / 100.0
	torch.light_energy = lerpf(torch.light_energy, (8.0 * (0.55 + 0.45 * clampf(bat * 3.0, 0.0, 1.0))) if (f["on"] and not dead) else 0.0, 1.0 - exp(-14.0 * dt))
	Game.state["stats"]["distance"] += speed_now * dt
