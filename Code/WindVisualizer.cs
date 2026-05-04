/// <summary>
/// Spawns flowing tracer particles inside a WindZone for visual feedback.
/// Attach to the same GameObject as the WindZone + BoxCollider.
///
/// Visual matches the WindZone.Mode:
///   Directional — particles drift along Direction, wrap on exit.
///   Tornado     — particles orbit around the local Z axis, drifting upward.
///   Pulse       — same as Directional but speed + opacity breathe with the pulse cycle.
/// </summary>
public sealed class WindVisualizer : Component
{
	[Property] public WindZone Zone { get; set; }
	[Property] public BoxCollider Box { get; set; }

	[Property, Group( "Particles" ), Range( 5, 500 )]
	public int Count { get; set; } = 120;

	[Property, Group( "Particles" ), Range( 0.2f, 10f )]
	public float Thickness { get; set; } = 0.6f;

	[Property, Group( "Particles" ), Range( 5f, 80f )]
	public float Length { get; set; } = 25f;

	[Property, Group( "Particles" )]
	public Color Color { get; set; } = new Color( 1f, 1f, 1f, 0.45f );

	[Property, Group( "Particles" ), Range( 0.1f, 50f )]
	public float SpeedMultiplier { get; set; } = 8f;

	private readonly List<GameObject> _particles = new();
	private readonly List<ModelRenderer> _renderers = new();
	private Vector3 _boxHalf;

	protected override void OnAwake()
	{
		Zone ??= GetComponent<WindZone>();
		Box ??= GetComponent<BoxCollider>();
	}

	protected override void OnStart()
	{
		if ( Box is null || Zone is null ) return;
		_boxHalf = Box.Scale * 0.5f;
		SpawnParticles();
	}

	protected override void OnDestroy()
	{
		foreach ( var p in _particles )
		{
			if ( p.IsValid() ) p.Destroy();
		}
		_particles.Clear();
		_renderers.Clear();
	}

	private void SpawnParticles()
	{
		var thicknessScale = Thickness / 50f;
		var lengthScale = Length / 50f;
		var streakScale = new Vector3( lengthScale, thicknessScale, thicknessScale );

		for ( int i = 0; i < Count; i++ )
		{
			var p = new GameObject( true, $"WindStreak_{i}" );
			p.SetParent( GameObject );
			p.LocalPosition = RandomLocalPos();
			p.LocalScale = streakScale;

			var renderer = p.Components.Create<ModelRenderer>();
			renderer.Model = Model.Load( "models/dev/box.vmdl" );
			renderer.Tint = Color;

			_particles.Add( p );
			_renderers.Add( renderer );
		}
	}

	private Vector3 RandomLocalPos()
	{
		return new Vector3(
			Game.Random.Float( -_boxHalf.x, _boxHalf.x ),
			Game.Random.Float( -_boxHalf.y, _boxHalf.y ),
			Game.Random.Float( -_boxHalf.z, _boxHalf.z )
		);
	}

	protected override void OnUpdate()
	{
		if ( Zone is null || Box is null || _particles.Count == 0 ) return;

		switch ( Zone.Mode )
		{
			case WindMode.Tornado:
				UpdateTornado();
				break;
			case WindMode.Pulse:
				UpdatePulse();
				break;
			default:
				UpdateDirectional();
				break;
		}
	}

	private void UpdateDirectional()
	{
		var dirLocal = Zone.Direction.Normal;
		var step = dirLocal * (SpeedMultiplier * Time.Delta * (Zone.Strength * 0.01f + 1f));

		for ( int i = 0; i < _particles.Count; i++ )
		{
			var p = _particles[i];
			var newPos = p.LocalPosition + step;

			if ( OutOfBounds( newPos ) )
				newPos = ResetToEntrySide( dirLocal );

			p.LocalPosition = newPos;
			p.LocalRotation = Rotation.LookAt( dirLocal );
		}
	}

