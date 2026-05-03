/// <summary>
/// Editor tool — generates a maze-like city grid with main avenues, side alleys,
/// plazas, dead ends, and occasional landmark towers.
///
/// Drop on an empty GameObject, configure parameters, click "Generate Grid".
/// </summary>
public sealed class CityGridGenerator : Component
{
	[Property, Group( "Grid Size" ), Range( 1, 30 )]
	public int GridX { get; set; } = 20;

	[Property, Group( "Grid Size" ), Range( 1, 30 )]
	public int GridY { get; set; } = 20;

	[Property, Group( "Building Dimensions" ), Range( 20f, 500f )]
	public float BuildingSize { get; set; } = 120f;

	[Property, Group( "Building Dimensions" ), Range( 20f, 300f )]
	public float StreetWidth { get; set; } = 80f;

	[Property, Group( "Building Dimensions" ), Range( 50f, 1500f )]
	public float MinHeight { get; set; } = 400f;

	[Property, Group( "Building Dimensions" ), Range( 50f, 2000f )]
	public float MaxHeight { get; set; } = 1200f;

	[Property, Group( "Maze Layout" ), Range( 0, 10 )]
	public int MainAvenueEvery { get; set; } = 5;

	[Property, Group( "Maze Layout" ), Range( 0, 10 )]
	public int Plazas { get; set; } = 3;

	[Property, Group( "Maze Layout" ), Range( 0, 10 )]
	public int Landmarks { get; set; } = 2;

	[Property, Group( "Maze Layout" ), Range( 1f, 5f )]
	public float LandmarkHeightMultiplier { get; set; } = 2f;

	[Property, Group( "Maze Layout" ), Range( 0f, 0.5f )]
	public float SkipChance { get; set; } = 0.1f;

	[Property, Group( "Maze Layout" ), Range( 0f, 0.5f )]
	public float DeadEndBlockChance { get; set; } = 0.15f;

	[Property, Group( "Visuals" )]
	public Color BuildingTintMin { get; set; } = new Color( 0.35f, 0.35f, 0.4f );

	[Property, Group( "Visuals" )]
	public Color BuildingTintMax { get; set; } = new Color( 0.55f, 0.55f, 0.6f );

	[Button( "Generate Grid" )]
	public void Generate()
	{
		ClearGenerated();

		var spacing = BuildingSize + StreetWidth;
		var random = new Random();

		// Cell map: true = building, false = street
		var hasBuilding = new bool[GridX, GridY];
		for ( int x = 0; x < GridX; x++ )
			for ( int y = 0; y < GridY; y++ )
				hasBuilding[x, y] = true;

		// Carve main avenues every N cells (N-S and E-W)
		if ( MainAvenueEvery > 1 )
		{
			for ( int x = MainAvenueEvery; x < GridX; x += MainAvenueEvery )
				for ( int y = 0; y < GridY; y++ )
					hasBuilding[x, y] = false;

			for ( int y = MainAvenueEvery; y < GridY; y += MainAvenueEvery )
				for ( int x = 0; x < GridX; x++ )
					hasBuilding[x, y] = false;
		}

		// Place plazas (3x3 open spots) in random locations
		for ( int p = 0; p < Plazas; p++ )
		{
			var px = random.Next( 1, MathF.Max( 2, GridX - 3 ).FloorToInt() );
			var py = random.Next( 1, MathF.Max( 2, GridY - 3 ).FloorToInt() );
			for ( int dx = 0; dx < 3 && px + dx < GridX; dx++ )
				for ( int dy = 0; dy < 3 && py + dy < GridY; dy++ )
					hasBuilding[px + dx, py + dy] = false;
		}

		// Random skip — opens occasional cells inside blocks for organic feel
		for ( int x = 0; x < GridX; x++ )
		{
			for ( int y = 0; y < GridY; y++ )
			{
				if ( hasBuilding[x, y] && random.NextSingle() < SkipChance )
					hasBuilding[x, y] = false;
			}
		}

		// Dead-end blocking — fill in some street cells to create dead-end alleys.
		// Pick street cells adjacent to building blocks and turn them into buildings.
		for ( int x = 1; x < GridX - 1; x++ )
		{
			for ( int y = 1; y < GridY - 1; y++ )
			{
				if ( hasBuilding[x, y] ) continue;

				// Count surrounding buildings — if mostly surrounded, occasionally seal it
				int neighbours = 0;
				if ( hasBuilding[x - 1, y] ) neighbours++;
				if ( hasBuilding[x + 1, y] ) neighbours++;
				if ( hasBuilding[x, y - 1] ) neighbours++;
				if ( hasBuilding[x, y + 1] ) neighbours++;

				if ( neighbours >= 3 && random.NextSingle() < DeadEndBlockChance )
					hasBuilding[x, y] = true;
			}
		}

		// Place landmarks — pick random building cells and mark them tall
		var landmarkCells = new HashSet<(int, int)>();
		int attempts = 0;
		while ( landmarkCells.Count < Landmarks && attempts < 100 )
		{
			attempts++;
			var lx = random.Next( 0, GridX );
			var ly = random.Next( 0, GridY );
			if ( hasBuilding[lx, ly] ) landmarkCells.Add( (lx, ly) );
		}

		// Spawn the buildings
		for ( int x = 0; x < GridX; x++ )
		{
			for ( int y = 0; y < GridY; y++ )
			{
				if ( !hasBuilding[x, y] ) continue;

				var isLandmark = landmarkCells.Contains( (x, y) );
				var height = MinHeight + random.NextSingle() * (MaxHeight - MinHeight);
				if ( isLandmark ) height *= LandmarkHeightMultiplier;

				var building = new GameObject( true, $"Building_{x}_{y}{(isLandmark ? "_LANDMARK" : "")}" );
				building.SetParent( GameObject );
				building.WorldPosition = WorldPosition + new Vector3(
					x * spacing,
					y * spacing,
					height * 0.5f
				);

				building.WorldScale = new Vector3(
					BuildingSize / 50f,
					BuildingSize / 50f,
					height / 50f
				);

				var tint = isLandmark
					? new Color( 0.6f, 0.55f, 0.45f ) // warmer tint for landmarks
					: Color.Lerp( BuildingTintMin, BuildingTintMax, random.NextSingle() );

				var renderer = building.Components.Create<ModelRenderer>();
				renderer.Model = Model.Load( "models/dev/box.vmdl" );
				renderer.Tint = tint;

				building.Components.Create<BoxCollider>();
			}
		}
	}

	[Button( "Clear" )]
	public void ClearGenerated()
	{
		// Only clear children we spawned (named "Building_...")
		var children = GameObject.Children.Where( c => c.Name.StartsWith( "Building_" ) ).ToList();
		foreach ( var child in children )
		{
			child.Destroy();
		}
	}
}
