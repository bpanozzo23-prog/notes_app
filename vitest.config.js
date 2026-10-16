import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "virtual:pwa-register/react": new URL("./src/test/pwa.js", import.meta.url).pathname } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
    fileParallelism: false,
  },
});
