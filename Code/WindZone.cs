/// <summary>
/// A volume of wind. Attach to a GameObject with a BoxCollider that has IsTrigger = true.
/// While a LeafController is overlapping this trigger, applies the configured force.
///
/// Direction is in WORLD space by default. If LocalDirection is true, the direction
/// is relative to this GameObject's rotation — useful for wind tunnels you want to
/// rotate by rotating the GameObject.
/// </summary>
public sealed class WindZone : Component, Component.ITriggerListener
{
	[Property, Group( "Wind" )]
	public Vector3 Direction { get; set; } = Vector3.Forward;

	[Property, Group( "Wind" ), Range( 0f, 50000f )]
	public float Strength { get; set; } = 2000f;

	[Property, Group( "Wind" )]
	public bool LocalDirection { get; set; } = false;

	private readonly HashSet<LeafController> _occupants = new();

	void Component.ITriggerListener.OnTriggerEnter( Collider other )
	{
		var leaf = other.GameObject.Components.Get<LeafController>( FindMode.EnabledInSelfAndAncestors );
		if ( leaf is not null ) _occupants.Add( leaf );
	}

	void Component.ITriggerListener.OnTriggerExit( Collider other )
	{
		var leaf = other.GameObject.Components.Get<LeafController>( FindMode.EnabledInSelfAndAncestors );
		if ( leaf is not null ) _occupants.Remove( leaf );
	}

	protected override void OnFixedUpdate()
	{
		if ( _occupants.Count == 0 ) return;

		var worldDir = LocalDirection
			? WorldRotation * Direction.Normal
			: Direction.Normal;

		var force = worldDir * Strength;

		foreach ( var leaf in _occupants )
		{
			if ( leaf.IsValid )
				leaf.AddWindForce( force );
		}
	}
}
