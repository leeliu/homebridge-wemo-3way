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
const SWITCHES = (process.env.SWITCHES && JSON.parse(process.env.SWITCHES.toUpperCase())) || []
const SWITCHES_ONLY = (process.env.SWITCHES_ONLY && !!+process.env.SWITCHES_ONLY) || false
const RACE_TIMEOUT = 5000 // ignore multiple presses at 3-ways for 5s once triggered

const wemo = new Wemo()
const clients = {}
const devices = {}
const switches = {}
const primaries = [] // first switch in each 3-way set is used in case of state mis-sync
const races = {}
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

    // ignore non-3-ways if in SWITCHES_ONLY mode
    if (SWITCHES_ONLY && !switches[deviceInfo.serialNumber]) return

    const name = deviceName(deviceInfo)
    const client = wemo.client(deviceInfo)

    log.info(`Discovered: ${name}`)

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

    // add to clients/devices
    clients[deviceInfo.serialNumber] = client
    devices[deviceInfo.serialNumber] = deviceInfo

    // show other switches in its 3-way set
    if (switches[deviceInfo.serialNumber]) {
      setTimeout(() => {
        log.info(
          `${name} is in a 3-way set with:${switches[deviceInfo.serialNumber].map((x) => {
            return ' ' + ((devices[x] && devices[x].friendlyName) || x)
          })}`
        )
      }, 2000)
    }
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

  if (deviceInfo.seen) {
    if (!refresh && changed) {
      // dont show initial state during discovery/refresh
      log.info(`${name}: ${value === '1' ? 'ON' : 'OFF'}`)

      // is part of a 3-way switch?
      if (switches[deviceInfo.serialNumber]) {
        // already in race?
        if (races[deviceInfo.serialNumber]) {
          log.trace(`${name}: Race detected...ignoring`)
        } else {
          // mirror state on other switches in set
          for (let i = 0; i < switches[deviceInfo.serialNumber].length; i++) {
            let other = switches[deviceInfo.serialNumber][i]
            syncBinaryState(other, value, refresh)
          }
        }
      }
    } else if (refresh && ~primaries.indexOf(deviceInfo.serialNumber)) {
      // handle mis-sync's of 3-way during refresh, resetting each set to primary state
      for (let i = 0; i < switches[deviceInfo.serialNumber].length; i++) {
        let other = switches[deviceInfo.serialNumber][i]
        syncBinaryState(other, value, refresh)
      }
    }
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

const syncBinaryState = (serialNumber, value, refresh) => {
  let client = clients[serialNumber]
  let deviceInfo = devices[serialNumber]

  // check if online
  if (!deviceInfo) {
    return log.warn(`[${serialNumber} unknown]: Offline or not discovered`)
  }

  let other = deviceInfo.serialNumber
  let otherName = deviceName(deviceInfo)

  // check to see if other switch already in correct state due to some mis-sync
  if (deviceInfo.binaryState === value) {
    if (!refresh) log.trace(`${otherName}: Already ${value === '1' ? 'ON' : 'OFF'}`)
    return // other state identical, skip
  }

  // already in race?
  if (races[other]) {
    clearTimeout(races[other]) // clear existing race, start new
    log.trace(`${otherName}: Existing race timeout cleared`)
  }

  // start new race to prevent state changes at other switches from triggering
  races[other] = setTimeout(() => {
    races[other] = null // autoclear in a few secs
    log.trace(`${otherName}: Race timeout cleared`)
  }, RACE_TIMEOUT)

  // set binarystate
  client.setBinaryState(value)
  log.info(`${otherName}: Set 3-way to ${value === '1' ? 'ON' : 'OFF'}`)
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

const processSwitches = () => {
  if (!Array.isArray(SWITCHES) || !SWITCHES.length) {
    log.error(
      "No switch devices defined, ensure at least 1 set of 3-way switches are defined using the device's Wemo serial number"
    )
  }
  for (let i = 0; i < SWITCHES.length; i++) {
    let set = SWITCHES[i]
    if (!Array.isArray(set) || set.length < 2) {
      log.error(`${set} needs to have at least 2 Wemo devices, skipping this set...`)
      continue
    }
    for (let j = 0; j < set.length; j++) {
      // for each device, create an array of all other devices in its 3-way set
      switches[set[j]] = set.filter((x) => x !== set[j])
    }
    primaries.push(set[0])
  }
  // console.log(switches)
  // console.log(primaries)
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

processSwitches()
discoverDevices()
if (REPORT_ENABLED) setTimeout(debugReport, REPORT_INTERVAL)
