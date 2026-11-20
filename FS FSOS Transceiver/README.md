# Zabbix template for transceiver optics on FS FSOS switches

Community-maintained template that records the **optical receive and transmit power of every lane** of every transceiver on FS switches running FSOS, and alerts when one lane of a multi-lane link is weaker than the others. Everything comes from **one SNMP walk**; no SSH.

> **Compatibility:** Value format verified on **FS S5850-48B8C**, **FSOS 7.4.8**, **100GBASE-SR4** modules. Built for **Zabbix 7.4**. The template has passed the static checks in `tests/` but has **not yet been test-imported into a live Zabbix instance**. Other models, firmware releases and module types are not verified. This is not an official FS.com template.

## Why

A damaged or dirty fibre in a parallel-optics link (SR4, PSM4, MPO/MTP cabling) lowers the receive power of **one lane** while the other lanes stay normal. With forward error correction enabled, interface error counters stay at zero until the margin is gone. The receive level per lane shows the problem earlier.

## What is monitored

| Scope | Metric | Notes |
| --- | --- | --- |
| Lane | RX power (dBm) | One item per lane with a numeric reading. |
| Lane | TX power (dBm) | Measured inside the module. |
| Lane | Laser bias current (mA) | Compared with the high-warning threshold stored in the module. |
| Port | Transceiver temperature (°C) | Highest lane reading. |
| Port | Transceiver serial number | Stored on change only, to notice replacements. |
| Multi-lane port | RX power deviation of weakest lane (dB) | Median of the other lanes minus the weakest lane. |
| Multi-lane port | Weakest RX lane | Lane number, to tell the technician which fibre to look at. |
| Host | Optical ports with diagnostics | Count; also carries the "no data" trigger. |

Ports without diagnostics (DAC cables, copper modules) are not discovered. FSOS reports `0.00` for every reading of such a port and `0` in column `1.1.13`; the template uses that flag and never records those zeros as optical levels. Item names follow the convention of *Network Generic Device by SNMP*, for example `Interface eth-0-55(far end): Lane 4 RX power`.

## SNMP data source

The transceiver tables are the `transinformation` branch of the vendor MIB. Devices tested answer below `1.3.6.1.4.1.52642.1.37.1.10`; the same tables are documented below the legacy enterprise tree `1.3.6.1.4.1.27975.37.1.10`. The base OID is the macro `{$FS.XCVR.OID}`.

| Column | Suffix below base | Content |
| --- | --- | --- |
| Type | `.1.1.1.<ifIndex>` | Transceiver type |
| Part number | `.1.1.3.<ifIndex>` | Vendor part number, padded with spaces |
| Serial number | `.1.1.4.<ifIndex>` | Padded with spaces |
| Diagnostics flag | `.1.1.13.<ifIndex>` | `1` = module provides readings, `0` = it does not (not in the published MIB; observed) |
| Temperature | `.2.1.5.<ifIndex>` | String, one value per lane |
| Bias high warning | `.4.1.3.<ifIndex>` | Threshold stored in the module |
| Bias current | `.4.1.5.<ifIndex>` | String, one value per lane |
| TX power | `.5.1.5.<ifIndex>` | String, one value per lane |
| RX power | `.6.1.5.<ifIndex>` | String, one value per lane, e.g. `"0.29  ,0.14  ,0.12  ,-3.52 "` |

Columns 1 to 4 of the temperature, voltage, bias, TX and RX tables hold the alarm and warning thresholds stored in the module. They are wide: a 100GBASE-SR4 module warns at −9 dBm receive power, far below the level at which a single damaged lane already causes bit errors. That is why the main alert of this template compares lanes with each other instead.

The link-length columns (`.1.1.6` to `.1.1.10`) are **not** used: on the tested device they are decoded with the wrong layout for QSFP modules and report a multimode module as 3500 m single-mode.

Check that your device provides the tables before importing:

```sh
snmpwalk -v3 -l authPriv -u USER -a AUTHPROTO -A '...' -x PRIVPROTO -X '...' -On SWITCH 1.3.6.1.4.1.52642.1.37.1.10.6.1.5
```

## Installation

