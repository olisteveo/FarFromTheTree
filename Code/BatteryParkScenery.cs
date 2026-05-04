/// <summary>
/// Spawns the Battery Park backdrop: a sea on one side, a stylised Statue of Liberty
/// silhouette behind the player, and a grass patch around the tree.
///
/// Drop on an empty GameObject near the tree, configure offsets, click Generate.
/// </summary>
public sealed class BatteryParkScenery : Component
{
	[Property, Group( "Sea" ), Range( 100f, 5000f )]
	public float SeaSize { get; set; } = 3000f;

	[Property, Group( "Sea" )]
	public Vector3 SeaOffset { get; set; } = new Vector3( 0, -1200, -10 );

	[Property, Group( "Sea" )]
	public Color SeaColor { get; set; } = new Color( 0.15f, 0.35f, 0.55f );

	[Property, Group( "Statue" )]
	public Vector3 StatueOffset { get; set; } = new Vector3( -1500, -800, 0 );

	[Property, Group( "Statue" ), Range( 100f, 1500f )]
	public float StatueHeight { get; set; } = 600f;

	[Property, Group( "Statue" )]
	public Color StatueColor { get; set; } = new Color( 0.55f, 0.65f, 0.6f );

	[Property, Group( "Grass" ), Range( 100f, 2000f )]
	public float GrassSize { get; set; } = 600f;

	[Property, Group( "Grass" )]
	public Vector3 GrassOffset { get; set; } = new Vector3( 0, 0, 1 );

	[Property, Group( "Grass" )]
	public Color GrassColor { get; set; } = new Color( 0.4f, 0.55f, 0.3f );

	[Button( "Generate Battery Park Scenery" )]
	public void Generate()
	{
		ClearGenerated();

		// Sea — big flat blue plane
		Spawn( "BatteryPark_Sea",
			SeaOffset,
			new Vector3( SeaSize, SeaSize, 4f ),
			SeaColor,
			"models/dev/box.vmdl" );

		// Statue silhouette — tall narrow pillar behind/west
		Spawn( "BatteryPark_Statue",
			StatueOffset + new Vector3( 0, 0, StatueHeight * 0.5f ),
			new Vector3( 60f, 60f, StatueHeight ),
			StatueColor,
			"models/dev/box.vmdl" );

		// Statue base — wider plinth at the bottom
		Spawn( "BatteryPark_StatueBase",
			StatueOffset + new Vector3( 0, 0, 30f ),
			new Vector3( 200f, 200f, 60f ),
			StatueColor * 0.8f,
			"models/dev/box.vmdl" );

		// Grass patch under the tree
		Spawn( "BatteryPark_Grass",
			GrassOffset,
			new Vector3( GrassSize, GrassSize, 2f ),
			GrassColor,
			"models/dev/box.vmdl" );
	}

	private void Spawn( string name, Vector3 localOffset, Vector3 size, Color tint, string modelPath )
	{
		var go = new GameObject( true, name );
		go.SetParent( GameObject );

		// Compensate for parent scale so size is in world units
		var ps = GameObject.WorldScale;
		go.LocalScale = new Vector3(
			ps.x != 0 ? size.x / 50f / ps.x : size.x / 50f,
			ps.y != 0 ? size.y / 50f / ps.y : size.y / 50f,
			ps.z != 0 ? size.z / 50f / ps.z : size.z / 50f
		);
		go.WorldPosition = GameObject.WorldPosition + localOffset;

		var renderer = go.Components.Create<ModelRenderer>();
		renderer.Model = Model.Load( modelPath );
		renderer.Tint = tint;

		go.Components.Create<BoxCollider>();
	}

	[Button( "Clear" )]
	public void ClearGenerated()
	{
		var children = GameObject.Children
			.Where( c => c.Name.StartsWith( "BatteryPark_" ) )
			.ToList();
		foreach ( var c in children )
		{
			c.Destroy();
		}
	}
}
