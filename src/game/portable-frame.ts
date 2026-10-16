/** CPU frame entry for embedded hosts. Scene construction and UI composition are separate ports. */
export { createFrame, type Framing } from './frame';
export { SessionLifetime } from './lifecycle';
export { GameInput } from '../core/game-input';
export { IsoCamera } from '../render/camera';
export { bindKeys, type Keys } from './keys';
export { createPlayerActions, PLAYER_ACTION_KEYS, type PlayerAction } from './player-actions';
export type { FrameHost } from './frame-host';
export type { Viewport } from '../core/viewport';
