// Correctness rules only (no style rules). app.js and core.js are classic
// browser scripts; core.js is also loaded by the Node unit tests via CommonJS.
const browser = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
  fetch: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  requestAnimationFrame: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly',
  getComputedStyle: 'readonly', matchMedia: 'readonly', AbortController: 'readonly', CSS: 'readonly',
  self: 'readonly', L: 'readonly',
};
const rules = {
  'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none' }], 'no-redeclare': 'error', 'no-dupe-keys': 'error',
  'no-duplicate-case': 'error', 'no-unreachable': 'error', 'no-constant-condition': 'warn', eqeqeq: ['warn', 'smart'],
  'no-var': 'warn', 'prefer-const': 'warn', 'no-empty': ['warn', { allowEmptyCatch: false }], 'no-fallthrough': 'error',
  'no-self-assign': 'error', 'no-shadow-restricted-names': 'error', 'no-undef-init': 'warn', 'use-isnan': 'error',
  'valid-typeof': 'error', 'no-cond-assign': 'error', 'no-func-assign': 'error', 'no-inner-declarations': 'warn',
  'no-prototype-builtins': 'warn',
};
export default [
  { files: ['app.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: browser }, rules },
  { files: ['core.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { self: 'readonly', module: 'writable', URLSearchParams: 'readonly' } }, rules },
  { files: ['tests/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { require: 'readonly', module: 'writable', __dirname: 'readonly', process: 'readonly', console: 'readonly', setTimeout: 'readonly', URL: 'readonly' } }, rules },
];
