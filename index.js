const Wemo = require('wemo-client')
const log = require('./lib/log')

const DISCOVER_INITIAL_INTERVAL = 15000
const DISCOVER_INITIAL_ATTEMPTS = 6 // attempt 6 times at 15s each then 120s
const DISCOVER_INTERVAL = 120000
const REFRESH_ENABLED = true
const REFRESH_INTERVAL = 60000
const REPORT_ENABLED = (process.env.REPORT_ENABLED && !!+process.env.REPORT_ENABLED) || false
const REPORT_INTERVAL = 5000
const IGNORED_DEVICES =
  (process.env.IGNORED_DEVICES && process.env.IGNORED_DEVICES.toUpperCase().split(',')) || []

const wemo = new Wemo()
const devices = {}
let discoverCount = 0

const discoverDevices = () => {
  log.debug('Discovering devices...')
  wemo.discover((err, deviceInfo) => {
    if (err) {
      if (err.code !== 'ECONNRESET') console.log(err)
      return
    }

    // ignore IGNORED_DEVICES
    if (~IGNORED_DEVICES.indexOf(deviceInfo.serialNumber)) return

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

    // mark existing device as old/offline
    if (devices[deviceInfo.serialNumber]) {
      devices[deviceInfo.serialNumber].old = true
      log.trace(`${name}: Old device replaced by new discovery`)
      // console.log(devices[deviceInfo.serialNumber])
      // console.log(deviceInfo)
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
  if (deviceInfo.old) {
    return log.trace(`${name}: Old device removed from refresh`)
  }
  client.getBinaryState((err, value) => {
    if (err) {
      // device offline?
      if (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.code === 'ETIMEDOUT') {
        // stop refreshing this device by returning early
        return log.trace(`${name}: Device removed from refresh`)
      }

      // refresh next interval
      setTimeout(() => {
        refreshBinaryState(client, deviceInfo)
      }, REFRESH_INTERVAL)
      return
    }

    // value changed without our knowledge?
    if (deviceInfo.binaryState !== value) {
      log.warn(
        `Updated: ${name} from ${deviceInfo.binaryState === '1' ? 'ON' : 'OFF'} to ${
          value === '1' ? 'ON' : 'OFF'
        }`
      )
    }

    handleBinaryState(client, deviceInfo, value, true)

    // refresh next interval
    setTimeout(() => {
      refreshBinaryState(client, deviceInfo)
    }, REFRESH_INTERVAL)
  })
}

const deviceName = (deviceInfo) => {
  return `[${deviceInfo.serialNumber} ${
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
