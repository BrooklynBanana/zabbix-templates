#!/usr/bin/env python3
"""Static checks for the Zabbix 7.4 YAML template and accidental publishing of secrets."""
import pathlib
import re
import uuid

import yaml

base = pathlib.Path(__file__).resolve().parents[1]
path = base / 'template_fs_fsos_transceiver_zabbix_7.4.yaml'
text = path.read_text(encoding='utf-8')
doc = yaml.safe_load(text)['zabbix_export']
assert doc['version'] == '7.4'
assert len(doc['templates']) == 1
tmpl = doc['templates'][0]
NAME = 'FS FSOS Transceiver'
assert tmpl['template'] == NAME

items = tmpl['items']
keys = [i['key'] for i in items]
assert keys == ['fs.xcvr.walk', 'fs.xcvr.json', 'fs.xcvr.ports'], keys
by_key = {i['key']: i for i in items}

# One SNMP walk feeds everything; base OID is a macro so both enterprise trees work.
walk = by_key['fs.xcvr.walk']
assert walk['type'] == 'SNMP_AGENT' and walk['value_type'] == 'TEXT' and walk['history'] == '0'
oids = walk['snmp_oid'][len('walk['):-1].split(',')
assert walk['snmp_oid'].startswith('walk[') and walk['snmp_oid'].endswith(']')
assert oids == [
    '{$FS.XCVR.OID}.1.1.1', '{$FS.XCVR.OID}.1.1.3', '{$FS.XCVR.OID}.1.1.4',
    '{$FS.XCVR.OID}.1.1.13', '{$FS.XCVR.OID}.2.1.5', '{$FS.XCVR.OID}.4.1.3',
    '{$FS.XCVR.OID}.4.1.5', '{$FS.XCVR.OID}.5.1.5', '{$FS.XCVR.OID}.6.1.5',
    '1.3.6.1.2.1.31.1.1.1.1', '1.3.6.1.2.1.31.1.1.1.18'], oids
macros = {m['macro']: m['value'] for m in tmpl['macros']}
assert macros == {
    '{$FS.XCVR.OID}': '1.3.6.1.4.1.52642.1.37.1.10',
    '{$FS.XCVR.RX.DEV.WARN}': '1', '{$FS.XCVR.RX.DEV.HIGH}': '2',
    '{$FS.XCVR.RX.LOW}': '-8',
    '{$FS.XCVR.IFNAME.MATCHES}': '.*', '{$FS.XCVR.IFNAME.NOT_MATCHES}': 'CHANGE_IF_NEEDED'}, macros
assert float(macros['{$FS.XCVR.RX.DEV.WARN}']) < float(macros['{$FS.XCVR.RX.DEV.HIGH}'])

# The embedded JavaScript is exactly the parser covered by tests/test_parser.js.
js = by_key['fs.xcvr.json']['preprocessing']
assert len(js) == 1 and js[0]['type'] == 'JAVASCRIPT'
assert js[0]['parameters'][0] == (base / 'tests/parser.js').read_text(encoding='utf-8').rstrip('\n')
assert by_key['fs.xcvr.json']['master_item']['key'] == 'fs.xcvr.walk'
assert by_key['fs.xcvr.ports']['master_item']['key'] == 'fs.xcvr.json'

rules = {r['key']: r for r in tmpl['discovery_rules']}
assert set(rules) == {'fs.xcvr.lane.discovery', 'fs.xcvr.port.discovery',
                      'fs.xcvr.multilane.discovery', 'fs.xcvr.bias.discovery'}
expected_paths = {
    'fs.xcvr.lane.discovery': '$.lld_lanes', 'fs.xcvr.port.discovery': '$.lld_ports',
    'fs.xcvr.multilane.discovery': '$.lld_multilane', 'fs.xcvr.bias.discovery': '$.lld_bias'}
protos = {}
for key, r in rules.items():
    assert r['type'] == 'DEPENDENT' and r['master_item']['key'] == 'fs.xcvr.json'
    assert r['preprocessing'] == [{'type': 'JSONPATH', 'parameters': [expected_paths[key]]}]
    assert [c['macro'] for c in r['filter']['conditions']] == ['{#IFNAME}', '{#IFNAME}']
    for p in r['item_prototypes']:
        assert p['type'] == 'DEPENDENT' and p['master_item']['key'] == 'fs.xcvr.json'
        assert p['key'] not in protos
        assert '{#IFNAME}' in p['key'] and '{#IFINDEX}' in p['preprocessing'][0]['parameters'][0]
        protos[p['key']] = p
