const package = require('../package.json')
const pino = require('pino')

module.exports = pino(
  (module.exports = {
    name: package.name,
    level: process.env.LOG_LEVEL || 'debug',
    redact: undefined,
    formatters: {
      level(label) {
        return { level: label }
      }
    },
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
    prettyPrint:
      process.env.LOG_PRETTY !== undefined
        ? !!+process.env.LOG_PRETTY
        : process.env.NODE_ENV !== 'production'
  })
)
