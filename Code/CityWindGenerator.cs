/// <summary>
/// Generates a grid of wind zones to populate a city. Main avenue zones run E-W
/// and N-S along the main streets. Alley zones fill smaller streets with mixed
/// directions and oscillation. Output: 20-40 zones depending on density.
///
/// Drop on a GameObject (typically the same one as CityGridGenerator), match the
/// grid parameters, click Generate.
/// </summary>
public sealed class CityWindGenerator : Component
{
	[Property, Group( "Grid Match" ), Range( 1, 30 )]
	public int GridX { get; set; } = 20;

	[Property, Group( "Grid Match" ), Range( 1, 30 )]
	public int GridY { get; set; } = 20;

	[Property, Group( "Grid Match" ), Range( 20f, 500f )]
	public float CellSpacing { get; set; } = 200f;

	[Property, Group( "Grid Match" ), Range( 1, 10 )]
	public int MainAvenueEvery { get; set; } = 5;

	[Property, Group( "Wind Strengths" ), Range( 100f, 2000f )]
	public float MainAvenueStrength { get; set; } = 800f;

	[Property, Group( "Wind Strengths" ), Range( 50f, 1500f )]
	public float AlleyStrength { get; set; } = 500f;

	[Property, Group( "Wind Strengths" ), Range( 100f, 2000f )]
	public float EdgeStrength { get; set; } = 500f;

	[Property, Group( "Density" ), Range( 0f, 1f )]
	public float AlleyDensity { get; set; } = 1f;

	[Property, Group( "Density" )]
	public bool GenerateEdgeZones { get; set; } = true;

	[Property, Group( "Density" ), Range( 0.5f, 8f )]
	public float EdgeWidthMultiplier { get; set; } = 3f;

	/// <summary>
	/// Fraction of the cell that an alley zone covers. 1.0 means cells touch edge to edge,
	/// no gaps. Higher means cells overlap.
	/// </summary>
	[Property, Group( "Density" ), Range( 0.5f, 3f )]
	public float CellCoverage { get; set; } = 1.6f;

	[Property, Group( "Oscillation" ), Range( 0f, 1f )]
	public float OscillationChance { get; set; } = 0.1f;

	[Property, Group( "Oscillation" ), Range( 2f, 20f )]
	public float OscillationPeriod { get; set; } = 6f;

	/// <summary>
	/// Direction the city wind generally flows. All alley zones bias toward this
	/// direction with some variation. Set to (1,0,0) for "everything flows east"
	/// — creates wind-tunnel corridors leading the player through the city.
	/// </summary>
	[Property, Group( "Flow Direction" )]
	public Vector3 PrimaryFlow { get; set; } = new Vector3( 1, 0, 0 );

	/// <summary>
	/// 0 = pure primary flow everywhere (boring but coherent).
	/// 1 = totally random per cell (chaotic, what we had before).
	/// 0.2-0.4 = mostly directional with some variation (recommended).
	/// </summary>
	[Property, Group( "Flow Direction" ), Range( 0f, 1f )]
	public float DirectionVariation { get; set; } = 0.15f;

	/// <summary>
	/// Seed for reproducible wind layout. Same seed = same wind every Generate.
	/// 0 means random each click.
	/// </summary>
	[Property, Group( "Flow Direction" )]
	public int Seed { get; set; } = 12345;

	[Property, Group( "Vertical Layer" ), Range( 0f, 1000f )]
	public float StreetLevelZ { get; set; } = 400f;

	[Property, Group( "Vertical Layer" ), Range( 50f, 3000f )]
	public float StreetLayerHeight { get; set; } = 1500f;

	/// <summary>
	/// Z-component added to every wind direction so all city wind has a gentle upward bias.
	/// Helps lift the leaf off the floor and keeps it airborne. 0.1-0.3 is subtle, 0.5+ pulls strongly up.
	/// </summary>
	[Property, Group( "Vertical Layer" ), Range( 0f, 1f )]
	public float UpwardBias { get; set; } = 0.2f;

	[Property, Group( "Rooftop Layer" )]
	public bool GenerateRooftopLayer { get; set; } = true;

