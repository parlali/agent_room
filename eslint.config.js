import { tanstackConfig } from '@tanstack/eslint-config'

export default [
    ...tanstackConfig,
    {
        rules: {
            'import/no-cycle': 'off',
            'import/order': 'off',
            'sort-imports': 'off',
            '@typescript-eslint/array-type': 'off',
            '@typescript-eslint/require-await': 'off',
            'pnpm/json-enforce-catalog': 'off',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            '@typescript-eslint/no-unnecessary-condition': 'off',
            'import/consistent-type-specifier-style': 'off',
        },
    },
    {
        ignores: [
            'eslint.config.js',
            'prettier.config.js',
            'worker-configuration.d.ts',
            'apps/self-hosted/worker-configuration.d.ts',
            'apps/self-hosted/db/migrations/*.sql',
            'apps/self-hosted/src/routeTree.gen.ts',
            'packages/brand/exports/**',
        ],
    },
]
