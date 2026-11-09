const express = require('express')
const connectToDatabase = require('../models/db')
const router = express.Router()

router.get('/', async (req, res, next) => {
  try {
    const query = {}
    for (const field of ['name', 'category', 'condition', 'age_years']) {
      const value = req.query[field]
      if (value === undefined) continue
      if (typeof value !== 'string' || value.length > 200) {
        return res.status(400).json({ error: `Invalid ${field} filter` })
      }
      const text = value.trim()
      if (!text) continue
      if (field === 'name') {
        query.name = { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
      } else if (field === 'age_years') {
        const age = Number(text)
        if (!Number.isFinite(age) || age < 0) {
          return res.status(400).json({ error: 'age_years must be a nonnegative number' })
        }
        query.age_years = { $lte: age }
      } else {
        query[field] = text
      }
    }
    const db = await connectToDatabase()
    const collection = db.collection(process.env.MONGO_COLLECTION || 'secondChanceItems')
    res.json(await collection.find(query).toArray())
  } catch (error) {
    next(error)
  }
})

module.exports = router
