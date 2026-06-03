/**
 * Whether voice/video calling is available in this runtime.
 *
 * WebRTC peer connections live in the webview, and not every platform exposes
 * them — notably WebKitGTK on Linux ships without `RTCPeerConnection` unless the
 * build enabled WebRTC. Gate the call UI on this so an unsupported webview shows
 * a disabled control instead of throwing `ReferenceError: RTCPeerConnection`.
 */
export function isCallingSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined'
}
