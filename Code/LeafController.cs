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

	[Property, Group( "Safety" ), Range( 0f, 5000f )]
	public float MaxLinearSpeed { get; set; } = 600f;

	[Property, Group( "Safety" ), Range( 0f, 1000f )]
	public float MaxAngularSpeed { get; set; } = 360f;

	[Property, Group( "Ground" ), Range( 1f, 50f )]
	public float GroundCheckDistance { get; set; } = 8f;

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

	private Vector3 _pendulumAxis;
	private float _pendulumTime;
	private Vector3 _windAccum;
	private bool _isGrounded;
	private bool _hasLanded;
	private float _settleElapsed;

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
		// Tick the settle timer once leaf has landed. Player can press any input to skip.
		if ( _hasLanded && _settleElapsed < SettleDuration )
		{
			_settleElapsed += Time.Delta;

			var anyInput = Input.AnalogMove.LengthSquared > 0.01f || Input.Pressed( "Jump" );
			if ( anyInput )
			{
				_settleElapsed = SettleDuration;
			}
		}
	}

	protected override void OnFixedUpdate()
	{
		if ( Body is null ) return;

		CheckGrounded();
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

	private void CheckGrounded()
	{
		var rayStart = WorldPosition;
		var rayEnd = WorldPosition + Vector3.Down * GroundCheckDistance;
		var result = Scene.Trace.Ray( rayStart, rayEnd )
			.IgnoreGameObjectHierarchy( GameObject )
			.Run();

		_isGrounded = result.Hit;
		if ( _isGrounded ) _hasLanded = true;
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
			// No input — gently dampen angular velocity so leaf settles, doesn't spin
			Body.AngularVelocity = Body.AngularVelocity * (1f - TiltDamping * Time.Delta).Clamp( 0f, 1f );
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
		var torque = new Vector3(
			Game.Random.Float( -1f, 1f ),
			Game.Random.Float( -1f, 1f ),
			Game.Random.Float( -1f, 1f )
		) * TumbleStrength;
		Body.ApplyTorque( torque );
	}

	private void ApplyAccumulatedWind()
	{
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
