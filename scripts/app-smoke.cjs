const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const path = require('node:path')
const { createRequire } = require('node:module')
const backend = path.join(__dirname, '..', 'secondChance-backend')
const backendRequire = createRequire(path.join(backend, 'package.json'))
const { MongoClient } = backendRequire('mongodb')

async function main () {
  const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'
  assert.match(mongoUrl, /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/, 'Smoke test requires a loopback test database')
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 3000 })
  const databaseName = `secondChance_app_smoke_${process.pid}`
  let child
  let connected = false
  let output = ''
  try {
    await client.connect()
    connected = true
    await client.db(databaseName).collection('secondChanceItems').insertOne({ id: 'smoke-1', name: 'CI lamp', category: 'Office', condition: 'New', age_days: 0, age_years: 0, comments: [] })
    child = spawn(process.execPath, ['app.js'], {
      cwd: backend,
      env: { ...process.env, MONGO_URL: mongoUrl, MONGO_DB: databaseName, MONGO_COLLECTION: 'secondChanceItems', JWT_SECRET: 'local-smoke-test-secret', NODE_ENV: 'production', PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Application did not become ready: ' + output)), 15000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Application exited before ready: ' + code + ' ' + output)) })
      child.stderr.on('data', data => { output += data.toString() })
      child.stdout.on('data', data => {
        output += data.toString()
        const match = output.match(/Server running on port (\d+)/)
        if (match) { clearTimeout(timer); resolve(Number(match[1])) }
      })
    })
    const response = await fetch(`http://127.0.0.1:${port}/api/secondchance/items`)
    assert.equal(response.status, 200, 'The application must expose the items API')
    const items = await response.json()
    assert.equal(items.length, 1)
    assert.equal(items[0].name, 'CI lamp', 'The API must use the configured database')
    console.log('Application HTTP smoke test passed')
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
    if (connected) await client.db(databaseName).dropDatabase()
    await client.close()
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
