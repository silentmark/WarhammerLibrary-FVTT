import foundryConfig from "./foundry-path.js";
import copy from 'rollup-plugin-copy';
import postcss from "rollup-plugin-postcss";
import { upload, reloadAll } from "./orchestrator.mjs";

let modulePath = foundryConfig();

// eslint-disable-next-line jsdoc/require-returns
/**
 * Post-build plugin for Rollup
 */
function postBuildPlugin() {
  return {
    name: 'post-build-plugin',
    async buildEnd() {
      // eslint-disable-next-line no-undef
      console.log('[Rollup] Build finished. Running post-build tasks...');
      await upload();
      await reloadAll();
    }
  };
}

export default {
  input: ['src/warhammer-lib.js'],
  output: { dir: modulePath },
  watch: {
    clearScreen: false
  },
  plugins: [
    copy({
      targets: [
        { src: "./module.json", dest: modulePath },
        { src: "./static/*", dest: modulePath }
      ],
      // eslint-disable-next-line no-undef
      watch: process.env.NODE_ENV === "production" ? false : ["./static/**", "system.json", "template.json"]
    }),
    postcss({
      extract: "warhammer.css",
      plugins: []
    }),
    postBuildPlugin()
  ]
};