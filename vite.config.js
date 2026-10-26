import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/notes_app/",
  server: {
    port: Number(process.env.PORT) || 5174,
    // Vite blocks requests to hostnames it does not know (DNS-rebinding protection). The phone
    // reaches the XPS by its Tailscale name; IP addresses are always allowed.
    allowedHosts: ["brent-dell-system-xps-l502x", ".ts.net"],
  },
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: "prompt",
    manifest: {
      name: "Notes", short_name: "Notes", description: "Personal notes",
      display: "standalone", background_color: "#faf9f6", theme_color: "#faf9f6",
      shortcuts: [{ name: "Quick add", short_name: "Quick add", description: "Add a line to one of your notes", url: "./?quick-add",
        icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }] }],
      icons: [
        { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    workbox: { globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"] },
  })],
});
