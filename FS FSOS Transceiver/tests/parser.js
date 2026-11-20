// FSOS transceiver tables (FS-SWITCH-MIB "transinformation", <base>.37.1.10) from ONE SNMP walk.
// Value format verified on S5850-48B8C, FSOS 7.4.8: one string per port, one
// comma-separated reading per lane, e.g. "0.29  ,0.14  ,0.12  ,-3.52 ".
// Ports without diagnostics (DAC, copper modules) report 0.00 for every reading and
// 0 in column 1.13; they are skipped so that no fake 0 dBm values are recorded.
// Fail closed: a walk without any transceiver row is an error, not "healthy".
var COLS = {
    '1.1': 'type', '1.3': 'pn', '1.4': 'sn', '1.13': 'ddm',
    '2.5': 'temp', '4.3': 'bias_warn', '4.5': 'bias', '5.5': 'tx', '6.5': 'rx'
};
var raw = {};
var names = {};
var aliases = {};
var seen = false;

function clean(s) {
    s = s.replace(/^\s+|\s+$/g, '');
    var q = s.match(/^"([\s\S]*)"$/);
    return (q ? q[1] : s).replace(/^\s+|\s+$/g, '');
}

// "a ,b ,c ,d " -> [a, b, c, d]; anything that is not a plain number becomes null.
function numbers(s) {
    var out = [];
    if (s === '') return out;
    var parts = s.split(',');
    for (var k = 0; k < parts.length; k++) {
        var p = parts[k].replace(/^\s+|\s+$/g, '');
        out.push(/^-?\d+(?:\.\d+)?$/.test(p) ? Number(p) : null);
    }
    return out;
}

function round2(x) {
    return Math.round(x * 100) / 100;
}

// True when a list holds no reading other than zero.
function allZero(list) {
    for (var z = 0; z < list.length; z++) {
        if (list[z] !== null && list[z] !== 0) return false;
    }
    return true;
}

var lines = value.replace(/\r/g, '').split('\n');
for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^\s*\.?([0-9.]+)\s*=\s*(?:[A-Za-z][A-Za-z0-9-]*:\s*)?(.*)$/);
    if (!m) continue;
    var oid = m[1];
    var val = clean(m[2]);
    var t = oid.match(/\.37\.1\.10\.(\d+)\.1\.(\d+)\.(\d+)$/);
    if (t) {
        seen = true;
        var col = COLS[t[1] + '.' + t[2]];
        if (col) {
            if (!raw[t[3]]) raw[t[3]] = {};
            raw[t[3]][col] = val;
        }
        continue;
    }
    var n = oid.match(/^1\.3\.6\.1\.2\.1\.31\.1\.1\.1\.(1|18)\.(\d+)$/);
    if (n) {
        if (n[1] === '1') names[n[2]] = val; else aliases[n[2]] = val;
    }
}
if (!seen) {
    throw new Error('No transceiver rows in SNMP walk');
}

var data = {ports: {}, lld_ports: [], lld_multilane: [], lld_lanes: [], lld_bias: [], summary: {}};
var indexes = [];
for (var idx in raw) {
    if (raw.hasOwnProperty(idx)) indexes.push(idx);
}
indexes.sort(function (a, b) { return Number(a) - Number(b); });

var laneCount = 0;
var biasCount = 0;
for (var j = 0; j < indexes.length; j++) {
    var ifindex = indexes[j];
    var r = raw[ifindex];
    var rx = numbers(r.rx === undefined ? '' : r.rx);
    var valid = [];
    for (var l = 0; l < rx.length; l++) {
        if (rx[l] !== null) valid.push({lane: l + 1, v: rx[l]});
    }
    var tx = numbers(r.tx === undefined ? '' : r.tx);
    var bias = numbers(r.bias === undefined ? '' : r.bias);
    // Column 1.13 is 1 when the module provides diagnostics, 0 when it does not.
    if (r.ddm === '0') continue;
    // No numeric receive power: empty cage or unreadable module.
    if (valid.length === 0) continue;
    // Firmware without the flag column: all-zero rows are modules without diagnostics.
    if (r.ddm !== '1' && allZero(rx) && allZero(tx) && allZero(bias)) continue;

    var temps = numbers(r.temp === undefined ? '' : r.temp);
    var temp = null;
    for (var c = 0; c < temps.length; c++) {
        if (temps[c] !== null && (temp === null || temps[c] > temp)) temp = temps[c];
    }

    var port = {
        ifindex: Number(ifindex),
        name: names[ifindex] ? names[ifindex] : 'ifIndex' + ifindex,
        alias: aliases[ifindex] ? aliases[ifindex] : '',
        type: r.type === undefined ? '' : r.type,
        pn: r.pn === undefined ? '' : r.pn,
        sn: r.sn === undefined ? '' : r.sn,
        lanes: valid.length,
        rx: rx,
        tx: tx,
        bias: bias,
        bias_warn: null,
        temp: temp,
        rx_min: null,
        rx_weak_lane: null,
        rx_dev: null
    };

    // Weakest lane against the median of the remaining lanes. One lane that
    // drops while its neighbours stay put is the signature of a damaged fibre.
    var weak = valid[0];
    for (var w = 1; w < valid.length; w++) {
        if (valid[w].v < weak.v) weak = valid[w];
    }
    port.rx_min = weak.v;
    port.rx_weak_lane = weak.lane;
    if (valid.length >= 2) {
        var others = [];
        for (var o = 0; o < valid.length; o++) {
            if (valid[o].lane !== weak.lane) others.push(valid[o].v);
        }
        others.sort(function (a, b) { return a - b; });
        var mid = Math.floor(others.length / 2);
        var median = others.length % 2 ? others[mid] : (others[mid - 1] + others[mid]) / 2;
        port.rx_dev = round2(median - weak.v);
    }

    data.ports[ifindex] = port;
    var row = {
        '{#IFINDEX}': ifindex, '{#IFNAME}': port.name,
        '{#IFALIAS}': port.alias, '{#XCVR.TYPE}': port.type
    };
    data.lld_ports.push(row);
    if (valid.length >= 2) data.lld_multilane.push(row);
    for (var v = 0; v < valid.length; v++) {
        data.lld_lanes.push({
            '{#IFINDEX}': ifindex, '{#IFNAME}': port.name, '{#IFALIAS}': port.alias,
            '{#LANE}': String(valid[v].lane), '{#LANEIDX}': String(valid[v].lane - 1)
        });
        laneCount++;
    }
    // Laser bias is judged against the module's own high-warning threshold,
    // because the normal current differs widely between module types.
    var warn = numbers(r.bias_warn === undefined ? '' : r.bias_warn);
    if (warn.length > 0 && warn[0] !== null && warn[0] > 0) {
        port.bias_warn = warn[0];
        for (var b = 0; b < bias.length; b++) {
            if (bias[b] === null) continue;
            data.lld_bias.push({
                '{#IFINDEX}': ifindex, '{#IFNAME}': port.name, '{#IFALIAS}': port.alias,
                '{#LANE}': String(b + 1), '{#LANEIDX}': String(b),
                '{#BIAS.HIGH.WARN}': String(warn[0])
            });
            biasCount++;
        }
    }
}
data.summary = {
    ports: data.lld_ports.length,
    multilane_ports: data.lld_multilane.length,
    lanes: laneCount,
    bias_lanes: biasCount
};
return JSON.stringify(data);
