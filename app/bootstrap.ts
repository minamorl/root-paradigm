import { makeRoot } from "../src/lib/root";
import { RootHost } from "../host/root-host";
import { SseAdapter } from "../adapters/sse";
import { WalNdjsonAdapter } from "../adapters/wal-ndjson";
import { SqliteAdapter } from "../adapters/sqlite";
import type { DB } from "../adapters/sqlite/db";

export type BootstrapOptions = {
  sqlite?: string | DB;
  journalDir?: string;
  sse?: SseAdapter;
};

export function bootstrap(opts: BootstrapOptions = {}) {
  const root = makeRoot();
  const adapters = [] as Array<InstanceType<typeof SseAdapter> | InstanceType<typeof WalNdjsonAdapter> | InstanceType<typeof SqliteAdapter>>;
  const sse = opts.sse ?? new SseAdapter();
  adapters.push(sse);
  const wal = new WalNdjsonAdapter(opts.journalDir ?? "journal");
  adapters.push(wal);
  if (opts.sqlite) adapters.push(new SqliteAdapter(opts.sqlite));
  const host = new RootHost(root, adapters);
  return { root, host, sse, wal };
}

