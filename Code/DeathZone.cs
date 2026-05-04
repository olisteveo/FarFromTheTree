/// <summary>
/// Trigger volume that fails the run when the leaf enters it.
///
/// Drop on an empty GameObject and click "Setup Sea Zone" — that creates a
/// BoxCollider (IsTrigger=true) with a sensible default size, generates the
/// in-game blue water mass, and you can resize the collider freely from
/// there. The editor gizmo shows a solid blue volume even before setup so
/// you can see where it's going to be.
/// </summary>
public sealed class DeathZone : Component, Component.ITriggerListener
{
	[Property]
	public string FailReason { get; set; } = "Lost in the river";

	/// <summary>
	/// Default size used when "Setup Sea Zone" creates a fresh BoxCollider, AND
	/// fallback size used by the editor gizmo when no BoxCollider exists yet.
	/// </summary>
	[Property, Group( "Size" )]
	public Vector3 DefaultSize { get; set; } = new Vector3( 2000f, 800f, 200f );

	[Property, Group( "Visual" )]
	public Color WaterColor { get; set; } = new Color( 0.10f, 0.28f, 0.55f );

	[Property, Group( "Visual" )]
	public Color SurfaceColor { get; set; } = new Color( 0.30f, 0.55f, 0.85f );

	[Property, Group( "Visual" ), Range( 1f, 30f )]
	public float SurfaceThickness { get; set; } = 6f;

	protected override void OnAwake()
	{
		var ls = GameObject.LocalScale;
		var box = GetComponent<BoxCollider>();

		// If LocalScale has any zero axis (or is non-(1,1,1) non-uniform), bake
		// it into the BoxCollider.Scale BEFORE snapping LocalScale to (1,1,1).
		// Otherwise the in-game zone ends up at LocalScale x BoxCollider.Scale =
		// 1x default = much smaller than what was visible in the editor with the
		// old scaled transform.
		bool hasBadAxis = ls.x < 0.01f || ls.y < 0.01f || ls.z < 0.01f;
		bool nonUnit    = MathF.Abs( ls.x - 1f ) > 0.01f
		               || MathF.Abs( ls.y - 1f ) > 0.01f
		               || MathF.Abs( ls.z - 1f ) > 0.01f;

		if ( (hasBadAxis || nonUnit) && box is not null )
		{
			// Bake non-zero axes into BoxCollider.Scale; for zero axes, leave the
			// existing BoxCollider value (so trigger has reasonable extent there).
			var newScale = new Vector3(
				ls.x > 0.01f ? box.Scale.x * ls.x : box.Scale.x,
				ls.y > 0.01f ? box.Scale.y * ls.y : box.Scale.y,
				ls.z > 0.01f ? box.Scale.z * ls.z : box.Scale.z
			);
			Log.Info( $"[DeathZone] '{GameObject.Name}' LocalScale {ls} baked into BoxCollider.Scale (was {box.Scale}, now {newScale}). LocalScale -> (1,1,1)." );
			box.Scale = newScale;
			GameObject.LocalScale = new Vector3( 1f, 1f, 1f );
		}
		else if ( hasBadAxis )
		{
			Log.Warning( $"[DeathZone] '{GameObject.Name}' had zero/near-zero LocalScale {ls} but no BoxCollider yet — resetting to (1,1,1)." );
			GameObject.LocalScale = new Vector3( 1f, 1f, 1f );
		}

		// Auto-setup at runtime so the zone always works even if the scene was
		// saved before the BoxCollider / visual existed.
		if ( box is null )
		{
			box = Components.Create<BoxCollider>();
			box.Scale = DefaultSize;
			box.IsTrigger = true;
			Log.Info( $"[DeathZone] Auto-created BoxCollider {DefaultSize} on OnAwake." );
		}
		else
		{
			box.IsTrigger = true;
		}

		// Always (re)generate the visual at runtime so it matches the actual
		// post-bake collider size, not whatever was saved earlier.
		GenerateVisual();
	}

	void Component.ITriggerListener.OnTriggerEnter( Collider other )
	{
		Log.Info( $"[DeathZone] OnTriggerEnter from {other.GameObject?.Name ?? "?"}" );
		var leaf = other.GameObject.Components.Get<LeafController>();
		if ( leaf is null )
		{
			// Leaf might be a child of the entered object; walk up
			leaf = other.GameObject?.Parent?.Components.Get<LeafController>();
		}
		if ( leaf is null ) return;
		leaf.FailRun( FailReason );
	}

	[Button( "Reset (clear children, scale to 1, default size)" )]
	public void ResetEverything()
	{
		ClearVisual();
		GameObject.LocalScale = new Vector3( 1f, 1f, 1f );
		var box = GetComponent<BoxCollider>() ?? Components.Create<BoxCollider>();
		box.IsTrigger = true;
		box.Center = Vector3.Zero;
		box.Scale = DefaultSize;
		Log.Info( $"[DeathZone] Reset '{GameObject.Name}' — scale (1,1,1), BoxCollider {DefaultSize}, IsTrigger=true." );
		GenerateVisual();
	}

