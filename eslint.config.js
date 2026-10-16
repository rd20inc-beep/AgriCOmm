import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import a11yLite from './eslint-rules/a11y-lite.js'

// P5-14 accessibility checks (eslint-rules/a11y-lite.js — a local stand-in for
// eslint-plugin-jsx-a11y, which is not installed). 'warn' everywhere so the
// ~800 existing labels don't fail CI; 'error' on files already brought up to
// standard, so they can't regress.
const A11Y_RULES = ['click-events-have-key-events', 'label-has-associated-control']
const a11yLevel = (level) => Object.fromEntries(A11Y_RULES.map((r) => [`a11y-lite/${r}`, level]))
const A11Y_CLEAN_FILES = [
  'src/components/SlideDrawer.jsx',
  'src/components/ConfirmDialog.jsx',
  'src/components/ScanDrawer.jsx',
  'src/components/SupplierPicker.jsx',
  'src/components/CustomerPicker.jsx',
  'src/components/HaulerPicker.jsx',
  'src/components/BagTypePicker.jsx',
  'src/components/ItemPicker.jsx',
  'src/components/RiceTypePicker.jsx',
  'src/shared/components/Modal.jsx',
  'src/shared/components/SearchSelect.jsx',
  'src/shared/components/FormField.jsx',
  'src/shared/components/Breadcrumbs.jsx',
  'src/shared/components/DiscardChangesDialog.jsx',
  'src/modules/inventory/pages/StockCount.jsx',
]

export default defineConfig([
  globalIgnores([
    'dist',
    'backend/migrations',
    'backend/seeds',
    'node_modules',
  ]),

  // ── Frontend (src/) — browser + ESM + React ──
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { 'a11y-lite': a11yLite },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      ...a11yLevel('warn'),
    },
  },

  // ── Accessibility: files already fixed must stay fixed ──
  {
    files: A11Y_CLEAN_FILES,
    rules: a11yLevel('error'),
  },

  // ── Backend (backend/) — Node + CommonJS ──
  {
    files: ['backend/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
      sourceType: 'commonjs',
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },

  // ── Backend tests — jest injects describe/test/expect/jest as globals ──
  // Without this every backend test file reports thousands of false no-undef
  // errors, which would drown a real one in the CI lint gate.
  {
    files: ['backend/**/__tests__/**/*.js', 'backend/**/*.test.js'],
    languageOptions: {
      globals: globals.jest,
    },
  },
])
