/// <summary>
/// The leaf — minimum-viable falling physics.
///
/// Deliberately simple, no aerodynamic ambition:
///   * Rigidbody handles gravity + collision
///   * Quadratic drag — slows the fall
///   * Periodic random horizontal sway force — natural side-to-side drift
///   * Random tumble torque — visible rotation
///   * Hard velocity cap — leaf cannot fly off
///   * Wind zones add their own force
///
/// Once this version is verified to fall and drift sensibly,
/// we layer player tilt control + proper aerodynamics on top.
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

	[Property, Group( "Safety" ), Range( 0f, 5000f )]
	public float MaxLinearSpeed { get; set; } = 300f;

	[Property, Group( "Safety" ), Range( 0f, 1000f )]
	public float MaxAngularSpeed { get; set; } = 180f;

	private Vector3 _pendulumAxis;
	private float _pendulumTime;
	private Vector3 _windAccum;

	public void AddWindForce( Vector3 force ) => _windAccum += force;

	protected override void OnAwake()
	{
		Body ??= GetComponent<Rigidbody>();
		PickPendulumAxis();
	}

	private void PickPendulumAxis()
	{
		// Pick a random horizontal direction. Leaf will swing back and forth
		// along this axis as it falls — natural pendulum feel.
		var angle = Game.Random.Float( 0f, MathF.PI * 2f );
		_pendulumAxis = new Vector3( MathF.Cos( angle ), MathF.Sin( angle ), 0f );
		_pendulumTime = 0f;
	}

	protected override void OnFixedUpdate()
	{
		if ( Body is null ) return;

		ApplyDrag();
		ApplySway();
		ApplyTumble();
		ApplyAccumulatedWind();
		ClampVelocities();
	}

	private void ApplyDrag()
	{
		var velocity = Body.Velocity;
		var speed = velocity.Length;
		if ( speed < 0.1f ) return;

		var dragForce = -velocity.Normal * (speed * speed * DragCoefficient * 0.001f);
		Body.ApplyForce( dragForce );
	}

	private void ApplySway()
	{
		// Smooth sinusoidal force along a fixed horizontal axis — pendulum motion.
		// The leaf swings to one side, decelerates, swings back, repeats.
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
