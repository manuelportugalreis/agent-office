import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // No GitHub Pages o site vive em /agent-office/ (VITE_BASE); localmente na raiz.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: (id: string) => (id.includes("/node_modules/three/") ? "three" : undefined) } },
  },
  server: { host: "127.0.0.1", port: 5174, fs: { allow: [".."] } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
