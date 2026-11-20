# Zabbix template for FS S5850-24B4C

Community-maintained monitoring template for the **FS S5850-24B4C** network switch. It combines proprietary SNMP OIDs with a *single* read-only SSH query to monitor hardware health in **Zabbix 7.4**.

> **Compatibility:** Tested by the original contributor on **FS S5850-24B4C**, **FSOS 7.5.5**, **Zabbix 7.4**. Also in service on **FS S5850-48B8C** with **FSOS 7.4.8** (Zabbix 7.4.14), and one installation runs it on **Zabbix 8.0.0** without unsupported items. Other FS switches, firmware releases and Zabbix versions are **not verified**. This is not an official FS.com template.

> **Security notice (2026-11-20):** On FS S5850-48B8C with FSOS 7.4.8, user privilege level 1 did **not** restrict commands passed on the SSH command line. The monitoring account could print the running configuration and enter configuration mode that way, and the SSH check itself only works because of this. Until you have tested your own firmware, treat the monitoring account's password like an administrator password. Details: [The monitoring account is not read-only](#the-monitoring-account-is-not-read-only).

## What is monitored

| Method | Metric | Notes |
| --- | --- | --- |
| SNMP | CPU utilization (3 windows) | CPU window labels 5s/1m/5m are inferred, not confirmed against an official MIB. |
| SNMP | Used memory (%) | Calculated as `100 - free memory (%)`. |
| SNMP | FSOS firmware version | Text string. |
| SSH | Fan health | Eight expected fan *entries* (`1-1` to `2-4`); alerts if an entry is missing or unhealthy. |
| SSH | Minimum fan speed (%) | Percentage, **not RPM**. |
| SSH | Power-supply health | Two expected PSU entries; flags missing/not-PRESENT/non-OK/Alert=YES. |
| SSH | Power consumption for PSU 1/2 | Watt readings when available. |
| SSH | Two temperatures | `AROUND_CHIP` and `SWITCH_CHIP` in °C. |
| SSH | Missing temperature sensors | Alerts if either expected sensor index is missing. |
| Both | Missing monitoring data | Alerts if SSH-dependent health or SNMP CPU/RAM items stop reporting. |

The template **does not** provide network-interface discovery. Assign **Network Generic Device by SNMP** separately if you want interface traffic, link status, and other general monitoring.

## Installation

