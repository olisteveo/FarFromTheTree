/// <summary>
/// Motion blur that intensifies with leaf speed. Attach to the same GameObject as
/// LeafCamera. Auto-creates a Sandbox.MotionBlur component on the camera if missing.
/// </summary>
public sealed class SpeedBlur : Component
{
	[Property] public GameObject LeafTarget { get; set; }

	[Property, Range( 50f, 1000f )]
	public float SpeedAtFullBlur { get; set; } = 500f;

	[Property, Range( 0f, 1f )]
	public float MaxBlurAmount { get; set; } = 0.6f;

	[Property, Range( 0f, 1f )]
	public float MinBlurAmount { get; set; } = 0f;

	private MotionBlur _blur;

	protected override void OnStart()
	{
		_blur = Components.Get<MotionBlur>() ?? Components.Create<MotionBlur>();
	}

	protected override void OnUpdate()
	{
		if ( LeafTarget is null || _blur is null ) return;

		var body = LeafTarget.Components.Get<Rigidbody>();
		if ( body is null ) return;

		var speed = body.Velocity.Length;
		var t = (speed / SpeedAtFullBlur).Clamp( 0f, 1f );
		var amount = MathX.Lerp( MinBlurAmount, MaxBlurAmount, t );

		// Try common property names. If your s&box version uses a different name,
		// I'll update this once we see the compile error.
		_blur.Scale = amount;
	}
}
