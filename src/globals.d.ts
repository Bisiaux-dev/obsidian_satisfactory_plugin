/** Allows importing a .css file as a text string (esbuild `text` loader). */
declare module "*.css" {
  const content: string;
  export default content;
}

/** Allows importing a .md file as a text string (esbuild `text` loader) — embedded guide. */
declare module "*.md" {
  const content: string;
  export default content;
}