	void Component.ITriggerListener.OnTriggerExit( Collider other )
	{
		// no-op — failure is one-way
	}

	/// <summary>
	/// One-click setup: ensures a BoxCollider with IsTrigger=true exists at a
	/// sensible default size, then (re)generates the visible sea mass.
	/// Re-run this any time after resizing the BoxCollider.
	/// </summary>
	[Button( "Setup Sea Zone (collider + visual)" )]
	public void SetupSeaZone()
	{
		var box = GetComponent<BoxCollider>();
		if ( box is null )
		{
			box = Components.Create<BoxCollider>();
			Log.Info( $"[DeathZone] Created BoxCollider." );
		}

		// Always force IsTrigger on — without this the leaf bounces off instead
		// of triggering the failure.
		box.IsTrigger = true;

		// If the collider is at the s&box default tiny scale, swap in DefaultSize
		// so a fresh "Setup" click gives a usable river right away. We only nudge
		// when every axis is small (≤100) — leaves intentional bigger sizes alone.
		if ( box.Scale.x <= 100f && box.Scale.y <= 100f && box.Scale.z <= 100f )
		{
			box.Scale = DefaultSize;
			Log.Info( $"[DeathZone] BoxCollider was at default size — resized to {DefaultSize}." );
		}

		// Make sure no zero axes survive (in case of weird inspector edits)
		box.Scale = new Vector3(
			MathF.Max( box.Scale.x, 50f ),
			MathF.Max( box.Scale.y, 50f ),
			MathF.Max( box.Scale.z, 50f )
		);

		GenerateVisual();
	}

	[Button( "Generate Sea Visual" )]
	public void GenerateVisual()
	{
		ClearVisual();

		var box = GetComponent<BoxCollider>();
		if ( box is null )
		{
			Log.Warning( "[DeathZone] No BoxCollider — click 'Setup Sea Zone' first." );
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

	/// <summary>
	/// Editor gizmo — solid translucent water mass + edge outline + skull X.
	/// Falls back to DefaultSize at the GameObject origin when no BoxCollider
	/// exists, so you can SEE where the zone will be before setup.
	/// </summary>
	protected override void DrawGizmos()
	{
		var box = GetComponent<BoxCollider>();
		Vector3 center;
		Vector3 size;
		bool hasCollider = box is not null;
		if ( hasCollider )
		{
			center = box.Center;
			size = box.Scale;
		}
		else
		{
			center = Vector3.Zero;
			size = DefaultSize;
		}

		var half = size * 0.5f;
		var min = center - half;
		var max = center + half;

		// Strong fill so the volume is obvious in editor
		var fill = new Color( 0.10f, 0.32f, 0.60f, 0.45f );
		var edge = new Color( 0.45f, 0.75f, 1f, 1f );
		if ( Gizmo.IsHovered ) edge = Color.Yellow;
		else if ( Gizmo.IsSelected ) edge = new Color( 1f, 0.85f, 0.35f, 1f );

		Gizmo.Draw.IgnoreDepth = true;

		Gizmo.Draw.Color = fill;
		Gizmo.Draw.SolidBox( new BBox( min, max ) );

		Gizmo.Draw.Color = edge;
		Gizmo.Draw.LineThickness = 3f;
		Gizmo.Draw.LineBBox( new BBox( min, max ) );

		// Bright "shoreline" lines along the top
		Gizmo.Draw.Color = new Color( 0.65f, 0.88f, 1f, 0.85f );
		Gizmo.Draw.LineThickness = 1.5f;
		float topZ = max.z;
		int lines = 8;
		for ( int i = 1; i < lines; i++ )
		{
			float t = (float)i / lines;
			float y = MathX.Lerp( min.y, max.y, t );
			Gizmo.Draw.Line( new Vector3( min.x, y, topZ ), new Vector3( max.x, y, topZ ) );
		}

		// Big red X across the top middle so it's obviously a death zone
		var topCenter = new Vector3( (min.x + max.x) * 0.5f, (min.y + max.y) * 0.5f, topZ );
		Gizmo.Draw.Color = new Color( 1f, 0.45f, 0.45f, 0.95f );
		Gizmo.Draw.LineThickness = 4f;
		float r = MathF.Min( half.x, half.y ) * 0.30f;
		Gizmo.Draw.Line( topCenter + new Vector3( -r, -r, 0 ), topCenter + new Vector3( r, r, 0 ) );
		Gizmo.Draw.Line( topCenter + new Vector3( -r, r, 0 ), topCenter + new Vector3( r, -r, 0 ) );

		if ( !hasCollider )
		{
			// Visual cue — the gizmo is a preview, no real collider yet
			Gizmo.Draw.Color = new Color( 1f, 0.6f, 0.3f, 1f );
			Gizmo.Draw.LineThickness = 2f;
			Gizmo.Draw.Line( min, min + new Vector3( 80f, 0, 0 ) );
			Gizmo.Draw.Line( min, min + new Vector3( 0, 80f, 0 ) );
		}

		Gizmo.Hitbox.BBox( new BBox( min, max ) );
	}
}
