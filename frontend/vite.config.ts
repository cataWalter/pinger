import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  plugins: [react(), wails("./bindings")],
  build: {
    target: "safari15",
    cssTarget: "safari15",
    rolldownOptions: {
      output: {
        // Split heavy vendor libraries out of the markdown chunk so no single
        // chunk exceeds Vite's 500 kB warning threshold.
        codeSplitting: {
          groups: [
            { name: "katex", test: /[\\/]node_modules[\\/]katex[\\/]/, priority: 30 },
            { name: "highlight", test: /[\\/]node_modules[\\/](highlight\.js|lowlight)[\\/]/, priority: 30 },
            { name: "react-vendor", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
            { name: "emoji", test: /[\\/]node_modules[\\/]emoji-picker-react[\\/]/, priority: 25 },
            { name: "franc", test: /[\\/]node_modules[\\/]franc-min[\\/]/, priority: 25 },
            { name: "vendor", test: /[\\/]node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
