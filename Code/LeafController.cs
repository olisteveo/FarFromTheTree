/// <summary>
/// The leaf. Reads tilt input (WASD / left-stick), applies aerodynamic forces.
///
/// Physics model (intentionally simple — feel beats sim accuracy):
///   * Rigidbody handles gravity + collision (built-in)
///   * Drag opposes velocity, scaled by speed²        — slows the leaf down
///   * Lift always points up, scaled by speed² × flatness  — flat leaf glides, vertical leaf falls
///   * Tilt input rotates the leaf (smoothed) — pitch for nose up/down, roll for banking
///   * Yaw eases toward direction of travel — leaf "faces" where it's going
///   * Tumble torque applied when no input — passive flutter
///   * Wind zones add their own forces via AddWindForce()
///
/// Convention: forward input (W / stick up) = nose DOWN = dive (real aerodynamics).
/// </summary>
public sealed class LeafController : Component
{
	[Property] public Rigidbody Body { get; set; }

	[Property, Group( "Tilt" ), Range( 0f, 90f )]
	public float MaxPitchDeg { get; set; } = 60f;

	[Property, Group( "Tilt" ), Range( 0f, 90f )]
	public float MaxRollDeg { get; set; } = 70f;

	[Property, Group( "Tilt" ), Range( 0f, 20f )]
	public float TiltLerpRate { get; set; } = 6f;

	[Property, Group( "Tilt" ), Range( 0f, 10f )]
	public float YawLerpRate { get; set; } = 2f;

	[Property, Group( "Aerodynamics" ), Range( 0f, 5f )]
	public float DragCoefficient { get; set; } = 1.2f;

	[Property, Group( "Aerodynamics" ), Range( 0f, 5000f )]
	public float LiftCoefficient { get; set; } = 1500f;

	[Property, Group( "Aerodynamics" ), Range( 0f, 100f )]
	public float TumbleStrength { get; set; } = 6f;

	[Property, Group( "Aerodynamics" ), Range( 0f, 50f )]
	public float MinSpeedForYawTracking { get; set; } = 5f;

	private float _currentPitch;
	private float _currentRoll;
	private Vector3 _windAccum;

	/// <summary>
	/// WindZone components call this each tick to push the leaf.
	/// Accumulates over the frame so multiple overlapping zones add cleanly.
	/// </summary>
	public void AddWindForce( Vector3 force ) => _windAccum += force;

	protected override void OnAwake()
	{
		Body ??= GetComponent<Rigidbody>();
	}

	protected override void OnFixedUpdate()
	{
		if ( Body is null ) return;

		ApplyTilt();
		ApplyAerodynamics();
		ApplyTumble();
		ApplyAccumulatedWind();
	}

	private void ApplyTilt()
	{
		var input = Input.AnalogMove;

		// Forward (input.y > 0) = nose down = negative pitch
		// Right (input.x > 0)   = roll right = positive roll
		var targetPitch = -input.y * MaxPitchDeg;
		var targetRoll = input.x * MaxRollDeg;

		_currentPitch = _currentPitch.LerpTo( targetPitch, Time.Delta * TiltLerpRate );
		_currentRoll = _currentRoll.LerpTo( targetRoll, Time.Delta * TiltLerpRate );

		// Yaw eases toward velocity direction once we're moving — leaf naturally
		// rotates to face where it's going so the player sees forward.
		var velocity = Body.Velocity;
		var horizontalSpeed = velocity.WithZ( 0 ).Length;

		float yaw = WorldRotation.Yaw();
		if ( horizontalSpeed > MinSpeedForYawTracking )
		{
			float targetYaw = velocity.WithZ( 0 ).EulerAngles.yaw;
			yaw = yaw.LerpDegreesTo( targetYaw, Time.Delta * YawLerpRate );
		}

		WorldRotation = Rotation.From( _currentPitch, yaw, _currentRoll );
	}

	private void ApplyAerodynamics()
	{
		var velocity = Body.Velocity;
		var speed = velocity.Length;
		if ( speed < 0.1f ) return;

		// Quadratic drag opposing motion. The 0.001 is just unit-scaling so
		// DragCoefficient stays in a tunable 0-5 range.
		var dragForce = -velocity.Normal * (speed * speed * DragCoefficient * 0.001f);
		Body.ApplyForce( dragForce );

		// Lift: how flat is the leaf relative to horizontal?
		// Dot of leaf-up against world-up = 1 when flat, 0 when on edge.
		var flatness = MathF.Max( 0f, Vector3.Dot( WorldRotation.Up, Vector3.Up ) );
		var liftForce = Vector3.Up * (speed * speed * LiftCoefficient * flatness * 0.0001f);
		Body.ApplyForce( liftForce );
	}

	private void ApplyTumble()
	{
		// Passive flutter when player isn't tilting. Random small torques —
		// not physically meaningful, just makes the leaf feel alive.
		if ( Input.AnalogMove.LengthSquared >= 0.01f ) return;

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
}
