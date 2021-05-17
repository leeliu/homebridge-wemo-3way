const WemoClient = require('wemo-client')

const DISCOVER_INITIAL_ATTEMPTS = 6 // attempt 6 times at 15s each then 120s
const DISCOVER_INITIAL_INTERVAL = 15000
const DISCOVER_INTERVAL = 120000
const REFRESH_ENABLED = true
const REFRESH_INTERVAL = 60000
const IGNORED_DEVICES = []
const REPORT_ENABLED = false
const REPORT_INTERVAL = 5000

const SWITCHES = []
const SWITCHES_ONLY = false
const RACE_TIMEOUT = 5000 // ignore multiple presses at 3-ways for 5s once triggered

class Wemo {
  constructor(log, config) {
    this.log = log
    if (!this.log.debug) this.log.debug = () => {}
    if (!this.log.trace) this.log.trace = this.log.debug
    if (!this.log.warn) this.log.warn = this.log.error

    this.config = Object.assign(this.defaultConfig(), config)

    this.wemo = new WemoClient()
    this.clients = {}
    this.devices = {}

    this.switches = {}
    this.primaries = [] // first switch in each 3-way set is used in case of state mis-sync
    this.races = {}

    this.discoverCount = 0
  }

  init() {
    this.processSwitches()
    this.discoverDevices()
    if (this.config.reportEnabled)
      setTimeout(this.debugReport.bind(this), this.config.reportInterval)
  }

  defaultConfig() {
    return {
      discoverInitialAttempts: DISCOVER_INITIAL_ATTEMPTS,
      discoverInitialInterval: DISCOVER_INITIAL_INTERVAL,
      discoverInterval: DISCOVER_INTERVAL,
      refreshEnabled: REFRESH_ENABLED,
      refreshInterval: REFRESH_INTERVAL,
      ignoredDevices: IGNORED_DEVICES,
      reportEnabled: REPORT_ENABLED,
      reportInterval: REPORT_INTERVAL,
      switches: SWITCHES,
      switchesOnly: SWITCHES_ONLY,
      raceTimeout: RACE_TIMEOUT
    }
  }

  discoverDevices() {
    this.log.debug('Discovering devices...')
    this.wemo.discover((err, deviceInfo) => {
      if (err) {
        if (err.code !== 'ECONNRESET') console.log(err)
        return
      }

      // ignore IGNORED_DEVICES
      if (~this.config.ignoredDevices.indexOf(deviceInfo.serialNumber)) return

      // ignore non-3-ways if in SWITCHES_ONLY mode
      if (this.config.switchesOnly && !this.switches[deviceInfo.serialNumber]) return

      const name = this.deviceName(deviceInfo)
      const client = this.wemo.client(deviceInfo)

      this.log.info(`${name}: Discovered`)

      client.on('error', (err) => {
        this.log.error(`${name}: ${err.code}`)
      })

      // subscribe to on/off state
      client.on('binaryState', (value) => {
        this.handleBinaryState(client, deviceInfo, value)
      })

      // subscribe to brightness for dimmers
      if (deviceInfo.modelName === 'Dimmer') {
        client.on('brightness', (brightness) => {
          deviceInfo.brightness = brightness // update local info
          this.log.info(`${name}: ${brightness}% Brightness`)
        })
      }

      // periodic refresh of on/off state
      if (this.config.refreshEnabled) {
        setTimeout(() => {
          this.refreshBinaryState(client, deviceInfo)
        }, this.config.refreshInterval)
      }

      // mark existing device as old/offline
      if (this.devices[deviceInfo.serialNumber]) {
        this.devices[deviceInfo.serialNumber].old = true
        this.log.trace(`${name}: Old device replaced by new discovery`)
        // console.log(this.devices[deviceInfo.serialNumber])
        // console.log(deviceInfo)
      }

      // add to clients/devices
      this.clients[deviceInfo.serialNumber] = client
      this.devices[deviceInfo.serialNumber] = deviceInfo

      // show other switches in its 3-way set
      if (this.switches[deviceInfo.serialNumber]) {
        setTimeout(() => {
          this.log.info(
            `${name} is in a 3-way set with:${this.switches[deviceInfo.serialNumber].map((x) => {
              return ' ' + ((this.devices[x] && this.devices[x].friendlyName) || x)
            })}`
          )
        }, this.config.reportInterval)
      }
    })
    setTimeout(
      this.discoverDevices.bind(this),
      ++this.discoverCount < this.config.discoverInitialAttempts
        ? this.config.discoverInitialInterval
        : this.config.discoverInterval
    )
  }

