import { createApiServer } from "./http.js";

const port = Number(process.env.PORT ?? 3001);
// The first release has no authentication. Bare Node therefore binds only to
// loopback unless Docker or the operator explicitly opts into a wider address.
const host = process.env.HOST ?? "127.0.0.1";
const configuredLimit = Number(process.env.PRESET_STUDIO_BODY_LIMIT_MIB ?? 64);
const bodyLimitBytes = Number.isFinite(configuredLimit) && configuredLimit > 0
  ? Math.floor(configuredLimit * 1024 * 1024)
  : 64 * 1024 * 1024;

const { server, store, stSessions } = createApiServer({ bodyLimitBytes });
await store.initialize();

server.listen(port, host, () => {
  console.log(`Preset Studio server listening on http://${host}:${port}`);
  console.log(`Workspace: ${store.workspaceRoot}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stSessions.close();
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  });
}

export { createApiServer } from "./http.js";
export { ProjectStore } from "./project-store.js";
export { StSessionManager } from "./st-session-manager.js";
export type { StSessionInfo, StSessionManagerOptions } from "./st-session-manager.js";
