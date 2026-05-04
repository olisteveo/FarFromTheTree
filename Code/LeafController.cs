/// <summary>
/// The leaf — passive object in active wind.
///
/// LOAD-BEARING DESIGN RULE: the leaf has no engine, no thrust, no propulsion.
/// All motion comes from gravity, drag, or wind zones. Player input ONLY rotates
/// the leaf via torque — it never moves it directly.
///
/// Tilt determines how the leaf catches wind:
///   * Flat into wind  → maximum push     (catches the full force)
///   * Edge into wind  → minimum push     (slices through)
///   * Angled to wind  → redirected force (surf mechanic, the heart of the game)
/// </summary>
public sealed class LeafController : Component, Component.ICollisionListener
{
	[Property] public Rigidbody Body { get; set; }

	[Property, Group( "Falling" ), Range( 0f, 5f )]
	public float DragCoefficient { get; set; } = 0.8f;

	[Property, Group( "Sway" ), Range( 0f, 500f )]
	public float SwayStrength { get; set; } = 60f;

	[Property, Group( "Sway" ), Range( 0.1f, 5f )]
	public float SwayFrequency { get; set; } = 0.8f;

	[Property, Group( "Sway" ), Range( 0f, 20f )]
	public float TumbleStrength { get; set; } = 1.5f;

	/// <summary>
	/// Gravity scale applied during the initial cinematic fall (before the leaf has
	/// touched the ground for the first time). Very low so the leaf drifts downward
	/// slowly while sway pendulums it side-to-side. Restored to the rigidbody's
	/// configured GravityScale once the leaf lands.
	/// </summary>
	[Property, Group( "Initial Fall" ), Range( 0f, 1f )]
	public float FallGravityScale { get; set; } = 0.07f;

	/// <summary>Multiplier on SwayStrength while still in the initial fall — bigger pendulum.</summary>
	[Property, Group( "Initial Fall" ), Range( 1f, 10f )]
	public float FallSwayMultiplier { get; set; } = 1.6f;

	/// <summary>
	/// How much wind force the leaf catches when its surface is edge-on to the wind.
	/// 0 = pure surface area model (no push at all when edge-on, full push when flat).
	/// 1 = wind pushes the leaf the same regardless of orientation (no surf mechanic).
	/// Lower values = more rewarding surf gameplay.
	/// </summary>
	[Property, Group( "Wind Interaction" ), Range( 0f, 1f )]
	public float EdgeOnWindCatch { get; set; } = 0.2f;

	[Property, Group( "Tilt Control" ), Range( 0f, 500f )]
	public float TiltTorqueStrength { get; set; } = 200f;

	[Property, Group( "Tilt Control" ), Range( 0f, 50f )]
	public float TiltDamping { get; set; } = 0.5f;

	/// <summary>
	/// Strength of the auto-stabilize torque that gently rotates the leaf back to flat
	/// (surface normal up) when the player isn't giving input. Prevents endless spinning.
	/// </summary>
	[Property, Group( "Tilt Control" ), Range( 0f, 30f )]
	public float AutoStabilizeStrength { get; set; } = 1.5f;

	/// <summary>
	/// When the leaf is banked (rolled), it gradually yaws toward the bank direction —
	/// banking right turns right, like an aeroplane. Effect scales with speed.
	/// </summary>
	[Property, Group( "Tilt Control" ), Range( 0f, 30f )]
	public float BankToYawStrength { get; set; } = 8f;

	/// <summary>
	/// When the leaf is pitched forward (nose down), it gets a small forward push along
	/// its facing direction — gives "dive into speed" feel. NOT pure thrust because it
	/// only kicks when the leaf is already angled into a dive.
	/// </summary>
	[Property, Group( "Tilt Control" ), Range( 0f, 2000f )]
	public float DiveAssist { get; set; } = 600f;

	[Property, Group( "Safety" ), Range( 0f, 5000f )]
	public float MaxLinearSpeed { get; set; } = 600f;

	[Property, Group( "Safety" ), Range( 0f, 1000f )]
	public float MaxAngularSpeed { get; set; } = 360f;

