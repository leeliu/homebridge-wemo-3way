# homebridge-wemo-3way
[Homebridge](https://homebridge.io/) plugin to turn 2 Wemo switches (1 with load, 1 w/o) into a software 3 way switch. Generally, you need to have a switch that controls a load (ie: lights/fan) and another switch (that may or may not have its load wire connected). This plugin will sync ON/OFF state for both switches, so you can the turn the load ON or OFF from either switch. Usually, there are 2 devices in a 3-way switch set, though 3+ devices (4-way) in a set is supported as well. Also, this plugin avoids loops and mis-syncs through periodic refresh.

## Prerequisites

* This plugin will attempt to discover and control your Wemo devices via your local network (UPnP). No Wemo credentials are required.
* Please ensure you have [Homebridge](https://homebridge.io/) (at least v1.0.0) installed, with an IP on the same local network or VLAN as your Wemo devices.

## Installation

### Homebridge UI
Simply go to the Plugins page, search `homebridge-wemo-3way` and click Install.

### Manually
Assuming a global installation of `homebridge`:

`npm i -g --unsafe-perm homebridge-wemo-3way`

## Homebridge Configuration

For the best experience setting up this plugin, please use [Homebridge UI](https://www.npmjs.com/package/homebridge-config-ui-x) to configure settings and switches.

### Required Configuration
Each 3-way switch set should have 2 (or more) switches. The 1st switch in each set is considered the primary (controls load/lights). For example, my Hallway Dimmer (serial number: 241746K1504004) has lights, is specified 1st, then my Hallway Switch (serial number: 2299A029N01D80) has no load connected, is 2nd. You can find the serial numbers of all your Wemo devices during discovery in Homebridge logs.

```json
{
  "switches": [["241746K1504004", "2299A029N01D80"]]
}
```
* This example shows a single 3-way switch set with 2 switches. `241746K1504004` has load and is 1st in set (primary).

```json
{
  "switches": [
    ["241746K1504004", "2299A029N01D80"],
    ["XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX"], // another 3-way switch set
    ...
  ]
}
```
* Each additional array is another 3-way switch set

### Optional Configuration

Option | Type | Default | Explanation
--- | --- | --- | ---
`discoverInitialAttempts` | `integer` | `6` | Wemo discovery needs to be on a more frequent interval at startup to ensure all devices are discovered.
`discoverInitialInterval` | `interger` | `15000` | By default, attempt 6 times at 15s each then fallback to every 120s.
`discoverInterval` | `integer` | `120000` | Regular discovery interval (in ms) after initial attempts
`refreshEnabled` | `bool` | `true` | Enabled by default. Sometimes light switches fail to report updated state, this'll manually poll each device to ensure state is correct.
`refreshInterval` | `integer` | `60000` | Interval (in ms) to manually poll each device's state
`ignoredDevices` | `array` | `[]` | Some devices such as the v4 socket plug frequently disconnect/reconnect. If they're not a part of a 3-way switch set, you can ignore them here to avoid log spam.
`switchesOnly` | `bool` | `false` | Disabled by default, which shows ON/OFF activity for all Wemo devices in Homebridge logs (may be useful for debugging or just general logging of Wemo activity in your house). Enable this to only monitor devices belonging to a 3-way switch set.
`raceTimeout` | `integer` | `5000` | When you turn on a switch in a 3-way switch set, it'll turn on the other switch, which normally will trigger the original switch. This timeout (in ms) prevents that loop from occurring. By default, this plugin will ignore ON/OFF from the other switch for 5s. If this results in a mis-sync, the refresh interval will sync all switches in a set to the primary again within 60s (default value).
`syncTimeout` | `integer` | `5000` | When you turn on a switch in a 3-way switch set, it'll turn on the other switch. This timeout (in ms) ensures the other switch responds in time. By default, this plugin will mark the other switch as dead if it doesn't respond for 5s, which causes new discovery and will resubscribe to events.

## TODO
* Allows multiple dimmers in a 3-way set and sync brightness across each set

## License
MIT
