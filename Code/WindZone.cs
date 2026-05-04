public enum WindMode
{
	/// <summary>Classic uniform push along Direction.</summary>
	Directional,

	/// <summary>Mini tornado: tangential swirl around the zone's local Z axis with a slight up-pull.</summary>
	Tornado,

	/// <summary>Huff and puff: directional, but strength breathes between PulseMin and full Strength.</summary>
	Pulse,
}

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
	public WindMode Mode { get; set; } = WindMode.Directional;

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
	/// Used by Directional mode only.
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

	/// <summary>Tangential swirl strength multiplier. 1 = full Strength tangentially.</summary>
	[Property, Group( "Tornado" ), Range( 0f, 2f )]
	public float TornadoSwirl { get; set; } = 1f;

	/// <summary>How much the tornado pulls the leaf upward, as a fraction of Strength.</summary>
	[Property, Group( "Tornado" ), Range( 0f, 1f )]
	public float TornadoUpward { get; set; } = 0.25f;

	/// <summary>How much the tornado pulls the leaf toward its center, as a fraction of Strength.</summary>
	[Property, Group( "Tornado" ), Range( 0f, 1f )]
	public float TornadoInwardPull { get; set; } = 0.15f;

	/// <summary>Minimum strength multiplier during the "huff" (relax) part of the cycle. 0.3 = drops to 30%.</summary>
	[Property, Group( "Pulse" ), Range( 0f, 1f )]
	public float PulseMin { get; set; } = 0.3f;

	/// <summary>Seconds for one full huff+puff cycle.</summary>
	[Property, Group( "Pulse" ), Range( 0.3f, 10f )]
	public float PulsePeriod { get; set; } = 2.5f;

	private readonly HashSet<LeafController> _occupants = new();
	private float _oscTime;

	/// <summary>
	/// Representative force vector for visualizer / gizmo (no leaf position).
	/// For Tornado this returns a tangential reference at +X from center.
	/// </summary>
	public Vector3 CurrentForce
	{
		get
		{
			switch ( Mode )
			{
				case WindMode.Tornado:
				{
					var swirlDir = Vector3.Cross( Vector3.Up, Vector3.Right ).Normal; // = -Forward
					var f = swirlDir * (Strength * TornadoSwirl);
					f += Vector3.Up * (Strength * TornadoUpward);
					return f;
				}
				case WindMode.Pulse:
				{
					var worldDir = LocalDirection
						? WorldRotation * Direction.Normal
						: Direction.Normal;
					return worldDir * (Strength * ComputePulseMultiplier());
				}
				default:
				{
					var worldDir = LocalDirection
						? WorldRotation * Direction.Normal
						: Direction.Normal;
					var force = worldDir * Strength;
					if ( Oscillates ) force *= ComputeOscillationMultiplier();
					return force;
				}
			}
		}
	}

	[Button( "Flip Direction (180°)" )]
	public void FlipDirection()
	{
		Direction = -Direction;
	}

	[Button( "Rotate 90° CW (around Z)" )]
	public void RotateClockwise()
	{
		Direction = new Vector3( Direction.y, -Direction.x, Direction.z );
	}

	[Button( "Rotate 90° CCW (around Z)" )]
	public void RotateCounterClockwise()
	{
		Direction = new Vector3( -Direction.y, Direction.x, Direction.z );
	}

	private float ComputeOscillationMultiplier()
	{
		var phase = (_oscTime / OscillationPeriod) * MathF.PI * 2f
			+ (PhaseOffsetDeg * MathF.PI / 180f);
		var s = MathF.Sin( phase );
		return Reverses ? s : MathF.Max( 0f, s );
	}

	/// <summary>0..1 multiplier — sits at 1 most of the cycle, dips to PulseMin during the "huff".</summary>
	public float ComputePulseMultiplier()
	{
		// Cosine biased so the cycle spends ~70% near full strength and dips down briefly.
		var phase = (_oscTime / PulsePeriod) * MathF.PI * 2f;
		var raw = (MathF.Cos( phase ) + 1f) * 0.5f; // 0..1
		var shaped = MathF.Pow( raw, 0.4f );        // bias toward full
		return MathX.Lerp( PulseMin, 1f, shaped );
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

		foreach ( var leaf in _occupants )
		{
			if ( !leaf.IsValid ) continue;
			if ( RequireFirstLanding && !leaf.IsReadyForFirstWind ) continue;

			var force = ComputeForceFor( leaf.WorldPosition );
			if ( force.LengthSquared < 0.01f ) continue;
			leaf.AddWindForce( force );
		}
	}

	/// <summary>
	/// The force this zone applies to a leaf at the given world position.
	/// Tornado depends on position (tangential around center); Directional/Pulse don't.
	/// </summary>
	private Vector3 ComputeForceFor( Vector3 leafWorldPos )
	{
		switch ( Mode )
		{
			case WindMode.Tornado:
			{
				// Vector from zone center to leaf, projected onto horizontal plane.
				var toLeaf = (leafWorldPos - WorldPosition).WithZ( 0 );
				if ( toLeaf.LengthSquared < 1f )
				{
					// At the eye — small upward only, no swirl direction.
					return Vector3.Up * (Strength * TornadoUpward);
				}
				var radial = toLeaf.Normal;
				// Tangential = horizontal cross with up, gives counter-clockwise swirl viewed from above.
				var tangent = Vector3.Cross( Vector3.Up, radial ).Normal;
				var swirl = tangent * (Strength * TornadoSwirl);
				var lift = Vector3.Up * (Strength * TornadoUpward);
				var inward = -radial * (Strength * TornadoInwardPull);
				return swirl + lift + inward;
			}
			case WindMode.Pulse:
			{
				var worldDir = LocalDirection
					? WorldRotation * Direction.Normal
					: Direction.Normal;
				return worldDir * (Strength * ComputePulseMultiplier());
			}
			default:
			{
				var worldDir = LocalDirection
					? WorldRotation * Direction.Normal
					: Direction.Normal;
				var force = worldDir * Strength;
				if ( Oscillates ) force *= ComputeOscillationMultiplier();
				return force;
			}
		}
	}

	/// <summary>
	/// Editor gizmo: arrow / spiral / pulsing arrow depending on Mode.
	/// </summary>
	protected override void DrawGizmos()
	{
		if ( Strength <= 0.01f ) return;

		switch ( Mode )
		{
			case WindMode.Tornado:
				DrawTornadoGizmo();
				break;
			case WindMode.Pulse:
				DrawPulseGizmo();
				break;
			default:
				DrawDirectionalGizmo();
				break;
		}
	}

	private void DrawDirectionalGizmo()
	{
		var dir = LocalDirection ? Direction.Normal : (WorldRotation.Inverse * Direction.Normal);
		if ( dir.LengthSquared < 0.01f ) return;

		var arrowLength = (Strength * 0.5f).Clamp( 30f, 400f );
		var intensity = (Strength / 1500f).Clamp( 0.4f, 1f );

		var color = new Color( 0.4f, 0.85f, 1f, intensity );
		if ( Gizmo.IsHovered ) color = Color.Yellow;
		else if ( Gizmo.IsSelected ) color = new Color( 1f, 0.8f, 0.3f, 1f );

		Gizmo.Draw.Color = color;
		Gizmo.Draw.LineThickness = 1f + (Strength / 400f).Clamp( 0f, 4f );
		Gizmo.Draw.IgnoreDepth = true;

		var origin = Vector3.Zero;
		var tip = dir * arrowLength;

		Gizmo.Draw.Line( origin, tip );

		var up = MathF.Abs( dir.z ) < 0.95f ? Vector3.Up : Vector3.Right;
		var perp = Vector3.Cross( dir, up ).Normal;
		var perp2 = Vector3.Cross( dir, perp ).Normal;
		var headSize = arrowLength * 0.18f;

		Gizmo.Draw.Line( tip, tip - dir * headSize + perp * headSize );
		Gizmo.Draw.Line( tip, tip - dir * headSize - perp * headSize );
		Gizmo.Draw.Line( tip, tip - dir * headSize + perp2 * headSize );
		Gizmo.Draw.Line( tip, tip - dir * headSize - perp2 * headSize );

		var halfThickness = 8f + (Strength / 400f).Clamp( 0f, 8f );
		var pad = new Vector3( halfThickness, halfThickness, halfThickness );
		var minPt = Vector3.Min( origin, tip ) - pad;
		var maxPt = Vector3.Max( origin, tip ) + pad;
		Gizmo.Hitbox.BBox( new BBox( minPt, maxPt ) );
	}

	/// <summary>Spiral coil + central up-arrow. Larger / brighter with Strength.</summary>
	private void DrawTornadoGizmo()
	{
		var intensity = (Strength / 1500f).Clamp( 0.4f, 1f );
		var color = new Color( 0.6f, 0.5f, 1f, intensity ); // purple to differentiate
		if ( Gizmo.IsHovered ) color = Color.Yellow;
		else if ( Gizmo.IsSelected ) color = new Color( 1f, 0.8f, 0.3f, 1f );

		Gizmo.Draw.Color = color;
		Gizmo.Draw.LineThickness = 1.5f + (Strength / 500f).Clamp( 0f, 3f );
		Gizmo.Draw.IgnoreDepth = true;

		// Funnel size — radius and height scale with strength
		var radiusBase = (Strength * 0.08f).Clamp( 30f, 200f );
		var height = (Strength * 0.2f).Clamp( 60f, 400f );
		const int turns = 3;
		const int segmentsPerTurn = 24;
		int totalSegments = turns * segmentsPerTurn;

		// Funnel widens upward from a small point
		Vector3 prev = Vector3.Zero;
		for ( int i = 1; i <= totalSegments; i++ )
		{
			float t = (float)i / totalSegments;
			float angle = t * turns * MathF.PI * 2f;
			float r = MathX.Lerp( radiusBase * 0.2f, radiusBase, t );
			float h = t * height;
			var p = new Vector3( MathF.Cos( angle ) * r, MathF.Sin( angle ) * r, h );
			Gizmo.Draw.Line( prev, p );
			prev = p;
		}

		// Central up-arrow — shows the lift component
		Gizmo.Draw.Line( Vector3.Zero, Vector3.Up * height );
		var tipUp = Vector3.Up * height;
		var headSize = height * 0.08f;
		Gizmo.Draw.Line( tipUp, tipUp - Vector3.Up * headSize + Vector3.Right * headSize );
		Gizmo.Draw.Line( tipUp, tipUp - Vector3.Up * headSize - Vector3.Right * headSize );
		Gizmo.Draw.Line( tipUp, tipUp - Vector3.Up * headSize + Vector3.Forward * headSize );
		Gizmo.Draw.Line( tipUp, tipUp - Vector3.Up * headSize - Vector3.Forward * headSize );

		// Clickable hitbox: cylindrical-ish bounding box
		var pad = new Vector3( radiusBase, radiusBase, height * 0.5f );
		var center = Vector3.Up * (height * 0.5f);
		Gizmo.Hitbox.BBox( new BBox( center - pad, center + pad ) );
	}

	/// <summary>Same arrow as Directional but length pulses in real-time with the breath cycle.</summary>
	private void DrawPulseGizmo()
	{
		var dir = LocalDirection ? Direction.Normal : (WorldRotation.Inverse * Direction.Normal);
		if ( dir.LengthSquared < 0.01f ) return;

		var pulse = ComputePulseMultiplier(); // 0..1, bias toward 1
		var baseLength = (Strength * 0.5f).Clamp( 30f, 400f );
		var arrowLength = baseLength * MathX.Lerp( 0.5f, 1f, pulse );
		var intensity = (Strength / 1500f).Clamp( 0.4f, 1f ) * MathX.Lerp( 0.5f, 1f, pulse );

		var color = new Color( 0.4f, 1f, 0.7f, intensity ); // green-cyan to differentiate
		if ( Gizmo.IsHovered ) color = Color.Yellow;
		else if ( Gizmo.IsSelected ) color = new Color( 1f, 0.8f, 0.3f, 1f );

		Gizmo.Draw.Color = color;
		Gizmo.Draw.LineThickness = (1f + (Strength / 400f).Clamp( 0f, 4f )) * MathX.Lerp( 0.5f, 1f, pulse );
		Gizmo.Draw.IgnoreDepth = true;

		var origin = Vector3.Zero;
		var tip = dir * arrowLength;

		Gizmo.Draw.Line( origin, tip );

		var up = MathF.Abs( dir.z ) < 0.95f ? Vector3.Up : Vector3.Right;
		var perp = Vector3.Cross( dir, up ).Normal;
		var perp2 = Vector3.Cross( dir, perp ).Normal;
		var headSize = arrowLength * 0.18f;

		Gizmo.Draw.Line( tip, tip - dir * headSize + perp * headSize );
		Gizmo.Draw.Line( tip, tip - dir * headSize - perp * headSize );
		Gizmo.Draw.Line( tip, tip - dir * headSize + perp2 * headSize );
		Gizmo.Draw.Line( tip, tip - dir * headSize - perp2 * headSize );

		// Concentric ring at the origin to suggest a "huff" — radius pulses too
		var ringR = baseLength * 0.15f * MathX.Lerp( 0.4f, 1f, 1f - pulse );
		const int ringSegs = 16;
		Vector3 prevRing = new Vector3( ringR, 0, 0 );
		for ( int i = 1; i <= ringSegs; i++ )
		{
			float a = (float)i / ringSegs * MathF.PI * 2f;
			var p = new Vector3( MathF.Cos( a ) * ringR, MathF.Sin( a ) * ringR, 0 );
			Gizmo.Draw.Line( prevRing, p );
			prevRing = p;
		}

		var halfThickness = 8f + (Strength / 400f).Clamp( 0f, 8f );
		var pad = new Vector3( halfThickness, halfThickness, halfThickness );
		var minPt = Vector3.Min( origin, dir * baseLength ) - pad;
		var maxPt = Vector3.Max( origin, dir * baseLength ) + pad;
		Gizmo.Hitbox.BBox( new BBox( minPt, maxPt ) );
	}
}
