/** Permet d'importer un .css comme chaîne de texte (loader esbuild `text`). */
declare module "*.css" {
  const content: string;
  export default content;
}

/** Permet d'importer un .md comme chaîne de texte (loader esbuild `text`) — guide embarqué. */
declare module "*.md" {
  const content: string;
  export default content;
}
