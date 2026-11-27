<?php
// COMMUNITY LIVE SDR FEED (GS-58).
// Visitors who switch on SHARE LIVE FEED in the SDR panel post the public geo
// targets their own radio decodes (aircraft, vessels, mesh nodes, APRS, weather
// balloons). Everyone else sees them merged into the matching regular layers
// when the site does not already have that target.
//
// Store: data/community-feed.json (data/ is denied by .htaccess and never
// committed or uploaded by the deploy). Entries expire after 2-5 minutes.
// Never accepted: pagers, TPMS, Bluetooth, meters, radio GPS units, audio, IQ.
// Every stored point carries source "contributor" so a later contributor-only
// view can filter on it.

defined('GSA_CF_MAX_BODY') || define('GSA_CF_MAX_BODY', 65536);     // bytes per POST
defined('GSA_CF_MAX_ITEMS') || define('GSA_CF_MAX_ITEMS', 250);     // targets per POST
defined('GSA_CF_MAX_STORE') || define('GSA_CF_MAX_STORE', 4000);    // targets kept site-wide
defined('GSA_CF_MAX_PER_IP') || define('GSA_CF_MAX_PER_IP', 600);   // live targets per contributor
defined('GSA_CF_MIN_GAP') || define('GSA_CF_MIN_GAP', 8);           // seconds between posts per contributor
defined('GSA_CF_PER_HOUR') || define('GSA_CF_PER_HOUR', 400);       // posts per contributor per hour
defined('GSA_CF_RX_GRID') || define('GSA_CF_RX_GRID', 0.25);        // receiver blur, degrees (~25 km)
defined('GSA_CF_NEAR_RX_KM') || define('GSA_CF_NEAR_RX_KM', 2.0);   // drop non-aircraft this close to the receiver

function gsa_cf_kinds()
{
    // kind => ttl seconds
    return array('adsb' => 120, 'uat' => 120, 'ais' => 300, 'mesh' => 300, 'aprs' => 300, 'sonde' => 180);
}

function gsa_cf_file($name)
{
    global $dataDir;
    return $dataDir . '/community-' . $name;
}

function gsa_cf_str($v, $max)
{
    if (!is_string($v) && !is_numeric($v)) {
        return '';
    }
    $s = (string) $v;
    $s = preg_replace('#(https?://|www\.|tel:|mailto:)\S*#i', '', $s);
    $s = preg_replace('/[^\x20-\x7E]/', '', $s);   // printable ASCII only
    $s = preg_replace('/[<>"\'`\\\\{}]/', '', $s);
    $s = trim(preg_replace('/\s+/', ' ', $s));
    return substr($s, 0, $max);
}

function gsa_cf_num($v, $lo, $hi, $dp)
{
    if (!is_int($v) && !is_float($v) && !(is_string($v) && is_numeric($v))) {
        return null;
    }
    $n = (float) $v;
    if (!is_finite($n) || $n < $lo || $n > $hi) {
        return null;
    }
    return round($n, $dp);
}

function gsa_cf_km($aLat, $aLon, $bLat, $bLon)
{
    $r = M_PI / 180;
    $h = pow(sin(($bLat - $aLat) * $r / 2), 2) + cos($aLat * $r) * cos($bLat * $r) * pow(sin(($bLon - $aLon) * $r / 2), 2);
    return 2 * 6371.0088 * asin(min(1, sqrt($h)));
}

