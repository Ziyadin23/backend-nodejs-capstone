const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const express = require('express')
const request = require('supertest')
const { MongoClient } = require('mongodb')

// Refuse remote databases and isolate every run from application/seed data.
const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(mongoUrl)) {
  throw new Error('API tests require an unauthenticated loopback MongoDB instance')
}
process.env.MONGO_URL = mongoUrl
process.env.MONGO_DB = `secondChance_api_test_${process.pid}`
process.env.MONGO_COLLECTION = 'secondChanceItems'
process.env.NODE_ENV = 'production'

const connectToDatabase = require('../models/db')
const app = express()
app.use(express.json())
app.use('/api/secondchance/items', require('../routes/secondChanceItemsRoutes'))
app.use('/api/secondchance/search', require('../routes/searchRoutes'))
app.use((error, req, res, next) => {
  res.status(error.status || 500).json({ error: error.message })
})

const fixtures = [
  { id: '396', name: 'Curtain', category: 'Office', condition: 'Older', age_days: 1073, age_years: 2.94, description: 'Flowing curtains', image: '/images/curtains1.jpeg', comments: [] },
  { id: '999', name: 'Lamp.*', category: 'Office', condition: 'New', age_days: 0, age_years: 0, description: 'Brand new lamp', image: '/images/lamp.jpeg', comments: [] },
  { id: '1000', name: 'Lamp shade', category: 'Living', condition: 'Like New', age_days: 182, age_years: 0.5, description: 'A shade', image: '/images/lamp.jpeg', comments: [] }
]

