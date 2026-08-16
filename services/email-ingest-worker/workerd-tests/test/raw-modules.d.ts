// Minimal ambient declaration for Vite's `?raw` string-import suffix, used
// by the Workers-runtime spec to bundle a synthetic .eml fixture as a
// string at build time (no filesystem exists inside workerd at runtime).
declare module "*?raw" {
  const content: string;
  export default content;
}