	/// <summary>
	/// Cap on total wind force applied per fixed update tick. Prevents catastrophic
	/// over-acceleration when multiple wind zones overlap. Tune low for "leaf-light"
	/// feel, high for "kite" feel.
	/// </summary>
	[Property, Group( "Safety" ), Range( 100f, 20000f )]
	public float MaxWindForcePerTick { get; set; } = 4000f;

	[Property, Group( "Ground" ), Range( 1f, 50f )]
	public float GroundCheckDistance { get; set; } = 8f;

	/// <summary>
	/// Continuous upward force applied while leaf is grounded mid-flight (after settle).
	/// Stops the leaf from sticking to the floor — the air is always trying to lift it.
	/// 0 disables. Higher values = leaf bounces off ground quickly.
	/// </summary>
	[Property, Group( "Ground" ), Range( 0f, 5000f )]
	public float GroundRecoveryForce { get; set; } = 2000f;

	/// <summary>
	/// World-space direction the leaf should be travelling. Used by stall recovery
	/// to nudge stuck leaves forward. Should match LeafCamera.GameplayDirection.
	/// </summary>
	[Property, Group( "Stall Recovery" )]
	public Vector3 PrimaryDirection { get; set; } = Vector3.Forward;

	/// <summary>
	/// If average speed over last second drops below this, the leaf is "stuck" and
	/// gets an unstick impulse. 0 disables.
	/// </summary>
	[Property, Group( "Stall Recovery" ), Range( 0f, 200f )]
	public float StallSpeedThreshold { get; set; } = 60f;

	[Property, Group( "Stall Recovery" ), Range( 0f, 5000f )]
	public float StallRecoveryUpward { get; set; } = 1500f;

	[Property, Group( "Stall Recovery" ), Range( 0f, 5000f )]
	public float StallRecoveryForward { get; set; } = 800f;

	[Property, Group( "Stall Recovery" ), Range( 0.2f, 5f )]
	public float StallSampleSeconds { get; set; } = 0.8f;

	/// <summary>
	/// On every collision (wall hit), instantly damp the leaf's angular velocity and
	/// apply an upward + forward impulse so it doesn't stick to the surface.
	/// </summary>
	[Property, Group( "Collision" ), Range( 0f, 2000f )]
	public float CollisionUpwardKick { get; set; } = 600f;

	[Property, Group( "Collision" ), Range( 0f, 2000f )]
	public float CollisionForwardKick { get; set; } = 400f;

	[Property, Group( "Collision" ), Range( 0f, 1f )]
	public float CollisionAngularDamping { get; set; } = 0.2f;

	[Property, Group( "Collision" ), Range( 0f, 1f )]
	public float CollisionLinearDamping { get; set; } = 0.5f;

	[Property, Group( "Collision" )]
	public bool LogCollisions { get; set; } = true;

	/// <summary>
	/// How long the leaf sits still on the ground after first landing before the
	/// first gust kicks in. Tutorial UI shows during this window. Player can press
	/// any input to skip to instant pickup.
	/// </summary>
	[Property, Group( "Tutorial Settle" ), Range( 0f, 10f )]
	public float SettleDuration { get; set; } = 3f;

	/// <summary>
	/// Leaf "petals" — long-term life/durability indicator. Starts at MaxPetals,
	/// will eventually decrement on heavy collisions / wall scrapes. Hit zero = run failed.
	/// Right now no logic decrements them; HUD just displays the count.
	/// </summary>
	[Property, Group( "Run" ), Range( 1, 10 )]
	public int MaxPetals { get; set; } = 5;

	[Property, Group( "Run" ), Range( 0, 10 )]
	public int Petals { get; set; } = 5;

	/// <summary>True when leaf is currently in contact with (or just above) the ground.</summary>
	public bool IsGrounded => _isGrounded;

	/// <summary>True after the leaf has touched the ground at least once this run (cinematic landing moment).</summary>
	public bool HasLanded => _hasLanded;

