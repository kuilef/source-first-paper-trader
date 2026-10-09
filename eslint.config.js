import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ignores:['dist/**','artifacts/**','node_modules/**','.superpowers/**','playwright-report/**','test-results/**']},js.configs.recommended,...tseslint.configs.recommended,{languageOptions:{globals:{console:'readonly',process:'readonly',URL:'readonly',Response:'readonly',Request:'readonly',fetch:'readonly',setTimeout:'readonly',clearTimeout:'readonly',TextEncoder:'readonly'}},rules:{'@typescript-eslint/no-explicit-any':'error'}});
