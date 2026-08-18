import { createApiServer } from "./http.js";

const port = Number(process.env.PORT ?? 3001);
// The first release has no authentication. Bare Node therefore binds only to
// loopback unless Docker or the operator explicitly opts into a wider address.
const host = process.env.HOST ?? "127.0.0.1";
const configuredLimit = Number(process.env.PRESET_STUDIO_BODY_LIMIT_MIB ?? 64);
const bodyLimitBytes = Number.isFinite(configuredLimit) && configuredLimit > 0
  ? Math.floor(configuredLimit * 1024 * 1024)
  : 64 * 1024 * 1024;

const previewRuntimeFlag = (process.env.PRESET_STUDIO_PREVIEW_RUNTIME_ENABLED
  ?? process.env.PREVIEW_RUNTIME_ENABLED
  ?? "true")
  .trim()
  .toLowerCase();
const previewRuntimeEnabled = !["0", "false", "no", "off"].includes(previewRuntimeFlag);
const previewOrigin = process.env.PRESET_STUDIO_PREVIEW_ORIGIN ?? `http://localhost:${port}`;
const previewParentOrigins = (process.env.PRESET_STUDIO_PREVIEW_PARENT_ORIGINS
  ?? `http://${host}:${port},http://localhost:${port},http://127.0.0.1:${port},http://localhost:4173,http://127.0.0.1:4173`)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const { server, store, stSessions } = createApiServer({
  bodyLimitBytes,
  previewOrigin,
  previewRuntimeEnabled,
  previewParentOrigins,
});
await store.initialize();

server.listen(port, host, () => {
  console.log(`Preset Studio server listening on http://${host}:${port}`);
  console.log(!previewRuntimeEnabled
    ? "JavaScript preview host: disabled by service feature flag"
    : `JavaScript preview host: ${previewOrigin}/preview-runtime`);
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
