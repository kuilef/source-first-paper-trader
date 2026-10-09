import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/unit/**/*.test.ts','tests/integration/**/*.test.ts'],environment:'node'},server:{port:4173},build:{target:'es2022'}});
