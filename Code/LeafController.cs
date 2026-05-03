/// <summary>
/// The leaf. Aerodynamic forces + natural pendulum sway + safety caps.
///
/// Physics model — designed to feel like a real falling leaf:
///   * Rigidbody handles gravity + collision (built-in)
///   * Drag opposes velocity, varying with leaf orientation:
///       face-on (perpendicular to motion) = high drag (parachute)
///       edge-on (parallel to motion)      = low drag (arrow)
///   * Lift acts in WORLD UP, scaled by how flat the leaf is. Always upward,
///     never downward — prevents runaway acceleration when leaf inverts.
///   * Drift = horizontal component of leaf surface direction × small force.
///     Tilted leaf drifts sideways, flat leaf doesn't drift. Decoupled from
///     lift so we can't get into a self-amplifying spiral.
///   * Wobble torque = sinusoidal force perpendicular to fall direction —
///     drives the side-to-side pendulum.
///   * Tumble torque = small random flutter.
///   * Hard caps on linear and angular velocity prevent any combination of
///     forces from launching the leaf into orbit.
/// </summary>
public sealed class LeafController : Component
{
	[Property] public Rigidbody Body { get; set; }

	[Property, Group( "Aerodynamics" ), Range( 0f, 5f )]
	public float DragCoefficient { get; set; } = 2.5f;

	[Property, Group( "Aerodynamics" ), Range( 0f, 500f )]
	public float LiftCoefficient { get; set; } = 80f;

	[Property, Group( "Aerodynamics" ), Range( 0f, 100f )]
	public float DriftCoefficient { get; set; } = 30f;

	[Property, Group( "Aerodynamics" ), Range( 0f, 1f )]
	public float MinDragMultiplier { get; set; } = 0.3f;

	[Property, Group( "Wobble" ), Range( 0f, 20f )]
	public float WobbleStrength { get; set; } = 3f;

	[Property, Group( "Wobble" ), Range( 0f, 5f )]
	public float WobbleFrequency { get; set; } = 1.5f;

	[Property, Group( "Wobble" ), Range( 0f, 20f )]
	public float TumbleStrength { get; set; } = 1.5f;

	[Property, Group( "Safety Caps" ), Range( 0f, 5000f )]
	public float MaxLinearSpeed { get; set; } = 800f;

	[Property, Group( "Safety Caps" ), Range( 0f, 1000f )]
	public float MaxAngularSpeed { get; set; } = 360f;

	private float _wobbleTime;
	private Vector3 _windAccum;

	/// <summary>
	/// WindZone components call this each tick to push the leaf.
	/// </summary>
	public void AddWindForce( Vector3 force ) => _windAccum += force;

	protected override void OnAwake()
	{
		Body ??= GetComponent<Rigidbody>();
	}

	protected override void OnFixedUpdate()
	{
		if ( Body is null ) return;

		_wobbleTime += Time.Delta;

		ApplyAerodynamics();
		ApplyLeafWobble();
		ApplyTumble();
		ApplyAccumulatedWind();
		ClampVelocities();
	}

	private void ApplyAerodynamics()
	{
		var velocity = Body.Velocity;
		var speed = velocity.Length;
		if ( speed < 0.1f ) return;

		var velNormal = velocity / speed;
		var leafSurface = WorldRotation.Up;

		// Drag with orientation-aware multiplier.
		var motionAlignment = MathF.Abs( Vector3.Dot( leafSurface, velNormal ) );
		var dragMultiplier = MinDragMultiplier + (1f - MinDragMultiplier) * motionAlignment;
		var dragForce = -velNormal * (speed * speed * DragCoefficient * dragMultiplier * 0.001f);
		Body.ApplyForce( dragForce );

		// Lift always points in WORLD up, scaled by leaf flatness.
		// Never pushes down even if leaf inverts — keeps physics stable.
		var flatness = MathF.Max( 0f, Vector3.Dot( leafSurface, Vector3.Up ) );
		var liftForce = Vector3.Up * (speed * LiftCoefficient * flatness);
		Body.ApplyForce( liftForce );

		// Drift = horizontal projection of leaf surface direction.
		// Tilted leaf gets pushed sideways in the direction it tilts.
		var horizontalTilt = leafSurface.WithZ( 0 );
		var driftForce = horizontalTilt * (speed * DriftCoefficient);
		Body.ApplyForce( driftForce );
	}

	private void ApplyLeafWobble()
	{
		var velocity = Body.Velocity;
		if ( velocity.LengthSquared < 1f ) return;

		Vector3 wobbleAxis;
		var cross = Vector3.Cross( velocity.Normal, Vector3.Up );
		if ( cross.LengthSquared > 0.01f )
		{
			wobbleAxis = cross.Normal;
		}
		else
		{
			// Velocity is near vertical — pick a horizontal axis that rotates over time.
			float angle = _wobbleTime * 0.5f;
			wobbleAxis = new Vector3( MathF.Cos( angle ), MathF.Sin( angle ), 0 );
		}

		var wobble = MathF.Sin( _wobbleTime * WobbleFrequency ) * WobbleStrength;
		Body.ApplyTorque( wobbleAxis * wobble );
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
		{
			Body.Velocity = Body.Velocity.Normal * MaxLinearSpeed;
		}

		if ( Body.AngularVelocity.Length > MaxAngularSpeed )
		{
			Body.AngularVelocity = Body.AngularVelocity.Normal * MaxAngularSpeed;
		}
	}
}
