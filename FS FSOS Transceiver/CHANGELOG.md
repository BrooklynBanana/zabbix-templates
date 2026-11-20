# Changelog

## [0.2.0] - 2026-11-20

- **Fix:** DAC and copper ports report `0.00` for every reading. They were discovered as optical ports with 0 dBm. Discovery now uses the diagnostics flag (column `1.1.13`) and skips all-zero rows when the flag is absent.
- Laser bias current per lane, with a trigger against the high-warning threshold stored in the module.
- Transceiver serial number per port with an Info trigger when a module is replaced.
- UUIDs of all 0.1.0 entities are unchanged, so an existing import can be updated in place.
- Fixture now mirrors the row formats observed on FSOS 7.4.8 (padded strings, DAC rows, flag column).

## [0.1.0] - 2026-11-20

Initial release candidate for Zabbix 7.4 and FS FSOS switches (value format verified on S5850-48B8C, FSOS 7.4.8, 100GBASE-SR4).

- One SNMP walk of the vendor transceiver tables plus `ifName`/`ifAlias`; base OID configurable through `{$FS.XCVR.OID}`.
- Discovery of optical ports and lanes; RX and TX power per lane, module temperature per port.
- Per-port deviation of the weakest receive lane from the median of the other lanes, with Warning and Average triggers and interface-context macros.
- Fail-closed parser with synthetic regression tests; static template validation and CI workflow.

**Caveat:** Not yet test-imported into a live Zabbix instance. Row format for ports without diagnostics is unverified.
