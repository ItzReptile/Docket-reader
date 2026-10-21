import path from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// In dev, Vite serves the UI on :5173 and forwards /api to the Elysia server.
// `bun run build` writes web/dist, which the Elysia server serves itself.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