	/// <summary>
	/// True once the leaf has landed AND the settle period has elapsed (or been skipped).
	/// Wind zones with RequireFirstLanding = true wait for this before activating.
	/// </summary>
	public bool IsReadyForFirstWind => _hasLanded && _settleElapsed >= SettleDuration;

	/// <summary>
	/// Time elapsed in the settle phase, normalized 0..1. Used by tutorial UI to
	/// show countdown / progress.
	/// </summary>
	public float SettleProgress => _hasLanded ? (_settleElapsed / SettleDuration).Clamp( 0f, 1f ) : 0f;

	/// <summary>True if leaf has landed but settle is still in progress (tutorial period).</summary>
	public bool IsInTutorialSettle => _hasLanded && _settleElapsed < SettleDuration;

	/// <summary>Magnitude of the leaf's current velocity. Convenience for HUD speedometer.</summary>
	public float CurrentSpeed => Body?.Velocity.Length ?? 0f;

	/// <summary>Seconds elapsed in the current run, ticking once the first wind activates.</summary>
	public float RunTime => _runElapsed;

	/// <summary>True while the run timer is ticking (post-settle, not yet finished).</summary>
	public bool IsRunning => _hasLanded && _settleElapsed >= SettleDuration && !HasFinished && !HasFailed;

	/// <summary>True once the leaf has reached the run goal. Stops the timer. (No goal yet.)</summary>
	public bool HasFinished { get; private set; }

	/// <summary>True if the leaf hit a death zone (river, out-of-bounds). Stops the timer.</summary>
	public bool HasFailed { get; private set; }

	/// <summary>Reason text shown on the failure overlay (set by the DeathZone that killed it).</summary>
	public string FailureReason { get; private set; } = "";

	/// <summary>Called by DeathZone trigger. Halts the leaf and shows the failure overlay.</summary>
	public void FailRun( string reason )
	{
		if ( HasFailed ) return;
		HasFailed = true;
		FailureReason = reason ?? "";
		if ( Body is not null )
		{
			Body.Velocity = Vector3.Zero;
			Body.AngularVelocity = Vector3.Zero;
		}
		if ( DebugLogging ) Log.Info( $"[Leaf] RUN FAILED — {reason} at pos=({WorldPosition.x:F0},{WorldPosition.y:F0},{WorldPosition.z:F0})" );
	}

	/// <summary>Seconds remaining until the first gust kicks in (0 once skipped or elapsed).</summary>
	public float SettleTimeRemaining => MathF.Max( 0f, SettleDuration - _settleElapsed );

	[Property, Group( "Debug" )]
	public bool DebugLogging { get; set; } = true;

	private Vector3 _pendulumAxis;
	private float _pendulumTime;
	private Vector3 _windAccum;
	private bool _isGrounded;
	private bool _hasLanded;
	private float _settleElapsed;
	private float _runElapsed;
	private float _normalGravityScale;
	private float _speedSum;
	private int _speedSamples;
	private float _stallCooldown;
	private int _consecutiveStalls;
	private float _stallStreakTimer;
	private bool _logSettleStart;
	private bool _logSettleEnd;
	private float _logHeartbeat;

	/// <summary>
	/// Called by WindZone components each tick. The wind vector here is the
	/// raw force the zone wants to apply — but this leaf adjusts that force
	/// based on its own orientation (the surf mechanic).
	/// </summary>
	public void AddWindForce( Vector3 windVector )
	{
		var mag = windVector.Length;
		if ( mag < 0.01f ) return;

		var windDir = windVector / mag;
		var leafSurface = WorldRotation.Up;

		// How face-on is the leaf to the wind?
		// 1.0 = perpendicular surface (catches full force, "flat into wind")
		// 0.0 = parallel surface (slices through, edge-on)
		var catchFactor = MathF.Abs( Vector3.Dot( leafSurface, windDir ) );

		// Blend between "edge catches some" and "flat catches all" using EdgeOnWindCatch as floor.
		var effective = EdgeOnWindCatch + (1f - EdgeOnWindCatch) * catchFactor;

		_windAccum += windVector * effective;

		if ( DebugLogging )
		{
			Log.Info( $"[Leaf] Wind hit: dir=({windDir.x:F2},{windDir.y:F2},{windDir.z:F2}) mag={mag:F0} catch={catchFactor:F2} effective={effective:F2}" );
		}
	}

