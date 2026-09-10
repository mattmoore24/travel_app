module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // A subagent's git worktree lives INSIDE the repo, under .claude/worktrees,
  // and carries a second copy of every test. Without this the suite ran each
  // file twice and reported a test's OLD name after it had been rewritten
  // (skills/traps).
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/\\.claude/'],
  clearMocks: true,
  moduleNameMapper: {
    // Metro understands `import '@/global.css'` (NativeWind); Jest hands the
    // file to the JS parser and dies on the first selector. Nothing under
    // test depends on its contents.
    '\\.css$': '<rootDir>/jest.style-stub.js',
    // The native search module lives beside src, not under it (tsconfig
    // paths already say so); without this the address field and the place
    // search cannot be imported by a test.
    '^@/modules/(.*)$': '<rootDir>/modules/$1',
  },
};
