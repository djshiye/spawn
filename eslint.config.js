import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const gjsGlobals = {
    log: 'readonly',
    logError: 'readonly',
    console: 'readonly',
    global: 'readonly',
    imports: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    ARGV: 'readonly',
};

export default tseslint.config(
    {ignores: ['build/**', 'dist/**', 'node_modules/**', '.dev/**', 'docs/**', '.claude/**']},
    js.configs.recommended,
    {
        files: ['src/**/*.ts'],
        extends: [...tseslint.configs.recommended],
        languageOptions: {
            parserOptions: {project: './tsconfig.json'},
            globals: gjsGlobals,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}],
            '@typescript-eslint/consistent-type-imports': ['error', {fixStyle: 'inline-type-imports'}],
            eqeqeq: ['error', 'always', {null: 'ignore'}],
            'prefer-const': 'error',
        },
    },
    {
        files: ['tests/**/*.js', 'eslint.config.js'],
        languageOptions: {
            sourceType: 'module',
            globals: gjsGlobals,
        },
        rules: {
            'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
        },
    },
);
