const log = require('./lib/log')
const Wemo = require('./lib/wemo')

const IGNORED_DEVICES =
  process.env.IGNORED_DEVICES && process.env.IGNORED_DEVICES.toUpperCase().split(',')
const REPORT_ENABLED = process.env.REPORT_ENABLED && !!+process.env.REPORT_ENABLED

const SWITCHES = process.env.SWITCHES && JSON.parse(process.env.SWITCHES.toUpperCase())
const SWITCHES_ONLY = process.env.SWITCHES_ONLY && !!+process.env.SWITCHES_ONLY

const config = {}
if (IGNORED_DEVICES) config.ignoredDevices = IGNORED_DEVICES
if (REPORT_ENABLED) config.reportEnabled = REPORT_ENABLED
if (SWITCHES) config.switches = SWITCHES
if (SWITCHES_ONLY) config.switchesOnly = SWITCHES_ONLY

const wemo = new Wemo(log, config)
wemo.init()
