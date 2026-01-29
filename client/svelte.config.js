import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({
      // SPA mode -- all routes handled client-side
      fallback: "index.html",
    }),
    alias: {
      $game: "src/lib/game",
      $components: "src/lib/components",
    },
  },
};

export default config;