	protected override void OnAwake()
	{
		Body ??= GetComponent<Rigidbody>();
		PickPendulumAxis();

		// Stash the rigidbody's configured gravity scale (the "post-landing" value)
		// and override with the lower fall scale until the leaf lands.
		if ( Body is not null )
		{
			_normalGravityScale = Body.GravityScale;
			Body.GravityScale = FallGravityScale;
		}
	}

	private void PickPendulumAxis()
	{
		var angle = Game.Random.Float( 0f, MathF.PI * 2f );
		_pendulumAxis = new Vector3( MathF.Cos( angle ), MathF.Sin( angle ), 0f );
		_pendulumTime = 0f;
	}

	protected override void OnUpdate()
	{
		// Heartbeat — 1Hz position dump while in flight (not grounded)
		if ( DebugLogging && !_isGrounded && Body is not null )
		{
			_logHeartbeat += Time.Delta;
			if ( _logHeartbeat >= 1f )
			{
				_logHeartbeat = 0f;
				var v = Body.Velocity;
				Log.Info( $"[Leaf] HB pos=({WorldPosition.x:F0},{WorldPosition.y:F0},{WorldPosition.z:F0}) vel=({v.x:F0},{v.y:F0},{v.z:F0}) speed={v.Length:F0}" );
			}
		}

		if ( IsRunning ) _runElapsed += Time.Delta;

		// Tick the settle timer once leaf has landed. Player can press any input to skip.
		if ( _hasLanded && _settleElapsed < SettleDuration )
		{
			var wasFinished = _settleElapsed >= SettleDuration;
			_settleElapsed += Time.Delta;

			var anyInput = Input.AnalogMove.LengthSquared > 0.01f || Input.Pressed( "Jump" );
			if ( anyInput )
			{
				_settleElapsed = SettleDuration;
				if ( DebugLogging ) Log.Info( $"[Leaf] settle SKIPPED by input — wind activates" );
			}
			else if ( !wasFinished && _settleElapsed >= SettleDuration && DebugLogging )
			{
				Log.Info( $"[Leaf] settle complete — wind activates" );
			}
		}
	}

	protected override void OnFixedUpdate()
	{
		if ( Body is null ) return;

		// During tutorial settle, freeze the leaf completely — no movement, no rotation,
		// no input response. The HUD has the player's attention.
		if ( IsInTutorialSettle )
		{
			Body.Velocity = Vector3.Zero;
			Body.AngularVelocity = Vector3.Zero;
			_windAccum = Vector3.Zero;
			return;
		}

		CheckGrounded();
		ApplyGroundRecovery();
		ApplyStallRecovery();
		ApplyDrag();
		ApplyTilt();           // player input rotates the leaf (always available)
		ApplyAccumulatedWind();

		// Passive natural-leaf flutter only when free-falling without significant wind.
		// Once wind starts pushing, the player is in control.
		var hasWind = _windAccum.LengthSquared > 1f; // checked below before reset
		if ( !_isGrounded && !hasWind )
		{
			ApplySway();
			ApplyTumble();
		}

		ClampVelocities();
	}

