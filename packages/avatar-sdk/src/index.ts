export type { AvatarState, AvatarEvent } from '@facenode/avatar-core';

/**
 * Minimal interface required by any adapter that wants to feed events
 * into a controller (AvatarController, test doubles, etc.).
 *
 * Using this interface instead of importing AvatarController directly
 * keeps hermes-adapter and other adapters free of web-avatar dependencies.
 */
export interface AvatarEventDispatcher {
  dispatch(event: import('@facenode/avatar-core').AvatarEvent): void;
}
