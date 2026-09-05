module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
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