1. Ensure that your Zabbix server (or the host's assigned proxy) can reach the switch's management address on **UDP 161** (SNMP) and **TCP 22** (SSH). The Zabbix server/proxy must support SSH checks.
2. Enable SNMP on the switch and configure the appropriate **SNMP interface** and credentials on the Zabbix host. Use SNMPv3 with authentication and privacy where supported; see [SNMP access on the switch](#snmp-access-on-the-switch).
3. Create a **dedicated SSH user for monitoring**, separate from any personal or administrator login. The SSH check works with an account at user privilege level **1** (FSOS 7.5.5 and 7.4.8). **Do not assume that this makes the account read-only:** see [The monitoring account is not read-only](#the-monitoring-account-is-not-read-only) and run the test there on your firmware. The commands are in [Creating the monitoring user](#creating-the-monitoring-user).
4. Confirm non-interactive SSH works from the monitoring server or proxy:
   ```sh
   ssh -T zabbix-mon@SWITCH_IP 'show environment'
   ```
5. In Zabbix, open **Data collection → Templates → Import**, select [`template_fs_s5850_24b4c_zabbix_7.4.xml`](template_fs_s5850_24b4c_zabbix_7.4.xml), and import. You may need to create or select the **Templates/Network devices** group depending on your existing configuration.
6. Link the template **FS S5850-24B4C by SNMP and SSH** to your switch host. Optionally also link **Network Generic Device by SNMP**.
7. Under **Data collection → Hosts → _your switch_ → Macros**, add the following **host-level** macros (they are intentionally *not* populated by the template):

   | Macro | Value | Zabbix macro type |
   | --- | --- | --- |
   | `{$FS.SSH.IP}` | Switch management IP address | Text |
   | `{$FS.SSH.USER}` | Dedicated monitoring login | Text |
   | `{$FS.SSH.PASSWORD}` | That user's SSH password | **Secret text** |

8. Open **Monitoring → Latest data** and check the `FS: Environment raw data` item. It should contain JSON after the SSH item has run; its dependent hardware items should also populate. SSH polling runs every **5 minutes**. The firmware item polls hourly.

**Upgrading an existing installation:** The template's technical name, item keys and original UUIDs are preserved so Zabbix can update an existing import of this template. The display name changes. Import with **Update existing** and **Create new**. Do **not** select **Delete missing** if your template includes locally added items you wish to retain. Verify the new temperature-sensor health item after upgrading.

## Creating the monitoring user

These commands create a dedicated login at privilege level 1 that may only log in by SSH. They were used on FS S5850-48B8C switches running FSOS 7.4.8; syntax may differ on other releases. Replace `<secret>` with a long random password that is used nowhere else, and keep it only in the `{$FS.SSH.PASSWORD}` macro.

```
configure terminal
username zabbix-mon
username zabbix-mon secret <secret>
username zabbix-mon privilege 1
username zabbix-mon service-type ssh
end
write
```

- `secret` keeps the password out of the configuration in readable form. On FSOS 7.4.8 the account then appears as `username zabbix-mon password 8 <hash>`. Confirm with an administrator login how your firmware stores it (`show running-config | include username`).
- Privilege level 1 is the default and is not shown in the running configuration, so there is no `privilege` line for this account.
- **Do not copy the `secret` line to an existing administrator account without the next step.** On FSOS 7.4.8, `username NAME secret ...` on an existing account removed that account's `privilege` line, which leaves it at the default level. Enter `username NAME privilege <level>` again straight afterwards, check both lines with `show running-config | include username`, and confirm a fresh login in a second session before you close the current one or run `write`.
- `service-type ssh` restricts the account to SSH logins.
- `write` saves the account to the startup configuration; without it the user is gone after a reboot.

Then check from the Zabbix server or proxy that `ssh -T zabbix-mon@SWITCH_IP 'show environment'` prints the fan, power and sensor tables without a prompt or paging, and set `{$FS.SSH.USER}` to `zabbix-mon` on the host.

## The monitoring account is not read-only

**Observed on FS S5850-48B8C, FSOS 7.4.8, on 2026-11-20**, with the account created as shown above:

| How the command is given | `show environment` | `show running-config` | `configure terminal` |
| --- | --- | --- | --- |
| Typed in an interactive login | **not available** | not available | not available |
| Passed on the SSH command line, e.g. `ssh -T zabbix-mon@SWITCH_IP 'show running-config'` | prints the tables | **prints the running configuration** | **answers `Enter configuration commands, one per line.`** |

In the interactive login the account has no `show` command at all. Its command list consists of `cd`, `dir`, `disable`, `enable`, `ethernet`, `exit`, `help`, `logout`, `ls`, `md5sum`, `no`, `ping`, `pwd`, `quit`, `ssh`, `telnet`, `terminal` and `traceroute`. `enable` answered `% No password has been assigned yet` because no enable password was configured; what happens when one is configured was not tested.

This matches the vendor's description of the levels in the [FSOS Basic Configuration Guide for the S5800 series](https://img-en.fs.com/file/user_manual/s5800-series-basic-configuration.pdf): level 1 has only basic commands, level 2 adds all `show` commands, level 3 adds configuration commands and level 4 has everything. The S5850 CLI reference gives the syntax `username WORD privilege <1-4>` without describing the levels. Neither document mentions commands passed on the SSH command line.

Two things follow from the table:

- Privilege level 1 was enforced in the interactive session only. For a command passed on the SSH command line, the behaviour contradicts the vendor documentation.
- **The SSH check of this template depends on that behaviour.** A level 1 account cannot run `show environment` interactively. If a firmware release enforces the privilege level on the SSH command line as well, the check will stop returning data with a level 1 account and will presumably need level 2. That has not been tested.

Whether a change can be completed and saved through the SSH command line was not tested, and it is not known whether this is intended behaviour or a defect. The S5850-24B4C with FSOS 7.5.5 has not been retested for this.

What follows from it:

- Anyone who knows the monitoring password, or who can read or use the `{$FS.SSH.PASSWORD}` macro in Zabbix, should be assumed to have administrator-equivalent access to the switch. The running configuration may also reveal other credentials.
- Testing the account in an interactive login is **not** sufficient. Run `show running-config` and `configure terminal` on the SSH command line against your own firmware. If either one succeeds, the restriction does not hold on that path.

If it does not hold on your firmware:

1. Restrict SSH on the switch to the Zabbix server or proxy and your administration hosts, by management ACL or firewall. The S5850 CLI reference documents `access-class ACL-NAME in` under `line vty` for this and states that only IP address and port of the ACL are evaluated there; this has not been tested here. Include your own administration networks before applying such a rule, or you will lock yourself out. The measure only helps if administration comes from a limited set of addresses.
2. Use a long random password that exists only in a **Secret text** macro or a secrets vault, and review who can administer hosts, items and scripts in Zabbix.
3. Make sure the other accounts and credentials in the switch configuration are not stored in readable form. For local accounts see the note on `secret` and the `privilege` line in [Creating the monitoring user](#creating-the-monitoring-user).
4. Ask the vendor whether a newer release enforces privilege levels for commands passed on the SSH command line.
5. If the remaining risk is not acceptable, do not create the account. Disable the SSH item and the triggers that depend on it; the SNMP items for CPU, memory and firmware keep working without it.

## SNMP access on the switch

The SNMP part of the template needs read access only. The following lines show an SNMPv3 setup as it appears in a running configuration on FSOS 7.5.5, with names and values replaced. Check each command with `?` on your release.

```
snmp-server enable
snmp-server version v3
snmp-server view MON_RO included .1
snmp-server usm-user monuser authentication sha <auth-password> privacy aes <priv-password>
snmp-server group MON_GRP user monuser security-model usm
snmp-server access MON_GRP security-model usm priv read MON_RO
ip access-list MON_SNMP
 10 permit any host <ZABBIX_IP> any
 20 deny any any any
snmp-server access-group MON_SNMP in
```

- Use `priv` in the `snmp-server access` line. `noauth` is the lowest SNMPv3 security level and should not be used for a monitoring group.
- Prefer `sha` and `aes` over `md5` and `des`.
- `snmp-server access-group` limits SNMP to the listed source addresses.
- On the Zabbix host interface this corresponds to SNMPv3 with security level **authPriv**.

## Triggers

- **High:** fan failure, PSU failure, missing temperature sensor, sustained CPU usage above 90%, sustained used memory above 90%, high chip temperatures.
- **Disaster:** temperature reaches the corresponding critical limit.
- **Warning:** hardware-monitoring data absent for 20 minutes, or either CPU 5s / used-memory SNMP item absent for 15 minutes.

The temperature thresholds default to the tested device's `show environment` output and can be overridden using **template-level macros** (or host-level overrides):

| Temperature sensor | High | Disaster |
| --- | ---: | ---: |
| `AROUND_CHIP` (index 1) | `{$FS.TEMP.AROUND.HIGH}` = 65 °C | `{$FS.TEMP.AROUND.CRIT}` = 80 °C |
| `SWITCH_CHIP` (index 2) | `{$FS.TEMP.SWITCH.HIGH}` = 100 °C | `{$FS.TEMP.SWITCH.CRIT}` = 110 °C |

High temperature triggers apply below the Disaster threshold, so they do not stay active alongside the critical event. Override the four template macros if your specific device reports different limits. Ensure each high threshold is lower than its corresponding critical threshold.

## Reliability and limitations

The SSH item runs **one** `show environment` command. JavaScript preprocessing parses fan, PSU and sensor sections into JSON, then dependent items extract individual measurements. The parser expects the tested model's hardware arrangement: **eight fan entries, two PSUs, two temperature sensor indexes**. Missing fan or PSU entries count as faults; missing sensor indexes have their own alert. If a section heading disappears entirely (for example after an incompatible firmware update), preprocessing fails and the `nodata()` check warns of missing monitoring data instead of treating unexpected output as healthy.

A missing PSU watt reading is represented as `null`. The power measurement item may temporarily become unsupported, but **PSU failure status is reported independently**. Network, SSH and user privilege configurations can affect data availability. The CPU sampling window labels have not been verified against the vendor MIB. The S5850-48B8C on FSOS 7.4.8 prints the same `show environment` layout (eight fan entries, two PSUs, two sensors) and the same temperature limits. Beyond these two combinations, other S5850 models and FSOS releases have not been tested.

## Security

- Create a **dedicated SSH account** at privilege level 1 and do not use a personal or general administrator account for monitoring. On FSOS 7.4.8 the privilege level did not restrict commands passed on the SSH command line, so the account must be treated as administrator-equivalent until tested otherwise: see [The monitoring account is not read-only](#the-monitoring-account-is-not-read-only). Restrict SSH access to the Zabbix server/proxy and your administration hosts by management ACL or firewall.
- Use a **Secret text** macro or an approved external secret-management integration. A masked Zabbix macro is not equivalent to an independent secrets vault; review who can administer Zabbix hosts and items.
- The published XML contains **only macro references**, not device passwords, SNMP community strings, or infrastructure addresses.
- **Do not publish raw SNMP walks, configuration backups, or unredacted screenshots**, which can expose serial numbers, interface descriptions, filenames or your network layout.
- Do not import arbitrary templates without inspecting scripts and item commands. This repository's SSH command is only `show environment`.

## Development and validation

```sh
python3 tests/validate.py
node tests/test_parser.js
```

The included test fixture is **synthetic** and contains no real switch identifiers. These checks validate XML structure, parser behavior, known OIDs and the absence of obvious embedded credentials. They **do not replace** a test import into an actual Zabbix 7.4 instance or a live hardware test.

## Development and AI assistance

This project was developed with assistance from **OpenAI ChatGPT**, including analysis of SNMP OIDs, template design, JavaScript preprocessing, documentation, and regression tests. The original contributor configured and tested the monitoring setup on a physical FS S5850-24B4C running FSOS 7.5.5 with Zabbix 7.4. The template was later also put into service on FS S5850-48B8C switches running FSOS 7.4.8.

The improved parser in this repository is covered by synthetic tests and has since been run live on FS S5850-48B8C switches (FSOS 7.4.8, Zabbix 7.4.14), imported from this repository's XML. A retest on the S5850-24B4C itself, on which the original parser was tested, is still outstanding. All AI-assisted contributions should be reviewed and tested in the target environment before production use. This is an independent community project, not an official product of or endorsed by FS.com, Zabbix, or OpenAI.

## License

Licensed under [MIT](LICENSE). Copyright (c) 2026 **cross media IT GmbH**. Contributions and reports from other FSOS versions are welcome; include the exact switch model and firmware, but redact network addresses, serial numbers and credentials.
