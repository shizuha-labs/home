import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { userFromAccessToken } from '../src/utils/auth.js'

const [auth, ctx] = await Promise.all([
  readFile(new URL('../src/utils/auth.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8'),
])

assert.match(auth, /typeof token !== 'string' \|\| !token/)
assert.match(ctx, /token \? userFromAccessToken\(token\) : null/)
assert.equal(userFromAccessToken(null), null)
assert.equal(userFromAccessToken(''), null)
assert.equal(userFromAccessToken(), null)
console.log('logged-out auth: ok')
