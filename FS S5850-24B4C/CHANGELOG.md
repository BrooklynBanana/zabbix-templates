# Changelog

## [0.1.3] - 2026-11-20

Documentation only, from further tests on FS S5850-48B8C with FSOS 7.4.8. No functional change.

- A privilege-level-1 account has no `show` command in an interactive login. The SSH check therefore works only because the privilege level is not enforced for commands passed on the SSH command line; if a firmware release enforces it there, the account will presumably need level 2.
- `username NAME secret ...` is stored as `password 8 <hash>`. On an existing account it removed the `privilege` line, so the level must be set again afterwards.
- References to the vendor documentation of the privilege levels and of `access-class` on `line vty`.
- New README section with an SNMPv3 example (authPriv, read-only view, source ACL).

## [0.1.2] - 2026-11-20

- Documentation only: the improved parser has been run live on FS S5850-48B8C (FSOS 7.4.8, Zabbix 7.4.14), imported from this repository's XML. One installation runs the template on Zabbix 8.0.0. A retest on the S5850-24B4C itself is still outstanding. No functional change.
- **Security notice:** on FS S5850-48B8C with FSOS 7.4.8, user privilege level 1 did not restrict commands passed on the SSH command line; the monitoring account could print the running configuration and enter configuration mode. The README no longer calls the account read-only or least-privilege and describes how to test this and how to limit the exposure.
- README: commands for creating the privilege-level-1, SSH-only monitoring user (as used on FSOS 7.4.8).

## [0.1.1] - 2026-11-20

- Documentation only: also reported working on FS S5850-48B8C with FSOS 7.4.8, which prints the same `show environment` layout and temperature limits. No functional change; item keys and UUIDs are unchanged.

## [0.1.0] - 2026-10-08

Initial community release candidate for Zabbix 7.4 and FS S5850-24B4C (FSOS 7.5.5).

- SNMP: three CPU readings, used RAM percentage, firmware version.
- One read-only SSH `show environment` item with dependent fan, PSU and temperature metrics.
- Trigger coverage for missing/unhealthy fans and PSUs, missing sensors, high/critical temperatures and missing monitoring data.
- Safer CLI parsing: missing fans and PSUs count as errors; missing wattage isn't converted to a fake zero.
- Display units for temperature, fan speed and PSU consumption.
- Configurable temperature threshold macros.
- Security and AI-assistance documentation, XML and JavaScript tests, and CI workflow.

**Caveat:** Live testing was performed with the original parser. The improved parser has synthetic regression tests, but still needs a fresh live import/test.
