const express = require('express')
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { ObjectId } = require('mongodb')
const { body, header, validationResult } = require('express-validator')
const connectToDatabase = require('../models/db')
const logger = require('../logger')

const router = express.Router()

function emailRule (optional = false) {
  const rule = optional ? body('email').optional() : body('email')
  return rule.isString().bail().trim().isEmail().isLength({ max: 254 }).toLowerCase()
}

function passwordRule () {
  return body('password').isString().bail().isLength({ min: 6 })
    .custom(password => Buffer.byteLength(password, 'utf8') <= 72)
}

function validate (req, res, next) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Invalid input',
      errors: errors.array({ onlyFirstError: true }).map(error => ({
        field: error.path,
        message: error.msg
      }))
    })
  }
  next()
}

function signToken (id) {
  return jwt.sign({ user: { id: id.toString() } }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h'
  })
}

function serverError (res, error) {
  logger.error({ name: error.name, code: error.code }, 'Authentication request failed')
  return res.status(500).json({ error: 'Internal server error' })
}

router.use((req, res, next) => {
  if (!process.env.JWT_SECRET) {
    logger.error('JWT_SECRET is not configured')
    return res.status(500).json({ error: 'Internal server error' })
  }
  next()
})

router.post('/register', [
  emailRule(),
  passwordRule(),
  body('firstName').isString().bail().trim().isLength({ min: 1, max: 100 }),
  body('lastName').isString().bail().trim().isLength({ min: 1, max: 100 })
], validate, async (req, res) => {
  try {
    const db = await connectToDatabase()
    const collection = db.collection('users')
    // The unique index also prevents two simultaneous requests registering one email.
    await collection.createIndex({ email: 1 }, { unique: true })
    const { email, firstName, lastName, password } = req.body
    if (await collection.findOne({ email })) {
      return res.status(400).json({ error: 'Email id already exists' })
    }

    const hash = await bcryptjs.hash(password, 10)
    const newUser = await collection.insertOne({
      email,
      firstName,
      lastName,
      password: hash,
      createdAt: new Date()
    })
    const authtoken = signToken(newUser.insertedId)
    logger.info('User registered successfully')
    return res.json({ authtoken, email })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Email id already exists' })
    }
    return serverError(res, error)
  }
})

router.post('/login', [emailRule(), passwordRule()], validate, async (req, res) => {
  try {
    const db = await connectToDatabase()
    const collection = db.collection('users')
    const user = await collection.findOne({ email: req.body.email })
    if (!user || !await bcryptjs.compare(req.body.password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const authtoken = signToken(user._id)
    logger.info('User logged in successfully')
    return res.json({ authtoken, userName: user.firstName, userEmail: user.email })
  } catch (error) {
    return serverError(res, error)
  }
})

router.put('/update', [
  header('email').isString().bail().trim().isEmail().isLength({ max: 254 }).toLowerCase(),
  emailRule(true),
  body('name').customSanitizer((name, { req }) => name === undefined ? req.body.firstName : name)
    .isString().bail().trim().isLength({ min: 1, max: 100 })
], validate, async (req, res) => {
  const authorization = /^Bearer (\S+)$/i.exec(req.get('Authorization') || '')
  if (!authorization) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  let claims
  try {
    claims = jwt.verify(authorization[1], process.env.JWT_SECRET, { algorithms: ['HS256'] })
    if (!claims.user || typeof claims.user.id !== 'string' || !/^[a-f\d]{24}$/i.test(claims.user.id)) {
      return res.status(401).json({ error: 'Invalid authentication token' })
    }
  } catch (error) {
    return res.status(401).json({ error: 'Invalid authentication token' })
  }

  try {
    const db = await connectToDatabase()
    const collection = db.collection('users')
    const user = await collection.findOne({ _id: new ObjectId(claims.user.id) })
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (req.headers.email !== user.email || (req.body.email !== undefined && req.body.email !== user.email)) {
      return res.status(403).json({ error: 'Email does not match the authenticated user' })
    }

    const updatedUser = await collection.findOneAndUpdate(
      { _id: user._id },
      { $set: { firstName: req.body.name, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )
    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    const authtoken = signToken(updatedUser._id)
    logger.info('User updated successfully')
    return res.json({ authtoken })
  } catch (error) {
    return serverError(res, error)
  }
})

module.exports = router
