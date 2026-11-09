const express = require('express')
const multer = require('multer')
const path = require('node:path')
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const connectToDatabase = require('../models/db')
const router = express.Router()
const directoryPath = path.join(__dirname, '..', 'public', 'images')
const imageTypes = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif' }

function badRequest (message) {
  return Object.assign(new Error(message), { status: 400 })
}

const storage = multer.diskStorage({
  destination (req, file, cb) {
    fs.mkdir(directoryPath, { recursive: true }, error => cb(error, directoryPath))
  },
  filename (req, file, cb) {
    cb(null, `${randomUUID()}${imageTypes[file.mimetype]}`)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, fields: 20 },
  fileFilter (req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase()
    if (!imageTypes[file.mimetype] || !['.jpg', '.jpeg', '.png', '.gif'].includes(extension)) {
      return cb(badRequest('Upload a JPG, PNG or GIF image'))
    }
    cb(null, true)
  }
})

function itemFields (body, creating = false) {
  const item = {}
  for (const field of ['name', 'category', 'condition', 'zipcode', 'description']) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string' || body[field].length > 10000) {
        throw badRequest(`Invalid ${field}`)
      }
      item[field] = body[field].trim()
    }
  }
  if (creating && !item.name) throw badRequest('An item name is required')
  if (body.age_days !== undefined || creating) {
    const value = body.age_days === undefined ? 0 : body.age_days
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') {
      throw badRequest('age_days must be a nonnegative number')
    }
    const ageDays = Number(value)
    if (!Number.isFinite(ageDays) || ageDays < 0) throw badRequest('age_days must be a nonnegative number')
    item.age_days = ageDays
    item.age_years = Number((ageDays / 365).toFixed(creating ? 2 : 1))
  }
  return item
}

async function getCollection () {
  const db = await connectToDatabase()
  return db.collection(process.env.MONGO_COLLECTION || 'secondChanceItems')
}

router.get('/', async (req, res, next) => {
  try {
    const collection = await getCollection()
    res.json(await collection.find({}).toArray())
  } catch (error) {
    next(error)
  }
})

router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const secondChanceItem = itemFields(req.body, true)
    const collection = await getCollection()
    const ids = await collection.find({}, { projection: { id: 1 } }).toArray()
    const lastId = ids.reduce((max, item) => /^\d+$/.test(item.id) && Number.isSafeInteger(Number(item.id))
      ? Math.max(max, Number(item.id))
      : max, 0)
    const db = await connectToDatabase()
    const counters = db.collection('itemCounters')
    const counterKey = { _id: collection.collectionName }
    // Seed from existing numeric IDs, then reserve each new ID atomically.
    try {
      await counters.updateOne(counterKey, { $max: { sequence: lastId } }, { upsert: true })
    } catch (error) {
      if (error.code !== 11000) throw error
      await counters.updateOne(counterKey, { $max: { sequence: lastId } })
    }
    const counter = await counters.findOneAndUpdate(counterKey, { $inc: { sequence: 1 } }, { returnDocument: 'after' })
    secondChanceItem.id = String(counter.sequence)
    secondChanceItem.date_added = Math.floor(Date.now() / 1000)
    secondChanceItem.comments = []
    secondChanceItem.image = req.file ? `/images/${req.file.filename}` : ''
    const result = await collection.insertOne(secondChanceItem)
    res.status(201).json({ ...secondChanceItem, _id: result.insertedId })
  } catch (error) {
    if (req.file) await fs.promises.rm(req.file.path, { force: true }).catch(() => {})
    next(error)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const collection = await getCollection()
    const secondChanceItem = await collection.findOne({ id: req.params.id })
    if (!secondChanceItem) return res.status(404).json({ error: 'secondChanceItem not found' })
    res.json(secondChanceItem)
  } catch (error) {
    next(error)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const collection = await getCollection()
    const secondChanceItem = await collection.findOne({ id: req.params.id })
    if (!secondChanceItem) return res.status(404).json({ error: 'secondChanceItem not found' })
    const fields = itemFields(req.body)
    // The lab updates these fields; item identity and original name stay stable.
    delete fields.name
    delete fields.zipcode
    fields.updatedAt = new Date()
    await collection.updateOne({ id: req.params.id }, { $set: fields })
    res.json({ uploaded: 'success' })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const collection = await getCollection()
    const result = await collection.deleteOne({ id: req.params.id })
    if (!result.deletedCount) return res.status(404).json({ error: 'secondChanceItem not found' })
    res.json({ deleted: 'success' })
  } catch (error) {
    next(error)
  }
})

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) error.status = 400
  next(error)
})

module.exports = router
