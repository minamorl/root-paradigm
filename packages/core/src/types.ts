/**
 * Primitive events that describe state changes.
 */
export type Create = { type: 'Create'; id: string; value: unknown };
export type Update = { type: 'Update'; id: string; value: unknown };
export type Delete = { type: 'Delete'; id: string };

/**
 * Union of all event variants.
 */
export type Event = Create | Update | Delete;

/**
 * Subscriber callback for push-style notifications per event.
 */
export type Subscriber = (ev: Event) => void;

