const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['qrcode-lib.js', 'worker/**', 'node_modules/**', 'dist/**', '.wrangler/**', 'www/**', 'android/**'] },

  js.configs.recommended,

  {
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // app.js — main POS controller, loaded as a classic <script> in index.html
  {
    files: ['app.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        google: 'writable',
        posApiSetup: 'writable',
        POS_LOCAL_CONFIG: 'readonly',
        tailwind: 'readonly',
        qrcode: 'readonly',
        ONLINE_ORDER_ENABLED: 'readonly',
        escAttr: 'readonly',
        escHtml: 'readonly',
        bufToHex: 'readonly',
        sha256Hex: 'readonly',
        hashPinWithSalt: 'readonly',
        calcVatBreakdown: 'readonly',
        unitCost: 'readonly',
        recipeCost: 'readonly',
        parseCostExtras: 'readonly',
        COST_EXTRA_PREFIX: 'readonly',
      },
    },
  },

  // order.js — public order page, loaded as a classic <script> in order.html
  {
    files: ['order.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        tailwind: 'readonly',
        ONLINE_ORDER_ENABLED: 'readonly',
        escAttr: 'readonly',
        escHtml: 'readonly',
      },
    },
  },

  // config.local.js / config.local.example.js — optional local dev override, loaded via <script> in index.html
  {
    files: ['config.local.js', 'config.local.example.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.es2021 },
    },
  },

  // lang-my.js — พจนานุกรมภาษาพม่า โหลดเป็น <script> ธรรมดาก่อน app.js
  {
    files: ['lang-my.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.es2021 },
    },
  },

  // pure-helpers.js — shared by app.js/order.js (classic <script>) and Node tests (require)
  {
    files: ['pure-helpers.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        module: 'writable',
      },
    },
  },

  // sw.js — service worker
  {
    files: ['sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.serviceworker,
        ...globals.es2021,
      },
    },
  },

  // this config file + tests: plain Node CommonJS
  {
    files: ['eslint.config.js', 'tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
];
