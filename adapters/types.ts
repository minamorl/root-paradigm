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
  /**
   * Receive a single Notify. Implementations should handle values that may include binary payloads.
   * Note: `Notify.value` may contain `BinaryRef | Uint8Array | Buffer`.
   * Non-text adapters should prefer carrying `BinaryRef` over raw bytes.
   */
  onNotify(n: Notify): Promise<void> | void;
  onNotifyBatch?(ns: Notify[]): Promise<void> | void;
  health?(): Promise<{ ok: boolean; detail?: string }>;
  drain?(): Promise<void>;
}

/** Content-addressed reference to a blob stored by a BlobAdapter. */
export type BinaryRef = {
  kind: "blob";
  /** e.g. "blob:sha256-<64 hex>" */
  uri: string;
  bytes: number;
  /** e.g. "image/png" */
  contentType?: string;
};

/** Separate adapter for binary payloads (FS, S3, etc.). */
export interface BlobAdapter {
  /** Adapter name, e.g. "blob-fs", "blob-s3". */
  name: string;
  put(content: Uint8Array, opts?: { contentType?: string }): Promise<{ uri: string; bytes: number }>;
  get(uri: string): Promise<{ content: Uint8Array; contentType?: string | undefined }>;
  has?(uri: string): Promise<boolean>;
  delete?(uri: string): Promise<void>;
}
