/// <summary>
/// The leaf. Owns aerodynamic state and applies wind/lift/drag forces to the Rigidbody.
/// Attach to a GameObject with a Rigidbody and a Collider. Reads Input.AnalogMove for tilt.
/// </summary>
public sealed class LeafController : Component
{
	[Property] public Rigidbody Body { get; set; }

	[Property, Range( 0f, 5000f )] public float LiftCoefficient { get; set; } = 800f;
	[Property, Range( 0f, 100f )] public float DragCoefficient { get; set; } = 8f;
	[Property, Range( 0f, 200f )] public float TiltSpeed { get; set; } = 90f;
	[Property, Range( 0f, 90f )] public float MaxTiltAngle { get; set; } = 60f;
	[Property, Range( 0f, 1f )] public float Integrity { get; set; } = 1f;

	protected override void OnAwake()
	{
		Body ??= GetComponent<Rigidbody>();
	}

	protected override void OnFixedUpdate()
	{
		if ( Body is null ) return;

		// TODO: tilt control from Input.AnalogMove (pitch/roll)
		// TODO: drag opposing velocity (~v^2)
		// TODO: lift perpendicular to velocity, scaled by tilt and forward speed
		// TODO: passive tumble torque when no input
		// TODO: integrity decreases on impact, modifies handling
	}
}
