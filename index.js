const Wemo = require('wemo-client')
const log = require('./lib/log')

const DISCOVER_INITIAL_INTERVAL = 15000
const DISCOVER_INITIAL_ATTEMPTS = 6 // attempt 6 times at 15s each then 300s
const DISCOVER_INTERVAL = 300000
const REFRESH_ENABLED = true
const REFRESH_INTERVAL = 60000
const REPORT_ENABLED = true
const REPORT_INTERVAL = 5000

const wemo = new Wemo()
const devices = {}
let discoverCount = 0

const discoverDevices = () => {
  log.info('Discovering new devices...')
  wemo.discover((err, deviceInfo) => {
    if (err) {
      if (err.code !== 'ECONNRESET') console.log(err)
      return
    }

    // already discovered? skip
    if (devices[deviceInfo.serialNumber]) return

    const name = deviceName(deviceInfo)
    const client = wemo.client(deviceInfo)

    client.on('error', (err) => {
      log.error(`${name}: ${err.code}`)
    })

    // subscribe to on/off state
    client.on('binaryState', (value) => {
      handleBinaryState(client, deviceInfo, value)
    })

    // subscribe to brightness for dimmers
    if (deviceInfo.modelName === 'Dimmer') {
      client.on('brightness', (brightness) => {
        deviceInfo.brightness = brightness // update local info
        log.info(`${name}: ${brightness}% Brightness`)
      })
    }

    // periodic refresh of on/off state
    if (REFRESH_ENABLED) {
      setTimeout(() => {
        refreshBinaryState(client, deviceInfo)
      }, REFRESH_INTERVAL)
    }

    // add to devices
    devices[deviceInfo.serialNumber] = deviceInfo
    log.info(`Discovered: ${name}`)
  })
  setTimeout(
    discoverDevices,
    ++discoverCount < DISCOVER_INITIAL_ATTEMPTS ? DISCOVER_INITIAL_INTERVAL : DISCOVER_INTERVAL
  )
}

const handleBinaryState = (client, deviceInfo, value, refresh) => {
  const name = deviceName(deviceInfo)
  const changed = deviceInfo.binaryState !== value
  deviceInfo.binaryState = value // update local info

  // dont show initial state during discovery
  if (deviceInfo.seen) {
    if (!refresh) log.info(`${name}: ${value === '1' ? 'ON' : 'OFF'}`)
  } else {
    deviceInfo.seen = true
  }

  // get brightness % if on
  if (deviceInfo.modelName === 'Dimmer' && value === '1' && changed) {
    client.getBrightness((err, brightness) => {
      if (err) {
        return log.error(`${name}: ${err.code} during handleBinaryState`)
      }
      deviceInfo.brightness = brightness // update local info
      log.info(`${name}: ${brightness}% brightness`)
    })
  }
}

const refreshBinaryState = (client, deviceInfo) => {
  const name = deviceName(deviceInfo)
  client.getBinaryState((err, value) => {
    if (err) return // errors already surfaced in main on error handler
    if (deviceInfo.binaryState !== value) {
      log.warn(
        `Updated: ${name} from ${deviceInfo.binaryState === '1' ? 'ON' : 'OFF'} to ${
          value === '1' ? 'ON' : 'OFF'
        }`
      )
    }
    handleBinaryState(client, deviceInfo, value, true)
  })
  setTimeout(() => {
    refreshBinaryState(client, deviceInfo)
  }, REFRESH_INTERVAL)
}

const deviceName = (deviceInfo) => {
  return `[${deviceInfo.serialNumber.substring(deviceInfo.serialNumber.length - 4)} ${
    deviceInfo.hwVersion || 'v1'
  } ${deviceInfo.modelName.replace('LightSwitch', 'Switch')}] ${deviceInfo.friendlyName}`
}

const debugReport = () => {
  const deviceKeys = Object.keys(devices)
  log.debug(`Total devices: ${deviceKeys.length}`)
  log.debug('Devices currently on:')
  for (let i = 0; i < deviceKeys.length; i++) {
    const deviceInfo = devices[deviceKeys[i]]
    if (deviceInfo.binaryState === '1') {
      log.debug(
        `  ${deviceName(deviceInfo)}${
          deviceInfo.modelName === 'Dimmer' ? `: ${deviceInfo.brightness}% Brightness` : ''
        }`
      )
    }
  }
  setTimeout(debugReport, REPORT_INTERVAL)
}

discoverDevices()
if (REPORT_ENABLED) setTimeout(debugReport, REPORT_INTERVAL)
