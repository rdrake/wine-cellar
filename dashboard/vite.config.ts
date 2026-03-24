import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/** Inject <link rel="preload"> for latin font files so they arrive before CSS is parsed. */
function preloadFonts(): Plugin {
  return {
    name: "preload-fonts",
    enforce: "post",
    transformIndexHtml(_, ctx) {
      const fonts = Object.keys(ctx.bundle ?? {}).filter(
        (f) => f.endsWith(".woff2") && f.includes("-latin-") && !f.includes("-latin-ext-"),
      );
      return fonts.map((f) => ({
        tag: "link",
        attrs: { rel: "preload", href: `/${f}`, as: "font", type: "font/woff2", crossorigin: "" },
        injectTo: "head-prepend" as const,
      }));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFonts()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/webhook": "http://localhost:8787",
      "/health": "http://localhost:8787",
    },
  },
});
