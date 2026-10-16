import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base will become "/notes_app/" when the app is deployed to GitHub Pages; the spike is served
// from the XPS dev server at the root.
export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5174,
    // Vite blocks requests to hostnames it does not know (DNS-rebinding protection). The phone
    // reaches the XPS by its Tailscale name; IP addresses are always allowed.
    allowedHosts: ["brent-dell-system-xps-l502x", ".ts.net"],
  },
  plugins: [react(), tailwindcss()],
});
