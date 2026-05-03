/// <summary>
/// Spawns flowing tracer particles inside a WindZone for visual feedback.
/// Attach to the same GameObject as the WindZone + BoxCollider.
///
/// Particles spawn at random positions in the box, drift along the wind
/// direction, and wrap around when they exit. Their speed scales with
/// the WindZone's Strength so you can see strong vs weak winds at a glance.
/// </summary>
public sealed class WindVisualizer : Component
{
	[Property] public WindZone Zone { get; set; }
	[Property] public BoxCollider Box { get; set; }

	[Property, Group( "Particles" ), Range( 5, 300 )]
	public int Count { get; set; } = 60;

	[Property, Group( "Particles" ), Range( 1f, 20f )]
	public float Size { get; set; } = 3f;

	[Property, Group( "Particles" )]
	public Color Color { get; set; } = new Color( 0.85f, 0.95f, 1f, 0.6f );

	[Property, Group( "Particles" ), Range( 0.1f, 50f )]
	public float SpeedMultiplier { get; set; } = 6f;

	[Property, Group( "Particles" ), Range( 0.5f, 10f )]
	public float StretchAlongFlow { get; set; } = 4f;

	private readonly List<GameObject> _particles = new();
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
	}

	private void SpawnParticles()
	{
		var dirLocal = Zone.Direction.Normal;
		var stretchScale = Vector3.One + (dirLocal * (StretchAlongFlow - 1f)).Abs();

		for ( int i = 0; i < Count; i++ )
		{
			var p = new GameObject( true, $"WindParticle_{i}" );
			p.SetParent( GameObject );
			p.LocalPosition = RandomLocalPos();
			p.LocalScale = stretchScale * (Size / 50f);

			var renderer = p.Components.Create<ModelRenderer>();
			renderer.Model = Model.Load( "models/dev/box.vmdl" );
			renderer.Tint = Color;

			_particles.Add( p );
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

		// Direction in local space (the GameObject's space)
		var dirLocal = Zone.Direction.Normal;
		var stepLocal = dirLocal * (SpeedMultiplier * Time.Delta * (Zone.Strength * 0.01f + 1f));

		foreach ( var p in _particles )
		{
			var newPos = p.LocalPosition + stepLocal;

			// Wrap around if outside box bounds
			if ( MathF.Abs( newPos.x ) > _boxHalf.x ||
				 MathF.Abs( newPos.y ) > _boxHalf.y ||
				 MathF.Abs( newPos.z ) > _boxHalf.z )
			{
				newPos = ResetToEntrySide( dirLocal );
			}

			p.LocalPosition = newPos;
		}
	}

	/// <summary>
	/// Place particle at the "upstream" side of the box so it can flow back through.
	/// </summary>
	private Vector3 ResetToEntrySide( Vector3 dir )
	{
		var absDir = new Vector3( MathF.Abs( dir.x ), MathF.Abs( dir.y ), MathF.Abs( dir.z ) );

		// Pick the dominant axis — the one wind primarily flows along
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