  handleBinaryState(client, deviceInfo, value, refresh) {
    const name = this.deviceName(deviceInfo)
    const changed = deviceInfo.binaryState !== value
    deviceInfo.binaryState = value // update local info

    if (deviceInfo.seen) {
      if (!refresh && changed) {
        // dont show initial state during discovery/refresh
        this.log.info(`${name}: ${value === '1' ? 'ON' : 'OFF'}`)

        // is part of a 3-way switch?
        if (this.switches[deviceInfo.serialNumber]) {
          // already in race?
          if (this.races[deviceInfo.serialNumber]) {
            this.log.trace(`${name}: Race detected...ignoring`)
          } else {
            // mirror state on other switches in set
            for (let i = 0; i < this.switches[deviceInfo.serialNumber].length; i++) {
              let other = this.switches[deviceInfo.serialNumber][i]
              this.syncBinaryState(other, value, refresh)
            }
          }
        }
      } else if (refresh && ~this.primaries.indexOf(deviceInfo.serialNumber)) {
        // handle mis-sync's of 3-way during refresh, resetting each set to primary state
        for (let i = 0; i < this.switches[deviceInfo.serialNumber].length; i++) {
          let other = this.switches[deviceInfo.serialNumber][i]
          this.syncBinaryState(other, value, refresh)
        }
      }
    } else {
      deviceInfo.seen = true
    }

    // get brightness % if on
    if (deviceInfo.modelName === 'Dimmer' && value === '1' && changed) {
      client.getBrightness((err, brightness) => {
        if (err) {
          return this.log.error(`${name}: ${err.code} during handleBinaryState`)
        }
        deviceInfo.brightness = brightness // update local info
        this.log.info(`${name}: ${brightness}% brightness`)
      })
    }
  }

  syncBinaryState(serialNumber, value, refresh) {
    let client = this.clients[serialNumber]
    let deviceInfo = this.devices[serialNumber]

    // check if online
    if (!deviceInfo) {
      return this.log.warn(`[${serialNumber} unknown]: Offline or not discovered`)
    }

    let other = deviceInfo.serialNumber
    let otherName = this.deviceName(deviceInfo)

    // check to see if other switch already in correct state due to some mis-sync
    if (deviceInfo.binaryState === value) {
      if (!refresh) this.log.trace(`${otherName}: Already ${value === '1' ? 'ON' : 'OFF'}`)
      return // other state identical, skip
    } else if (deviceInfo.binaryState !== value && refresh) {
      // mis-sync detected during refresh
      this.log.warn(`${otherName}: Mis-sync detected, correcting...`)
    }

    // already in race?
    if (this.races[other]) {
      clearTimeout(this.races[other]) // clear existing race, start new
      this.log.trace(`${otherName}: Existing race timeout cleared`)
    }

    // start new race to prevent state changes at other switches from triggering
    this.races[other] = setTimeout(() => {
      this.races[other] = null // autoclear in a few secs
      this.log.trace(`${otherName}: Race timeout cleared`)
    }, this.config.raceTimeout)

    // set binarystate
    client.setBinaryState(value)
    this.log.info(`${otherName}: Set 3-way to ${value === '1' ? 'ON' : 'OFF'}`)
  }

  refreshBinaryState(client, deviceInfo) {
    const name = this.deviceName(deviceInfo)
    if (deviceInfo.old) {
      return this.log.trace(`${name}: Old device removed from refresh`)
    }
    client.getBinaryState((err, value) => {
      if (err) {
        // device offline?
        if (
          err.code === 'ECONNREFUSED' ||
          err.code === 'EHOSTUNREACH' ||
          err.code === 'ETIMEDOUT'
        ) {
          // stop refreshing this device by returning early
          return this.log.trace(`${name}: Device removed from refresh`)
        }

        // refresh next interval
        setTimeout(() => {
          this.refreshBinaryState(client, deviceInfo)
        }, this.config.refreshInterval)
        return
      }

      // value changed without our knowledge?
      if (deviceInfo.binaryState !== value) {
        this.log.warn(`${name}: Updated state to ${value === '1' ? 'ON' : 'OFF'}`)
      }

      this.handleBinaryState(client, deviceInfo, value, true)

      // refresh next interval
      setTimeout(() => {
        this.refreshBinaryState(client, deviceInfo)
      }, this.config.refreshInterval)
    })
  }

  deviceName(deviceInfo) {
    return `[${deviceInfo.serialNumber} ${
      deviceInfo.hwVersion || 'v1'
    } ${deviceInfo.modelName.replace('LightSwitch', 'Switch')}] ${deviceInfo.friendlyName}`
  }

  processSwitches() {
    if (!Array.isArray(this.config.switches) || !this.config.switches.length) {
      this.log.error(
        "No switch devices defined, ensure at least 1 set of 3-way switches are defined using the device's Wemo serial number"
      )
    }
    for (let i = 0; i < this.config.switches.length; i++) {
      let set = this.config.switches[i]
      if (!Array.isArray(set) || set.length < 2) {
        this.log.error(`${set} needs to have at least 2 Wemo devices, skipping this set...`)
        continue
      }
      for (let j = 0; j < set.length; j++) {
        // for each device, create an array of all other devices in its 3-way set
        this.switches[set[j]] = set.filter((x) => x !== set[j])
      }
      this.primaries.push(set[0])
    }
    // console.log(this.switches)
    // console.log(this.primaries)
  }

  debugReport() {
    const deviceKeys = Object.keys(this.devices)
    this.log.debug(`Total devices: ${deviceKeys.length}`)
    this.log.debug('Devices currently on:')
    for (let i = 0; i < deviceKeys.length; i++) {
      const deviceInfo = this.devices[deviceKeys[i]]
      if (deviceInfo.binaryState === '1') {
        this.log.debug(
          `  ${this.deviceName(deviceInfo)}${
            deviceInfo.modelName === 'Dimmer' ? `: ${deviceInfo.brightness}% Brightness` : ''
          }`
        )
      }
    }
    setTimeout(this.debugReport.bind(this), this.config.reportInterval)
  }
}

module.exports = Wemo
