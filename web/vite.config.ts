import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  // 输出到仓库根目录 dist：Cloudflare Pages 的 v2 root directory strategy 会在根目录找 dist；
  // 同时 GitHub Actions 与后端托管（Docker/CloudBase）也统一读取根 dist，单一真相源。
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});