import esbuild from "esbuild";

const ctx = await esbuild.context({
  entryPoints: ["harness/harness.tsx"],
  bundle: true,
  outfile: "harness/bundle.js",
  jsx: "automatic",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"development"' },
  sourcemap: "inline",
  logLevel: "info",
});

await ctx.watch();
const { port } = await ctx.serve({ servedir: "harness", port: 8123 });
console.log("SERVE http://localhost:" + port);
