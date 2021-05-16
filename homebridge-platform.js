const Wemo = require('./lib/wemo')

const PLATFORM_NAME = 'Wemo3Way'

module.exports = (homebridge) => {
  homebridge.registerPlatform(PLATFORM_NAME, Wemo3WayPlatform)
}

class Wemo3WayPlatform {
  constructor(log, config, api) {
    this.log = log
    if (config) log.info(JSON.stringify(config))
    const wemo = new Wemo(log, config)
    wemo.init()
    log.info('Wemo 3-way initialized')
  }
}
