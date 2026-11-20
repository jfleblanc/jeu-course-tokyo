import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** Hash court du commit, injecté au build pour l'afficher dans un coin de l'écran. */
function commitHash(): string {
  const fromCi = process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig(({ command }) => ({
  // GitHub Pages sert le jeu sous /<nom-du-dépôt>/ ; Cloudflare (course.jfleblanc.com) à la racine : BASE=/
  base: process.env.BASE ?? (command === 'build' ? '/jeu-course-tokyo/' : '/'),
  define: {
    __APP_VERSION__: JSON.stringify(commitHash()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
}));
