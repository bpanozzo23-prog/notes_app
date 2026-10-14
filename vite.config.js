import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base will become "/notes_app/" when the app is deployed to GitHub Pages; the spike is served
// from the XPS dev server at the root.
export default defineConfig({
  server: { port: Number(process.env.PORT) || 5174 },
  plugins: [react(), tailwindcss()],
});
