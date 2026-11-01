// The low November sun, south-west (true azimuth ~235 deg, 11 deg up), which in the grid frame (avenues along +z)
// is behind and to the left of a player heading uptown. Shared by the light and everything that fakes reflecting it.
import * as THREE from "three";

export function sunDirection(out = new THREE.Vector3()): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(247 - 28.9), el = THREE.MathUtils.degToRad(11);
  return out.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize(); // east is -x
}
