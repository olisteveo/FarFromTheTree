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
public sealed class LeafController : Component
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
	/// How much wind force the leaf catches when its surface is edge-on to the wind.
	/// 0 = pure surface area model (no push at all when edge-on, full push when flat).
	/// 1 = wind pushes the leaf the same regardless of orientation (no surf mechanic).
	/// Lower values = more rewarding surf gameplay.
	/// </summary>
	[Property, Group( "Wind Interaction" ), Range( 0f, 1f )]
	public float EdgeOnWindCatch { get; set; } = 0.2f;

	[Property, Group( "Tilt Control" ), Range( 0f, 50f )]
	public float TiltTorqueStrength { get; set; } = 8f;

	[Property, Group( "Tilt Control" ), Range( 0f, 50f )]
	public float TiltDamping { get; set; } = 4f;

	/// <summary>
	/// Strength of the auto-stabilize torque that gently rotates the leaf back to flat
	/// (surface normal up) when the player isn't giving input. Prevents endless spinning.
	/// </summary>
	[Property, Group( "Tilt Control" ), Range( 0f, 30f )]
	public float AutoStabilizeStrength { get; set; } = 4f;

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
	/// How long the leaf sits still on the ground after first landing before the
	/// first gust kicks in. Tutorial UI shows during this window. Player can press
	/// any input to skip to instant pickup.
	/// </summary>
	[Property, Group( "Tutorial Settle" ), Range( 0f, 10f )]
	public float SettleDuration { get; set; } = 3f;

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
	private float _speedSum;
	private int _speedSamples;
	private float _stallCooldown;
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

		if ( avgSpeed < StallSpeedThreshold )
		{
			// Stuck — find which wall is closest by casting rays in 6 directions,
			// then kick AWAY from that wall + up. Falls back to forward if no wall found.
			var unstickDir = FindBestUnstickDirection();
			Body.ApplyForce( unstickDir * StallRecoveryForward );
			Body.ApplyForce( Vector3.Up * StallRecoveryUpward );
			_stallCooldown = 1.5f;

			if ( DebugLogging )
			{
				Log.Info( $"[Leaf] STALL RECOVERY — avg {avgSpeed:F0}, unstick=({unstickDir.x:F2},{unstickDir.y:F2},{unstickDir.z:F2})" );
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

		var dragForce = -velocity.Normal * (speed * speed * DragCoefficient * 0.001f);
		Body.ApplyForce( dragForce );
	}

	private void ApplyTilt()
	{
		// Player input rotates the leaf via torque — physics-friendly, doesn't fight Rigidbody.
		// Forward (W / stick up) = pitch nose down (negative pitch in our convention).
		// Right (D / stick right) = roll right.
		// NEVER applies forward thrust — leaf cannot move on its own.
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
			// No input — dampen angular velocity AND gently stabilize toward flat
			Body.AngularVelocity = Body.AngularVelocity * (1f - TiltDamping * Time.Delta).Clamp( 0f, 1f );

			// Auto-stabilize: torque toward flat (leaf surface normal points up)
			if ( AutoStabilizeStrength > 0f )
			{
				var leafUp = WorldRotation.Up;
				var correction = Vector3.Cross( leafUp, Vector3.Up );
				Body.ApplyTorque( correction * AutoStabilizeStrength );
			}
		}
	}

	private void ApplySway()
	{
		_pendulumTime += Time.Delta;
		var swingForce = MathF.Sin( _pendulumTime * SwayFrequency * MathF.PI * 2f ) * SwayStrength;
		Body.ApplyForce( _pendulumAxis * swingForce );
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
