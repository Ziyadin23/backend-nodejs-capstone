require('dotenv').config()
const { MongoClient } = require('mongodb')

let dbInstance
let connectionPromise

async function connectToDatabase () {
  if (dbInstance) return dbInstance
  if (connectionPromise) return connectionPromise

  const { MONGO_URL, MONGO_DB } = process.env
  if (!MONGO_URL || !MONGO_DB) {
    throw new Error('MONGO_URL and MONGO_DB must be configured')
  }

  let client
  try {
    client = new MongoClient(MONGO_URL)
  } catch {
    // Driver parse errors can contain the URI, including its credentials.
    throw new Error('Invalid MongoDB configuration')
  }
  connectionPromise = (async () => {
    try {
      await client.connect()
      dbInstance = client.db(MONGO_DB)
      return dbInstance
    } catch (error) {
      await client.close()
      throw error
    } finally {
      connectionPromise = undefined
    }
  })()
  return connectionPromise
}

module.exports = connectToDatabase