// One clean target, or null. Only whitelisted public fields survive.
function gsa_cf_clean($it, $rx)
{
    if (!is_array($it)) {
        return null;
    }
    $kinds = gsa_cf_kinds();
    $k = is_string($it['k'] ?? null) ? $it['k'] : '';
    if (!isset($kinds[$k])) {
        return null;
    }
    $lat = gsa_cf_num($it['lat'] ?? null, -90, 90, 5);
    $lon = gsa_cf_num($it['lon'] ?? null, -180, 180, 5);
    if ($lat === null || $lon === null || ($lat == 0.0 && $lon == 0.0)) {
        return null;
    }
    $out = array('k' => $k, 'lat' => $lat, 'lon' => $lon);
    if ($k === 'adsb' || $k === 'uat') {
        $hex = strtolower(gsa_cf_str($it['id'] ?? '', 6));
        if (!preg_match('/^[0-9a-f]{6}$/', $hex)) {
            return null;
        }
        $out['id'] = $hex;
        $out['call'] = strtoupper(preg_replace('/[^A-Za-z0-9-]/', '', gsa_cf_str($it['call'] ?? '', 8)));
        $out['alt'] = gsa_cf_num($it['alt'] ?? null, -1500, 70000, 0);
        $out['gs'] = gsa_cf_num($it['gs'] ?? null, 0, 2500, 0);
        $out['track'] = gsa_cf_num($it['track'] ?? null, 0, 360, 1);
        $out['vrate'] = gsa_cf_num($it['vrate'] ?? null, -20000, 20000, 0);
    } elseif ($k === 'ais') {
        $mmsi = preg_replace('/\D/', '', gsa_cf_str($it['id'] ?? '', 9));
        if (strlen($mmsi) !== 9) {
            return null;
        }
        $out['id'] = $mmsi;
        $out['name'] = gsa_cf_str($it['name'] ?? '', 24);
        $out['sog'] = gsa_cf_num($it['sog'] ?? null, 0, 102.2, 1);
        $out['cog'] = gsa_cf_num($it['cog'] ?? null, 0, 360, 1);
        $out['type'] = gsa_cf_num($it['type'] ?? null, 0, 99, 0);
    } elseif ($k === 'mesh') {
        $id = strtolower(gsa_cf_str($it['id'] ?? '', 12));
        if (!preg_match('/^!?[0-9a-f]{8}$/', $id)) {
            return null;
        }
        $out['id'] = $id[0] === '!' ? $id : '!' . $id;
        $out['name'] = gsa_cf_str($it['name'] ?? '', 40);
        $out['short'] = gsa_cf_str($it['short'] ?? '', 8);
        $out['proto'] = gsa_cf_str($it['proto'] ?? '', 16);
    } elseif ($k === 'aprs') {
        $call = strtoupper(gsa_cf_str($it['id'] ?? '', 12));
        if (!preg_match('/^[A-Z0-9]{3,9}(-[0-9A-Z]{1,2})?$/', $call)) {
            return null;
        }
        $out['id'] = $call;
        $out['sym'] = gsa_cf_str($it['sym'] ?? '', 2);
    } elseif ($k === 'sonde') {
        $serial = strtoupper(gsa_cf_str($it['id'] ?? '', 12));
        if (!preg_match('/^[A-Z0-9-]{4,12}$/', $serial)) {
            return null;
        }
        $out['id'] = $serial;
        $out['alt'] = gsa_cf_num($it['alt'] ?? null, -500, 45000, 0);
        $out['type'] = gsa_cf_str($it['type'] ?? '', 8);
    }
    // Privacy: anything sitting at the contributor's own receiver (their mesh
    // node, home APRS station) is dropped. Aircraft are always far away.
    if ($rx && $k !== 'adsb' && $k !== 'uat' && gsa_cf_km($rx[0], $rx[1], $lat, $lon) < GSA_CF_NEAR_RX_KM) {
        return null;
    }
    return array_filter($out, function ($v) {
        return $v !== null && $v !== '';
    });
}

function gsa_cf_client_key()
{
    $saltFile = gsa_cf_file('salt.txt');
    $salt = is_file($saltFile) ? trim((string) file_get_contents($saltFile)) : '';
    if (strlen($salt) < 32) {
        $salt = bin2hex(random_bytes(24));
        @file_put_contents($saltFile, $salt, LOCK_EX);
    }
    // Shared hosting: REMOTE_ADDR is the visitor. Raw IPs are never stored.
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    return substr(hash('sha256', $salt . '|' . $ip), 0, 16);
}

