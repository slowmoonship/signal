import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/*.tsbuildinfo',
      'data/**',
      // Next 自动生成，其中的三斜线类型引用是 Next 的要求，不受本仓库规则约束
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // 测试文件与根/工具配置文件不属于任何 package 的 tsconfig include，
          // 需要显式允许，否则 project service 拒绝解析它们。
          // 注意：allowDefaultProject 不支持 `**`，新增嵌套测试目录时要在此补一行。
          allowDefaultProject: [
            'vitest.config.ts',
            'eslint.config.js',
            'packages/*/test/*.ts',
            'apps/web/*.config.ts',
            'apps/web/*.config.mjs',
          ],
          // 默认工程的匹配数上限只有 8，超过就直接解析失败。
          // 测试文件一多就会撞上（这些文件本来就都不在任何 build 产物里，
          // 提高上限不会拖慢常规检查）。
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 32,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 数据缺失是常态，用类型表达而不是骗编译器
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // 未使用的变量一律报错，但允许下划线前缀
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    // 测试与 CLI 允许用 any/断言来构造非法输入——那正是它们的目的
    files: ['**/test/**/*.ts', 'packages/*/src/cli.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // 配置文件由各工具自行加载，不参与类型化 lint
    files: ['eslint.config.js'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // web 侧 Next.js/React 约定
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
)
