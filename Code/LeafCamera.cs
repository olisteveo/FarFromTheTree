/// <summary>
/// Auto chase camera for the leaf with optional mouse orbit on top.
///
///   1. FALL mode — leaf is detaching/falling. Loose follow, lerps toward velocity
///      direction so we always see the leaf and the ground below.
///
///   2. GAMEPLAY mode — leaf has landed. Camera locks to a fixed framing pointing
///      down GameplayDirection (the direction the first gust will blow).
///
/// In both modes, mouse movement orbits the camera around the leaf within limits.
/// When mouse hasn't moved, camera slowly recenters back to the auto direction.
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

	[Property, Group( "Follow" ), Range( 0f, 30f )]
	public float RotationLerpRate { get; set; } = 10f;

	/// <summary>
	/// World-space direction the camera looks toward in gameplay mode.
	/// Should match the direction the first gust pushes the leaf.
	/// </summary>
	[Property, Group( "Gameplay" )]
	public Vector3 GameplayDirection { get; set; } = Vector3.Forward;

	[Property, Group( "Gameplay" ), Range( 0.5f, 5f )]
	public float TransitionDuration { get; set; } = 1.5f;

	[Property, Group( "Mouse Orbit" )]
	public bool EnableMouseOrbit { get; set; } = true;

	[Property, Group( "Mouse Orbit" ), Range( 0f, 5f )]
	public float MouseSensitivity { get; set; } = 0.4f;

	[Property, Group( "Mouse Orbit" )]
	public bool InvertYaw { get; set; } = true;

	[Property, Group( "Mouse Orbit" )]
	public bool InvertPitch { get; set; } = true;

	[Property, Group( "Mouse Orbit" ), Range( 0f, 180f )]
	public float MaxYawOffset { get; set; } = 30f;

	[Property, Group( "Mouse Orbit" ), Range( 0f, 80f )]
	public float MaxPitchOffset { get; set; } = 5f;

	/// <summary>
	/// How fast the orbit recenters back to "behind leaf" when the player isn't moving the mouse.
	/// High = snaps back instantly. Low = drifts back slowly. 0 = sticky, never recenters.
	/// </summary>
	[Property, Group( "Mouse Orbit" ), Range( 0f, 10f )]
	public float RecenterRate { get; set; } = 4f;

	/// <summary>
	/// Seconds of mouse idle before recentering kicks back in. Short = camera snaps
	/// behind leaf almost as soon as you stop moving the mouse.
	/// </summary>
	[Property, Group( "Mouse Orbit" ), Range( 0f, 3f )]
	public float MouseIdleDelay { get; set; } = 0.2f;

	[Property, Group( "FOV" ), Range( 30f, 90f )]
	public float MinFov { get; set; } = 60f;

	[Property, Group( "FOV" ), Range( 60f, 120f )]
	public float MaxFov { get; set; } = 95f;

	[Property, Group( "FOV" ), Range( 1f, 100f )]
	public float SpeedAtMaxFov { get; set; } = 30f;

	[Property, Group( "Constraints" ), Range( 0f, 500f )]
	public float MinCameraHeight { get; set; } = 30f;

	[Property, Group( "Collision Avoidance" )]
	public bool AvoidObstacles { get; set; } = true;

	[Property, Group( "Collision Avoidance" ), Range( 5f, 100f )]
	public float ObstaclePadding { get; set; } = 20f;

	[Property, Group( "Collision Avoidance" ), Range( 10f, 300f )]
	public float MinCollisionDistance { get; set; } = 50f;

	private Rotation _trackedYaw = Rotation.Identity;
	private bool _inGameplayMode;
	private float _transitionElapsed;
	private float _mouseYaw;
	private float _mousePitch;
	private float _currentDistance;
	private float _mouseIdleSeconds;

	protected override void OnAwake()
	{
		Camera ??= GetComponent<CameraComponent>();
	}

	protected override void OnUpdate()
	{
		if ( Target is null ) return;

		ProcessMouseInput();

		var leafPos = Target.WorldPosition;
		var leafController = Target.Components.Get<LeafController>();
		var hasLanded = leafController?.HasLanded ?? false;

		if ( hasLanded && !_inGameplayMode )
		{
			_inGameplayMode = true;
			_transitionElapsed = 0f;
			Log.Info( $"[Cam] entering GAMEPLAY mode. leafPos=({leafPos.x:F0},{leafPos.y:F0},{leafPos.z:F0}) gameplayDir=({GameplayDirection.x:F1},{GameplayDirection.y:F1},{GameplayDirection.z:F1})" );
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

	private void ProcessMouseInput()
	{
		if ( !EnableMouseOrbit )
		{
			_mouseYaw = 0;
			_mousePitch = 0;
			_mouseIdleSeconds = 999f;
			return;
		}

		var look = Input.AnalogLook;
		var dx = look.yaw * MouseSensitivity * (InvertYaw ? -1f : 1f);
		var dy = look.pitch * MouseSensitivity * (InvertPitch ? -1f : 1f);

		var moved = MathF.Abs( dx ) > 0.001f || MathF.Abs( dy ) > 0.001f;

		if ( moved )
		{
			_mouseYaw = (_mouseYaw + dx).Clamp( -MaxYawOffset, MaxYawOffset );
			_mousePitch = (_mousePitch + dy).Clamp( -MaxPitchOffset, MaxPitchOffset );
			_mouseIdleSeconds = 0f;
		}
		else
		{
			_mouseIdleSeconds += Time.Delta;

			// Only recenter after idle delay has passed — player input persists meanwhile
			if ( _mouseIdleSeconds > MouseIdleDelay && RecenterRate > 0f )
			{
				_mouseYaw = _mouseYaw.LerpTo( 0f, Time.Delta * RecenterRate );
				_mousePitch = _mousePitch.LerpTo( 0f, Time.Delta * RecenterRate );
			}
		}
	}

	/// <summary>True when the player is actively orbiting the camera with the mouse.</summary>
	private bool IsMouseActive => _mouseIdleSeconds < MouseIdleDelay;

	private Rotation OrbitRotation => Rotation.From( -_mousePitch, _mouseYaw, 0 );

	private void UpdateFollowMode( Vector3 leafPos )
	{
		var leafBody = Target.Components.Get<Rigidbody>();
		var velocity = leafBody?.Velocity ?? Vector3.Zero;
		var horizontalVel = velocity.WithZ( 0 );
		var speed = velocity.Length;

		// ALWAYS auto-track velocity direction so camera stays behind the leaf.
		// Mouse adds an offset on top — but the base direction always follows motion.
		// Lerp speed scales with leaf speed: faster leaf = faster camera catch-up.
		if ( horizontalVel.Length > 5f )
		{
			var targetYaw = Rotation.From( 0, horizontalVel.EulerAngles.yaw, 0 );
			var lerpSpeed = RotationLerpRate * (1f + speed / 300f);
			_trackedYaw = Rotation.Lerp( _trackedYaw, targetYaw, Time.Delta * lerpSpeed );
		}

		var combined = _trackedYaw * OrbitRotation;
		var resolved = ResolveCameraPosition( leafPos, combined );

		WorldPosition = WorldPosition.LerpTo( resolved, Time.Delta * PositionLerpRate );
		WorldRotation = Rotation.LookAt( leafPos - WorldPosition, Vector3.Up );

		if ( Camera is not null )
		{
			float t = (speed / SpeedAtMaxFov).Clamp( 0f, 1f );
			Camera.FieldOfView = MinFov.LerpTo( MaxFov, t );
		}
	}

	private void UpdateGameplayMode( Vector3 leafPos )
	{
		_transitionElapsed += Time.Delta;

		var dir = GameplayDirection.LengthSquared > 0.01f
			? GameplayDirection.Normal
			: Vector3.Forward;

		var baseRot = Rotation.LookAt( dir );
		var combined = baseRot * OrbitRotation;
		var targetPos = ResolveCameraPosition( leafPos, combined );
		var targetRot = Rotation.LookAt( leafPos - targetPos, Vector3.Up );

		var t = (_transitionElapsed / TransitionDuration).Clamp( 0f, 1f );
		var followRate = MathX.Lerp( 2f, 12f, t );

		WorldPosition = WorldPosition.LerpTo( targetPos, Time.Delta * followRate );
		WorldRotation = Rotation.Slerp( WorldRotation, targetRot, Time.Delta * followRate );

		if ( Camera is not null )
		{
			Camera.FieldOfView = MinFov;
		}
	}

	/// <summary>
	/// Compute the desired camera position with collision avoidance + min height clamp.
	/// If something is between the leaf and the desired camera spot, pull the camera in
	/// (Spider-Man / Forza style). Also clamps Z so camera never goes below MinCameraHeight.
	/// </summary>
	private Vector3 ResolveCameraPosition( Vector3 leafPos, Rotation orbitOrientation )
	{
		var backOffset = orbitOrientation.Forward * -Distance;
		var upOffset = Vector3.Up * Height;
		var desiredPos = leafPos + backOffset + upOffset;

		var actualDistance = Distance;

		if ( AvoidObstacles )
		{
			var rayStart = leafPos + Vector3.Up * (Height * 0.5f);
			var rayEnd = desiredPos;
			var trace = Scene.Trace.Ray( rayStart, rayEnd )
				.IgnoreGameObjectHierarchy( Target )
				.IgnoreGameObjectHierarchy( GameObject )
				.Run();

			if ( trace.Hit )
			{
				var hitDist = (trace.HitPosition - rayStart).Length - ObstaclePadding;
				actualDistance = MathF.Max( MinCollisionDistance, hitDist );
				var dir = (desiredPos - rayStart).Normal;
				desiredPos = rayStart + dir * actualDistance;
			}
		}

		// Never let the camera dip below the minimum height
		if ( desiredPos.z < MinCameraHeight )
			desiredPos = desiredPos.WithZ( MinCameraHeight );

		_currentDistance = actualDistance;
		return desiredPos;
	}
}
