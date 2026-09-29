/// <reference types="vite/client" />

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare const __OUTLINE_FOLD_VERSION__: string;
