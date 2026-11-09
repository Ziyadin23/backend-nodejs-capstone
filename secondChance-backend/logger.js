const pino = require('pino')

const options = {
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers.email',
    'req.body.password',
    'req.body.token'
  ]
}

if (process.env.NODE_ENV !== 'production') {
  options.level = 'debug'
  options.transport = { target: 'pino-pretty' }
}

module.exports = pino(options)
