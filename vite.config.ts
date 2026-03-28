import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",     // Dashboard at /
        app: "app.html",        // DEX (Swap/Liquidity) at /app.html
      },
    },
  },
});
