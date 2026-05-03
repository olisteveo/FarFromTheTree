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
	public float SwayStrength { get; set; } = 80f;

	[Property, Group( "Sway" ), Range( 0.1f, 5f )]
	public float MinSwayDuration { get; set; } = 0.5f;

	[Property, Group( "Sway" ), Range( 0.5f, 10f )]
	public float MaxSwayDuration { get; set; } = 2f;

	[Property, Group( "Sway" ), Range( 0f, 20f )]
	public float TumbleStrength { get; set; } = 2f;

	[Property, Group( "Safety" ), Range( 0f, 5000f )]
	public float MaxLinearSpeed { get; set; } = 300f;

	[Property, Group( "Safety" ), Range( 0f, 1000f )]
	public float MaxAngularSpeed { get; set; } = 180f;

	private Vector3 _swayDirection;
	private float _swayElapsed;
	private float _swayDuration = 1f;
	private Vector3 _windAccum;

	public void AddWindForce( Vector3 force ) => _windAccum += force;

	protected override void OnAwake()
	{
		Body ??= GetComponent<Rigidbody>();
		PickNewSwayDirection();
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
		// Periodically pick a new random horizontal direction to drift in.
		_swayElapsed += Time.Delta;
		if ( _swayElapsed >= _swayDuration )
		{
			PickNewSwayDirection();
		}

		Body.ApplyForce( _swayDirection * SwayStrength );
	}

	private void PickNewSwayDirection()
	{
		_swayDirection = new Vector3(
			Game.Random.Float( -1f, 1f ),
			Game.Random.Float( -1f, 1f ),
			0f
		);

		if ( _swayDirection.LengthSquared > 0.01f )
			_swayDirection = _swayDirection.Normal;

		_swayElapsed = 0f;
		_swayDuration = Game.Random.Float( MinSwayDuration, MaxSwayDuration );
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
