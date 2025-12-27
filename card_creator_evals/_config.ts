import lume from "lume/mod.ts";
import esbuild from "lume/plugins/esbuild.ts";

const site = lume({
  src: ".",
  dest: "./_site",
  server: {
    open: true,
  },
});

site.use(esbuild({
  extensions: [".ts"],
  options: {
    minify: false,
    treeShaking: false,
    keepNames: false,
  },
}));

// Add src files
site.add("src/index.html", "index.html");
site.add("src/styles.css", "styles.css");
site.add("src/main.ts", "main.js");

// Copy data directories
site.copy("goldens");
site.copy("inputs");
site.copy("runs");

// Ignore files we don't want to copy
site.ignore("_config.ts");
site.ignore("deno.json");
site.ignore("scripts");

export default site;