1. Make sure the Zabbix host for the switch has a working **SNMPv2c or SNMPv3 interface**. The walk item needs bulk requests, which SNMPv1 does not provide.
2. In Zabbix, open **Data collection → Templates → Import** and import [`template_fs_fsos_transceiver_zabbix_7.4.yaml`](template_fs_fsos_transceiver_zabbix_7.4.yaml).
3. Link **FS FSOS transceiver optics by SNMP** to the switch host.
4. Run **Execute now** on the item `FS: Transceiver SNMP walk`, then on the three discovery rules, or wait: the walk runs every 5 minutes.
5. Open **Monitoring → Latest data** and check `FS: Transceiver data`. It should contain JSON, and the lane items should appear after discovery.

## Triggers and macros

| Trigger | Severity | Default |
| --- | --- | --- |
| One optical lane is far weaker than the others | Average | `{$FS.XCVR.RX.DEV.HIGH}` = 2 dB |
| One optical lane is weaker than the others | Warning | `{$FS.XCVR.RX.DEV.WARN}` = 1 dB |
| Lane RX power is low | Warning | `{$FS.XCVR.RX.LOW}` = −8 dBm |
| Lane laser bias current is high | Warning | Module's own high-warning threshold |
| Transceiver has been replaced | Info | Serial number changed; closed manually |
| Transceiver monitoring has no data | Warning | 30 minutes |

All level triggers need the condition to hold for 15 minutes. `{$FS.XCVR.RX.LOW}` suits short-reach optics; lower it for long-reach modules, whose normal receive level is lower. The three threshold macros accept the interface name as context, for example `{$FS.XCVR.RX.DEV.WARN:"eth-0-54"}` = `1.8`. `{$FS.XCVR.IFNAME.MATCHES}` and `{$FS.XCVR.IFNAME.NOT_MATCHES}` limit discovery by interface name.

The default deviation thresholds come from one installation: healthy four-lane links showed 0.3 to 0.5 dB, lanes with a marginal fibre 1.4 to 1.6 dB, lanes with a damaged fibre 2.6 to 3.7 dB. Adjust them to your plant.

## Reliability and limitations

- **DOM accuracy:** Absolute readings from transceiver self-diagnostics are accurate to a few dB only. The comparison of lanes within one module is far more reliable, which is why the main alert is relative.
- **Low RX trigger fires on intentional outages:** A far end that is shut down or unplugged reads as very low power.
- **Row formats:** Confirmed for 100GBASE-SR4 optics and for 25G/100G DAC cables on FSOS 7.4.8. Single-lane optics and other firmware are untested; if the diagnostics flag is missing, rows whose readings are all zero are skipped.
- **Bias threshold as discovery macro:** The module's high-warning value is copied into the trigger at discovery time. Lanes without a usable threshold get no bias item.
- **Index assumption:** The table index is treated as `ifIndex` and joined with `ifName`/`ifAlias`. Confirmed on two ports of one model. If names do not match, items are named `ifIndex<n>`.
- **Fail closed:** If the walk returns no transceiver rows at all, preprocessing fails and the no-data trigger fires, instead of reporting healthy optics.

## Security

- The template uses the host's SNMP interface. The file contains **no credentials, addresses or serial numbers**.
- Transceiver serial numbers are collected into Zabbix to notice replacements. Disable the item prototype `Transceiver serial number` if they must not be stored.
- **Do not publish raw SNMP walks.** They expose serial numbers and interface descriptions. The fixture in `tests/` is synthetic.
- Prefer SNMPv3 with authentication and privacy and a read-only view.

## Development and validation

```sh
python3 tests/validate.py
node tests/test_parser.js
```

`tests/parser.js` is the exact JavaScript embedded in the template; `validate.py` enforces that. These checks validate structure, references, UUIDs and parser behaviour. They **do not replace** a test import into a real Zabbix 7.4 instance.

## Development and AI assistance

This template was developed with assistance from **Anthropic Claude**, based on SNMP output from a physical FS S5850-48B8C running FSOS 7.4.8. All AI-assisted contributions should be reviewed and tested in the target environment before production use. This is an independent community project, not an official product of or endorsed by FS.com, Zabbix or Anthropic.

## License

Licensed under [MIT](LICENSE). Copyright (c) 2026 **cross media IT GmbH**. Contributions and reports from other FSOS versions and module types are welcome; include the exact switch model and firmware, but redact network addresses, serial numbers and credentials.