	private void ApplyStallRecovery()
	{
		if ( !_hasLanded ) return;
		if ( IsInTutorialSettle ) return;
		if ( StallSpeedThreshold <= 0f ) return;

		// Track average speed over a rolling window
		_speedSum += Body.Velocity.Length;
		_speedSamples++;

		var sampleWindowTicks = (int)(StallSampleSeconds * 60f); // assuming 60Hz fixed
		if ( _speedSamples < sampleWindowTicks ) return;

		var avgSpeed = _speedSum / _speedSamples;
		_speedSum = 0;
		_speedSamples = 0;

		if ( _stallCooldown > 0 )
		{
			_stallCooldown -= StallSampleSeconds;
			return;
		}

		// Tick down consecutive stall streak when not stalled
		_stallStreakTimer -= StallSampleSeconds;
		if ( _stallStreakTimer < 0 )
		{
			_consecutiveStalls = 0;
			_stallStreakTimer = 0;
		}

		if ( avgSpeed < StallSpeedThreshold )
		{
			_consecutiveStalls++;
			_stallStreakTimer = 5f; // reset window — must stall again within 5s to count

			var primary = PrimaryDirection.LengthSquared > 0.01f
				? PrimaryDirection.Normal
				: Vector3.Forward;

			// Each consecutive stall multiplies the recovery force. Caps at 4× to avoid
			// flinging the leaf into orbit.
			var multiplier = MathF.Min( _consecutiveStalls, 4f );
			Body.ApplyForce( Vector3.Up * StallRecoveryUpward * 1.5f * multiplier );
			Body.ApplyForce( primary * StallRecoveryForward * multiplier );
			_stallCooldown = 1.5f;

			if ( DebugLogging )
			{
				Log.Info( $"[Leaf] STALL RECOVERY — avg {avgSpeed:F0}, streak {_consecutiveStalls}× — kick {multiplier:F0}× harder" );
			}
		}
	}

	/// <summary>
	/// Casts rays in horizontal directions to find the closest wall, then returns
	/// a unit vector pointing AWAY from it (with bias toward PrimaryDirection so
	/// we don't push backward when there's no nearby wall).
	/// </summary>
	private Vector3 FindBestUnstickDirection()
	{
		var primaryDir = PrimaryDirection.LengthSquared > 0.01f
			? PrimaryDirection.Normal
			: Vector3.Forward;

		// 8 horizontal probe directions
		var probes = new Vector3[]
		{
			new Vector3( 1, 0, 0 ),
			new Vector3( -1, 0, 0 ),
			new Vector3( 0, 1, 0 ),
			new Vector3( 0, -1, 0 ),
			new Vector3( 0.7f, 0.7f, 0 ).Normal,
			new Vector3( -0.7f, 0.7f, 0 ).Normal,
			new Vector3( 0.7f, -0.7f, 0 ).Normal,
			new Vector3( -0.7f, -0.7f, 0 ).Normal,
		};

		Vector3 closestHitNormal = Vector3.Zero;
		float closestDist = 80f; // only care about walls within 80u

		foreach ( var probe in probes )
		{
			var trace = Scene.Trace.Ray( WorldPosition, WorldPosition + probe * 80f )
				.IgnoreGameObjectHierarchy( GameObject )
				.Run();
			if ( trace.Hit && trace.Distance < closestDist )
			{
				closestDist = trace.Distance;
				closestHitNormal = -probe; // direction AWAY from the wall
			}
		}

		// If a wall was found, kick away from it (+ small primary bias)
		if ( closestHitNormal.LengthSquared > 0.01f )
		{
			var combined = (closestHitNormal * 0.7f + primaryDir * 0.3f).Normal;
			return combined;
		}

		// No nearby wall — kick toward primary direction
		return primaryDir;
	}

	private void ApplyGroundRecovery()
	{
		// Lift the leaf back up if it's stuck on the floor mid-flight.
		// Disabled during the initial fall + settle so it doesn't interfere with the cinematic landing.
		if ( !_isGrounded ) return;
		if ( !_hasLanded ) return; // still falling for the first time
		if ( IsInTutorialSettle ) return; // tutorial pause is sacred
		if ( GroundRecoveryForce <= 0f ) return;

		Body.ApplyForce( Vector3.Up * GroundRecoveryForce );
	}

