import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  server: {
    port: 5173,
    proxy: {
      // The dev server from `npm run dev:server`, not the Docker container. The Host header stays the one the
      // browser sent: the server refuses a write whose Origin is not its own Host (services/local-only.ts), and
      // Vite's string shorthand would rewrite Host to the target's, refusing every write from the page.
      "/api": { target: `http://localhost:${process.env.PORT || 3100}`, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
  },
});
