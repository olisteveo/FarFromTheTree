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
	public float MainAvenueStrength { get; set; } = 400f;

	[Property, Group( "Wind Strengths" ), Range( 50f, 1500f )]
	public float AlleyStrength { get; set; } = 250f;

	[Property, Group( "Wind Strengths" ), Range( 100f, 2000f )]
	public float EdgeStrength { get; set; } = 500f;

	[Property, Group( "Density" ), Range( 0f, 1f )]
	public float AlleyDensity { get; set; } = 1f;

	[Property, Group( "Density" )]
	public bool GenerateEdgeZones { get; set; } = true;

	[Property, Group( "Density" ), Range( 0.5f, 5f )]
	public float EdgeWidthMultiplier { get; set; } = 1.5f;

	/// <summary>
	/// Fraction of the cell that an alley zone covers. 1.0 means cells touch edge to edge,
	/// no gaps. Higher means cells overlap.
	/// </summary>
	[Property, Group( "Density" ), Range( 0.5f, 2f )]
	public float CellCoverage { get; set; } = 1.1f;

	[Property, Group( "Oscillation" ), Range( 0f, 1f )]
	public float OscillationChance { get; set; } = 0.4f;

	[Property, Group( "Oscillation" ), Range( 2f, 20f )]
	public float OscillationPeriod { get; set; } = 6f;

	[Property, Group( "Vertical Layer" ), Range( 0f, 500f )]
	public float StreetLevelZ { get; set; } = 150f;

	[Property, Group( "Vertical Layer" ), Range( 50f, 1000f )]
	public float StreetLayerHeight { get; set; } = 500f;

	[Property, Group( "Visualizer" )]
	public bool AddVisualizers { get; set; } = true;

	[Button( "Generate Wind Zones" )]
	public void Generate()
	{
		ClearGenerated();
		var random = new Random();
		var totalX = GridX * CellSpacing;
		var totalY = GridY * CellSpacing;

		// Edge zones — wide ribbons of wind along each side of the city
		if ( GenerateEdgeZones )
		{
			var edgeWidth = CellSpacing * EdgeWidthMultiplier;

			// North edge — wind blowing east along the top (oscillating)
			CreateZone( "Wind_Edge_North",
				localPos: new Vector3( totalX * 0.5f, totalY + edgeWidth * 0.5f - CellSpacing, StreetLevelZ ),
				size: new Vector3( totalX + edgeWidth, edgeWidth, StreetLayerHeight * 1.2f ),
				direction: new Vector3( 1, 0, 0 ),
				strength: EdgeStrength,
				oscillates: true,
				phase: 0f );

			// South edge — wind blowing west, opposite phase
			CreateZone( "Wind_Edge_South",
				localPos: new Vector3( totalX * 0.5f, -edgeWidth * 0.5f + CellSpacing, StreetLevelZ ),
				size: new Vector3( totalX + edgeWidth, edgeWidth, StreetLayerHeight * 1.2f ),
				direction: new Vector3( -1, 0, 0 ),
				strength: EdgeStrength,
				oscillates: true,
				phase: 180f );

			// East edge — wind blowing north
			CreateZone( "Wind_Edge_East",
				localPos: new Vector3( totalX + edgeWidth * 0.5f - CellSpacing, totalY * 0.5f, StreetLevelZ ),
				size: new Vector3( edgeWidth, totalY + edgeWidth, StreetLayerHeight * 1.2f ),
				direction: new Vector3( 0, 1, 0 ),
				strength: EdgeStrength,
				oscillates: true,
				phase: 90f );

			// West edge — wind blowing south
			CreateZone( "Wind_Edge_West",
				localPos: new Vector3( -edgeWidth * 0.5f + CellSpacing, totalY * 0.5f, StreetLevelZ ),
				size: new Vector3( edgeWidth, totalY + edgeWidth, StreetLayerHeight * 1.2f ),
				direction: new Vector3( 0, -1, 0 ),
				strength: EdgeStrength,
				oscillates: true,
				phase: 270f );
		}

		// Main E-W avenues (across each Nth row, full length)
		for ( int y = MainAvenueEvery; y < GridY; y += MainAvenueEvery )
		{
			CreateZone(
				name: $"Wind_AvenueEW_y{y}",
				localPos: new Vector3( totalX * 0.5f, y * CellSpacing, StreetLevelZ ),
				size: new Vector3( totalX * 0.95f, CellSpacing * 0.7f, StreetLayerHeight ),
				direction: new Vector3( 1, 0, 0 ),
				strength: MainAvenueStrength,
				oscillates: random.NextSingle() < OscillationChance,
				phase: random.NextSingle() * 360f
			);
		}

		// Main N-S avenues (across each Nth column, full length)
		for ( int x = MainAvenueEvery; x < GridX; x += MainAvenueEvery )
		{
			CreateZone(
				name: $"Wind_AvenueNS_x{x}",
				localPos: new Vector3( x * CellSpacing, totalY * 0.5f, StreetLevelZ ),
				size: new Vector3( CellSpacing * 0.7f, totalY * 0.95f, StreetLayerHeight ),
				direction: new Vector3( 0, 1, 0 ),
				strength: MainAvenueStrength,
				oscillates: random.NextSingle() < OscillationChance,
				phase: random.NextSingle() * 360f
			);
		}

		// Alley zones — random cells inside blocks, mixed directions
		for ( int x = 0; x < GridX; x++ )
		{
			for ( int y = 0; y < GridY; y++ )
			{
				// Skip cells that are on main avenues (already covered)
				if ( MainAvenueEvery > 1 && (x % MainAvenueEvery == 0 || y % MainAvenueEvery == 0) ) continue;
				if ( random.NextSingle() > AlleyDensity ) continue;

				var dx = 0;
				var dy = 0;
				var roll = random.NextSingle();
				if ( roll < 0.4f ) dx = 1;
				else if ( roll < 0.6f ) dx = -1;
				else if ( roll < 0.8f ) dy = 1;
				else dy = -1;

				CreateZone(
					name: $"Wind_Alley_{x}_{y}",
					localPos: new Vector3( x * CellSpacing, y * CellSpacing, StreetLevelZ ),
					size: new Vector3( CellSpacing * CellCoverage, CellSpacing * CellCoverage, StreetLayerHeight ),
					direction: new Vector3( dx, dy, 0 ),
					strength: AlleyStrength,
					oscillates: random.NextSingle() < OscillationChance,
					phase: random.NextSingle() * 360f
				);
			}
		}
	}

	private void CreateZone( string name, Vector3 localPos, Vector3 size, Vector3 direction,
		float strength, bool oscillates, float phase )
	{
		var go = new GameObject( true, name );
		go.SetParent( GameObject );
		go.LocalPosition = localPos;

		var box = go.Components.Create<BoxCollider>();
		box.IsTrigger = true;
		box.Scale = size;

		var wind = go.Components.Create<WindZone>();
		wind.Direction = direction;
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
