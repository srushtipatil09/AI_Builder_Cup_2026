import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_API_TARGET lets a second dev API (another port) serve this page without editing the config.
const api = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  envDir: "../",
  server: {
    port: 5173,
    allowedHosts: [
      "specifies-previously-ticket-beatles.trycloudflare.com",
      ".trycloudflare.com",
    ],
    proxy: {
      "/health": api,
      "/api": {
        target: api,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

