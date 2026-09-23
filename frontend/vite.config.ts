import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Dev server proxies /api to the python backend (just server).
export default defineConfig({
  plugins: [vue()],
  server: {
    host: "127.0.0.1", // IPv4 like the backend; bare vite binds ::1 only
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
