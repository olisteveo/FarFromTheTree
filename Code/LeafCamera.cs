/// <summary>
/// Auto chase camera for the leaf. No player input — the camera always shows
/// where the leaf is going, never where the player points (deliberate design choice).
///
/// Behaviour:
///   * Sits behind and slightly above the leaf
///   * Lerps toward the leaf's direction of travel (eases when you turn)
///   * FOV widens as the leaf goes faster (speed-feel)
///
/// Attach to a Camera GameObject (any GameObject with a CameraComponent will do).
/// Set Target to the leaf GameObject. The camera does NOT need to be a child of
/// the leaf — it tracks via WorldPosition.
/// </summary>
public sealed class LeafCamera : Component
{
	[Property] public GameObject Target { get; set; }
	[Property] public CameraComponent Camera { get; set; }

	[Property, Group( "Follow" ), Range( 0f, 500f )]
	public float Distance { get; set; } = 250f;

	[Property, Group( "Follow" ), Range( 0f, 200f )]
	public float Height { get; set; } = 80f;

	[Property, Group( "Follow" ), Range( 0f, 20f )]
	public float PositionLerpRate { get; set; } = 4f;

	[Property, Group( "Follow" ), Range( 0f, 20f )]
	public float RotationLerpRate { get; set; } = 3f;

	[Property, Group( "FOV" ), Range( 30f, 90f )]
	public float MinFov { get; set; } = 60f;

	[Property, Group( "FOV" ), Range( 60f, 120f )]
	public float MaxFov { get; set; } = 95f;

	[Property, Group( "FOV" ), Range( 1f, 100f )]
	public float SpeedAtMaxFov { get; set; } = 30f;

	private Rotation _trackedYaw = Rotation.Identity;

	protected override void OnAwake()
	{
		Camera ??= GetComponent<CameraComponent>();
	}

	protected override void OnUpdate()
	{
		if ( Target is null ) return;

		var leafPos = Target.WorldPosition;
		var leafBody = Target.Components.Get<Rigidbody>();
		var velocity = leafBody?.Velocity ?? Vector3.Zero;
		var horizontalVel = velocity.WithZ( 0 );
		var speed = velocity.Length;

		// Track the direction of travel — only update yaw when actually moving,
		// otherwise keep the last direction so the camera doesn't spin while idle.
		if ( horizontalVel.Length > 5f )
		{
			var targetYaw = Rotation.From( 0, horizontalVel.EulerAngles.yaw, 0 );
			_trackedYaw = Rotation.Lerp( _trackedYaw, targetYaw, Time.Delta * RotationLerpRate );
		}

		// Camera sits behind+above the tracked direction
		var backOffset = _trackedYaw.Forward * -Distance;
		var upOffset = Vector3.Up * Height;
		var desiredPos = leafPos + backOffset + upOffset;

		WorldPosition = WorldPosition.LerpTo( desiredPos, Time.Delta * PositionLerpRate );
		WorldRotation = Rotation.LookAt( leafPos - WorldPosition, Vector3.Up );

		// FOV widens with speed
		if ( Camera is not null )
		{
			float t = (speed / SpeedAtMaxFov).Clamp( 0f, 1f );
			Camera.FieldOfView = MinFov.LerpTo( MaxFov, t );
		}
	}
}
