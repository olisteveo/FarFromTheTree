/// <summary>
/// Trigger volume that fails the run when the leaf enters it.
/// Attach to a GameObject with a BoxCollider that has IsTrigger = true.
///
/// Editor gizmo draws a translucent dark-blue box with rippling top to suggest
/// water / dead area at a glance.
/// </summary>
public sealed class DeathZone : Component, Component.ITriggerListener
{
	[Property]
	public string FailReason { get; set; } = "Lost in the river";

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

	protected override void DrawGizmos()
	{
		var box = GetComponent<BoxCollider>();
		if ( box is null ) return;

		var half = box.Scale * 0.5f;
		var min = box.Center - half;
		var max = box.Center + half;

		// Water-blue translucent volume, brighter when hovered/selected
		var fill = new Color( 0.12f, 0.32f, 0.55f, 0.18f );
		var edge = new Color( 0.35f, 0.65f, 0.95f, 0.85f );
		if ( Gizmo.IsHovered ) edge = Color.Yellow;
		else if ( Gizmo.IsSelected ) edge = new Color( 1f, 0.8f, 0.3f, 1f );

		Gizmo.Draw.IgnoreDepth = true;

		// Outline box
		Gizmo.Draw.Color = edge;
		Gizmo.Draw.LineThickness = 2f;
		Gizmo.Draw.LineBBox( new BBox( min, max ) );

		// Translucent solid fill
		Gizmo.Draw.Color = fill;
		Gizmo.Draw.SolidBox( new BBox( min, max ) );

		// "Water surface" lines along the top to cue it as a death surface
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

		// Skull tag in the centre to make it obvious this is a death zone
		var center = (min + max) * 0.5f;
		Gizmo.Draw.Color = new Color( 1f, 0.4f, 0.4f, 0.9f );
		Gizmo.Draw.LineThickness = 3f;
		float r = MathF.Min( half.x, MathF.Min( half.y, half.z ) ) * 0.18f;
		// X mark
		Gizmo.Draw.Line( center + new Vector3( -r, -r, 0 ), center + new Vector3( r, r, 0 ) );
		Gizmo.Draw.Line( center + new Vector3( -r, r, 0 ), center + new Vector3( r, -r, 0 ) );

		Gizmo.Hitbox.BBox( new BBox( min, max ) );
	}
}
