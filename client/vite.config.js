import { defineConfig } from "vite";
import discoveryPlugin from "./vite-discovery-plugin.js";

export default defineConfig({
  plugins: [discoveryPlugin()],
  root: ".",
  server: {
    // Proxy WebSocket and API requests to the game server during dev
    proxy: {
      "/ws": {
        target: "http://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../client_dist",
    emptyOutDir: true,
  },
});
