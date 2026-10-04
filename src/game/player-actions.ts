/** Semantic taps reuse existing bindings, including their screen-ownership and gameplay guards. */
export const PLAYER_ACTION_KEYS = {
  interact: 'enter', jump: ' ', attack: 'x', shoot: 'z', ward: 'b', blight: 'h', light: 'u', draught: 'v',
  inventory: 'i', journal: 'j', roster: '1', map: 'm', options: 'o', company: 'l', chat: 't',
  party: 'k', hire: 'y', give: 'g', rally: 'r', photo: 'p', cameraMode: 'f', seeThrough: '2',
  leave: 'n', close: 'escape', talkUp: 'arrowup', talkDown: 'arrowdown',
  talkLeft: 'arrowleft', talkRight: 'arrowright', mapCentre: 'c', mapZoomIn: '+', mapZoomOut: '-',
} as const;
export type PlayerAction = keyof typeof PLAYER_ACTION_KEYS;

interface ActionInput { press(key: string): void }

/** Return false for unknown or retired-session messages before they can reach a binding. */
export function createPlayerActions(input: ActionInput, isLive: () => boolean) {
  return {
    dispatch(action: PlayerAction): boolean {
      if (!isLive() || !Object.hasOwn(PLAYER_ACTION_KEYS, action)) return false;
      input.press(PLAYER_ACTION_KEYS[action]);
      return true;
    },
  };
}
