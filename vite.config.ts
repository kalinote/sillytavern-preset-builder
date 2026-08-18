import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const devApiTarget = env.PRESET_STUDIO_DEV_API_TARGET || "http://127.0.0.1:3001";
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 4173,
      strictPort: true,
      proxy: {
        "/api": {
          target: devApiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 1400,
    },
  };
});