	[Property, Group( "Rooftop Layer" ), Range( 200f, 3000f )]
	public float RooftopLevelZ { get; set; } = 1300f;

	[Property, Group( "Rooftop Layer" ), Range( 100f, 2000f )]
	public float RooftopLayerHeight { get; set; } = 800f;

	[Property, Group( "Rooftop Layer" ), Range( 100f, 2000f )]
	public float RooftopStrength { get; set; } = 600f;

	[Property, Group( "Visualizer" )]
	public bool AddVisualizers { get; set; } = true;

	[Button( "Generate Wind Zones" )]
	public void Generate()
	{
		ClearGenerated();
		var random = Seed != 0 ? new Random( Seed ) : new Random();
		var totalX = GridX * CellSpacing;
		var totalY = GridY * CellSpacing;

		// Edge zones — overlap at corners to ensure no leaf escapes the perimeter.
		// Each edge extends well beyond the city in both directions of its long axis,
		// so corners get covered by two zones at once.
		if ( GenerateEdgeZones )
		{
			var edgeWidth = CellSpacing * EdgeWidthMultiplier;
			var longAxis = MathF.Max( totalX, totalY ) + edgeWidth * 2f; // overshoot at both ends

			// All edges push the leaf BACK TOWARD CITY CENTER — corral effect.
			// North edge — pushes SOUTH (and slight east to keep flow going)
			CreateZone( "Wind_Edge_North",
				localPos: new Vector3( totalX * 0.5f, totalY + edgeWidth * 0.5f, StreetLevelZ ),
				size: new Vector3( longAxis, edgeWidth, StreetLayerHeight * 1.2f ),
				direction: new Vector3( 0.3f, -1, 0.3f ),
				strength: EdgeStrength,
				oscillates: false,
				phase: 0f );

			// South edge — pushes NORTH (and slight east)
			CreateZone( "Wind_Edge_South",
				localPos: new Vector3( totalX * 0.5f, -edgeWidth * 0.5f, StreetLevelZ ),
				size: new Vector3( longAxis, edgeWidth, StreetLayerHeight * 1.2f ),
				direction: new Vector3( 0.3f, 1, 0.3f ),
				strength: EdgeStrength,
				oscillates: false,
				phase: 0f );

			// West edge — pushes EAST (forward, into city)
			CreateZone( "Wind_Edge_West",
				localPos: new Vector3( -edgeWidth * 0.5f, totalY * 0.5f, StreetLevelZ ),
				size: new Vector3( edgeWidth, longAxis, StreetLayerHeight * 1.2f ),
				direction: new Vector3( 1, 0, 0.3f ),
				strength: EdgeStrength,
				oscillates: false,
				phase: 0f );

			// East edge — light west push (so leaf doesn't overshoot the destination)
			// but mostly soft, for "you're here" feel rather than blocking
			CreateZone( "Wind_Edge_East",
				localPos: new Vector3( totalX + edgeWidth * 0.5f, totalY * 0.5f, StreetLevelZ ),
				size: new Vector3( edgeWidth, longAxis, StreetLayerHeight * 1.2f ),
				direction: new Vector3( -0.3f, 0, 0.5f ),
				strength: EdgeStrength * 0.5f,
				oscillates: false,
				phase: 0f );

			// Corner pull-in zones — push leaves back toward city center if they wander out
			var cornerOffset = edgeWidth * 0.5f;
			var pullStrength = EdgeStrength * 1.2f;

			CreateZone( "Wind_Edge_NE",
				localPos: new Vector3( totalX + cornerOffset, totalY + cornerOffset, StreetLevelZ ),
				size: new Vector3( edgeWidth * 2f, edgeWidth * 2f, StreetLayerHeight * 1.2f ),
				direction: new Vector3( -1, -1, 0 ),
				strength: pullStrength,
				oscillates: false,
				phase: 0f );

			CreateZone( "Wind_Edge_NW",
				localPos: new Vector3( -cornerOffset, totalY + cornerOffset, StreetLevelZ ),
				size: new Vector3( edgeWidth * 2f, edgeWidth * 2f, StreetLayerHeight * 1.2f ),
				direction: new Vector3( 1, -1, 0 ),
				strength: pullStrength,
				oscillates: false,
				phase: 0f );

			CreateZone( "Wind_Edge_SE",
				localPos: new Vector3( totalX + cornerOffset, -cornerOffset, StreetLevelZ ),
				size: new Vector3( edgeWidth * 2f, edgeWidth * 2f, StreetLayerHeight * 1.2f ),
				direction: new Vector3( -1, 1, 0 ),
				strength: pullStrength,
				oscillates: false,
				phase: 0f );

			CreateZone( "Wind_Edge_SW",
				localPos: new Vector3( -cornerOffset, -cornerOffset, StreetLevelZ ),
				size: new Vector3( edgeWidth * 2f, edgeWidth * 2f, StreetLayerHeight * 1.2f ),
				direction: new Vector3( 1, 1, 0 ),
				strength: pullStrength,
				oscillates: false,
				phase: 0f );
		}

		// Main E-W avenues — pure east, no oscillation. Forgiving.
		for ( int y = MainAvenueEvery; y < GridY; y += MainAvenueEvery )
		{
			CreateZone(
				name: $"Wind_AvenueEW_y{y}",
				localPos: new Vector3( totalX * 0.5f, y * CellSpacing, StreetLevelZ ),
				size: new Vector3( totalX * 0.95f, CellSpacing * 0.7f, StreetLayerHeight ),
				direction: new Vector3( 1, 0, 0 ),
				strength: MainAvenueStrength,
				oscillates: false,
				phase: 0f
			);
		}

		// Main N-S avenues — biased east + slight northbound, no oscillation.
		// They contribute eastward force so they don't trap the leaf in a N-S oscillation.
		for ( int x = MainAvenueEvery; x < GridX; x += MainAvenueEvery )
		{
			CreateZone(
				name: $"Wind_AvenueNS_x{x}",
				localPos: new Vector3( x * CellSpacing, totalY * 0.5f, StreetLevelZ ),
				size: new Vector3( CellSpacing * 0.7f, totalY * 0.95f, StreetLayerHeight ),
				direction: new Vector3( 0.7f, 0.3f, 0 ),
				strength: MainAvenueStrength * 0.6f,
				oscillates: false,
				phase: 0f
			);
		}

		// Rooftop layer — full grid of wind zones above the buildings. Same density as
		// the street level but no building cells to skip (rooftops are open).
		if ( GenerateRooftopLayer )
		{
			SpawnRooftopGrid();
		}

		// Per-street wind zones — only place wind in STREET cells. ALL flow east toward
		// the destination (with slight up bias). Forgiving by design — no counter-currents
		// to get stuck in. Add complexity (north-flowing streets, oscillating zones, etc)
		// by hand-editing specific zones later.
		if ( MainAvenueEvery <= 1 ) return;

		for ( int x = 0; x < GridX; x++ )
		{
			for ( int y = 0; y < GridY; y++ )
			{
				bool onEW = y % MainAvenueEvery == 0;
				bool onNS = x % MainAvenueEvery == 0;

				if ( !onEW && !onNS ) continue; // building cell — no wind here

				// EVERY wind flows toward primary (east by default). Simple and forgiving.
				var dir = PrimaryFlow.Normal;

				CreateZone(
					name: $"Wind_Street_{x}_{y}",
					localPos: new Vector3( x * CellSpacing, y * CellSpacing, StreetLevelZ ),
					size: new Vector3( CellSpacing * CellCoverage, CellSpacing * CellCoverage, StreetLayerHeight ),
					direction: dir,
					strength: AlleyStrength,
					oscillates: false,
					phase: 0f
				);
			}
		}
	}

