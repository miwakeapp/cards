import lume from "lume/mod.ts";
import esbuild from "lume/plugins/esbuild.ts";

const site = lume({
  src: "./src",
  server: {
    open: true,
  },
});

site.add("index.html");
site.add("styles/");
site.add("fonts/");
site.add("data/");
site.add("main.ts");

site.use(esbuild({
  extensions: [".ts"],
  options: {
    minify: false,
    treeShaking: false,
    keepNames: false,
  },
}));

export default site;
