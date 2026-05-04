/// <summary>
/// Trigger volume that fails the run when the leaf enters it.
/// Attach to a GameObject with a BoxCollider that has IsTrigger = true.
///
/// Click "Generate Sea Visual" to auto-spawn a tinted water mass that exactly
/// fills the BoxCollider, so the death zone is visible in-game (the editor
/// gizmo is editor-only). Re-run the button after resizing the BoxCollider.
/// </summary>
public sealed class DeathZone : Component, Component.ITriggerListener
{
	[Property]
	public string FailReason { get; set; } = "Lost in the river";

	[Property, Group( "Visual" )]
	public Color WaterColor { get; set; } = new Color( 0.10f, 0.28f, 0.55f );

	[Property, Group( "Visual" )]
	public Color SurfaceColor { get; set; } = new Color( 0.30f, 0.55f, 0.85f );

	[Property, Group( "Visual" ), Range( 1f, 30f )]
	public float SurfaceThickness { get; set; } = 6f;

	void Component.ITriggerListener.OnTriggerEnter( Collider other )
	{
		var leaf = other.GameObject.Components.Get<LeafController>();
		if ( leaf is null ) return;
		leaf.FailRun( FailReason );
	}

	void Component.ITriggerListener.OnTriggerExit( Collider other )
	{
		// no-op — failure is one-way
	}

	[Button( "Generate Sea Visual" )]
	public void GenerateVisual()
	{
		ClearVisual();

		var box = GetComponent<BoxCollider>();
		if ( box is null )
		{
			Log.Warning( "[DeathZone] No BoxCollider — add one before generating the sea visual." );
			return;
		}

		var ps = GameObject.WorldScale;

		// Main water body — opaque box filling the entire trigger volume
		SpawnChild(
			name: "DeathZone_Water",
			localPos: box.Center,
			size: box.Scale,
			tint: WaterColor,
			parentScale: ps );

		// Bright surface slab sitting on top — gives a visible "shoreline" cue
		var surfaceSize = new Vector3( box.Scale.x, box.Scale.y, SurfaceThickness );
		var surfaceCenter = box.Center + new Vector3( 0, 0, (box.Scale.z * 0.5f) - (SurfaceThickness * 0.5f) );
		SpawnChild(
			name: "DeathZone_Surface",
			localPos: surfaceCenter,
			size: surfaceSize,
			tint: SurfaceColor,
			parentScale: ps );
	}

	[Button( "Clear Visual" )]
	public void ClearVisual()
	{
		var children = GameObject.Children
			.Where( c => c.Name.StartsWith( "DeathZone_" ) )
			.ToList();
		foreach ( var c in children )
		{
			c.Destroy();
		}
	}

	private void SpawnChild( string name, Vector3 localPos, Vector3 size, Color tint, Vector3 parentScale )
	{
		var go = new GameObject( true, name );
		go.SetParent( GameObject );

		// Compensate for parent scale so the visual lands at world-unit size
		go.LocalScale = new Vector3(
			parentScale.x != 0 ? size.x / 50f / parentScale.x : size.x / 50f,
			parentScale.y != 0 ? size.y / 50f / parentScale.y : size.y / 50f,
			parentScale.z != 0 ? size.z / 50f / parentScale.z : size.z / 50f
		);
		go.LocalPosition = localPos;

		var renderer = go.Components.Create<ModelRenderer>();
		renderer.Model = Model.Load( "models/dev/box.vmdl" );
		renderer.Tint = tint;
	}

	protected override void DrawGizmos()
	{
		var box = GetComponent<BoxCollider>();
		if ( box is null ) return;

		var half = box.Scale * 0.5f;
		var min = box.Center - half;
		var max = box.Center + half;

		var fill = new Color( 0.12f, 0.32f, 0.55f, 0.18f );
		var edge = new Color( 0.35f, 0.65f, 0.95f, 0.85f );
		if ( Gizmo.IsHovered ) edge = Color.Yellow;
		else if ( Gizmo.IsSelected ) edge = new Color( 1f, 0.8f, 0.3f, 1f );

		Gizmo.Draw.IgnoreDepth = true;

		Gizmo.Draw.Color = edge;
		Gizmo.Draw.LineThickness = 2f;
		Gizmo.Draw.LineBBox( new BBox( min, max ) );

		Gizmo.Draw.Color = fill;
		Gizmo.Draw.SolidBox( new BBox( min, max ) );

		Gizmo.Draw.Color = new Color( 0.55f, 0.82f, 1f, 0.55f );
		Gizmo.Draw.LineThickness = 1f;
		float topZ = max.z;
		int lines = 6;
		for ( int i = 1; i < lines; i++ )
		{
			float t = (float)i / lines;
			float y = MathX.Lerp( min.y, max.y, t );
			Gizmo.Draw.Line( new Vector3( min.x, y, topZ ), new Vector3( max.x, y, topZ ) );
		}

		var center = (min + max) * 0.5f;
		Gizmo.Draw.Color = new Color( 1f, 0.4f, 0.4f, 0.9f );
		Gizmo.Draw.LineThickness = 3f;
		float r = MathF.Min( half.x, MathF.Min( half.y, half.z ) ) * 0.18f;
		Gizmo.Draw.Line( center + new Vector3( -r, -r, 0 ), center + new Vector3( r, r, 0 ) );
		Gizmo.Draw.Line( center + new Vector3( -r, r, 0 ), center + new Vector3( r, -r, 0 ) );

		Gizmo.Hitbox.BBox( new BBox( min, max ) );
	}
}