	private void CreateZone( string name, Vector3 localPos, Vector3 size, Vector3 direction,
		float strength, bool oscillates, float phase )
	{
		var go = new GameObject( true, name );
		go.SetParent( GameObject );

		// Compensate for any parent scale so wind zones operate in world units
		// regardless of how the parent GameObject is scaled.
		var ps = GameObject.WorldScale;
		go.LocalScale = new Vector3(
			ps.x != 0 ? 1f / ps.x : 1f,
			ps.y != 0 ? 1f / ps.y : 1f,
			ps.z != 0 ? 1f / ps.z : 1f
		);
		go.WorldPosition = GameObject.WorldPosition + localPos;

		var box = go.Components.Create<BoxCollider>();
		box.IsTrigger = true;
		box.Scale = size;

		var biasedDir = direction;
		if ( !name.Contains( "Edge" ) ) biasedDir = biasedDir + Vector3.Up * UpwardBias;

		var wind = go.Components.Create<WindZone>();
		wind.Direction = biasedDir;
		wind.Strength = strength;
		wind.RequireFirstLanding = true;
		wind.Oscillates = oscillates;
		wind.OscillationPeriod = OscillationPeriod;
		wind.PhaseOffsetDeg = phase;
		wind.Reverses = true;

		if ( AddVisualizers )
		{
			var vis = go.Components.Create<WindVisualizer>();
			vis.Zone = wind;
			vis.Box = box;
		}
	}