	private void CheckGrounded()
	{
		var rayStart = WorldPosition;
		var rayEnd = WorldPosition + Vector3.Down * GroundCheckDistance;
		var result = Scene.Trace.Ray( rayStart, rayEnd )
			.IgnoreGameObjectHierarchy( GameObject )
			.Run();

		var wasGrounded = _isGrounded;
		_isGrounded = result.Hit;

		if ( !_hasLanded && _isGrounded )
		{
			_hasLanded = true;
			if ( Body is not null ) Body.GravityScale = _normalGravityScale;
			if ( DebugLogging )
			{
				Log.Info( $"[Leaf] LANDED at pos=({WorldPosition.x:F0},{WorldPosition.y:F0},{WorldPosition.z:F0}) — settle phase begins ({SettleDuration}s)" );
			}
		}
		else if ( _isGrounded != wasGrounded && DebugLogging )
		{
			Log.Info( $"[Leaf] grounded={_isGrounded} pos=({WorldPosition.x:F0},{WorldPosition.y:F0},{WorldPosition.z:F0})" );
		}
	}

	private void ApplyDrag()
	{
		var velocity = Body.Velocity;
		var speed = velocity.Length;
		if ( speed < 0.1f ) return;

		var velNormal = velocity / speed;

		// Orientation-aware drag: leaf face-on to motion = high drag (parachute),
		// edge-on = low drag (diving). Tilting forward (nose down) puts leaf edge-on
		// to its fall direction → drag drops → leaf accelerates down. Real surf physics.
		var leafSurface = WorldRotation.Up;
		var motionAlignment = MathF.Abs( Vector3.Dot( leafSurface, velNormal ) );
		var dragMultiplier = 0.25f + 0.75f * motionAlignment;

		var dragForce = -velNormal * (speed * speed * DragCoefficient * dragMultiplier * 0.001f);
		Body.ApplyForce( dragForce );
	}

	private void ApplyTilt()
	{
		var input = Input.AnalogMove;

		if ( input.LengthSquared > 0.01f )
		{
			// Apply torque about leaf's local axes for pitch and roll
			var pitchTorque = WorldRotation.Right * (-input.y * TiltTorqueStrength);
			var rollTorque = WorldRotation.Forward * (input.x * TiltTorqueStrength);
			Body.ApplyTorque( pitchTorque + rollTorque );
		}
		else if ( !_isGrounded )
		{
			// No input — gentle damping + stabilize toward flat
			Body.AngularVelocity = Body.AngularVelocity * (1f - TiltDamping * Time.Delta).Clamp( 0f, 1f );

			if ( AutoStabilizeStrength > 0f )
			{
				var leafUp = WorldRotation.Up;
				var correction = Vector3.Cross( leafUp, Vector3.Up );
				Body.ApplyTorque( correction * AutoStabilizeStrength );
			}
		}

		// Bank-to-yaw: a banked leaf turns toward the bank direction (aeroplane-like).
		// Independent of input — works whenever the leaf is rolled.
		if ( !_isGrounded && BankToYawStrength > 0f )
		{
			var leafRight = WorldRotation.Right;
			// Roll component: how much "right" axis is tilted up/down
			var rollAmount = leafRight.z;
			var speed = Body.Velocity.Length;
			var speedFactor = (speed / 200f).Clamp( 0f, 2f );
			Body.ApplyTorque( Vector3.Up * (-rollAmount * BankToYawStrength * speedFactor) );
		}

		// Dive assist: when leaf is pitched nose-down, push forward along its facing.
		// Makes "diving" actually feel like accelerating, not just falling.
		if ( !_isGrounded && DiveAssist > 0f )
		{
			var leafForward = WorldRotation.Forward;
			// Negative Z component on forward = nose pointing down
			var diveAmount = -leafForward.z;
			if ( diveAmount > 0f )
			{
				var pushDir = leafForward.WithZ( 0 ).Normal;
				Body.ApplyForce( pushDir * DiveAssist * diveAmount );
			}
		}
	}

	private void ApplySway()
	{
		_pendulumTime += Time.Delta;
		var amplitude = SwayStrength * (_hasLanded ? 1f : FallSwayMultiplier);

		// Lissajous-style 2D sway in the XY plane: X uses one frequency, Y uses
		// a slightly different one. The closed-loop pattern means the leaf wobbles
		// without the net positional drift a fixed-axis pendulum produces — the
		// reason it was getting flung "behind the tree" before.
		var phase = _pendulumTime * SwayFrequency * MathF.PI * 2f;
		var fx = MathF.Sin( phase ) * amplitude;
		var fy = MathF.Cos( phase * 0.73f ) * amplitude * 0.7f;
		Body.ApplyForce( new Vector3( fx, fy, 0f ) );
	}

