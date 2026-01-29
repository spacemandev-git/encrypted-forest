import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    // Polyfill for Anchor/web3.js in browser
    "process.env": {},
  },
  optimizeDeps: {
    include: ["three"],
  },
});
