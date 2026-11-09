const assert = require('node:assert/strict')
const { describe, beforeEach, afterEach, it: test } = require('mocha')
const { createRequire } = require('node:module')
const path = require('node:path')

describe('authentication routes', () => {
  const backend = path.resolve(__dirname, '..')
  const fromBackend = createRequire(path.join(backend, 'package.json'))
  const express = fromBackend('express')
  const request = fromBackend('supertest')
  const bcrypt = fromBackend('bcryptjs')
  const jwt = fromBackend('jsonwebtoken')
  const { ObjectId } = fromBackend('mongodb')
  const testSecret = 'local-auth-contract-test-secret-never-use-in-production'
  const ownerId = new ObjectId('1234567890abcdef12345678')
  let users
  let databaseFailure
  let forceDuplicate

  const collection = {
    async createIndex () { return 'email_1' },
    async findOne (query) {
      if (databaseFailure) throw new Error('private-database-connection-details')
      return users.find(user => query.email !== undefined
        ? user.email === query.email
        : user._id.equals(query._id))
    },
    async insertOne (user) {
      if (forceDuplicate || users.some(existing => existing.email === user.email)) {
        const error = new Error('duplicate')
        error.code = 11000
        throw error
      }
      const inserted = { ...user, _id: new ObjectId() }
      users.push(inserted)
      return { acknowledged: true, insertedId: inserted._id }
    },
    async findOneAndUpdate (query, update) {
      const user = await this.findOne(query)
      if (!user) return null
      Object.assign(user, update.$set)
      return user
    }
  }
  const dbPath = fromBackend.resolve('./models/db')
  const loggerPath = fromBackend.resolve('./logger')
  const routePath = path.join(backend, 'routes/authRoutes.js')
  const cachedModules = [dbPath, loggerPath, routePath].map(id => [id, require.cache[id]])
  let router
  try {
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: async () => ({
        collection (name) { assert.equal(name, 'users'); return collection }
      })
    }
    require.cache[loggerPath] = {
      id: loggerPath,
      filename: loggerPath,
      loaded: true,
      exports: {
        info () {}, error () {}
      }
    }
    delete require.cache[routePath]
    router = fromBackend(routePath)
  } finally {
    // Keep the isolated router, then restore imports before Mocha loads any other suite.
    for (const [id, previous] of cachedModules) {
      if (previous) require.cache[id] = previous
      else delete require.cache[id]
    }
  }
  const app = express()
  app.use(express.json())
  app.use('/api/auth', router)

  let previousSecret
  beforeEach(async () => {
    previousSecret = process.env.JWT_SECRET
    process.env.JWT_SECRET = testSecret
    databaseFailure = false
    forceDuplicate = false
    users = [{
      _id: ownerId,
      email: 'owner@example.com',
      firstName: 'Owner',
      lastName: 'User',
      password: await bcrypt.hash('secret123', 4),
      createdAt: new Date('2025-01-01')
    }]
  })

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previousSecret
  })

  const token = (id = ownerId, options = {}) => jwt.sign({ user: { id: id.toString() } }, testSecret, options)
  const registration = { firstName: ' New ', lastName: ' User ', email: ' NEW@EXAMPLE.COM ', password: 'lac123' }

  test('registration hashes the password and returns the React token/email contract', async () => {
    const response = await request(app).post('/api/auth/register').send(registration)
    assert.equal(response.status, 200)
    assert.equal(response.body.email, 'new@example.com')
    const stored = users.find(user => user.email === 'new@example.com')
    assert.equal(stored.firstName, 'New')
    assert.equal(stored.lastName, 'User')
    assert.notEqual(stored.password, registration.password)
    assert.equal(await bcrypt.compare(registration.password, stored.password), true)
    const claims = jwt.verify(response.body.authtoken, testSecret, { algorithms: ['HS256'] })
    assert.equal(claims.user.id, stored._id.toString())
    assert.ok(claims.exp > claims.iat && claims.exp - claims.iat <= 86400)
    assert.equal(response.body.password, undefined)
  })

  test('registration rejects object-shaped email and passwords over bcrypt byte limit', async () => {
    for (const bad of [{ email: { $ne: null } }, { password: 'é'.repeat(37) }, { firstName: '' }]) {
      const response = await request(app).post('/api/auth/register').send({ ...registration, ...bad })
      assert.equal(response.status, 400)
      assert.equal(response.body.authtoken, undefined)
    }
    assert.equal(users.length, 1)
  })

  test('registration handles existing email and concurrent duplicate index errors', async () => {
    const response = await request(app).post('/api/auth/register').send({ ...registration, email: 'owner@example.com' })
    assert.equal(response.status, 400)
    forceDuplicate = true
    const raced = await request(app).post('/api/auth/register').send(registration)
    assert.equal(raced.status, 400)
    assert.equal(users.length, 1)
  })

  test('login checks bcrypt and returns the name/email contract without credentials', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: ' OWNER@example.com ', password: 'secret123' })
    assert.equal(response.status, 200)
    assert.equal(response.body.userName, 'Owner')
    assert.equal(response.body.userEmail, 'owner@example.com')
    assert.equal(response.body.password, undefined)
    assert.equal(jwt.verify(response.body.authtoken, testSecret).user.id, ownerId.toString())
  })

  test('login refuses wrong password and unknown email with the same safe response', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: 'owner@example.com', password: 'wrong123' })
    const absent = await request(app).post('/api/auth/login').send({ email: 'missing@example.com', password: 'wrong123' })
    assert.equal(wrong.status, 401)
    assert.equal(absent.status, 401)
    assert.deepEqual(wrong.body, absent.body)
    assert.equal(wrong.body.authtoken, undefined)
  })

  test('update changes only the token owner name and issues a valid replacement token', async () => {
    const previousHash = users[0].password
    const response = await request(app).put('/api/auth/update')
      .set('Authorization', `Bearer ${token()}`).set('Email', 'owner@example.com')
      .send({ name: ' Updated ', email: 'owner@example.com', password: 'overwrite', lastName: 'Overwritten' })
    assert.equal(response.status, 200)
    assert.equal(users[0].firstName, 'Updated')
    assert.equal(users[0].lastName, 'User')
    assert.equal(users[0].password, previousHash)
    assert.ok(users[0].updatedAt instanceof Date)
    assert.equal(jwt.verify(response.body.authtoken, testSecret).user.id, ownerId.toString())
  })

  test('update accepts the lab firstName field as well as the React name field', async () => {
    const response = await request(app).put('/api/auth/update')
      .set('Authorization', `Bearer ${token()}`).set('Email', 'owner@example.com')
      .send({ firstName: 'LabName' })
    assert.equal(response.status, 200)
    assert.equal(users[0].firstName, 'LabName')
  })

  test('update rejects missing, tampered, expired, or non-user tokens', async () => {
    const badTokens = ['', token() + 'tampered', token(ownerId, { expiresIn: -1 }), jwt.sign({ user: { id: 'bad-id' } }, testSecret)]
    for (const value of badTokens) {
      const response = await request(app).put('/api/auth/update')
        .set('Authorization', value ? `Bearer ${value}` : '').set('Email', 'owner@example.com')
        .send({ name: 'Hacked' })
      assert.equal(response.status, 401)
    }
    assert.equal(users[0].firstName, 'Owner')
  })

  test('update rejects forged email identity and requires the lab Email header', async () => {
    for (const email of ['other@example.com', '']) {
      const response = await request(app).put('/api/auth/update')
        .set('Authorization', `Bearer ${token()}`).set('Email', email)
        .send({ name: 'Hacked' })
      assert.equal(response.status, email ? 403 : 400)
    }
    const bodyOverride = await request(app).put('/api/auth/update')
      .set('Authorization', `Bearer ${token()}`).set('Email', 'owner@example.com')
      .send({ name: 'Hacked', email: 'other@example.com' })
    assert.equal(bodyOverride.status, 403)
    assert.equal(users[0].firstName, 'Owner')
  })

  test('update rejects non-string names instead of persisting injection-shaped data', async () => {
    const response = await request(app).put('/api/auth/update')
      .set('Authorization', `Bearer ${token()}`).set('Email', 'owner@example.com')
      .send({ name: { $set: 'Hacked' } })
    assert.equal(response.status, 400)
    assert.equal(users[0].firstName, 'Owner')
  })

  test('database errors remain JSON and do not expose internal error details', async () => {
    databaseFailure = true
    const response = await request(app).post('/api/auth/login').send({ email: 'owner@example.com', password: 'secret123' })
    assert.equal(response.status, 500)
    assert.ok(response.body.error)
    assert.equal(response.body.details, undefined)
    assert.equal(JSON.stringify(response.body).includes('private-database'), false)
  })

  test('missing JWT configuration fails before creating an account', async () => {
    delete process.env.JWT_SECRET
    const response = await request(app).post('/api/auth/register').send(registration)
    assert.equal(response.status, 500)
    assert.equal(users.length, 1)
  })
})
