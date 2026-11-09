const assert = require('node:assert/strict')
const { before, after, test } = require('node:test')
process.env.NODE_ENV = 'production'
const app = require('../index')
let server
let baseUrl

before(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

async function analyze (sentence) {
  const response = await fetch(`${baseUrl}/sentiment?${new URLSearchParams({ sentence })}`, { method: 'POST' })
  assert.equal(response.status, 200)
  return response.json()
}

test('real Natural analyzer identifies positive, negative and neutral sentences', async () => {
  const positive = await analyze('I am happy and love this wonderful gift')
  assert.equal(positive.sentiment, 'positive')
  assert.ok(positive.sentimentScore > 0.33)
  const negative = await analyze('I fell off my bike yesterday and got injured. I am sad and not able to go to work today.')
  assert.equal(negative.sentiment, 'negative')
  assert.ok(negative.sentimentScore < 0)
  const neutral = await analyze('The item is on the table')
  assert.deepEqual(neutral, { sentimentScore: 0, sentiment: 'neutral' })
})

test('a real positive score at or below 0.33 remains neutral', async () => {
  const result = await analyze([...Array(11).fill('good'), ...Array(89).fill('item')].join(' '))
  assert.equal(result.sentimentScore, 0.33)
  assert.equal(result.sentiment, 'neutral')
})

test('missing, blank and structured sentences produce a clear 400 response', async () => {
  for (const query of ['', '?sentence=', '?sentence=%20%20', '?sentence[x]=hello']) {
    const response = await fetch(`${baseUrl}/sentiment${query}`, { method: 'POST' })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error, 'No sentence provided')
  }
})
