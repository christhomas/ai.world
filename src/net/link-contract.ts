/** The transport contract contains no browser socket or worker implementation. */
export type Parcel = string | ArrayBuffer;
export const WORLD_PAUSE = 'pause';
export const WORLD_RESUME = 'resume';

export interface Link {
  send(parcel: Parcel): void;
  close(): void;
  readonly ready: boolean;
}

export interface LinkEvents {
  onOpen: () => void;
  onMessage: (parcel: Parcel) => void;
  onClose: (why: string) => void;
}
