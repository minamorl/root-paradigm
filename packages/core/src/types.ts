export type Id = string;

export type Create = { type: 'Create'; id: Id; value: unknown };
export type Update = { type: 'Update'; id: Id; value: unknown };
export type Delete = { type: 'Delete'; id: Id };
export type Event = Create | Update | Delete;
