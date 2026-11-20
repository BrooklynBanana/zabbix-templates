'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, 'parser.js'), 'utf8');
const parse = new Function('value', script);
const raw = fs.readFileSync(path.join(__dirname, 'walk_sample.txt'), 'utf8');
function check(msg, fn) { fn(); console.log('PASS', msg); }

check('four-lane optics are parsed per lane', () => {
  const d = JSON.parse(parse(raw));
  assert.deepEqual(d.ports['55'].rx, [0.29, 0.14, 0.12, -3.52]);
  assert.deepEqual(d.ports['55'].tx, [0.12, 0.1, 0, 0]);
  assert.deepEqual(d.ports['54'].rx, [-0.09, -0.26, 0.09, 0.23]);
  assert.equal(d.ports['55'].temp, 39.72);
  assert.equal(d.ports['55'].name, 'eth-0-55');
  assert.equal(d.ports['55'].alias, 'example far end 55');
  assert.equal(d.ports['54'].alias, '');
  assert.equal(d.ports['55'].type, '100GBASE_SR4');
});
check('damaged lane shows as deviation from the other lanes', () => {
  const d = JSON.parse(parse(raw));
  assert.equal(d.ports['55'].rx_weak_lane, 4);
  assert.equal(d.ports['55'].rx_min, -3.52);
  assert.equal(d.ports['55'].rx_dev, 3.66);
});
check('healthy port stays well below the warning threshold', () => {
  const d = JSON.parse(parse(raw));
  assert.equal(d.ports['54'].rx_weak_lane, 2);
  assert.equal(d.ports['54'].rx_dev, 0.35);
});
check('DAC ports report 0.00 readings and are not discovered', () => {
  // Observed on FSOS 7.4.8: DACs return "0.00" per lane and 0 in column 1.13.
  const d = JSON.parse(parse(raw));
  assert.equal(d.ports['1'], undefined);
  assert.equal(d.ports['49'], undefined);
  assert.deepEqual(Object.keys(d.ports), ['2', '54', '55']);
});
check('without the diagnostics flag, all-zero rows are still skipped', () => {
  const txt = raw.split('\n').filter((l) => !l.includes('.10.1.1.13.')).join('\n');
  const d = JSON.parse(parse(txt));
  assert.deepEqual(Object.keys(d.ports), ['2', '54', '55']);
});
check('diagnostics flag 1 keeps a port even when a lane reads exactly 0.00 dBm', () => {
  const txt = raw.replace('"0.29  ,0.14  ,0.12  ,-3.52 "', '"0.00  ,0.00  ,0.00  ,0.00  "');
  const d = JSON.parse(parse(txt));
  assert.deepEqual(d.ports['55'].rx, [0, 0, 0, 0]);
  assert.equal(d.ports['55'].rx_dev, 0);
});
check('serial number and laser bias threshold are read per port', () => {
  const d = JSON.parse(parse(raw));
  assert.equal(d.ports['55'].sn, 'EXAMPLESN0055');
  assert.equal(d.ports['55'].pn, 'EXAMPLE-SR4-100G');
  assert.deepEqual(d.ports['55'].bias, [7, 7, 6.98, 7.02]);
  assert.equal(d.ports['55'].bias_warn, 10);
  assert.equal(d.ports['2'].bias_warn, 70);
});
check('bias discovery carries the module threshold as a macro', () => {
  const d = JSON.parse(parse(raw));
  assert.equal(d.lld_bias.length, 9);
  assert.deepEqual(d.lld_bias[d.lld_bias.length - 1], {
    '{#IFINDEX}': '55', '{#IFNAME}': 'eth-0-55', '{#IFALIAS}': 'example far end 55',
    '{#LANE}': '4', '{#LANEIDX}': '3', '{#BIAS.HIGH.WARN}': '10'
  });
  for (const row of d.lld_bias) {
    assert.equal(typeof d.ports[row['{#IFINDEX}']].bias[Number(row['{#LANEIDX}'])], 'number');
    assert.ok(Number(row['{#BIAS.HIGH.WARN}']) > 0);
  }
});
check('missing or zero bias threshold creates no bias items, other items stay', () => {
  const txt = raw.split('\n').filter((l) => !l.includes('.10.4.1.3.')).join('\n');
  const d = JSON.parse(parse(txt));
  assert.equal(d.lld_bias.length, 0);
  assert.equal(d.ports['55'].bias_warn, null);
  assert.equal(d.lld_lanes.length, 9);
});
check('single-lane optic gets lane items but no deviation', () => {
  const d = JSON.parse(parse(raw));
  assert.deepEqual(d.ports['2'].rx, [-2.31]);
  assert.equal(d.ports['2'].rx_dev, null);
  assert.equal(d.ports['2'].lanes, 1);
});
check('discovery lists match the parsed ports', () => {
  const d = JSON.parse(parse(raw));
  assert.deepEqual(d.summary, {ports: 3, multilane_ports: 2, lanes: 9, bias_lanes: 9});
  assert.equal(d.lld_ports.length, 3);
  assert.equal(d.lld_multilane.length, 2);
  assert.equal(d.lld_lanes.length, 9);
  const last = d.lld_lanes[d.lld_lanes.length - 1];
  assert.deepEqual(last, {
    '{#IFINDEX}': '55', '{#IFNAME}': 'eth-0-55', '{#IFALIAS}': 'example far end 55',
    '{#LANE}': '4', '{#LANEIDX}': '3'
  });
});
check('a lane without a reading is skipped, its neighbours keep their lane numbers', () => {
  const txt = raw.replace('"0.29  ,0.14  ,0.12  ,-3.52 "', '"0.29  ,N/A   ,0.12  ,-3.52 "');
  const d = JSON.parse(parse(txt));
  assert.deepEqual(d.ports['55'].rx, [0.29, null, 0.12, -3.52]);
  assert.equal(d.ports['55'].lanes, 3);
  assert.equal(d.ports['55'].rx_weak_lane, 4);
  assert.equal(d.ports['55'].rx_dev, 3.73);
  const lanes = d.lld_lanes.filter((x) => x['{#IFINDEX}'] === '55').map((x) => x['{#LANE}']);
  assert.deepEqual(lanes, ['1', '3', '4']);
});
check('works under the legacy enterprise tree and without quotes or type prefix', () => {
  const txt = [
    '1.3.6.1.4.1.27975.37.1.10.6.1.5.7 = -1.00 ,-1.20 ,-4.40 ,-1.10',
    '1.3.6.1.2.1.31.1.1.1.1.7 = eth-0-7'
  ].join('\n');
  const d = JSON.parse(parse(txt));
  assert.equal(d.ports['7'].name, 'eth-0-7');
  assert.equal(d.ports['7'].rx_weak_lane, 3);
  assert.equal(d.ports['7'].rx_dev, 3.3);
});
check('missing interface name falls back to the index', () => {
  const txt = raw.split('\n').filter((l) => !l.includes('.31.1.1.1.')).join('\n');
  const d = JSON.parse(parse(txt));
  assert.equal(d.ports['55'].name, 'ifIndex55');
  assert.equal(d.ports['55'].alias, '');
});
check('optical table present but no optics yields empty discovery, not an error', () => {
  const txt = raw.split('\n').filter((l) => /\.(1|49) = /.test(l)).join('\n');
  const d = JSON.parse(parse(txt));
  assert.deepEqual(d.summary, {ports: 0, multilane_ports: 0, lanes: 0, bias_lanes: 0});
});
check('walk without transceiver rows fails rather than reporting healthy', () => {
  assert.throws(() => parse('.1.3.6.1.2.1.31.1.1.1.1.1 = STRING: "eth-0-1"'), /No transceiver rows/);
  assert.throws(() => parse('No Such Object available on this agent at this OID'), /No transceiver rows/);
});
check('every discovered lane resolves through the item JSONPath to a number', () => {
  // Item prototypes use $.ports['{#IFINDEX}'].rx[{#LANEIDX}] and .tx[{#LANEIDX}].
  const d = JSON.parse(parse(raw));
  for (const row of d.lld_lanes) {
    const port = d.ports[row['{#IFINDEX}']];
    assert.equal(typeof port.rx[Number(row['{#LANEIDX}'])], 'number');
    assert.equal(typeof port.tx[Number(row['{#LANEIDX}'])], 'number');
  }
  for (const row of d.lld_multilane) {
    assert.equal(typeof d.ports[row['{#IFINDEX}']].rx_dev, 'number');
    assert.equal(typeof d.ports[row['{#IFINDEX}']].rx_weak_lane, 'number');
  }
  for (const row of d.lld_ports) {
    assert.equal(typeof d.ports[row['{#IFINDEX}']].temp, 'number');
  }
});
