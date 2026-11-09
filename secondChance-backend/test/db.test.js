const assert = require('node:assert/strict')
const sinon = require('sinon')
const { MongoClient } = require('mongodb')

function freshConnector () {
  const modulePath = require.resolve('../models/db')
  const original = require.cache[modulePath]
  delete require.cache[modulePath]
  const connect = require(modulePath)
  require.cache[modulePath] = original
  return connect
}

describe('MongoDB connection recovery', function () {
  this.timeout(10000)

  it('rejects missing configuration without exposing a connection string', async function () {
    const original = process.env.MONGO_URL
    delete process.env.MONGO_URL
    try {
      await assert.rejects(freshConnector()(), { message: 'MONGO_URL and MONGO_DB must be configured' })
    } finally {
      process.env.MONGO_URL = original
    }
  })

  it('allows a real connection after an initial connection failure', async function () {
    const connect = freshConnector()
    const failure = sinon.stub(MongoClient.prototype, 'connect').callThrough()
    failure.onFirstCall().rejects(new Error('Temporary connection failure'))
    let db
    try {
      await assert.rejects(connect(), /Temporary connection failure/)
      db = await connect()
      assert.equal((await db.command({ ping: 1 })).ok, 1)
    } finally {
      failure.restore()
      if (db) await db.client.close()
    }
  })

  it('does not expose credentials when the MongoDB URI cannot be parsed', async function () {
    const original = process.env.MONGO_URL
    process.env.MONGO_URL = 'mongodb://example-user:dummy-secret@'
    try {
      await assert.rejects(freshConnector()(), error => {
        assert.equal(error.message, 'Invalid MongoDB configuration')
        assert.ok(!error.stack.includes('dummy-secret'))
        return true
      })
    } finally {
      process.env.MONGO_URL = original
    }
  })
})
