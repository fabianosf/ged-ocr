import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: {
    proxy: {
      "/api": { target: process.env.BACKEND_URL ?? "http://127.0.0.1:8000" },
      "/admin": { target: process.env.BACKEND_URL ?? "http://127.0.0.1:8000" },
      "/static": { target: process.env.BACKEND_URL ?? "http://127.0.0.1:8000" },
    },
  },
});