	[Button( "Clear" )]
	public void ClearGenerated()
	{
		// Only clear children we spawned (named "Wind_...")
		var children = GameObject.Children.Where( c => c.Name.StartsWith( "Wind_" ) ).ToList();
		foreach ( var c in children )
		{
			c.Destroy();
		}
	}

	/// <summary>
	/// Adds ONLY the rooftop layer zones without clearing the street zones.
	/// Use this after you've hand-tuned the street layer and want to layer rooftop wind on top.
	/// </summary>
	[Button( "Add Rooftop Layer Only" )]
	public void AddRooftopLayerOnly()
	{
		var existing = GameObject.Children.FirstOrDefault( c => c.Name.StartsWith( "Wind_Rooftop_" ) );
		if ( existing is not null )
		{
			Log.Info( "[CityWindGenerator] Rooftop zones already exist — use 'Clear Rooftop Only' first." );
			return;
		}

		SpawnRooftopGrid();
		Log.Info( "[CityWindGenerator] Rooftop layer added on top of existing zones." );
	}

	/// <summary>
	/// Internal: spawns the grid of rooftop wind zones. Same density as street level,
	/// every cell gets one, all flowing east.
	/// </summary>
	private void SpawnRooftopGrid()
	{
		for ( int x = 0; x < GridX; x++ )
		{
			for ( int y = 0; y < GridY; y++ )
			{
				CreateZone(
					name: $"Wind_Rooftop_{x}_{y}",
					localPos: new Vector3( x * CellSpacing, y * CellSpacing, RooftopLevelZ ),
					size: new Vector3( CellSpacing * CellCoverage, CellSpacing * CellCoverage, RooftopLayerHeight ),
					direction: new Vector3( 1, 0, 0 ),
					strength: RooftopStrength,
					oscillates: false,
					phase: 0f
				);
			}
		}
	}

	[Button( "Clear Rooftop Only" )]
	public void ClearRooftopOnly()
	{
		var children = GameObject.Children.Where( c => c.Name.StartsWith( "Wind_Rooftop_" ) ).ToList();
		foreach ( var c in children )
		{
			c.Destroy();
		}
	}

	/// <summary>
	/// Walks the entire scene and adds a WindVisualizer to every WindZone that doesn't
	/// already have one. Useful for retrofitting visualization onto manually placed zones.
	/// </summary>
	[Button( "Visualize All Wind Zones In Scene" )]
	public void VisualizeAllWindZones()
	{
		int added = 0;
		var allZones = Scene.GetAllComponents<WindZone>();
		foreach ( var zone in allZones )
		{
			var hasVis = zone.GameObject.Components.Get<WindVisualizer>();
			if ( hasVis is not null ) continue;

			var box = zone.GameObject.Components.Get<BoxCollider>();
			if ( box is null ) continue;

			var vis = zone.GameObject.Components.Create<WindVisualizer>();
			vis.Zone = zone;
			vis.Box = box;
			added++;
		}
		Log.Info( $"[CityWindGenerator] Added WindVisualizer to {added} zones" );
	}
}
