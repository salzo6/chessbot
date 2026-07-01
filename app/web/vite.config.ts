import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Single source of truth for the dev backend port. In production the Node
// server serves this built app and the API/WS on the SAME origin, so the
// client's relative URLs (`/api`, `/ws`) work behind any domain unchanged.
const SERVER_PORT = process.env.SERVER_PORT || process.env.PORT || "3001";
const target = `http://localhost:${SERVER_PORT}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    strictPort: false, // if taken, Vite picks the next free port — client stays relative
    // Allow importing the shared pure-logic module from app/shared (one level above web).
    fs: { allow: [".."] },
    proxy: {
      "/api": target,
      "/ws": { target: target.replace(/^http/, "ws"), ws: true },
    },
  },
});