assert set(protos) == {
    'fs.xcvr.rx[{#IFNAME},{#LANE}]', 'fs.xcvr.tx[{#IFNAME},{#LANE}]',
    'fs.xcvr.temp[{#IFNAME}]', 'fs.xcvr.rx.dev[{#IFNAME}]', 'fs.xcvr.rx.weak[{#IFNAME}]',
    'fs.xcvr.serial[{#IFNAME}]', 'fs.xcvr.bias[{#IFNAME},{#LANE}]'}
for key, unit in {
        'fs.xcvr.rx[{#IFNAME},{#LANE}]': 'dBm', 'fs.xcvr.tx[{#IFNAME},{#LANE}]': 'dBm',
        'fs.xcvr.bias[{#IFNAME},{#LANE}]': 'mA',
        'fs.xcvr.temp[{#IFNAME}]': '°C', 'fs.xcvr.rx.dev[{#IFNAME}]': 'dB'}.items():
    assert protos[key]['units'] == unit and protos[key]['value_type'] == 'FLOAT', key
# Lane-level keys must be unique per lane, port-level keys must not depend on a lane.
for key in ('fs.xcvr.lane.discovery', 'fs.xcvr.bias.discovery'):
    for p in rules[key]['item_prototypes']:
        assert '{#LANE}' in p['key'] and '{#LANEIDX}' in p['preprocessing'][0]['parameters'][0]
# The serial number is only kept to notice replacements: stored on change, closed by hand.
serial = protos['fs.xcvr.serial[{#IFNAME}]']
assert serial['value_type'] == 'CHAR'
assert [x['type'] for x in serial['preprocessing']] == ['JSONPATH', 'DISCARD_UNCHANGED_HEARTBEAT']
assert serial['trigger_prototypes'][0]['manual_close'] == 'YES'
# Laser bias is compared with the threshold stored in the module, passed as an LLD macro.
bias = protos['fs.xcvr.bias[{#IFNAME},{#LANE}]']
assert bias['trigger_prototypes'][0]['expression'].endswith('>{#BIAS.HIGH.WARN}')
assert '"{#BIAS.HIGH.WARN}"' not in text and "'{#BIAS.HIGH.WARN}': String(" in text
for key in ('fs.xcvr.port.discovery', 'fs.xcvr.multilane.discovery'):
    for p in rules[key]['item_prototypes']:
        assert '{#LANE' not in p['key']

# Every trigger references an existing key of this template and an existing macro.
triggers = [t for i in items for t in i.get('triggers', [])]
triggers += [t for p in protos.values() for t in p.get('trigger_prototypes', [])]
assert len(triggers) == 6, len(triggers)
all_keys = set(keys) | set(protos)
for t in triggers:
    refs = re.findall(r'/([^/]+)/((?:[^,()\[\]]|\[[^\]]*\])+)', t['expression'])
    assert refs, t['expression']
    for host, key in refs:
        assert host == NAME, host
        assert key in all_keys, key
    for macro in re.findall(r'\{\$[A-Z0-9_.]+', t['expression']):
        assert macro + '}' in macros, macro
    assert t['priority'] in ('INFO', 'WARNING', 'AVERAGE')


def uuids(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == 'uuid':
                yield v
            else:
                yield from uuids(v)
    elif isinstance(node, list):
        for v in node:
            yield from uuids(v)


seen = list(uuids(doc))
assert len(seen) == len(set(seen)) and len(seen) >= 15
for value in seen:
    assert len(value) == 32 and uuid.UUID(hex=value).version == 4, value

# Reject likely internal hostnames, serials, credentials and IPv4 literals (OIDs excluded).
assert not re.search(r'\bSW-[A-Z0-9-]{4,}\b', text)
assert not re.search(r'\bCG\d{10,}\b', text)
assert not re.search(r'(?i)passw|passphrase|snmp_community|securityname', text)
no_oids = re.sub(r'(?:\d+\.){5,}\d+', '', text)
assert not re.search(r'(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)', no_oids)
sample = (base / 'tests/walk_sample.txt').read_text(encoding='utf-8')
assert not re.search(r'\bSW-[A-Z0-9-]{4,}\b|\b[A-Z]\d{9,}\b', sample)
print(f'PASS YAML parsed: Zabbix 7.4; {len(items)} items; {len(rules)} discovery rules; '
      f'{len(protos)} item prototypes; {len(triggers)} triggers')
print('PASS walk OIDs, macros, embedded parser, dependent references, UUIDs, basic secrets check')
