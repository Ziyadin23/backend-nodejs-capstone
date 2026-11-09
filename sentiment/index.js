require('dotenv').config()
const express = require('express')
const natural = require('natural')
const logger = require('./logger')
const expressPino = require('express-pino-logger')({ logger })
const app = express()
const port = process.env.PORT || 3000
const analyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn')

app.use(express.json())
app.use(expressPino)

app.post('/sentiment', (req, res) => {
  // Query parameters match the lab's provided curl and integration contract.
  const { sentence } = req.query
  if (typeof sentence !== 'string' || !sentence.trim()) {
    return res.status(400).json({ error: 'No sentence provided' })
  }

  try {
    const sentimentScore = analyzer.getSentiment(sentence.trim().split(/\s+/))
    let sentiment = 'neutral'
    if (sentimentScore < 0) sentiment = 'negative'
    else if (sentimentScore > 0.33) sentiment = 'positive'
    logger.info({ sentimentScore, sentiment }, 'Sentiment analysis result')
    res.status(200).json({ sentimentScore, sentiment })
  } catch (error) {
    logger.error('Error performing sentiment analysis')
    res.status(500).json({ message: 'Error performing sentiment analysis' })
  }
})

if (require.main === module) {
  app.listen(port, () => logger.info(`Server running on port ${port}`))
}

module.exports = app
