/// <summary>
/// Auto chase camera for the leaf. Two modes, switches automatically:
///
///   1. FALL mode — leaf is detaching/falling. Loose follow, lerps toward velocity
///      direction so we always see the leaf and the ground below.
///
///   2. GAMEPLAY mode — leaf has landed. Camera locks to a fixed framing pointing
///      down GameplayDirection (the direction the first gust will blow). This is
///      the "ready to play" view.
///
/// No player input ever. Camera always shows where the leaf is going.
/// </summary>
public sealed class LeafCamera : Component
{
	[Property] public GameObject Target { get; set; }
	[Property] public CameraComponent Camera { get; set; }

	[Property, Group( "Follow" ), Range( 0f, 500f )]
	public float Distance { get; set; } = 200f;

	[Property, Group( "Follow" ), Range( 0f, 200f )]
	public float Height { get; set; } = 60f;

	[Property, Group( "Follow" ), Range( 0f, 20f )]
	public float PositionLerpRate { get; set; } = 6f;

	[Property, Group( "Follow" ), Range( 0f, 20f )]
	public float RotationLerpRate { get; set; } = 4f;

	/// <summary>
	/// World-space direction the camera looks toward in gameplay mode.
	/// Should match the direction the first gust pushes the leaf, so the player
	/// is always facing forward into the action.
	/// </summary>
	[Property, Group( "Gameplay" )]
	public Vector3 GameplayDirection { get; set; } = Vector3.Forward;

	[Property, Group( "Gameplay" ), Range( 0.5f, 5f )]
	public float TransitionDuration { get; set; } = 1.5f;

	[Property, Group( "FOV" ), Range( 30f, 90f )]
	public float MinFov { get; set; } = 60f;

	[Property, Group( "FOV" ), Range( 60f, 120f )]
	public float MaxFov { get; set; } = 95f;

	[Property, Group( "FOV" ), Range( 1f, 100f )]
	public float SpeedAtMaxFov { get; set; } = 30f;

	private Rotation _trackedYaw = Rotation.Identity;
	private bool _inGameplayMode;
	private float _transitionElapsed;

	protected override void OnAwake()
	{
		Camera ??= GetComponent<CameraComponent>();
	}

	protected override void OnUpdate()
	{
		if ( Target is null ) return;

		var leafPos = Target.WorldPosition;
		var leafController = Target.Components.Get<LeafController>();
		var hasLanded = leafController?.HasLanded ?? false;

		// Detect transition into gameplay mode
		if ( hasLanded && !_inGameplayMode )
		{
			_inGameplayMode = true;
			_transitionElapsed = 0f;
		}

		if ( _inGameplayMode )
		{
			UpdateGameplayMode( leafPos );
		}
		else
		{
			UpdateFollowMode( leafPos );
		}
	}

	private void UpdateFollowMode( Vector3 leafPos )
	{
		var leafBody = Target.Components.Get<Rigidbody>();
		var velocity = leafBody?.Velocity ?? Vector3.Zero;
		var horizontalVel = velocity.WithZ( 0 );
		var speed = velocity.Length;

		if ( horizontalVel.Length > 5f )
		{
			var targetYaw = Rotation.From( 0, horizontalVel.EulerAngles.yaw, 0 );
			_trackedYaw = Rotation.Lerp( _trackedYaw, targetYaw, Time.Delta * RotationLerpRate );
		}

		var backOffset = _trackedYaw.Forward * -Distance;
		var upOffset = Vector3.Up * Height;
		var desiredPos = leafPos + backOffset + upOffset;

		WorldPosition = WorldPosition.LerpTo( desiredPos, Time.Delta * PositionLerpRate );
		WorldRotation = Rotation.LookAt( leafPos - WorldPosition, Vector3.Up );

		if ( Camera is not null )
		{
			float t = (speed / SpeedAtMaxFov).Clamp( 0f, 1f );
			Camera.FieldOfView = MinFov.LerpTo( MaxFov, t );
		}
	}

	private void UpdateGameplayMode( Vector3 leafPos )
	{
		// Camera locked to a fixed framing pointed along GameplayDirection.
		// During TransitionDuration, lerp gently from current pose to the locked one,
		// then settle.
		_transitionElapsed += Time.Delta;

		var dir = GameplayDirection.LengthSquared > 0.01f
			? GameplayDirection.Normal
			: Vector3.Forward;

		var targetPos = leafPos - (dir * Distance) + (Vector3.Up * Height);
		var targetRot = Rotation.LookAt( leafPos - targetPos, Vector3.Up );

		// Slower, smoother transition while we're still settling. After TransitionDuration,
		// the lerp tightens up to a hard lock.
		var t = (_transitionElapsed / TransitionDuration).Clamp( 0f, 1f );
		var followRate = MathX.Lerp( 2f, 12f, t );

		WorldPosition = WorldPosition.LerpTo( targetPos, Time.Delta * followRate );
		WorldRotation = Rotation.Slerp( WorldRotation, targetRot, Time.Delta * followRate );

		if ( Camera is not null )
		{
			Camera.FieldOfView = MinFov;
		}
	}
}
