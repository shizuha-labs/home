import '@testing-library/jest-dom'

// Mock localStorage
const store = {}
global.localStorage = {
  getItem: (key) => store[key] ?? null,
  setItem: (key, value) => { store[key] = value },
  removeItem: (key) => { delete store[key] },
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
}

// Mock fetch
global.fetch = async () => {
  throw new Error('fetch not mocked in this test')
}
