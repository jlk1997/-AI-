{
  "name": "opengame-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "phaser": "3.90.0",
    "@opengame/runtime": "__RUNTIME_SPEC__"
  },
  "devDependencies": {
    "typescript": "~5.8.3",
    "vite": "^6.2.6"
  }
}
