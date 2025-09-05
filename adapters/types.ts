export type Snapshot = { type: "Snapshot"; seq: bigint; ts: string; version: 1 };

export type EventN = {
  type: "Create" | "Update" | "Delete";
  id: string;
  value?: unknown;
  seq: bigint;
  ts: string;
  version: 1;
  traceId?: string;
  actor?: string;
};

export type Notify = EventN | Snapshot;

export interface Adapter {
  name: string;
  onNotify(n: Notify): Promise<void> | void;
  onNotifyBatch?(ns: Notify[]): Promise<void> | void;
  health?(): Promise<{ ok: boolean; detail?: string }>;
  drain?(): Promise<void>;
}

