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

	[Property, Group( "Density" ), Range( 0f, 1f )]
	public float AlleyDensity { get; set; } = 0.15f;

	[Property, Group( "Oscillation" ), Range( 0f, 1f )]
	public float OscillationChance { get; set; } = 0.4f;

	[Property, Group( "Oscillation" ), Range( 2f, 20f )]
	public float OscillationPeriod { get; set; } = 6f;

	[Property, Group( "Vertical Layer" ), Range( 0f, 200f )]
	public float StreetLevelZ { get; set; } = 80f;

	[Property, Group( "Vertical Layer" ), Range( 50f, 500f )]
	public float StreetLayerHeight { get; set; } = 200f;

	[Property, Group( "Visualizer" )]
	public bool AddVisualizers { get; set; } = true;

	[Button( "Generate Wind Zones" )]
	public void Generate()
	{
		ClearGenerated();
		var random = new Random();
		var totalX = GridX * CellSpacing;
		var totalY = GridY * CellSpacing;

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
					size: new Vector3( CellSpacing * 0.6f, CellSpacing * 0.6f, StreetLayerHeight * 0.7f ),
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
		var children = GameObject.Children.ToList();
		foreach ( var c in children )
		{
			c.Destroy();
		}
	}
}
