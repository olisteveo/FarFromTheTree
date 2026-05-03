/// <summary>
/// The leaf. Aerodynamic forces + natural pendulum sway.
///
/// Physics model — designed to feel like a real falling leaf:
///   * Rigidbody handles gravity + collision (built-in)
///   * Drag opposes velocity, varying with leaf orientation:
///       face-on (perpendicular to motion) = high drag like a parachute
///       edge-on (parallel to motion)      = low drag like an arrow
///   * Lift acts perpendicular to leaf SURFACE (local up, not world up):
///       a tilted leaf gets pushed sideways → natural drift
///       a flat leaf gets pushed up → glide
///   * Wobble torque = sinusoidal force perpendicular to fall direction:
///       drives the side-to-side pendulum motion of a real falling leaf
///   * Tumble torque = small random torque for flutter
///   * Wind zones add their own forces via AddWindForce()
///
/// Player tilt control is currently disabled — to be re-enabled with a
/// torque-based approach (not WorldRotation override, which fights Rigidbody).
/// </summary>
public sealed class LeafController : Component
{
	[Property] public Rigidbody Body { get; set; }

	[Property, Group( "Aerodynamics" ), Range( 0f, 5f )]
	public float DragCoefficient { get; set; } = 1.2f;

	[Property, Group( "Aerodynamics" ), Range( 0f, 5000f )]
	public float LiftCoefficient { get; set; } = 1500f;

	[Property, Group( "Aerodynamics" ), Range( 0f, 1f )]
	public float MinDragMultiplier { get; set; } = 0.3f;

	[Property, Group( "Wobble" ), Range( 0f, 50f )]
	public float WobbleStrength { get; set; } = 12f;

	[Property, Group( "Wobble" ), Range( 0f, 10f )]
	public float WobbleFrequency { get; set; } = 2.5f;

	[Property, Group( "Wobble" ), Range( 0f, 100f )]
	public float TumbleStrength { get; set; } = 6f;

	private float _wobbleTime;
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

		_wobbleTime += Time.Delta;

		ApplyAerodynamics();
		ApplyLeafWobble();
		ApplyTumble();
		ApplyAccumulatedWind();
	}

	private void ApplyAerodynamics()
	{
		var velocity = Body.Velocity;
		var speed = velocity.Length;
		if ( speed < 0.1f ) return;

		var velNormal = velocity / speed;
		var leafSurface = WorldRotation.Up;

		// Drag scales with how face-on the leaf is to its motion.
		// Face-on (motionAlignment ≈ 1)   → parachute, max drag
		// Edge-on (motionAlignment ≈ 0)   → arrow, MinDragMultiplier
		var motionAlignment = MathF.Abs( Vector3.Dot( leafSurface, velNormal ) );
		var dragMultiplier = MinDragMultiplier + (1f - MinDragMultiplier) * motionAlignment;
		var dragForce = -velNormal * (speed * speed * DragCoefficient * dragMultiplier * 0.001f);
		Body.ApplyForce( dragForce );

		// Lift acts along leaf's surface normal (its local up).
		// Tilted leaf → lift pushes sideways → natural drift.
		// Flat leaf  → lift pushes up → glides like a paper plane.
		var liftForce = leafSurface * (speed * speed * LiftCoefficient * 0.0001f);
		Body.ApplyForce( liftForce );
	}

	private void ApplyLeafWobble()
	{
		// Sinusoidal torque about an axis perpendicular to the fall direction.
		// This is what makes a real leaf rock side to side as it falls.
		var velocity = Body.Velocity;
		if ( velocity.LengthSquared < 1f ) return;

		var wobbleAxis = Vector3.Cross( velocity.Normal, Vector3.Up );
		if ( wobbleAxis.LengthSquared < 0.01f ) return; // velocity near vertical → no defined axis

		wobbleAxis = wobbleAxis.Normal;
		var wobble = MathF.Sin( _wobbleTime * WobbleFrequency ) * WobbleStrength;
		Body.ApplyTorque( wobbleAxis * wobble );
	}

	private void ApplyTumble()
	{
		// Small random torque — flutter, makes the leaf feel alive
		// even before any input or wobble.
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