// Locked read-modify-write of the store. $fn gets (&$store, $now).
function gsa_cf_with_store($fn)
{
    $lock = fopen(gsa_cf_file('feed.lock'), 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    try {
        $file = gsa_cf_file('feed.json');
        $store = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (!is_array($store) || !isset($store['items']) || !is_array($store['items'])) {
            $store = array('items' => array(), 'rate' => array());
        }
        if (!isset($store['rate']) || !is_array($store['rate'])) {
            $store['rate'] = array();
        }
        $now = time();
        foreach ($store['items'] as $key => $it) {
            if (!is_array($it) || (int) ($it['exp'] ?? 0) <= $now) {
                unset($store['items'][$key]);
            }
        }
        foreach ($store['rate'] as $ck => $r) {
            if (!is_array($r) || (int) ($r['hour'] ?? 0) < $now - 3600) {
                unset($store['rate'][$ck]);
            }
        }
        $before = json_encode($store);
        $result = $fn($store, $now);
        $after = json_encode($store);
        if ($after !== $before) {
            $tmp = $file . '.tmp';
            if (@file_put_contents($tmp, $after) !== false) {
                @rename($tmp, $file);
            }
        }
        return $result;
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

function gsa_cf_ingest()
{
    $type = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    if (strpos($type, 'application/json') !== 0) {
        json_out(415, array('error' => 'JSON only'));
    }
    if (($_SERVER['HTTP_X_GSA_COMMUNITY'] ?? '') !== '1') {
        json_out(403, array('error' => 'Missing feed header'));
    }
    $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len <= 0 || $len > GSA_CF_MAX_BODY) {
        json_out(413, array('error' => 'Body too large'));
    }
    $raw = (string) file_get_contents('php://input', false, null, 0, GSA_CF_MAX_BODY + 1);
    if (strlen($raw) > GSA_CF_MAX_BODY) {
        json_out(413, array('error' => 'Body too large'));
    }
    $body = json_decode($raw, true, 6);
    if (!is_array($body) || !isset($body['items']) || !is_array($body['items'])) {
        json_out(400, array('error' => 'Bad body'));
    }
    if (count($body['items']) > GSA_CF_MAX_ITEMS) {
        json_out(413, array('error' => 'Too many targets'));
    }
    $rx = null;
    if (isset($body['rx']) && is_array($body['rx'])) {
        $rlat = gsa_cf_num($body['rx']['lat'] ?? null, -90, 90, 6);
        $rlon = gsa_cf_num($body['rx']['lon'] ?? null, -180, 180, 6);
        if ($rlat !== null && $rlon !== null) {
            $rx = array($rlat, $rlon);
        }
    }
    $clean = array();
    foreach ($body['items'] as $it) {
        $c = gsa_cf_clean($it, $rx);
        if ($c) {
            $clean[$c['k'] . ':' . $c['id']] = $c;
        }
    }
    $ck = gsa_cf_client_key();
    $kinds = gsa_cf_kinds();
    $res = gsa_cf_with_store(function (&$store, $now) use ($clean, $ck, $kinds, $rx) {
        $r = $store['rate'][$ck] ?? array('hour' => $now, 'n' => 0, 'last' => 0);
        if ($now - (int) $r['last'] < GSA_CF_MIN_GAP) {
            return array(429, array('error' => 'Slow down', 'retrySec' => GSA_CF_MIN_GAP - ($now - (int) $r['last'])));
        }
        if ((int) $r['n'] >= GSA_CF_PER_HOUR) {
            return array(429, array('error' => 'Hourly limit reached', 'retrySec' => max(60, (int) $r['hour'] + 3600 - $now)));
        }
        $r['n'] = (int) $r['n'] + 1;
        $r['last'] = $now;
        $store['rate'][$ck] = $r;
        $mine = 0;
        foreach ($store['items'] as $it) {
            if (($it['by'] ?? '') === $ck) {
                $mine++;
            }
        }
        $blur = $rx ? array(
            round(round($rx[0] / GSA_CF_RX_GRID) * GSA_CF_RX_GRID, 2),
            round(round($rx[1] / GSA_CF_RX_GRID) * GSA_CF_RX_GRID, 2),
        ) : null;
        $kept = 0;
        foreach ($clean as $key => $c) {
            $existing = $store['items'][$key] ?? null;
            if (!$existing && $mine >= GSA_CF_MAX_PER_IP) {
                continue;
            }
            if (!$existing && count($store['items']) >= GSA_CF_MAX_STORE) {
                break;
            }
            $c['source'] = 'contributor';
            $c['seen'] = $now;
            $c['exp'] = $now + $kinds[$c['k']];
            $c['by'] = $ck;
            $reporters = is_array($existing['rep'] ?? null) ? $existing['rep'] : array();
            $reporters[$ck] = $now;
            if (count($reporters) > 8) {
                arsort($reporters);
                $reporters = array_slice($reporters, 0, 8, true);
            }
            $c['rep'] = $reporters;
            if ($blur) {
                $c['rx'] = $blur;
            }
            if (!$existing) {
                $mine++;
            }
            $store['items'][$key] = $c;
            $kept++;
        }
        return array(200, array('ok' => true, 'accepted' => $kept, 'rejected' => count($clean) - $kept, 'nextSec' => GSA_CF_MIN_GAP));
    });
    json_out($res[0], $res[1] + array('dropped' => count($body['items']) - count($clean)));
}

// Public view of live contributions. Internal fields (by, rep, exp) never leave.
function gsa_cf_points($kinds = null)
{
    return gsa_cf_with_store(function (&$store, $now) use ($kinds) {
        $out = array();
        $by = array();
        foreach ($store['items'] as $it) {
            if ($kinds && !in_array($it['k'], $kinds, true)) {
                continue;
            }
            foreach (array_keys($it['rep'] ?? array()) as $ck) {
                $by[$ck] = true;
            }
            $p = $it;
            $p['ageSec'] = max(0, $now - (int) $it['seen']);
            $p['ttlSec'] = max(0, (int) $it['exp'] - $now);
            $p['reports'] = count($it['rep'] ?? array());
            unset($p['by'], $p['rep'], $p['exp'], $p['seen']);
            $p['community'] = true;
            $out[] = $p;
        }
        return array('points' => $out, 'contributors' => count($by));
    });
}

function gsa_cf_feed()
{
    $kinds = null;
    if (isset($_GET['k']) && is_string($_GET['k'])) {
        $kinds = array_values(array_intersect(explode(',', $_GET['k']), array_keys(gsa_cf_kinds())));
    }
    $res = gsa_cf_points($kinds);
    json_out(200, array(
        'source' => 'contributor',
        'label' => 'Community SDR feed',
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'count' => count($res['points']),
        'contributors' => $res['contributors'],
        'points' => $res['points'],
    ));
}

// Mesh node ids: SDR sends "!1a2b3c4d", meshmap.net keys by decimal node number.
function gsa_cf_mesh_keys($id)
{
    $id = strtolower((string) $id);
    $keys = array($id);
    if (preg_match('/^!?([0-9a-f]{8})$/', $id, $m)) {
        $keys[] = '!' . $m[1];
        $keys[] = (string) hexdec($m[1]);
    } elseif (ctype_digit($id)) {
        $keys[] = '!' . str_pad(dechex((int) $id), 8, '0', STR_PAD_LEFT);
    }
    return $keys;
}

// Add contributor aircraft that the live air traffic feed does not already have.
function gsa_cf_merge_aircraft($snap)
{
    if (!is_array($snap)) {
        return $snap;
    }
    $points = is_array($snap['points'] ?? null) ? $snap['points'] : array();
    $have = array();
    foreach ($points as $p) {
        if (isset($p['hex'])) {
            $have[strtolower((string) $p['hex'])] = true;
        }
    }
    $add = 0;
    foreach (gsa_cf_points(array('adsb', 'uat'))['points'] as $c) {
        if (isset($have[$c['id']])) {
            continue;
        }
        $have[$c['id']] = true;
        $alt = $c['alt'] ?? null;
        $points[] = array(
            'lat' => $c['lat'], 'lon' => $c['lon'], 'hex' => $c['id'],
            'name' => ($c['call'] ?? '') !== '' ? $c['call'] : strtoupper($c['id']),
            'alt' => $alt === null ? 0 : ($alt <= 0 ? 'ground' : $alt),
            'altM' => $alt === null ? 0 : max(0, round($alt * 0.3048)),
            'track' => $c['track'] ?? 0, 'gs' => $c['gs'] ?? 0,
            'baro_rate' => $c['vrate'] ?? null,
            'ts' => (time() - $c['ageSec']) * 1000,
            'community' => true, 'source' => 'contributor', 'k' => $c['k'],
            'ageSec' => $c['ageSec'], 'reports' => $c['reports'], 'rx' => $c['rx'] ?? null,
        );
        $add++;
    }
    $snap['points'] = $points;
    $snap['community'] = $add;
    if (isset($snap['count'])) {
        $snap['count'] = count($points);
    }
    return $snap;
}

// Add contributor mesh nodes that meshmap.net does not already list.
function gsa_cf_merge_mesh($snap)
{
    if (!is_array($snap)) {
        return $snap;
    }
    $points = is_array($snap['points'] ?? null) ? $snap['points'] : array();
    $have = array();
    foreach ($points as $p) {
        foreach (gsa_cf_mesh_keys($p['id'] ?? '') as $key) {
            $have[$key] = true;
        }
    }
    $add = 0;
    foreach (gsa_cf_points(array('mesh'))['points'] as $c) {
        $dupe = false;
        foreach (gsa_cf_mesh_keys($c['id']) as $key) {
            if (isset($have[$key])) {
                $dupe = true;
            }
        }
        if ($dupe) {
            continue;
        }
        $points[] = array(
            'id' => $c['id'], 'name' => $c['name'] ?? $c['id'], 'short' => $c['short'] ?? '',
            'hw' => $c['proto'] ?? '', 'role' => '', 'lat' => $c['lat'], 'lon' => $c['lon'],
            'community' => true, 'source' => 'contributor', 'k' => 'mesh',
            'ageSec' => $c['ageSec'], 'reports' => $c['reports'], 'rx' => $c['rx'] ?? null,
        );
        $add++;
    }
    $snap['points'] = $points;
    $snap['community'] = $add;
    if (isset($snap['count'])) {
        $snap['count'] = count($points);
    }
    return $snap;
}
