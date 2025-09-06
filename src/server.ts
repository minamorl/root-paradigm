// server.ts
import { startServer } from "../app/server/http";

const port = Number(process.env.PORT || 3000);
startServer(port, {
  sqlite: "todos.db", // SQLite ファイルに保存
  journalDir: "journal",
}); // ポートで起動
console.log(`[server] Listening on http://localhost:${port}  — open / for status`);
