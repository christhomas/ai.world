// Execute on GitHub only. Reuses the repository's pinned Vite dependency.
import { build } from 'vite';
await build({ configFile: false, build: { target: 'es2022', outDir: 'runtime-spike-out', minify: false, lib: { entry: 'tools/mobile-runtime-spike/workload.ts', name: 'MobileSpike', formats: ['iife'], fileName: () => 'workload.js' } } });
