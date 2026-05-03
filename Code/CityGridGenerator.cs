/// <summary>
/// Editor tool — generates a grid of cube "buildings" with streets between them.
/// Drop on an empty GameObject, configure size, click Generate.
///
/// Each cube becomes a building with ModelRenderer + BoxCollider. Streets are the
/// gaps between buildings. Replace cubes with NYC building models later — the
/// grid topology stays the same.
/// </summary>
public sealed class CityGridGenerator : Component
{
	[Property, Group( "Grid Size" ), Range( 1, 30 )]
	public int GridX { get; set; } = 8;

	[Property, Group( "Grid Size" ), Range( 1, 30 )]
	public int GridY { get; set; } = 8;

	[Property, Group( "Building Dimensions" ), Range( 20f, 500f )]
	public float BuildingSize { get; set; } = 120f;

	[Property, Group( "Building Dimensions" ), Range( 20f, 300f )]
	public float StreetWidth { get; set; } = 80f;

	[Property, Group( "Building Dimensions" ), Range( 50f, 1500f )]
	public float MinHeight { get; set; } = 200f;

	[Property, Group( "Building Dimensions" ), Range( 50f, 2000f )]
	public float MaxHeight { get; set; } = 500f;

	[Property, Group( "Visuals" )]
	public Color BuildingTintMin { get; set; } = new Color( 0.35f, 0.35f, 0.4f );

	[Property, Group( "Visuals" )]
	public Color BuildingTintMax { get; set; } = new Color( 0.55f, 0.55f, 0.6f );

	[Property, Group( "Layout" ), Range( 0f, 1f )]
	public float SkipChance { get; set; } = 0.15f;

	[Button( "Generate Grid" )]
	public void Generate()
	{
		ClearGenerated();

		var spacing = BuildingSize + StreetWidth;
		var random = new Random();

		for ( int x = 0; x < GridX; x++ )
		{
			for ( int y = 0; y < GridY; y++ )
			{
				if ( random.NextSingle() < SkipChance ) continue;

				var height = MinHeight + (float)random.NextDouble() * (MaxHeight - MinHeight);

				var building = new GameObject( true, $"Building_{x}_{y}" );
				building.SetParent( GameObject );
				building.WorldPosition = WorldPosition + new Vector3(
					x * spacing,
					y * spacing,
					height * 0.5f
				);

				// dev/box.vmdl has unit size 50 — scale to get actual size
				building.WorldScale = new Vector3(
					BuildingSize / 50f,
					BuildingSize / 50f,
					height / 50f
				);

				var tint = Color.Lerp( BuildingTintMin, BuildingTintMax, random.NextSingle() );

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
		var children = GameObject.Children.ToList();
		foreach ( var child in children )
		{
			child.Destroy();
		}
	}
}
