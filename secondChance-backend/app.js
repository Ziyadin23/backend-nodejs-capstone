require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const pinoHttp = require('pino-http')
const logger = require('./logger')
const connectToDatabase = require('./models/db')
const secondChanceItemsRoutes = require('./routes/secondChanceItemsRoutes')
const authRoutes = require('./routes/authRoutes')
const searchRoutes = require('./routes/searchRoutes')

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(pinoHttp({ logger }))
app.use(express.static(path.join(__dirname, 'public')))
app.use('/api/secondchance/items', secondChanceItemsRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/secondchance/search', searchRoutes)

app.get('/', (req, res) => {
  res.send('Inside the server')
})

app.use((error, req, res, next) => {
  const status = error.status >= 400 && error.status < 500 ? error.status : 500
  if (status === 500) logger.error({ err: error }, 'Request failed')
  res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message })
})

if (require.main === module) {
  connectToDatabase().then(() => {
    const port = Number(process.env.PORT || 3060)
    const server = app.listen(port, () => {
      console.log(`Server running on port ${server.address().port}`)
    })
  }).catch(error => {
    logger.error({ err: error }, 'Failed to start application')
    process.exitCode = 1
  })
}

module.exports = app
