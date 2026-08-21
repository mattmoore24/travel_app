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
  },
};
