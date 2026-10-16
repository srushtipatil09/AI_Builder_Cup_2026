import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: [
      "installed-surrey-fighter-gone.trycloudflare.com",  // Extending the allowed hosts to include the Cloudflare domain. For proper multi-device testing.
      ".trycloudflare.com",
    ],
    proxy: {
      "/health": "http://127.0.0.1:8080",
    },
  },
});