describe('SecondChance items and search with MongoDB', function () {
  this.timeout(10000)
  let client
  let collection
  const uploadedFiles = []

  before(async function () {
    client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 3000 })
    await client.connect()
    collection = client.db(process.env.MONGO_DB).collection(process.env.MONGO_COLLECTION)
  })

  beforeEach(async function () {
    await client.db(process.env.MONGO_DB).dropDatabase()
    await collection.insertMany(fixtures.map(item => ({ ...item })))
  })

  after(async function () {
    if (client) {
      await client.db(process.env.MONGO_DB).dropDatabase()
      await client.close()
    }
    const db = await connectToDatabase()
    await db.client.close()
    await Promise.all(uploadedFiles.map(file => fs.rm(file, { force: true })))
  })

  it('reuses the connected database across simultaneous requests', async function () {
    const connections = await Promise.all([connectToDatabase(), connectToDatabase(), connectToDatabase()])
    assert.equal(connections[0], connections[1])
    assert.equal(connections[1], connections[2])
    assert.equal((await connections[0].command({ ping: 1 })).ok, 1)
  })

  it('lists all actual documents and reads a string item ID', async function () {
    const listing = await request(app).get('/api/secondchance/items').expect(200)
    assert.deepEqual(listing.body.map(item => item.id).sort(), ['1000', '396', '999'])
    const detail = await request(app).get('/api/secondchance/items/396').expect(200)
    assert.equal(detail.body.name, 'Curtain')
    assert.equal(detail.body.category, 'Office')
  })

  it('returns 404 for absent detail, update and delete', async function () {
    await request(app).get('/api/secondchance/items/missing').expect(404)
    await request(app).put('/api/secondchance/items/missing').send({ age_days: 365 }).expect(404)
    await request(app).delete('/api/secondchance/items/missing').expect(404)
  })

  it('persists a multipart item with a safe actual image path and numeric age', async function () {
    const response = await request(app).post('/api/secondchance/items')
      .field('name', 'Test chair').field('category', 'Office').field('condition', 'Like New')
      .field('description', 'A comfortable chair').field('zipcode', '12345')
      .field('age_days', '1073').field('age_years', '900').field('comments', '')
      .field('id', 'injected').field('image', '/images/lamp.jpeg')
      .attach('file', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64'), { filename: 'lamp.png', contentType: 'image/png' })
      .expect(201)
    const imageFile = path.join(__dirname, '..', 'public', response.body.image)
    uploadedFiles.push(imageFile)
    assert.equal(response.body.id, '1001')
    assert.equal(response.body.age_days, 1073)
    assert.equal(response.body.age_years, 2.94)
    assert.ok(Number.isInteger(response.body.date_added))
    assert.deepEqual(response.body.comments, [])
    assert.match(response.body.image, /^\/images\/[a-f0-9-]+\.png$/)
    assert.ok((await fs.stat(imageFile)).size > 0)
    const stored = await collection.findOne({ id: '1001' })
    assert.equal(stored.image, response.body.image)
    assert.equal(stored.name, 'Test chair')
  })

  it('rejects malformed ages and unsupported uploads', async function () {
    await request(app).post('/api/secondchance/items').send({ name: 'Chair', age_days: 'bad' }).expect(400)
    await request(app).post('/api/secondchance/items').field('name', 'Chair')
      .attach('file', Buffer.from('<script>test</script>'), { filename: 'image.html', contentType: 'text/html' }).expect(400)
    assert.equal(await collection.countDocuments({}), 3)
  })

  it('assigns distinct numeric string IDs to simultaneous new items', async function () {
    const responses = await Promise.all(['First chair', 'Second chair'].map(name =>
      request(app).post('/api/secondchance/items').send({ name, age_days: 10 }).expect(201)
    ))
    assert.notEqual(responses[0].body.id, responses[1].body.id)
    assert.deepEqual(responses.map(response => response.body.id).sort(), ['1001', '1002'])
    assert.equal(await collection.countDocuments({}), 5)
  })

  it('updates allowed fields and derives age without replacing the ID', async function () {
    await request(app).put('/api/secondchance/items/396')
      .send({ category: 'Bedroom', condition: 'New', age_days: '365', description: 'Updated', id: 'evil' })
      .expect(200, { uploaded: 'success' })
    const stored = await collection.findOne({ id: '396' })
    assert.equal(stored.name, 'Curtain')
    assert.equal(stored.category, 'Bedroom')
    assert.equal(stored.age_days, 365)
    assert.equal(stored.age_years, 1)
    assert.ok(stored.updatedAt instanceof Date)
  })

  it('deletes the actual selected document', async function () {
    await request(app).delete('/api/secondchance/items/396').expect(200, { deleted: 'success' })
    assert.equal(await collection.findOne({ id: '396' }), null)
    assert.equal(await collection.countDocuments({}), 2)
  })

  it('matches the official Office/Curtain example case-insensitively', async function () {
    const response = await request(app).get('/api/secondchance/search').query({ category: 'Office', name: 'curt' }).expect(200)
    assert.deepEqual(response.body.map(item => item.id), ['396'])
  })

  it('combines condition and maximum age, including decimal and zero ages', async function () {
    const decimal = await request(app).get('/api/secondchance/search').query({ age_years: '0.5', condition: 'Like New' }).expect(200)
    assert.deepEqual(decimal.body.map(item => item.id), ['1000'])
    const zero = await request(app).get('/api/secondchance/search').query({ age_years: '0' }).expect(200)
    assert.deepEqual(zero.body.map(item => item.id), ['999'])
  })

  it('allows blank filters and treats regex characters as literal text', async function () {
    const all = await request(app).get('/api/secondchance/search').query({ name: '', category: '', condition: '' }).expect(200)
    assert.equal(all.body.length, 3)
    const literal = await request(app).get('/api/secondchance/search').query({ name: '.*' }).expect(200)
    assert.deepEqual(literal.body.map(item => item.id), ['999'])
  })

  it('rejects malformed numeric and structured query inputs', async function () {
    await request(app).get('/api/secondchance/search').query({ age_years: 'garbage' }).expect(400)
    await request(app).get('/api/secondchance/search').query({ age_years: '-1' }).expect(400)
    await request(app).get('/api/secondchance/search?category[$ne]=Office').expect(400)
  })
})
