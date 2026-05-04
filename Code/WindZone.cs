/// <summary>
/// A volume of wind. Attach to a GameObject with a BoxCollider that has IsTrigger = true.
/// While a LeafController is overlapping this trigger, applies the configured force.
///
/// Direction is in WORLD space by default. If LocalDirection is true, the direction
/// is relative to this GameObject's rotation — useful for wind tunnels you want to
/// rotate by rotating the GameObject.
/// </summary>
public sealed class WindZone : Component, Component.ITriggerListener
{
	[Property, Group( "Wind" )]
	public Vector3 Direction { get; set; } = Vector3.Forward;

	[Property, Group( "Wind" ), Range( 0f, 50000f )]
	public float Strength { get; set; } = 2000f;

	[Property, Group( "Wind" )]
	public bool LocalDirection { get; set; } = false;

	/// <summary>
	/// If true, this wind zone only applies force AFTER the leaf has touched the ground
	/// at least once. Use this for the "first gust" zone — prevents it from catching the
	/// leaf mid-fall and short-circuiting the cinematic landing moment.
	/// </summary>
	[Property, Group( "Activation" )]
	public bool RequireFirstLanding { get; set; } = false;

	/// <summary>
	/// If true, the wind direction oscillates over time (sine wave).
	/// Combined with Reverses = true, the wind alternates between Direction and -Direction.
	/// Combined with Reverses = false, the wind fades on and off (still always in Direction).
	/// </summary>
	[Property, Group( "Oscillation" )]
	public bool Oscillates { get; set; } = false;

	[Property, Group( "Oscillation" ), Range( 0.5f, 30f )]
	public float OscillationPeriod { get; set; } = 4f;

	[Property, Group( "Oscillation" ), Range( 0f, 360f )]
	public float PhaseOffsetDeg { get; set; } = 0f;

	/// <summary>
	/// If true and Oscillates, wind direction REVERSES (multiplier swings -1 to +1).
	/// If false, wind PULSES — full strength to zero (multiplier 0 to +1).
	/// </summary>
	[Property, Group( "Oscillation" )]
	public bool Reverses { get; set; } = true;

	private readonly HashSet<LeafController> _occupants = new();
	private float _oscTime;

	/// <summary>
	/// The current force vector this wind zone is applying (after oscillation).
	/// Read by WindVisualizer to keep particle direction in sync.
	/// </summary>
	public Vector3 CurrentForce
	{
		get
		{
			var worldDir = LocalDirection
				? WorldRotation * Direction.Normal
				: Direction.Normal;
			var force = worldDir * Strength;
			if ( Oscillates ) force *= ComputeOscillationMultiplier();
			return force;
		}
	}

	private float ComputeOscillationMultiplier()
	{
		var phase = (_oscTime / OscillationPeriod) * MathF.PI * 2f
			+ (PhaseOffsetDeg * MathF.PI / 180f);
		var s = MathF.Sin( phase );
		return Reverses ? s : MathF.Max( 0f, s );
	}

	void Component.ITriggerListener.OnTriggerEnter( Collider other )
	{
		var leaf = other.GameObject.Components.Get<LeafController>();
		if ( leaf is not null ) _occupants.Add( leaf );
	}

	void Component.ITriggerListener.OnTriggerExit( Collider other )
	{
		var leaf = other.GameObject.Components.Get<LeafController>();
		if ( leaf is not null ) _occupants.Remove( leaf );
	}

	protected override void OnFixedUpdate()
	{
		_oscTime += Time.Delta;

		if ( _occupants.Count == 0 ) return;

		var force = CurrentForce;
		if ( force.LengthSquared < 0.01f ) return; // oscillating to ~zero

		foreach ( var leaf in _occupants )
		{
			if ( !leaf.IsValid ) continue;
			if ( RequireFirstLanding && !leaf.IsReadyForFirstWind ) continue;

			leaf.AddWindForce( force );
		}
	}

	/// <summary>
	/// Editor gizmo: arrow showing wind direction. Length and thickness scale with Strength.
	/// </summary>
	protected override void DrawGizmos()
	{
		if ( Strength <= 0.01f ) return;

		// Direction in local space (the GameObject's space — Gizmo auto-transforms)
		var dir = LocalDirection ? Direction.Normal : (WorldRotation.Inverse * Direction.Normal);
		if ( dir.LengthSquared < 0.01f ) return;

		var arrowLength = (Strength * 0.5f).Clamp( 30f, 400f );
		var intensity = (Strength / 1500f).Clamp( 0.4f, 1f );

		Gizmo.Draw.Color = new Color( 0.4f, 0.85f, 1f, intensity );
		Gizmo.Draw.LineThickness = 1f + (Strength / 400f).Clamp( 0f, 4f );
		Gizmo.Draw.IgnoreDepth = true;

		var origin = Vector3.Zero;
		var tip = dir * arrowLength;

		// Shaft
		Gizmo.Draw.Line( origin, tip );

		// Arrowhead — 4 short diagonal lines from tip for visibility from any angle
		var up = MathF.Abs( dir.z ) < 0.95f ? Vector3.Up : Vector3.Right;
		var perp = Vector3.Cross( dir, up ).Normal;
		var perp2 = Vector3.Cross( dir, perp ).Normal;
		var headSize = arrowLength * 0.18f;

		Gizmo.Draw.Line( tip, tip - dir * headSize + perp * headSize );
		Gizmo.Draw.Line( tip, tip - dir * headSize - perp * headSize );
		Gizmo.Draw.Line( tip, tip - dir * headSize + perp2 * headSize );
		Gizmo.Draw.Line( tip, tip - dir * headSize - perp2 * headSize );
	}
}