	private void UpdatePulse()
	{
		var dirLocal = Zone.Direction.Normal;
		var pulse = Zone.ComputePulseMultiplier();
		var step = dirLocal * (SpeedMultiplier * Time.Delta * (Zone.Strength * 0.01f + 1f) * MathX.Lerp( 0.2f, 1f, pulse ));
		var alpha = Color.a * MathX.Lerp( 0.4f, 1f, pulse );

		for ( int i = 0; i < _particles.Count; i++ )
		{
			var p = _particles[i];
			var newPos = p.LocalPosition + step;

			if ( OutOfBounds( newPos ) )
				newPos = ResetToEntrySide( dirLocal );

			p.LocalPosition = newPos;
			p.LocalRotation = Rotation.LookAt( dirLocal );

			var tint = Color;
			tint.a = alpha;
			_renderers[i].Tint = tint;
		}
	}

	private void UpdateTornado()
	{
		// Orbit around the local Z axis, drifting upward over time.
		float angularSpeed = (Zone.Strength * 0.001f + 0.5f) * Zone.TornadoSwirl; // rad/sec
		float upSpeed = (Zone.Strength * 0.01f) * Zone.TornadoUpward;

		for ( int i = 0; i < _particles.Count; i++ )
		{
			var p = _particles[i];
			var pos = p.LocalPosition;

			// Polar coords on XY plane
			float r = MathF.Sqrt( pos.x * pos.x + pos.y * pos.y );
			float a = MathF.Atan2( pos.y, pos.x );
			a += angularSpeed * Time.Delta;
			float newX = MathF.Cos( a ) * r;
			float newY = MathF.Sin( a ) * r;
			float newZ = pos.z + upSpeed * Time.Delta;

			// Wrap upward → reseed at bottom near a fresh radius
			if ( newZ > _boxHalf.z )
			{
				newZ = -_boxHalf.z;
				r = Game.Random.Float( 0f, MathF.Min( _boxHalf.x, _boxHalf.y ) );
				a = Game.Random.Float( 0f, MathF.PI * 2f );
				newX = MathF.Cos( a ) * r;
				newY = MathF.Sin( a ) * r;
			}

			p.LocalPosition = new Vector3( newX, newY, newZ );

			// Orient particle along its tangential motion
			var tangent = new Vector3( -MathF.Sin( a ), MathF.Cos( a ), 0 );
			p.LocalRotation = Rotation.LookAt( tangent );
		}
	}

	private bool OutOfBounds( Vector3 p )
	{
		return MathF.Abs( p.x ) > _boxHalf.x
			|| MathF.Abs( p.y ) > _boxHalf.y
			|| MathF.Abs( p.z ) > _boxHalf.z;
	}

	/// <summary>
	/// Place particle at the "upstream" side of the box so it can flow back through.
	/// </summary>
	private Vector3 ResetToEntrySide( Vector3 dir )
	{
		var absDir = new Vector3( MathF.Abs( dir.x ), MathF.Abs( dir.y ), MathF.Abs( dir.z ) );

		if ( absDir.x >= absDir.y && absDir.x >= absDir.z )
		{
			return new Vector3(
				dir.x > 0 ? -_boxHalf.x : _boxHalf.x,
				Game.Random.Float( -_boxHalf.y, _boxHalf.y ),
				Game.Random.Float( -_boxHalf.z, _boxHalf.z )
			);
		}
		if ( absDir.y >= absDir.z )
		{
			return new Vector3(
				Game.Random.Float( -_boxHalf.x, _boxHalf.x ),
				dir.y > 0 ? -_boxHalf.y : _boxHalf.y,
				Game.Random.Float( -_boxHalf.z, _boxHalf.z )
			);
		}
		return new Vector3(
			Game.Random.Float( -_boxHalf.x, _boxHalf.x ),
			Game.Random.Float( -_boxHalf.y, _boxHalf.y ),
			dir.z > 0 ? -_boxHalf.z : _boxHalf.z
		);
	}
}