	private void ApplyTumble()
	{
		// Don't add random tumble while player is actively tilting — the random torque
		// would fight the player's input and make control feel mushy.
		if ( Input.AnalogMove.LengthSquared > 0.01f ) return;

		var torque = new Vector3(
			Game.Random.Float( -1f, 1f ),
			Game.Random.Float( -1f, 1f ),
			Game.Random.Float( -1f, 1f )
		) * TumbleStrength;
		Body.ApplyTorque( torque );
	}

	void Component.ICollisionListener.OnCollisionStart( Collision collision )
	{
		if ( Body is null ) return;
		if ( !_hasLanded ) return; // initial fall — let it land naturally
		if ( IsInTutorialSettle ) return;

		var preVel = Body.Velocity;
		var preAng = Body.AngularVelocity;
		var preSpeed = preVel.Length;
		var contactNormal = collision.Contact.Normal;
		var contactPoint = collision.Contact.Point;
		var otherName = collision.Other.GameObject?.Name ?? "?";

		// Kill rotation so the leaf doesn't spin off into a wall
		Body.AngularVelocity = Body.AngularVelocity * CollisionAngularDamping;

		// Damp the velocity so the leaf doesn't keep slamming into the same wall
		Body.Velocity = Body.Velocity * CollisionLinearDamping;

		// Push upward + forward (along PrimaryDirection) to escape the surface
		var primary = PrimaryDirection.LengthSquared > 0.01f
			? PrimaryDirection.Normal
			: Vector3.Forward;
		Body.ApplyForce( Vector3.Up * CollisionUpwardKick );
		Body.ApplyForce( primary * CollisionForwardKick );

		if ( LogCollisions )
		{
			// Angle between incoming velocity and contact normal — tells us if leaf
			// hit head-on (180° = straight at wall) or grazed (90° = parallel slide).
			float incidence = -1f;
			if ( preVel.LengthSquared > 1f && contactNormal.LengthSquared > 0.01f )
			{
				var dot = Vector3.Dot( preVel.Normal, -contactNormal );
				incidence = MathF.Acos( dot.Clamp( -1f, 1f ) ) * 57.2958f;
			}
			// Is the kick fighting the wall, or shoving into it?
			// Up-kick: dot with surface normal — positive = away from wall (good).
			float upDotNorm = Vector3.Dot( Vector3.Up, contactNormal );
			float fwdDotNorm = Vector3.Dot( primary, contactNormal );
			Log.Info( $"[Leaf] HIT {otherName} at ({contactPoint.x:F0},{contactPoint.y:F0},{contactPoint.z:F0}) preSpeed={preSpeed:F0} incidence={incidence:F0}° normal=({contactNormal.x:F2},{contactNormal.y:F2},{contactNormal.z:F2}) upKickAlignsAway={upDotNorm:F2} fwdKickAlignsAway={fwdDotNorm:F2} preAng={preAng.Length:F0}" );
		}
	}

	private void ApplyAccumulatedWind()
	{
		// Cap the per-tick wind force regardless of how many overlapping zones added to it.
		// Without this, leaf gets shot through the floor when zones overlap.
		var mag = _windAccum.Length;
		if ( mag > MaxWindForcePerTick )
		{
			_windAccum = _windAccum.Normal * MaxWindForcePerTick;
		}

		if ( _windAccum.LengthSquared > 0.01f )
		{
			Body.ApplyForce( _windAccum );
		}
		_windAccum = Vector3.Zero;
	}

	private void ClampVelocities()
	{
		if ( Body.Velocity.Length > MaxLinearSpeed )
			Body.Velocity = Body.Velocity.Normal * MaxLinearSpeed;

		if ( Body.AngularVelocity.Length > MaxAngularSpeed )
			Body.AngularVelocity = Body.AngularVelocity.Normal * MaxAngularSpeed;
	}
}
