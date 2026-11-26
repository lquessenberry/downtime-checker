<?php
// Cache and scan-snapshot helpers for the scheduled grid pass (#34).
// Same file name, function names and scan-cache.json format as Lee's PR #96.
// HTTP visitors only read these files. The cron runner is the only writer.

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found\n";
    exit;
}

// A pass older than this still replays, but the page says how old it is.
defined('GSA_GRID_STALE_SEC') || define('GSA_GRID_STALE_SEC', 45 * 60);
// The runner gives up after this many seconds and keeps the old result.
defined('GSA_GRID_MAX_SEC') || define('GSA_GRID_MAX_SEC', 8 * 60);
// If more than this share of sites comes back down, assume the host's own
// network is at fault and keep the last good result.
defined('GSA_GRID_MAX_DOWN') || define('GSA_GRID_MAX_DOWN', 0.80);

function gsa_runner_mode()
{
    return defined('GSA_RUNNER') && GSA_RUNNER;
}

// Write a file so readers always see the old or the new copy, never half.
function gsa_atomic_write($file, $body)
{
    $tmp = $file . '.tmp.' . getmypid();
    if (file_put_contents($tmp, $body) === false) {
        @unlink($tmp);
        return false;
    }
    if (!rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function gsa_fingerprint($payload)
{
    if (isset($payload['points'])) {
        $core = $payload['points'];
    } elseif (isset($payload['results'])) {
        $core = $payload['results'];
    } else {
        $core = $payload;
    }
    return hash('sha256', json_encode($core));
}

function gsa_cache_put($file, $payload)
{
    $payload['fetchedAt'] = time();
    $payload['stale'] = false;
    $body = json_encode($payload);
    if ($body === false || !gsa_atomic_write($file, $body)) {
        return array('changed' => false, 'error' => 'Could not save ' . basename($file));
    }
    return array(
        'changed' => true,
        'bytes' => strlen($body),
        'fingerprint' => gsa_fingerprint($payload),
        'count' => isset($payload['results']) ? count($payload['results']) : 0,
    );
}

function gsa_poll_status_file()
{
    global $dataDir;
    return $dataDir . '/poll-status.json';
}

function gsa_poll_status_read()
{
    $file = gsa_poll_status_file();
    if (!is_file($file)) {
        return array('jobs' => array(), 'mode' => 'one-user');
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    if (!is_array($decoded)) {
        return array('jobs' => array(), 'mode' => 'one-user');
    }
    $decoded['mode'] = 'one-user';
    return $decoded;
}

function gsa_poll_status_note($job, $info)
{
    $all = gsa_poll_status_read();
    if (!isset($all['jobs']) || !is_array($all['jobs'])) {
        $all['jobs'] = array();
    }
    $info['at'] = gmdate('Y-m-d\TH:i:s\Z');
    if (!empty($info['ok'])) {
        $info['lastOkAt'] = $info['at'];
    } elseif (isset($all['jobs'][$job]['lastOkAt'])) {
        $info['lastOkAt'] = $all['jobs'][$job]['lastOkAt'];
    }
    $all['jobs'][$job] = $info;
    $all['updated'] = $info['at'];
    gsa_atomic_write(gsa_poll_status_file(), json_encode($all));
}

function gsa_scan_cache_file()
{
    global $dataDir;
    return $dataDir . '/scan-cache.json';
}

function gsa_scan_cache_read()
{
    $file = gsa_scan_cache_file();
    if (!is_file($file)) {
        return null;
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    return is_array($decoded) ? $decoded : null;
}

// Is a finished pass good enough to replace what visitors see?
function gsa_pass_problem($state)
{
    if (!empty($state['stopped'])) {
        return 'Pass was stopped';
    }
    if (!empty($state['timedOut'])) {
        return 'Pass hit the ' . GSA_GRID_MAX_SEC . 's limit';
    }
    $total = (int) ($state['total'] ?? 0);
    if ($total <= 0) {
        return 'No targets';
    }
    $have = 0;
    foreach (($state['results'] ?? array()) as $row) {
        if (is_array($row)) {
            $have++;
        }
    }
    if ((int) ($state['done'] ?? 0) !== $total || $have !== $total) {
        return "Pass incomplete ($have of $total)";
    }
    $down = (int) ($state['down'] ?? 0);
    if ($down / $total > GSA_GRID_MAX_DOWN) {
        return sprintf('%d of %d down (over %d%%), host network suspected', $down, $total, GSA_GRID_MAX_DOWN * 100);
    }
    return null;
}

function gsa_filter_scan_state($snap, $id, $country)
{
    if (!is_array($snap) || empty($snap['results'])) {
        $empty = blank_state();
        $empty['replay'] = true;
        $empty['pending'] = true;
        return $empty;
    }
    $finished = (int) ($snap['finishedAt'] ?? 0);
    $ageSec = $finished > 0 ? max(0, time() - (int) floor($finished / 1000)) : null;
    $total = max(1, (int) ($snap['total'] ?? count($snap['results'])));
    $batch = max(1, (int) ($snap['batchSize'] ?? 20));
    $batches = (int) ceil($total / $batch);
    $pace = array(
        'batchSize' => $batch,
        'batchMs' => $batches > 0 ? (int) round(((int) ($snap['ms'] ?? 0)) / $batches) : 0,
        'mode' => $snap['mode'] ?? '',
    );
    $results = array();
    $up = 0;
    $down = 0;
    $all = $id === '' || $id === 'everything';
    foreach ($snap['results'] as $row) {
        if (!is_array($row) || empty($row['address'])) {
            continue;
        }
        if (!$all && !target_matches($row, $id, $country)) {
            continue;
        }
        $row['index'] = count($results);
        $results[] = $row;
        if (($row['status'] ?? '') === 'up') {
            $up++;
        } else {
            $down++;
        }
    }
    $heading = $id === 'country' ? $country : catalog_label($all ? 'everything' : $id);
    return array(
        'running' => false,
        'scanId' => $snap['scanId'] ?? 0,
        'heading' => $heading,
        'searchId' => $all ? 'everything' : $id,
        'country' => $country,
        'total' => count($results),
        'done' => count($results),
        'up' => $up,
        'down' => $down,
        'startedAt' => $snap['startedAt'] ?? 0,
        'finishedAt' => $finished,
        'ageSec' => $ageSec,
        'stale' => $ageSec === null || $ageSec > GSA_GRID_STALE_SEC,
        'pace' => $pace,
        'replay' => true,
        'sourceScan' => $snap['searchId'] ?? 'everything',
        'results' => $results,
    );
}

// Aircraft cron cache. The runner is the only process that calls adsb.lol.
// Visitors read data/aircraft-cache.json through /api/aircraft and /api/mil.
defined('GSA_AIRCRAFT_PRUNE_MS') || define('GSA_AIRCRAFT_PRUNE_MS', 15 * 60 * 1000);
defined('GSA_AIRCRAFT_CAP') || define('GSA_AIRCRAFT_CAP', 2500);
defined('GSA_AIRCRAFT_MIL_SEC') || define('GSA_AIRCRAFT_MIL_SEC', 15 * 60);
defined('GSA_AIRCRAFT_STALE_SEC') || define('GSA_AIRCRAFT_STALE_SEC', 20 * 60);

function gsa_aircraft_cache_file()
{
    global $dataDir;
    return $dataDir . '/aircraft-cache.json';
}

function gsa_aircraft_live_file()
{
    global $dataDir;
    return $dataDir . '/aircraft-live.json';
}

function gsa_aircraft_lock_file()
{
    global $dataDir;
    return $dataDir . '/aircraft.lock';
}

function gsa_adsb_state_file()
{
    global $dataDir;
    return $dataDir . '/adsb-state.json';
}

function gsa_adsb_state_read()
{
    $state = array(
        'day' => gmdate('Y-m-d'),
        'requests' => 0,
        'step' => 0,
        'milLastAt' => 0,
        'retryAfter' => 0,
        'last' => array(),
    );
    $file = gsa_adsb_state_file();
    if (is_file($file)) {
        $decoded = json_decode((string) file_get_contents($file), true);
        if (is_array($decoded)) {
            $state = array_merge($state, $decoded);
        }
    }
    $today = gmdate('Y-m-d');
    if ((string) ($state['day'] ?? '') !== $today) {
        $state['day'] = $today;
        $state['requests'] = 0;
        $state['last'] = array();
    }
    return $state;
}

function gsa_adsb_state_write($state)
{
    gsa_atomic_write(gsa_adsb_state_file(), json_encode($state));
}

function gsa_adsb_retry_at($value)
{
    $value = trim((string) $value);
    if ($value === '') {
        return time() + 60;
    }
    if (is_numeric($value)) {
        return time() + max(1, (int) $value);
    }
    $parsed = strtotime($value . ' UTC');
    if ($parsed === false) {
        $parsed = strtotime($value);
    }
    return $parsed !== false ? $parsed : time() + 60;
}

function gsa_adsb_civilian_job($step)
{
    $cycle = array('origin', 'ladd', 'pia', 'squawk7700');
    $kind = $cycle[((int) $step) % count($cycle)];
    if ($kind === 'origin') {
        return array('tag' => 'origin', 'url' => 'https://api.adsb.lol/v2/point/35.84/-90.7/250');
    }
    if ($kind === 'ladd') {
        return array('tag' => 'ladd', 'url' => 'https://api.adsb.lol/v2/ladd');
    }
    if ($kind === 'pia') {
        return array('tag' => 'pia', 'url' => 'https://api.adsb.lol/v2/pia');
    }
    return array('tag' => 'squawk7700', 'url' => 'https://api.adsb.lol/v2/squawk/7700');
}

function gsa_map_adsb_point($row, $tag)
{
    if (!is_array($row) || !isset($row['lat'], $row['lon'])) {
        return null;
    }
    $lat = (float) $row['lat'];
    $lon = (float) $row['lon'];
    if ($lat == 0.0 && $lon == 0.0) {
        return null;
    }
    $alt = $row['alt_baro'] ?? 0;
    $ground = $alt === 'ground';
    $altM = $ground ? 0 : (is_numeric($alt) ? round(((float) $alt) * 0.3048, 2) : 0);
    $flags = (int) ($row['dbFlags'] ?? 0);
    $emergency = $row['emergency'] ?? null;
    if ($emergency === 'none' || $emergency === '') {
        $emergency = null;
    }
    $hex = strtolower((string) ($row['hex'] ?? ''));
    return array(
        'lat' => $lat,
        'lon' => $lon,
        'hex' => $hex,
        'name' => trim((string) ($row['flight'] ?? $row['r'] ?? $row['hex'] ?? 'aircraft')),
        'r' => (string) ($row['r'] ?? ''),
        't' => (string) ($row['t'] ?? ''),
        'alt' => $alt,
        'altM' => $altM,
        'track' => $row['track'] ?? 0,
        'gs' => $row['gs'] ?? 0,
        'squawk' => (string) ($row['squawk'] ?? ''),
        'emergency' => $emergency,
        'category' => (string) ($row['category'] ?? ''),
        'src' => (string) ($row['type'] ?? ''),
        'mil' => (bool) ($flags & 1) || $tag === 'mil',
        'interesting' => (bool) ($flags & 2),
        'pia' => (bool) ($flags & 4) || $tag === 'pia',
        'ladd' => (bool) ($flags & 8) || $tag === 'ladd',
        'baro_rate' => $row['baro_rate'] ?? null,
        'seen_pos' => $row['seen_pos'] ?? null,
        'ts' => (int) round(microtime(true) * 1000),
    );
}

function gsa_aircraft_live_load()
{
    $file = gsa_aircraft_live_file();
    if (!is_file($file)) {
        return array();
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    return is_array($decoded) ? $decoded : array();
}

function gsa_aircraft_live_prune($map)
{
    $cut = (int) round(microtime(true) * 1000) - GSA_AIRCRAFT_PRUNE_MS;
    $kept = array();
    foreach ($map as $key => $point) {
        if (is_array($point) && (int) ($point['ts'] ?? 0) >= $cut) {
            $kept[$key] = $point;
        }
    }
    return $kept;
}

function gsa_aircraft_merge($map, $rows, $tag)
{
    if (!is_array($rows)) {
        return $map;
    }
    foreach ($rows as $row) {
        $point = gsa_map_adsb_point($row, $tag);
        if (!$point) {
            continue;
        }
        $key = $point['hex'] !== '' ? $point['hex'] : ($point['lat'] . ',' . $point['lon']);
        $map[$key] = $point;
    }
    return $map;
}

function gsa_aircraft_publish($map, $meta)
{
    $points = array_values($map);
    usort($points, function ($a, $b) {
        return ((int) ($b['ts'] ?? 0)) <=> ((int) ($a['ts'] ?? 0));
    });
    $count = count($points);
    if ($count > GSA_AIRCRAFT_CAP) {
        $points = array_slice($points, 0, GSA_AIRCRAFT_CAP);
    }
    $layer = array(
        'points' => $points,
        'count' => $count,
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'source' => $meta['source'] ?? 'adsb.lol',
        'sourceUrl' => $meta['sourceUrl'] ?? 'https://api.adsb.lol/',
        'attribution' => 'adsb.lol (ODbL 1.0)',
        'error' => $meta['error'] ?? null,
        'at' => (int) round(microtime(true) * 1000),
        'stale' => !empty($meta['stale']),
    );
    gsa_atomic_write(gsa_aircraft_live_file(), json_encode($map));
    // A failed pull must keep the previous fetchedAt so /api/aircraft can
    // still mark the copy stale. gsa_cache_put always stamps now and fresh.
    if (!empty($layer['stale'])) {
        $prev = gsa_aircraft_cache_read();
        $fetchedAt = (int) (($prev['fetchedAt'] ?? 0) ?: 0);
        if ($fetchedAt <= 0) {
            $fetchedAt = time();
        }
        $layer['fetchedAt'] = $fetchedAt;
        if (is_array($prev) && !empty($prev['source'])) {
            $layer['source'] = $prev['source'];
        }
        if (is_array($prev) && !empty($prev['sourceUrl'])) {
            $layer['sourceUrl'] = $prev['sourceUrl'];
        }
        if (is_array($prev) && !empty($prev['updated'])) {
            $layer['updated'] = $prev['updated'];
        }
        $body = json_encode($layer);
        $ok = $body !== false && gsa_atomic_write(gsa_aircraft_cache_file(), $body);
        $put = $ok
            ? array('changed' => true, 'bytes' => strlen($body), 'count' => $layer['count'])
            : array('changed' => false, 'error' => 'Could not save aircraft cache', 'bytes' => 0);
    } else {
        $put = gsa_cache_put(gsa_aircraft_cache_file(), $layer);
    }
    $put['count'] = $layer['count'];
    $put['published'] = count($points);
    return array($layer, $put);
}

function gsa_adsb_fetch($url, $tag)
{
    $state = gsa_adsb_state_read();
    $now = time();
    if ((int) ($state['retryAfter'] ?? 0) > $now) {
        return array(
            'ok' => false,
            'skipped' => true,
            'code' => 429,
            'error' => 'Backing off until Retry-After',
            'retryAfter' => (int) $state['retryAfter'],
            'requests' => (int) $state['requests'],
            'raw' => null,
            'tag' => $tag,
            'url' => $url,
        );
    }
    $mock = (string) ($GLOBALS['GSA_ADSB_MOCK'] ?? '');
    if ($mock === '429') {
        $state['retryAfter'] = $now + 120;
        $state['last'][] = array('at' => gmdate('Y-m-d\TH:i:s\Z'), 'tag' => $tag, 'url' => $url, 'code' => 429, 'mocked' => true);
        if (count($state['last']) > 12) {
            $state['last'] = array_slice($state['last'], -12);
        }
        gsa_adsb_state_write($state);
        return array(
            'ok' => false,
            'mocked' => true,
            'code' => 429,
            'error' => 'Mocked HTTP 429',
            'retryAfter' => $state['retryAfter'],
            'requests' => (int) $state['requests'],
            'raw' => null,
            'tag' => $tag,
            'url' => $url,
        );
    }
    if (!function_exists('curl_init')) {
        return array('ok' => false, 'code' => 0, 'error' => 'curl is missing', 'raw' => null, 'tag' => $tag, 'url' => $url, 'requests' => (int) $state['requests']);
    }
    $headers = array();
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => array(
            'Accept: application/json',
            'User-Agent: ' . browser_agent(),
        ),
        CURLOPT_HEADERFUNCTION => function ($curl, $header) use (&$headers) {
            $parts = explode(':', $header, 2);
            if (count($parts) === 2) {
                $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return strlen($header);
        },
    ));
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $state['requests'] = (int) $state['requests'] + 1;
    $state['last'][] = array('at' => gmdate('Y-m-d\TH:i:s\Z'), 'tag' => $tag, 'url' => $url, 'code' => $code);
    if (count($state['last']) > 12) {
        $state['last'] = array_slice($state['last'], -12);
    }
    $retryAfter = 0;
    if ($code === 429) {
        $retryAfter = gsa_adsb_retry_at($headers['retry-after'] ?? '60');
        $state['retryAfter'] = $retryAfter;
    }
    gsa_adsb_state_write($state);
    $raw = null;
    if ($body !== false && $code >= 200 && $code < 400) {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $raw = $decoded;
        }
    }
    $error = null;
    if ($raw === null) {
        if ($code === 429) {
            $error = 'adsb.lol returned 429';
        } elseif ($body === false) {
            $error = $err !== '' ? $err : 'adsb.lol did not answer';
        } else {
            $error = 'adsb.lol HTTP ' . $code;
        }
    }
    return array(
        'ok' => $raw !== null,
        'code' => $code,
        'error' => $error,
        'retryAfter' => $retryAfter,
        'requests' => (int) $state['requests'],
        'remaining' => isset($headers['x-ratelimit-remaining']) ? $headers['x-ratelimit-remaining'] : ($headers['x-ratelimit-limit'] ?? null),
        'raw' => $raw,
        'tag' => $tag,
        'url' => $url,
    );
}

function gsa_aircraft_refresh($opts = array())
{
    global $dataDir;
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0755, true);
    }
    $lock = fopen(gsa_aircraft_lock_file(), 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        if ($lock) {
            fclose($lock);
        }
        return array('ok' => true, 'busy' => true, 'error' => 'Aircraft poll already running');
    }
    try {
        return gsa_aircraft_refresh_locked($opts);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function gsa_aircraft_refresh_locked($opts)
{
    $state = gsa_adsb_state_read();
    $job = gsa_adsb_civilian_job((int) ($state['step'] ?? 0));

    $forceMil = !empty($opts['forceMil']);
    $skipMil = !empty($opts['skipMil']);
    $milAge = $state['milLastAt'] ? max(0, time() - (int) $state['milLastAt']) : null;
    $milDue = !$skipMil && ($forceMil || $state['milLastAt'] === 0 || $milAge >= GSA_AIRCRAFT_MIL_SEC);

    $civil = gsa_adsb_fetch($job['url'], $job['tag']);
    $mil = null;
    $milStatus = 'skipped';
    if ($milDue) {
        if (!empty($civil['skipped']) || (!empty($civil['code']) && (int) $civil['code'] === 429)) {
            $milStatus = 'backed-off';
        } else {
            $mil = gsa_adsb_fetch('https://api.adsb.lol/v2/mil', 'mil');
            if (!empty($mil['ok'])) {
                $milStatus = 'fetched';
                $state = gsa_adsb_state_read();
                $state['milLastAt'] = time();
                gsa_adsb_state_write($state);
            } elseif (!empty($mil['skipped'])) {
                $milStatus = 'backed-off';
            } else {
                $milStatus = 'failed';
            }
        }
    }

    $map = gsa_aircraft_live_prune(gsa_aircraft_live_load());
    $got = false;
    if (!empty($civil['ok'])) {
        $map = gsa_aircraft_merge($map, $civil['raw']['ac'] ?? array(), $job['tag']);
        $got = true;
        $state = gsa_adsb_state_read();
        $state['step'] = (int) ($state['step'] ?? 0) + 1;
        gsa_adsb_state_write($state);
    }
    if ($mil && !empty($mil['ok'])) {
        $map = gsa_aircraft_merge($map, $mil['raw']['ac'] ?? array(), 'mil');
        $got = true;
    }

    $errors = array();
    if (!empty($civil['error'])) {
        $errors[] = $job['tag'] . ': ' . $civil['error'];
    }
    if ($mil && !empty($mil['error'])) {
        $errors[] = 'mil: ' . $mil['error'];
    }
    $error = $errors ? implode('; ', $errors) : null;
    if (!$got && !$map) {
        $meta = array(
            'source' => 'adsb.lol ' . $job['tag'],
            'sourceUrl' => $job['url'],
            'error' => $error ?: 'adsb.lol did not answer',
            'stale' => true,
        );
        list($layer, $put) = gsa_aircraft_publish($map, $meta);
        $state = gsa_adsb_state_read();
        return array(
            'ok' => false,
            'count' => 0,
            'published' => 0,
            'civilianTag' => $job['tag'],
            'civilianCode' => $civil['code'] ?? 0,
            'mil' => $milStatus,
            'milAgeSec' => $milAge,
            'requestsToday' => (int) ($state['requests'] ?? 0),
            'retryAfter' => (int) ($state['retryAfter'] ?? 0),
            'error' => $meta['error'],
            'stale' => true,
            'bytes' => $put['bytes'] ?? 0,
        );
    }

    $sourceBits = array('adsb.lol ' . $job['tag']);
    if ($milStatus === 'fetched') {
        $sourceBits[] = 'mil';
    }
    $meta = array(
        'source' => implode(' · ', $sourceBits),
        'sourceUrl' => $job['url'],
        'error' => $got ? null : $error,
        'stale' => !$got,
    );
    list($layer, $put) = gsa_aircraft_publish($map, $meta);
    $state = gsa_adsb_state_read();
    return array(
        'ok' => $got || !empty($layer['points']),
        'count' => $layer['count'],
        'published' => count($layer['points']),
        'civilianTag' => $job['tag'],
        'civilianCode' => $civil['code'] ?? 0,
        'mil' => $milStatus,
        'milAgeSec' => $milAge,
        'requestsToday' => (int) ($state['requests'] ?? 0),
        'retryAfter' => (int) ($state['retryAfter'] ?? 0),
        'remaining' => $civil['remaining'] ?? ($mil['remaining'] ?? null),
        'error' => $error,
        'stale' => !$got,
        'bytes' => $put['bytes'] ?? 0,
        'attribution' => 'adsb.lol (ODbL 1.0)',
    );
}

function gsa_aircraft_cache_read()
{
    $file = gsa_aircraft_cache_file();
    if (!is_file($file)) {
        return null;
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    return is_array($decoded) ? $decoded : null;
}

function gsa_aircraft_snapshot()
{
    $cached = gsa_aircraft_cache_read();
    if (!is_array($cached)) {
        return array(
            'points' => array(),
            'count' => 0,
            'updated' => null,
            'source' => 'adsb.lol',
            'sourceUrl' => 'https://api.adsb.lol/',
            'attribution' => 'adsb.lol (ODbL 1.0)',
            'stale' => true,
            'error' => 'Awaiting poller',
            'ageSec' => null,
        );
    }
    $fetchedAt = (int) ($cached['fetchedAt'] ?? 0);
    $ageSec = $fetchedAt > 0 ? max(0, time() - $fetchedAt) : null;
    unset($cached['fetchedAt']);
    $cached['ageSec'] = $ageSec;
    $cached['stale'] = $ageSec === null || $ageSec > GSA_AIRCRAFT_STALE_SEC || !empty($cached['stale']) || empty($cached['points']);
    if (empty($cached['attribution'])) {
        $cached['attribution'] = 'adsb.lol (ODbL 1.0)';
    }
    return $cached;
}


// GPS jamming cron cache. The runner is the only process that calls
// api.gpsinterference.com. Visitors read data/jamming-cache.json through
// /api/feeds. The source map is rebuilt about once a day (~05:00 UTC);
// we still piggyback on the */5 aircraft cron but only pull when the last
// successful fetch is at least 15 minutes old.
defined('GSA_JAMMING_SEC') || define('GSA_JAMMING_SEC', 15 * 60);
defined('GSA_JAMMING_STALE_SEC') || define('GSA_JAMMING_STALE_SEC', 30 * 60 * 60);
defined('GSA_JAMMING_CAP') || define('GSA_JAMMING_CAP', 1400);
defined('GSA_JAMMING_YELLOW_CAP') || define('GSA_JAMMING_YELLOW_CAP', 700);
defined('GSA_JAMMING_URL') || define('GSA_JAMMING_URL', 'https://api.gpsinterference.com/v1/interference/latest');

function gsa_jamming_cache_file()
{
    global $dataDir;
    return $dataDir . '/jamming-cache.json';
}

function gsa_jamming_lock_file()
{
    global $dataDir;
    return $dataDir . '/jamming.lock';
}

function gsa_jamming_state_file()
{
    global $dataDir;
    return $dataDir . '/jamming-state.json';
}

function gsa_jamming_state_read()
{
    $state = array(
        'day' => gmdate('Y-m-d'),
        'requests' => 0,
        'lastAt' => 0,
        'retryAfter' => 0,
        'last' => array(),
    );
    $file = gsa_jamming_state_file();
    if (is_file($file)) {
        $decoded = json_decode((string) file_get_contents($file), true);
        if (is_array($decoded)) {
            $state = array_merge($state, $decoded);
        }
    }
    $today = gmdate('Y-m-d');
    if ((string) ($state['day'] ?? '') !== $today) {
        $state['day'] = $today;
        $state['requests'] = 0;
        $state['last'] = array();
    }
    return $state;
}

function gsa_jamming_state_write($state)
{
    gsa_atomic_write(gsa_jamming_state_file(), json_encode($state));
}

function gsa_jamming_ua()
{
    if (function_exists('browser_agent')) {
        return browser_agent();
    }
    return 'GlobalStatusApp/1.0 (https://globalstatus.app; jamming cache)';
}

// Same compact sampling as Lee's #96 jamming_sample: keep every severe
// (purple) and heavy (red) cell, then up to 700 degraded (yellow) cells,
// capped at 1400 points so the globe stays light.
function gsa_jamming_sample($jammed)
{
    usort($jammed, function ($a, $b) {
        return ($b['pct'] <=> $a['pct']);
    });
    $purple = array();
    $red = array();
    $yellow = array();
    foreach ($jammed as $point) {
        if ($point['band'] === 'p') {
            $purple[] = $point;
        } elseif ($point['band'] === 'r') {
            $red[] = $point;
        } else {
            $yellow[] = $point;
        }
    }
    $picked = array_merge($purple, $red);
    $cap = GSA_JAMMING_YELLOW_CAP;
    $n = count($yellow);
    if ($n <= $cap) {
        $picked = array_merge($picked, $yellow);
    } else {
        $step = $n / $cap;
        for ($i = 0; $i < $cap; $i++) {
            $picked[] = $yellow[(int) floor($i * $step)];
        }
    }
    return array_slice($picked, 0, GSA_JAMMING_CAP);
}

function gsa_jamming_map_points($raw)
{
    $jammed = array();
    $hexes = is_array($raw) ? ($raw['hexes'] ?? array()) : array();
    foreach ($hexes as $hex) {
        if (!is_array($hex) || ($hex['c'] ?? '') === 'g' || !isset($hex['poly']) || !is_array($hex['poly']) || count($hex['poly']) < 3) {
            continue;
        }
        $lat = 0;
        $lon = 0;
        foreach ($hex['poly'] as $pt) {
            if (!is_array($pt) || count($pt) < 2) {
                continue;
            }
            $lat += (float) $pt[0];
            $lon += (float) $pt[1];
        }
        $n = count($hex['poly']);
        if ($n < 3) {
            continue;
        }
        $band = (string) ($hex['c'] ?? 'y');
        $jammed[] = array(
            'lat' => $lat / $n,
            'lon' => $lon / $n,
            'band' => $band,
            'bad' => (float) ($hex['b'] ?? 0),
            'good' => (float) ($hex['g'] ?? 0),
            'pct' => (float) ($hex['p'] ?? 0),
            'name' => 'GPS ' . ($band === 'p' ? 'severe' : ($band === 'r' ? 'heavy' : 'degraded')),
        );
    }
    return $jammed;
}

function gsa_jamming_fetch()
{
    $state = gsa_jamming_state_read();
    $now = time();
    if ((int) ($state['retryAfter'] ?? 0) > $now) {
        return array(
            'ok' => false,
            'skipped' => true,
            'code' => 429,
            'error' => 'Backing off until Retry-After',
            'retryAfter' => (int) $state['retryAfter'],
            'requests' => (int) $state['requests'],
            'raw' => null,
        );
    }
    $mock = (string) ($GLOBALS['GSA_JAM_MOCK'] ?? '');
    if ($mock === '429') {
        $state['retryAfter'] = $now + 120;
        $state['last'][] = array('at' => gmdate('Y-m-d\TH:i:s\Z'), 'code' => 429, 'mocked' => true);
        if (count($state['last']) > 12) {
            $state['last'] = array_slice($state['last'], -12);
        }
        gsa_jamming_state_write($state);
        return array(
            'ok' => false,
            'mocked' => true,
            'code' => 429,
            'error' => 'Mocked HTTP 429',
            'retryAfter' => $state['retryAfter'],
            'requests' => (int) $state['requests'],
            'raw' => null,
        );
    }
    if ($mock === 'fail') {
        $state['last'][] = array('at' => gmdate('Y-m-d\TH:i:s\Z'), 'code' => 0, 'mocked' => true, 'error' => 'fail');
        if (count($state['last']) > 12) {
            $state['last'] = array_slice($state['last'], -12);
        }
        gsa_jamming_state_write($state);
        return array(
            'ok' => false,
            'mocked' => true,
            'code' => 0,
            'error' => 'Mocked fetch failure',
            'retryAfter' => 0,
            'requests' => (int) $state['requests'],
            'raw' => null,
        );
    }
    if ($mock !== '' && is_file($mock)) {
        $decoded = json_decode((string) file_get_contents($mock), true);
        $state['requests'] = (int) $state['requests'] + 1;
        $state['last'][] = array('at' => gmdate('Y-m-d\TH:i:s\Z'), 'code' => 200, 'mocked' => true, 'file' => basename($mock));
        if (count($state['last']) > 12) {
            $state['last'] = array_slice($state['last'], -12);
        }
        gsa_jamming_state_write($state);
        if (is_array($decoded)) {
            return array(
                'ok' => true,
                'mocked' => true,
                'code' => 200,
                'error' => null,
                'retryAfter' => 0,
                'requests' => (int) $state['requests'],
                'raw' => $decoded,
            );
        }
        return array(
            'ok' => false,
            'mocked' => true,
            'code' => 0,
            'error' => 'Mock file was not JSON',
            'retryAfter' => 0,
            'requests' => (int) $state['requests'],
            'raw' => null,
        );
    }
    if (!function_exists('curl_init')) {
        return array('ok' => false, 'code' => 0, 'error' => 'curl is missing', 'raw' => null, 'requests' => (int) $state['requests']);
    }
    $headers = array();
    $ch = curl_init(GSA_JAMMING_URL);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_HTTPHEADER => array(
            'Accept: application/json',
            'User-Agent: ' . gsa_jamming_ua(),
        ),
        CURLOPT_HEADERFUNCTION => function ($curl, $header) use (&$headers) {
            $parts = explode(':', $header, 2);
            if (count($parts) === 2) {
                $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return strlen($header);
        },
    ));
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $state['requests'] = (int) $state['requests'] + 1;
    $state['last'][] = array('at' => gmdate('Y-m-d\TH:i:s\Z'), 'code' => $code, 'url' => GSA_JAMMING_URL);
    if (count($state['last']) > 12) {
        $state['last'] = array_slice($state['last'], -12);
    }
    $retryAfter = 0;
    if ($code === 429) {
        $retryAfter = gsa_adsb_retry_at($headers['retry-after'] ?? '60');
        $state['retryAfter'] = $retryAfter;
    }
    gsa_jamming_state_write($state);
    $raw = null;
    if ($body !== false && $code >= 200 && $code < 400) {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $raw = $decoded;
        }
    }
    $error = null;
    if ($raw === null) {
        if ($code === 429) {
            $error = 'GPSInterference returned 429';
        } elseif ($body === false) {
            $error = $err !== '' ? $err : 'GPSInterference did not answer';
        } else {
            $error = 'GPSInterference HTTP ' . $code;
        }
    }
    return array(
        'ok' => $raw !== null,
        'code' => $code,
        'error' => $error,
        'retryAfter' => $retryAfter,
        'requests' => (int) $state['requests'],
        'raw' => $raw,
    );
}

function gsa_jamming_publish($layer)
{
    if (!empty($layer['stale'])) {
        $prev = gsa_jamming_cache_read();
        $fetchedAt = (int) (($prev['fetchedAt'] ?? 0) ?: 0);
        if ($fetchedAt <= 0) {
            $fetchedAt = time();
        }
        $layer['fetchedAt'] = $fetchedAt;
        foreach (array('source', 'sourceUrl', 'updated', 'historyDate', 'attribution') as $key) {
            if (is_array($prev) && !empty($prev[$key]) && empty($layer[$key])) {
                $layer[$key] = $prev[$key];
            }
        }
        if (is_array($prev) && !empty($prev['points']) && empty($layer['points'])) {
            $layer['points'] = $prev['points'];
            $layer['count'] = $prev['count'] ?? count($prev['points']);
        }
        $body = json_encode($layer);
        $ok = $body !== false && gsa_atomic_write(gsa_jamming_cache_file(), $body);
        $put = $ok
            ? array('changed' => true, 'bytes' => strlen($body), 'count' => $layer['count'] ?? 0)
            : array('changed' => false, 'error' => 'Could not save jamming cache', 'bytes' => 0);
    } else {
        $put = gsa_cache_put(gsa_jamming_cache_file(), $layer);
    }
    $put['count'] = $layer['count'] ?? 0;
    $put['published'] = isset($layer['points']) && is_array($layer['points']) ? count($layer['points']) : 0;
    return array($layer, $put);
}

function gsa_jamming_cache_read()
{
    $file = gsa_jamming_cache_file();
    if (!is_file($file)) {
        return null;
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    return is_array($decoded) ? $decoded : null;
}

function gsa_jamming_static_fallback()
{
    global $root;
    $file = $root . '/api/feeds.json';
    if (!is_file($file)) {
        return null;
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    if (!is_array($decoded) || empty($decoded['jamming']) || !is_array($decoded['jamming'])) {
        return null;
    }
    $jam = $decoded['jamming'];
    $jam['stale'] = true;
    $jam['source'] = $jam['source'] ?? 'GPSInterference.com';
    $jam['sourceUrl'] = $jam['sourceUrl'] ?? 'https://gpsinterference.com/';
    $jam['attribution'] = $jam['attribution'] ?? 'Source: GPSInterference.com (https://gpsinterference.com/)';
    return $jam;
}

function gsa_jamming_snapshot()
{
    $cached = gsa_jamming_cache_read();
    if (!is_array($cached)) {
        $fallback = gsa_jamming_static_fallback();
        if (is_array($fallback)) {
            $fallback['error'] = $fallback['error'] ?? 'Awaiting poller';
            $fallback['ageSec'] = null;
            $fallback['stale'] = true;
            return $fallback;
        }
        return array(
            'points' => array(),
            'count' => 0,
            'updated' => null,
            'source' => 'GPSInterference.com',
            'sourceUrl' => 'https://gpsinterference.com/',
            'attribution' => 'Source: GPSInterference.com (https://gpsinterference.com/)',
            'stale' => true,
            'error' => 'Awaiting poller',
            'ageSec' => null,
        );
    }
    $fetchedAt = (int) ($cached['fetchedAt'] ?? 0);
    $ageSec = $fetchedAt > 0 ? max(0, time() - $fetchedAt) : null;
    unset($cached['fetchedAt']);
    $cached['ageSec'] = $ageSec;
    $cached['stale'] = $ageSec === null || $ageSec > GSA_JAMMING_STALE_SEC || !empty($cached['stale']) || empty($cached['points']);
    if (empty($cached['attribution'])) {
        $cached['attribution'] = 'Source: GPSInterference.com (https://gpsinterference.com/)';
    }
    if (empty($cached['sourceUrl'])) {
        $cached['sourceUrl'] = 'https://gpsinterference.com/';
    }
    return $cached;
}

function gsa_jamming_refresh($opts = array())
{
    global $dataDir;
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0755, true);
    }
    $lock = fopen(gsa_jamming_lock_file(), 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        if ($lock) {
            fclose($lock);
        }
        return array('ok' => true, 'busy' => true, 'error' => 'Jamming poll already running');
    }
    try {
        return gsa_jamming_refresh_locked($opts);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function gsa_jamming_refresh_locked($opts)
{
    $state = gsa_jamming_state_read();
    $force = !empty($opts['force']);
    $lastAt = (int) ($state['lastAt'] ?? 0);
    if ($lastAt <= 0) {
        $prev = gsa_jamming_cache_read();
        $lastAt = (int) (($prev['fetchedAt'] ?? 0) ?: 0);
    }
    $ageSec = $lastAt > 0 ? max(0, time() - $lastAt) : null;
    $due = $force || $lastAt === 0 || $ageSec === null || $ageSec >= GSA_JAMMING_SEC;
    if (!$due) {
        $cached = gsa_jamming_cache_read();
        return array(
            'ok' => true,
            'skipped' => true,
            'reason' => 'not-due',
            'count' => is_array($cached) ? ($cached['count'] ?? 0) : 0,
            'published' => is_array($cached) && isset($cached['points']) ? count($cached['points']) : 0,
            'ageSec' => $ageSec,
            'requestsToday' => (int) ($state['requests'] ?? 0),
            'retryAfter' => (int) ($state['retryAfter'] ?? 0),
            'error' => null,
            'stale' => false,
            'updated' => is_array($cached) ? ($cached['updated'] ?? null) : null,
        );
    }

    $got = gsa_jamming_fetch();
    $state = gsa_jamming_state_read();
    if (!empty($got['ok']) && is_array($got['raw'])) {
        $raw = $got['raw'];
        $jammed = gsa_jamming_map_points($raw);
        $points = gsa_jamming_sample($jammed);
        $layer = array(
            'points' => $points,
            'count' => count($jammed),
            'updated' => $raw['updated'] ?? gmdate('Y-m-d\TH:i:s\Z'),
            'historyDate' => $raw['history_date'] ?? null,
            'source' => 'GPSInterference.com',
            'sourceUrl' => 'https://gpsinterference.com/',
            'attribution' => 'Source: GPSInterference.com (https://gpsinterference.com/)',
            'error' => null,
            'stale' => false,
            'at' => (int) round(microtime(true) * 1000),
        );
        list($layer, $put) = gsa_jamming_publish($layer);
        $state['lastAt'] = time();
        $state['retryAfter'] = 0;
        gsa_jamming_state_write($state);
        return array(
            'ok' => true,
            'count' => $layer['count'],
            'published' => $put['published'],
            'bytes' => $put['bytes'] ?? 0,
            'ageSec' => 0,
            'requestsToday' => (int) ($state['requests'] ?? 0),
            'retryAfter' => 0,
            'error' => null,
            'stale' => false,
            'updated' => $layer['updated'],
            'historyDate' => $layer['historyDate'],
            'mocked' => !empty($got['mocked']),
            'code' => $got['code'] ?? 200,
        );
    }

    // Failed or 429: keep the last good cache, marked stale.
    $prev = gsa_jamming_cache_read();
    $layer = array(
        'points' => is_array($prev) ? ($prev['points'] ?? array()) : array(),
        'count' => is_array($prev) ? ($prev['count'] ?? 0) : 0,
        'updated' => is_array($prev) ? ($prev['updated'] ?? null) : null,
        'historyDate' => is_array($prev) ? ($prev['historyDate'] ?? null) : null,
        'source' => 'GPSInterference.com',
        'sourceUrl' => 'https://gpsinterference.com/',
        'attribution' => 'Source: GPSInterference.com (https://gpsinterference.com/)',
        'error' => $got['error'] ?? 'GPSInterference did not answer',
        'stale' => true,
        'at' => is_array($prev) ? ($prev['at'] ?? (int) round(microtime(true) * 1000)) : (int) round(microtime(true) * 1000),
    );
    list($layer, $put) = gsa_jamming_publish($layer);
    return array(
        'ok' => !empty($layer['points']) || !empty($got['skipped']),
        'count' => $layer['count'],
        'published' => $put['published'],
        'bytes' => $put['bytes'] ?? 0,
        'ageSec' => $ageSec,
        'requestsToday' => (int) ($state['requests'] ?? 0),
        'retryAfter' => (int) ($got['retryAfter'] ?? ($state['retryAfter'] ?? 0)),
        'error' => $layer['error'],
        'stale' => true,
        'updated' => $layer['updated'],
        'backedOff' => !empty($got['skipped']) || ((int) ($got['code'] ?? 0) === 429),
        'mocked' => !empty($got['mocked']),
        'code' => $got['code'] ?? 0,
    );
}


// ---------------------------------------------------------------------------
// SPACE & WEATHER server feeds. Same rule as aircraft and jamming: the cron
// runner is the only process that calls these sources, visitors only read the
// compact cache files in data/ through router.php (/api/space/<name>).
// They ride the existing */5 aircraft cron; there is no new cron entry.
//
//   nws         api.weather.gov/alerts/active   every run   (<= 288/day)
//   hurricanes  nhc.noaa.gov/CurrentStorms.json every 15 min (<= 96/day)
//   wildfires   NASA FIRMS VIIRS NOAA-20 24h    every 3 h   (<= 8/day)
//   tsunami     tsunami.gov NTWC + PTWC Atom    every run   (2 x 288/day, + 1 CAP per new bulletin)
//   rivers      NWPS river gauges >= action     every 15 min (<= 96/day)
//   coastal     CO-OPS SOS latest water level   every 15 min (<= 96/day, + 2/day station list and MHHW)
//
// A failed pull keeps the last good cache and marks it stale.
// The browser-only layers (ISS, volcanoes, disasters, radar, aurora) are in
// spaceweather.js and never touch this server.

defined('GSA_SPACE_SLACK_SEC') || define('GSA_SPACE_SLACK_SEC', 60);

function gsa_space_feeds()
{
    return array(
        'nws' => array(
            'every' => 5 * 60,
            'staleSec' => 30 * 60,
            'source' => 'National Weather Service',
            'sourceUrl' => 'https://www.weather.gov/',
            'attribution' => 'Alerts: NOAA National Weather Service (api.weather.gov)',
        ),
        'hurricanes' => array(
            'every' => 15 * 60,
            'staleSec' => 3 * 60 * 60,
            'source' => 'National Hurricane Center',
            'sourceUrl' => 'https://www.nhc.noaa.gov/',
            'attribution' => 'Storms: NOAA National Hurricane Center',
        ),
        'wildfires' => array(
            'every' => 3 * 60 * 60,
            'staleSec' => 9 * 60 * 60,
            'source' => 'NASA FIRMS',
            'sourceUrl' => 'https://firms.modaps.eosdis.nasa.gov/',
            'attribution' => "Fires: NASA FIRMS (VIIRS NOAA-20, 24 h), part of NASA's EOSDIS",
        ),
        'tsunami' => array(
            'every' => 5 * 60,
            'staleSec' => 30 * 60,
            'source' => 'NOAA Tsunami Warning Centers',
            'sourceUrl' => 'https://www.tsunami.gov/',
            'attribution' => 'Tsunami alerts: NOAA/NWS National and Pacific Tsunami Warning Centers (tsunami.gov)',
        ),
        'rivers' => array(
            'every' => 15 * 60,
            'staleSec' => 2 * 60 * 60,
            'source' => 'NOAA National Water Prediction Service',
            'sourceUrl' => 'https://water.noaa.gov/',
            'attribution' => 'River gauges: NOAA/NWS National Water Prediction Service',
        ),
        'coastal' => array(
            'every' => 15 * 60,
            'staleSec' => 60 * 60,
            'source' => 'NOAA CO-OPS',
            'sourceUrl' => 'https://tidesandcurrents.noaa.gov/',
            'attribution' => 'Water levels: NOAA CO-OPS Tides and Currents',
        ),
    );
}

function gsa_space_cache_file($name)
{
    global $dataDir;
    return $dataDir . '/space-' . $name . '.json';
}

function gsa_space_state_file()
{
    global $dataDir;
    return $dataDir . '/space-state.json';
}

function gsa_space_state_read()
{
    $state = array();
    $file = gsa_space_state_file();
    if (is_file($file)) {
        $decoded = json_decode((string) file_get_contents($file), true);
        if (is_array($decoded)) {
            $state = $decoded;
        }
    }
    $today = gmdate('Y-m-d');
    foreach (array_keys(gsa_space_feeds()) as $name) {
        $row = isset($state[$name]) && is_array($state[$name]) ? $state[$name] : array();
        $row = array_merge(array('day' => $today, 'requests' => 0, 'lastAt' => 0, 'tryAt' => 0, 'retryAfter' => 0), $row);
        if ($row['day'] !== $today) {
            $row['day'] = $today;
            $row['requests'] = 0;
        }
        $state[$name] = $row;
    }
    return $state;
}

function gsa_space_state_write($state)
{
    gsa_atomic_write(gsa_space_state_file(), json_encode($state));
}

function gsa_space_cache_read($name)
{
    $file = gsa_space_cache_file($name);
    if (!is_file($file)) {
        return null;
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    return is_array($decoded) ? $decoded : null;
}

function gsa_space_ua()
{
    // NWS asks every caller for a User-Agent that says who is calling.
    return 'GlobalStatusApp/1.0 (https://globalstatus.app; space-weather cache)';
}

// GET a URL. With $toFile the body streams to disk (FIRMS is ~8 MB).
function gsa_space_get($url, $accept, $toFile = null, $timeout = 40)
{
    if (!function_exists('curl_init')) {
        return array('code' => 0, 'body' => null, 'error' => 'curl is missing', 'retryAfter' => 0);
    }
    $headers = array();
    $ch = curl_init($url);
    $fh = null;
    $opts = array(
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_ENCODING => '',
        CURLOPT_HTTPHEADER => array('Accept: ' . $accept, 'User-Agent: ' . gsa_space_ua()),
        CURLOPT_HEADERFUNCTION => function ($curl, $header) use (&$headers) {
            $parts = explode(':', $header, 2);
            if (count($parts) === 2) {
                $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return strlen($header);
        },
    );
    if ($toFile !== null) {
        $fh = fopen($toFile, 'wb');
        if (!$fh) {
            return array('code' => 0, 'body' => null, 'error' => 'Could not open temp file', 'retryAfter' => 0);
        }
        $opts[CURLOPT_FILE] = $fh;
    } else {
        $opts[CURLOPT_RETURNTRANSFER] = true;
    }
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($fh) {
        fclose($fh);
    }
    $retryAfter = 0;
    if ($code === 429 || $code === 503) {
        $retryAfter = gsa_adsb_retry_at($headers['retry-after'] ?? '300');
    }
    $ok = $body !== false && $code >= 200 && $code < 300;
    return array(
        'code' => $code,
        'body' => ($ok && $toFile === null) ? (string) $body : null,
        'ok' => $ok,
        'error' => $ok ? null : ($body === false ? ($err !== '' ? $err : 'No answer') : 'HTTP ' . $code),
        'retryAfter' => $retryAfter,
    );
}

// ---- NWS active alerts -> compact list --------------------------------------
// The full feed is ~2 MB. Most alerts have no polygon and name counties by
// SAME/FIPS code, so those are pinned at county centroids
// (api/county-centroids.json). Storm-based warnings keep their polygon.
// Marine-only alerts carry no county code and are counted, not pinned.

function gsa_space_county_index()
{
    global $root;
    static $index = null;
    if ($index !== null) {
        return $index;
    }
    $index = array();
    $decoded = json_decode((string) @file_get_contents($root . '/api/county-centroids.json'), true);
    $rows = is_array($decoded) ? ($decoded['counties'] ?? array()) : array();
    foreach ($rows as $row) {
        if (!isset($row['geoid'], $row['lat'], $row['lon'])) {
            continue;
        }
        $index[(string) $row['geoid']] = array(
            'lat' => round((float) $row['lat'], 3),
            'lon' => round((float) $row['lon'], 3),
            'name' => trim(($row['name'] ?? '') . ', ' . ($row['usps'] ?? ''), ', '),
        );
    }
    return $index;
}

function gsa_space_clip($text, $limit)
{
    $text = (string) $text;
    return function_exists('mb_substr') ? mb_substr($text, 0, $limit) : substr($text, 0, $limit);
}

// Marine and offshore zones (UGC like PZZ110, AMZ040) from the NWS GIS
// shapefiles, as one centroid per zone. Built once into api/.
function gsa_space_marine_index()
{
    global $root;
    static $index = null;
    if ($index !== null) {
        return $index;
    }
    $decoded = json_decode((string) @file_get_contents($root . '/api/marine-zone-centroids.json'), true);
    $index = is_array($decoded) && isset($decoded['zones']) && is_array($decoded['zones']) ? $decoded['zones'] : array();
    return $index;
}

function gsa_space_sev_rank($severity)
{
    $map = array('Extreme' => 4, 'Severe' => 3, 'Moderate' => 2, 'Minor' => 1);
    return $map[$severity] ?? 0;
}

function gsa_space_ring($ring)
{
    $out = array();
    $n = is_array($ring) ? count($ring) : 0;
    // Keep at most ~60 vertices per ring.
    $step = max(1, (int) ceil($n / 60));
    for ($i = 0; $i < $n; $i += $step) {
        $pt = $ring[$i];
        if (is_array($pt) && count($pt) >= 2) {
            $out[] = array(round((float) $pt[1], 3), round((float) $pt[0], 3));
        }
    }
    return count($out) >= 3 ? $out : null;
}

function gsa_space_nws_build($raw)
{
    $counties = gsa_space_county_index();
    $marine = gsa_space_marine_index();
    $alerts = array();
    $polygons = array();
    $byCounty = array();
    $unmapped = 0;
    $total = 0;
    foreach (($raw['features'] ?? array()) as $feat) {
        $p = is_array($feat) ? ($feat['properties'] ?? array()) : array();
        if (($p['status'] ?? '') !== 'Actual' || ($p['messageType'] ?? '') === 'Cancel') {
            continue;
        }
        $total++;
        $idx = count($alerts);
        $alerts[] = array(
            'e' => (string) ($p['event'] ?? 'Alert'),
            's' => (string) ($p['severity'] ?? 'Unknown'),
            'h' => gsa_space_clip($p['headline'] ?? '', 180),
            'x' => (string) ($p['expires'] ?? ($p['ends'] ?? '')),
            'u' => (string) ($p['@id'] ?? ($feat['id'] ?? '')),
        );
        $geom = $feat['geometry'] ?? null;
        $placed = false;
        if (is_array($geom) && ($geom['type'] ?? '') === 'Polygon' && !empty($geom['coordinates'][0])) {
            $ring = gsa_space_ring($geom['coordinates'][0]);
            if ($ring) {
                $polygons[] = array('i' => $idx, 'r' => $ring);
                $placed = true;
            }
        } elseif (is_array($geom) && ($geom['type'] ?? '') === 'MultiPolygon') {
            foreach (($geom['coordinates'] ?? array()) as $poly) {
                $ring = gsa_space_ring($poly[0] ?? null);
                if ($ring) {
                    $polygons[] = array('i' => $idx, 'r' => $ring);
                    $placed = true;
                }
            }
        }
        if (!$placed) {
            foreach (($p['geocode']['SAME'] ?? array()) as $same) {
                $fips = substr((string) $same, -5);
                if (!isset($counties[$fips])) {
                    continue;
                }
                $byCounty[$fips][] = $idx;
                $placed = true;
            }
        }
        if (!$placed) {
            foreach (($p['geocode']['UGC'] ?? array()) as $ugc) {
                $ugc = (string) $ugc;
                if (!isset($marine[$ugc])) {
                    continue;
                }
                $byCounty['z:' . $ugc][] = $idx;
                $placed = true;
            }
        }
        if (!$placed) {
            $unmapped++;
        }
    }
    // Keep only alerts that are drawn, renumbered, so the file stays small.
    $used = array();
    foreach ($polygons as $poly) {
        $used[$poly['i']] = true;
    }
    foreach ($byCounty as $list) {
        foreach ($list as $i) {
            $used[$i] = true;
        }
    }
    $remap = array();
    $kept = array();
    foreach ($alerts as $i => $alert) {
        if (isset($used[$i])) {
            $remap[$i] = count($kept);
            $kept[] = $alert;
        }
    }
    foreach ($polygons as $k => $poly) {
        $polygons[$k]['i'] = $remap[$poly['i']];
    }
    foreach ($byCounty as $fips => $list) {
        $byCounty[$fips] = array_map(function ($i) use ($remap) {
            return $remap[$i];
        }, $list);
    }
    $alerts = $kept;
    $points = array();
    foreach ($byCounty as $fips => $list) {
        $list = array_values(array_unique($list));
        usort($list, function ($a, $b) use ($alerts) {
            return gsa_space_sev_rank($alerts[$b]['s']) <=> gsa_space_sev_rank($alerts[$a]['s']);
        });
        if (strpos((string) $fips, 'z:') === 0) {
            $z = $marine[substr($fips, 2)];
            $c = array('lat' => $z['lat'], 'lon' => $z['lon'], 'name' => $z['name'] . ' (' . substr($fips, 2) . ')');
        } else {
            $c = $counties[$fips];
        }
        $points[] = array('lat' => $c['lat'], 'lon' => $c['lon'], 'n' => $c['name'], 'a' => array_slice($list, 0, 8));
    }
    return array(
        'alerts' => $alerts,
        'polygons' => $polygons,
        'points' => $points,
        'count' => $total,
        'mapped' => count($alerts),
        'unmapped' => $unmapped,
        'updated' => (string) ($raw['updated'] ?? gmdate('Y-m-d\TH:i:s\Z')),
    );
}

function gsa_space_fetch_nws()
{
    $got = gsa_space_get('https://api.weather.gov/alerts/active', 'application/geo+json', null, 40);
    if (empty($got['ok'])) {
        return $got;
    }
    $raw = json_decode($got['body'], true);
    if (!is_array($raw) || !isset($raw['features'])) {
        return array('ok' => false, 'code' => $got['code'], 'error' => 'NWS answer was not GeoJSON', 'retryAfter' => 0);
    }
    $got['layer'] = gsa_space_nws_build($raw);
    unset($got['body']);
    return $got;
}

// ---- NHC CurrentStorms.json ---------------------------------------------------

function gsa_space_hurricanes_build($raw)
{
    $storms = array();
    foreach (($raw['activeStorms'] ?? array()) as $s) {
        if (!is_array($s)) {
            continue;
        }
        $lat = $s['latitudeNumeric'] ?? null;
        $lon = $s['longitudeNumeric'] ?? null;
        if (!is_numeric($lat) || !is_numeric($lon)) {
            continue;
        }
        $storms[] = array(
            'id' => (string) ($s['id'] ?? ''),
            'name' => (string) ($s['name'] ?? 'Storm'),
            'cls' => (string) ($s['classification'] ?? ''),
            'kt' => is_numeric($s['intensity'] ?? null) ? (int) $s['intensity'] : null,
            'mb' => is_numeric($s['pressure'] ?? null) ? (int) $s['pressure'] : null,
            'lat' => round((float) $lat, 2),
            'lon' => round((float) $lon, 2),
            'dir' => is_numeric($s['movementDir'] ?? null) ? (int) $s['movementDir'] : null,
            'mph' => is_numeric($s['movementSpeed'] ?? null) ? (int) $s['movementSpeed'] : null,
            'at' => (string) ($s['lastUpdate'] ?? ''),
            'url' => (string) ($s['publicAdvisory']['url'] ?? ($s['forecastGraphics']['url'] ?? 'https://www.nhc.noaa.gov/')),
        );
    }
    return array(
        'points' => $storms,
        'count' => count($storms),
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'note' => count($storms) ? null : 'No active storms (Atlantic, East and Central Pacific)',
    );
}

function gsa_space_fetch_hurricanes()
{
    $mock = (string) ($GLOBALS['GSA_SPACE_MOCK_NHC'] ?? '');
    if ($mock !== '' && is_file($mock)) {
        $raw = json_decode((string) file_get_contents($mock), true);
        return array('ok' => is_array($raw), 'code' => 200, 'mocked' => true, 'error' => null, 'retryAfter' => 0,
            'layer' => gsa_space_hurricanes_build(is_array($raw) ? $raw : array()));
    }
    $got = gsa_space_get('https://www.nhc.noaa.gov/CurrentStorms.json', 'application/json', null, 25);
    if (empty($got['ok'])) {
        return $got;
    }
    $raw = json_decode($got['body'], true);
    if (!is_array($raw) || !array_key_exists('activeStorms', $raw)) {
        return array('ok' => false, 'code' => $got['code'], 'error' => 'NHC answer was not CurrentStorms JSON', 'retryAfter' => 0);
    }
    $got['layer'] = gsa_space_hurricanes_build($raw);
    unset($got['body']);
    return $got;
}

// ---- NASA FIRMS 24 h active fires -> 0.25 degree cells -------------------------
// The public no-key 24 h CSV (VIIRS NOAA-20, ~8 MB, ~70k rows) is streamed to a
// temp file and binned so the globe gets at most 3,000 points.

defined('GSA_FIRE_CELL') || define('GSA_FIRE_CELL', 0.25);
defined('GSA_FIRE_CAP') || define('GSA_FIRE_CAP', 3000);

function gsa_space_firms_urls()
{
    return array(
        'VIIRS NOAA-20' => 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv',
        'VIIRS NOAA-21' => 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv',
        'MODIS' => 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv',
    );
}

function gsa_space_firms_parse($file, $sensor)
{
    $fh = fopen($file, 'rb');
    if (!$fh) {
        return null;
    }
    $head = fgetcsv($fh, 0, ',', '"', '\\');
    if (!is_array($head)) {
        fclose($fh);
        return null;
    }
    $col = array_flip(array_map('trim', $head));
    if (!isset($col['latitude'], $col['longitude'])) {
        fclose($fh);
        return null;
    }
    $cells = array();
    $rows = 0;
    $latest = '';
    $cell = GSA_FIRE_CELL;
    while (($r = fgetcsv($fh, 0, ',', '"', '\\')) !== false) {
        if (count($r) < count($col)) {
            continue;
        }
        $conf = isset($col['confidence']) ? strtolower(trim((string) $r[$col['confidence']])) : '';
        // VIIRS: l/n/h; MODIS: 0-100. Skip low-confidence detections.
        if ($conf === 'l' || (is_numeric($conf) && (int) $conf < 30)) {
            continue;
        }
        $lat = (float) $r[$col['latitude']];
        $lon = (float) $r[$col['longitude']];
        $frp = isset($col['frp']) ? (float) $r[$col['frp']] : 0.0;
        $when = (isset($col['acq_date']) ? $r[$col['acq_date']] : '') . ' ' . (isset($col['acq_time']) ? str_pad($r[$col['acq_time']], 4, '0', STR_PAD_LEFT) : '');
        if ($when > $latest) {
            $latest = $when;
        }
        $key = (int) floor($lat / $cell) . ':' . (int) floor($lon / $cell);
        if (!isset($cells[$key])) {
            $cells[$key] = array(0.0, 0.0, 0, 0.0, 0.0, '');
        }
        $c = &$cells[$key];
        $c[0] += $lat;
        $c[1] += $lon;
        $c[2] += 1;
        $c[3] += $frp;
        if ($frp > $c[4]) {
            $c[4] = $frp;
        }
        if ($when > $c[5]) {
            $c[5] = $when;
        }
        unset($c);
        $rows++;
    }
    fclose($fh);
    uasort($cells, function ($a, $b) {
        return $b[3] <=> $a[3];
    });
    $points = array();
    foreach ($cells as $c) {
        if (count($points) >= GSA_FIRE_CAP) {
            break;
        }
        $points[] = array(
            'lat' => round($c[0] / $c[2], 3),
            'lon' => round($c[1] / $c[2], 3),
            'n' => $c[2],
            'frp' => round($c[3], 1),
            'max' => round($c[4], 1),
            't' => $c[5],
        );
    }
    $updated = null;
    if ($latest !== '') {
        $ts = strtotime(trim($latest) . ' UTC');
        if ($ts === false) {
            $ts = strtotime(substr($latest, 0, 10) . ' ' . substr($latest, 11, 2) . ':' . substr($latest, 13, 2) . ' UTC');
        }
        $updated = $ts ? gmdate('Y-m-d\TH:i:s\Z', $ts) : null;
    }
    return array(
        'points' => $points,
        'count' => $rows,
        'cells' => count($cells),
        'sensor' => $sensor,
        'updated' => $updated ?: gmdate('Y-m-d\TH:i:s\Z'),
    );
}

function gsa_space_fetch_wildfires()
{
    global $dataDir;
    $tmp = $dataDir . '/space-firms.tmp.' . getmypid();
    $last = array('ok' => false, 'code' => 0, 'error' => 'FIRMS did not answer', 'retryAfter' => 0);
    $calls = 0;
    foreach (gsa_space_firms_urls() as $sensor => $url) {
        $calls++;
        $got = gsa_space_get($url, 'text/csv', $tmp, 90);
        if (!empty($got['ok'])) {
            $layer = gsa_space_firms_parse($tmp, $sensor);
            @unlink($tmp);
            // An all-header file (seen today for Suomi NPP) is not a result.
            if (is_array($layer) && $layer['count'] > 0) {
                $got['layer'] = $layer;
                $got['calls'] = $calls;
                return $got;
            }
            $last = array('ok' => false, 'code' => $got['code'], 'error' => $sensor . ' file had no rows', 'retryAfter' => 0);
            continue;
        }
        @unlink($tmp);
        $last = $got;
        if (!empty($got['retryAfter'])) {
            break;
        }
    }
    $last['calls'] = $calls;
    return $last;
}

// ---- NWS river gauges at or above action stage (NWPS ArcGIS) -----------------
// One small query (~40 KB, ~60 gauges) every 15 min. Only gauges the NWS
// forecasts; no dot does not mean no flooding.

function gsa_space_rivers_url()
{
    return 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0/query?'
        . http_build_query(array(
            'f' => 'geojson',
            'where' => "status IN ('action','minor','moderate','major')",
            'outFields' => 'gaugelid,status,location,waterbody,state,obstime,url,action,flood,moderate,major,observed,units',
            'returnGeometry' => 'true',
            'outSR' => '4326',
        ), '', '&', PHP_QUERY_RFC3986);
}

function gsa_space_num($v)
{
    return (is_numeric($v) && trim((string) $v) !== '') ? round((float) $v, 2) : null;
}

function gsa_space_rivers_build($raw)
{
    $rank = array('major' => 4, 'moderate' => 3, 'minor' => 2, 'action' => 1);
    $pts = array();
    $by = array('action' => 0, 'minor' => 0, 'moderate' => 0, 'major' => 0);
    foreach (($raw['features'] ?? array()) as $f) {
        $p = $f['properties'] ?? array();
        $c = $f['geometry']['coordinates'] ?? null;
        $status = strtolower((string) ($p['status'] ?? ''));
        if (!isset($rank[$status]) || !is_array($c) || !is_numeric($c[0] ?? null) || !is_numeric($c[1] ?? null)) {
            continue;
        }
        $by[$status]++;
        $lid = strtolower((string) ($p['gaugelid'] ?? ''));
        $t = (string) ($p['obstime'] ?? '');
        $pts[] = array(
            'id' => $lid,
            's' => $status,
            'n' => gsa_space_clip($p['location'] ?? '', 80),
            'w' => gsa_space_clip($p['waterbody'] ?? '', 80),
            'st' => (string) ($p['state'] ?? ''),
            'lat' => round((float) $c[1], 4),
            'lon' => round((float) $c[0], 4),
            'obs' => gsa_space_num($p['observed'] ?? null),
            'u' => (string) ($p['units'] ?? 'ft'),
            // NWPS obstime is UTC without a zone.
            't' => preg_match('/^\d{4}-\d\d-\d\d \d\d:\d\d/', $t) ? str_replace(' ', 'T', substr($t, 0, 16)) . ':00Z' : '',
            'a' => gsa_space_num($p['action'] ?? null),
            'mi' => gsa_space_num($p['flood'] ?? null),
            'mo' => gsa_space_num($p['moderate'] ?? null),
            'ma' => gsa_space_num($p['major'] ?? null),
        );
    }
    usort($pts, function ($a, $b) use ($rank) {
        return $rank[$b['s']] <=> $rank[$a['s']];
    });
    return array(
        'points' => $pts,
        'count' => count($pts),
        'byStatus' => $by,
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'note' => count($pts) ? null : 'No NWS forecast gauges at or above action stage',
    );
}

function gsa_space_fetch_rivers()
{
    $got = gsa_space_get(gsa_space_rivers_url(), 'application/geo+json, application/json', null, 30);
    if (empty($got['ok'])) {
        return $got;
    }
    $raw = json_decode($got['body'], true);
    if (!is_array($raw) || !isset($raw['features']) || !is_array($raw['features'])) {
        return array('ok' => false, 'code' => $got['code'], 'error' => 'NWPS answer was not GeoJSON', 'retryAfter' => 0);
    }
    $got['layer'] = gsa_space_rivers_build($raw);
    unset($got['body']);
    return $got;
}

// ---- NOAA CO-OPS coastal water levels ----------------------------------------
// Every 15 min: one CO-OPS SOS "latest water level" CSV for all active stations
// (~50 KB, ~290 rows). Once a day: the station list with flood thresholds
// (mdapi stations.json?expand=floodlevels) plus one SOS call in the MHHW datum.
// Each SOS row carries the height of its datum above station datum (STND) in
// "vertical_position", so a MLLW reading converts to STND exactly (thresholds
// are published in feet above STND) and the MHHW call gives MHHW above STND.
// Great Lakes rows are IGLD 1985 and their thresholds are IGLD feet already.

defined('GSA_COOPS_APP') || define('GSA_COOPS_APP', 'globalstatus.app');
defined('GSA_M2FT') || define('GSA_M2FT', 3.280839895);

function gsa_space_coops_sos_url($datum = '')
{
    $q = 'service=SOS&request=GetObservation&version=1.0.0'
        . '&observedProperty=water_surface_height_above_reference_datum'
        . '&offering=urn:ioos:network:NOAA.NOS.CO-OPS:WaterLevelActive'
        . '&responseFormat=text/csv&application=' . rawurlencode(GSA_COOPS_APP);
    if ($datum !== '') {
        $q .= '&result=VerticalDatum%3D%3Durn:ioos:def:datum:noaa::' . $datum;
    }
    return 'https://opendap.co-ops.nos.noaa.gov/ioos-dif-sos/SOS?' . $q;
}

function gsa_space_coops_parse_csv($text)
{
    $rows = array();
    $lines = preg_split('/\r?\n/', trim((string) $text));
    if (!$lines || strpos($lines[0], 'station_id') !== 0) {
        return null;
    }
    $head = str_getcsv(array_shift($lines), ',', '"', '\\');
    $ix = array_flip($head);
    $need = array('station_id', 'date_time', 'water_surface_height_above_reference_datum (m)', 'datum_id', 'vertical_position (m)');
    foreach ($need as $k) {
        if (!isset($ix[$k])) {
            return null;
        }
    }
    foreach ($lines as $line) {
        if ($line === '') {
            continue;
        }
        $c = str_getcsv($line, ',', '"', '\\');
        $sid = substr(strrchr((string) ($c[$ix['station_id']] ?? ''), ':'), 1);
        $v = $c[$ix['water_surface_height_above_reference_datum (m)']] ?? '';
        if ($sid === '' || !is_numeric($v)) {
            continue;
        }
        $dat = (string) ($c[$ix['datum_id']] ?? '');
        $dat = strpos($dat, '::') !== false ? substr($dat, strrpos($dat, '::') + 2) : $dat;
        $vp = $c[$ix['vertical_position (m)']] ?? '';
        $rows[$sid] = array(
            'lat' => is_numeric($c[$ix['latitude (degree)']] ?? null) ? (float) $c[$ix['latitude (degree)']] : null,
            'lon' => is_numeric($c[$ix['longitude (degree)']] ?? null) ? (float) $c[$ix['longitude (degree)']] : null,
            't' => (string) ($c[$ix['date_time']] ?? ''),
            'v' => (float) $v,
            'dat' => $dat,
            'vp' => is_numeric($vp) ? (float) $vp : null,
        );
    }
    return $rows;
}

function gsa_space_coastal_meta_file()
{
    global $dataDir;
    return $dataDir . '/space-coastal-meta.json';
}

// Daily: names, states and flood thresholds, plus MHHW above STND.
function gsa_space_coastal_meta(&$calls)
{
    $file = gsa_space_coastal_meta_file();
    $meta = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    $fresh = is_array($meta) && (time() - (int) ($meta['fetchedAt'] ?? 0)) < 24 * 3600;
    $mock = (string) ($GLOBALS['GSA_SPACE_MOCK_COOPS'] ?? '');
    if ($fresh && $mock === '') {
        return $meta;
    }
    if ($mock !== '') {
        $stBody = @file_get_contents($mock . '/stations.json');
        $mhBody = @file_get_contents($mock . '/sos-mhhw.csv');
    } else {
        $calls++;
        $st = gsa_space_get('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels&expand=floodlevels', 'application/json', null, 60);
        $stBody = !empty($st['ok']) ? $st['body'] : false;
        $calls++;
        $mh = gsa_space_get(gsa_space_coops_sos_url('MHHW'), 'text/csv', null, 60);
        $mhBody = !empty($mh['ok']) ? $mh['body'] : false;
    }
    $list = $stBody ? json_decode($stBody, true) : null;
    if (!is_array($list) || !isset($list['stations'])) {
        return is_array($meta) ? $meta : null; // keep yesterday's list
    }
    $mhhw = $mhBody ? gsa_space_coops_parse_csv($mhBody) : null;
    $old = is_array($meta) ? ($meta['stations'] ?? array()) : array();
    $out = array();
    foreach ($list['stations'] as $s) {
        $id = (string) ($s['id'] ?? '');
        if ($id === '') {
            continue;
        }
        $fl = is_array($s['floodlevels'] ?? null) ? $s['floodlevels'] : array();
        $thr = null;
        if (is_numeric($fl['nws_minor'] ?? null)) {
            $thr = array('src' => 'NWS', 'a' => gsa_space_num($fl['action'] ?? null), 'mi' => gsa_space_num($fl['nws_minor']), 'mo' => gsa_space_num($fl['nws_moderate'] ?? null), 'ma' => gsa_space_num($fl['nws_major'] ?? null));
        } elseif (is_numeric($fl['nos_minor'] ?? null)) {
            $thr = array('src' => 'NOS', 'a' => null, 'mi' => gsa_space_num($fl['nos_minor']), 'mo' => gsa_space_num($fl['nos_moderate'] ?? null), 'ma' => gsa_space_num($fl['nos_major'] ?? null));
        }
        $m = null;
        if (is_array($mhhw) && isset($mhhw[$id]) && $mhhw[$id]['vp'] !== null && $mhhw[$id]['dat'] === 'MHHW') {
            $m = round($mhhw[$id]['vp'], 3);
        } elseif (isset($old[$id]['mhhw'])) {
            $m = $old[$id]['mhhw'];
        }
        $out[$id] = array(
            'n' => (string) ($s['name'] ?? $id),
            'st' => (string) ($s['state'] ?? ''),
            'gl' => !empty($s['greatlakes']),
            'thr' => $thr,
            'mhhw' => $m,
        );
    }
    $meta = array('fetchedAt' => time(), 'stations' => $out);
    gsa_atomic_write($file, json_encode($meta));
    return $meta;
}

function gsa_space_coastal_build($obs, $meta)
{
    $now = time();
    $stations = $meta['stations'] ?? array();
    $pts = array();
    $by = array();
    foreach ($obs as $id => $o) {
        if ($o['lat'] === null || $o['lon'] === null) {
            continue;
        }
        $m = $stations[$id] ?? array('n' => $id, 'st' => '', 'gl' => false, 'thr' => null, 'mhhw' => null);
        $ts = strtotime($o['t']);
        $stale = !$ts || ($now - $ts) > 3600;
        $lvlFt = round($o['v'] * GSA_M2FT, 2);
        // Compare in the threshold's datum: STND feet for tidal, IGLD feet for Great Lakes.
        $cmp = null;
        $shift = null; // feet to add to a threshold to put it in the reading's datum
        if ($o['dat'] === 'IGLD') {
            $cmp = $lvlFt;
            $shift = 0.0;
        } elseif (in_array($o['dat'], array('MLLW', 'STND', 'MSL', 'MLW', 'MHW', 'NAVD'), true) && $o['vp'] !== null) {
            $cmp = ($o['v'] + $o['vp']) * GSA_M2FT;
            $shift = -$o['vp'] * GSA_M2FT;
        }
        $vsMhhw = null;
        if ($o['dat'] !== 'IGLD' && $o['vp'] !== null && $m['mhhw'] !== null && $cmp !== null) {
            $vsMhhw = round(($o['v'] + $o['vp'] - $m['mhhw']) * GSA_M2FT, 2);
        }
        $vsLwd = ($o['dat'] === 'IGLD' && $o['vp'] !== null) ? round(($o['v'] - $o['vp']) * GSA_M2FT, 2) : null;
        $thr = $m['thr'];
        $c = 'none';
        $thrOut = null;
        if ($thr && $cmp !== null && $shift !== null) {
            $thrOut = array('src' => $thr['src']);
            foreach (array('a', 'mi', 'mo', 'ma') as $k) {
                $thrOut[$k] = $thr[$k] !== null ? round($thr[$k] + $shift, 2) : null;
            }
            if ($thr['ma'] !== null && $cmp >= $thr['ma']) {
                $c = 'major';
            } elseif ($thr['mo'] !== null && $cmp >= $thr['mo']) {
                $c = 'moderate';
            } elseif ($cmp >= $thr['mi']) {
                $c = 'minor';
            } elseif ($cmp >= $thr['mi'] - 0.5 || ($thr['a'] !== null && $cmp >= $thr['a'])) {
                $c = 'near';
            } else {
                $c = 'normal';
            }
        }
        if ($stale) {
            $c = 'stale';
        }
        $by[$c] = ($by[$c] ?? 0) + 1;
        $pts[] = array(
            'id' => (string) $id,
            'n' => $m['n'],
            'st' => $m['st'],
            'lat' => round($o['lat'], 4),
            'lon' => round($o['lon'], 4),
            't' => $o['t'],
            'lvl' => $lvlFt,
            'dat' => $o['dat'],
            'mhhw' => $vsMhhw,
            'lwd' => $vsLwd,
            'c' => $c,
            'thr' => $thrOut,
        );
    }
    $order = array('major' => 6, 'moderate' => 5, 'minor' => 4, 'near' => 3, 'normal' => 2, 'none' => 1, 'stale' => 0);
    usort($pts, function ($a, $b) use ($order) {
        return $order[$b['c']] <=> $order[$a['c']];
    });
    return array(
        'points' => $pts,
        'count' => count($pts),
        'byLevel' => $by,
        'metaAt' => isset($meta['fetchedAt']) ? gmdate('Y-m-d\TH:i:s\Z', (int) $meta['fetchedAt']) : null,
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'note' => count($pts) ? null : 'No CO-OPS water levels in the last pull',
    );
}

function gsa_space_fetch_coastal()
{
    $calls = 0;
    $meta = gsa_space_coastal_meta($calls);
    $mock = (string) ($GLOBALS['GSA_SPACE_MOCK_COOPS'] ?? '');
    if ($mock !== '') {
        $body = @file_get_contents($mock . '/sos.csv');
        $got = array('ok' => $body !== false, 'code' => 200, 'body' => $body, 'error' => $body === false ? 'mock missing' : null, 'retryAfter' => 0, 'mocked' => true);
    } else {
        $calls++;
        $got = gsa_space_get(gsa_space_coops_sos_url(), 'text/csv', null, 45);
    }
    $got['calls'] = $calls;
    if (empty($got['ok'])) {
        return $got;
    }
    $obs = gsa_space_coops_parse_csv($got['body']);
    if (!is_array($obs) || !$obs) {
        return array('ok' => false, 'code' => $got['code'], 'calls' => $calls, 'error' => 'CO-OPS answer was not the water level CSV', 'retryAfter' => 0);
    }
    $got['layer'] = gsa_space_coastal_build($obs, is_array($meta) ? $meta : array());
    unset($got['body']);
    return $got;
}

// ---- Tsunami alerts (NTWC Palmer AK + PTWC Honolulu Atom feeds) --------------
// Two ~3 KB Atom feeds every 5 min. A bulletin's CAP file is read once (cached
// by URL) for its expiry, headline and areas. Warnings, advisories, watches and
// PTWC threat messages are drawn; information statements are a note only.

function gsa_space_tsunami_feeds()
{
    return array(
        'NTWC' => 'https://www.tsunami.gov/events/xml/PAAQAtom.xml',
        'PTWC' => 'https://www.tsunami.gov/events/xml/PHEBAtom.xml',
    );
}

function gsa_space_tsunami_get($url, &$calls)
{
    $mock = (string) ($GLOBALS['GSA_SPACE_MOCK_TSUNAMI'] ?? '');
    if ($mock !== '') {
        $body = @file_get_contents($mock . '/' . basename(parse_url($url, PHP_URL_PATH)));
        return array('ok' => $body !== false, 'code' => $body !== false ? 200 : 404, 'body' => $body !== false ? $body : null, 'error' => $body === false ? 'mock missing' : null, 'retryAfter' => 0);
    }
    $calls++;
    return gsa_space_get($url, 'application/atom+xml, application/xml, text/xml', null, 20);
}

function gsa_space_xml_text($s)
{
    return trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags((string) $s), ENT_QUOTES | ENT_XML1, 'UTF-8')));
}

function gsa_space_tsunami_cap($xml)
{
    $out = array('expires' => null, 'event' => null, 'headline' => null, 'areas' => array(), 'polys' => array(), 'msgType' => null);
    if (preg_match('#<msgType>([^<]*)</msgType>#', $xml, $m)) {
        $out['msgType'] = trim($m[1]);
    }
    if (preg_match('#<expires>([^<]*)</expires>#', $xml, $m)) {
        $out['expires'] = trim($m[1]);
    }
    if (preg_match('#<event>([^<]*)</event>#', $xml, $m)) {
        $out['event'] = gsa_space_xml_text($m[1]);
    }
    if (preg_match('#<headline>(.*?)</headline>#s', $xml, $m)) {
        $out['headline'] = gsa_space_clip(gsa_space_xml_text($m[1]), 240);
    }
    if (preg_match_all('#<areaDesc>(.*?)</areaDesc>#s', $xml, $mm)) {
        foreach ($mm[1] as $a) {
            $out['areas'][] = gsa_space_clip(gsa_space_xml_text($a), 160);
        }
    }
    if (preg_match_all('#<polygon>(.*?)</polygon>#s', $xml, $mm)) {
        foreach ($mm[1] as $p) {
            $ring = array();
            foreach (preg_split('/\s+/', trim($p)) as $pair) {
                $xy = explode(',', $pair);
                if (count($xy) === 2 && is_numeric($xy[0]) && is_numeric($xy[1])) {
                    $ring[] = array(round((float) $xy[0], 3), round((float) $xy[1], 3));
                }
            }
            if (count($ring) >= 3) {
                $out['polys'][] = $ring;
            }
        }
    }
    $out['areas'] = array_slice(array_values(array_unique($out['areas'])), 0, 12);
    return $out;
}

function gsa_space_tsunami_build($entries)
{
    $danger = array('Warning' => 3, 'Advisory' => 2, 'Watch' => 1, 'Threat' => 2);
    $points = array();
    $notes = array();
    foreach ($entries as $e) {
        if (!empty($e['expired'])) {
            continue;
        }
        if (isset($danger[$e['cat']])) {
            $points[] = $e;
        } else {
            $notes[] = array('center' => $e['center'], 'cat' => $e['cat'], 'region' => $e['region'], 'mag' => $e['mag'], 't' => $e['t'], 'url' => $e['url']);
        }
    }
    usort($points, function ($a, $b) use ($danger) {
        return $danger[$b['cat']] <=> $danger[$a['cat']];
    });
    return array(
        'points' => $points,
        'count' => count($points),
        'notes' => $notes,
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'note' => count($points) ? null : 'No tsunami warnings, advisories or watches (NOAA NTWC/PTWC)',
    );
}

function gsa_space_fetch_tsunami()
{
    global $dataDir;
    $calls = 0;
    $capFile = $dataDir . '/space-tsunami-cap.json';
    $capCache = is_file($capFile) ? json_decode((string) file_get_contents($capFile), true) : array();
    if (!is_array($capCache)) {
        $capCache = array();
    }
    $entries = array();
    $okFeeds = 0;
    $lastErr = null;
    $now = time();
    foreach (gsa_space_tsunami_feeds() as $center => $url) {
        $got = gsa_space_tsunami_get($url, $calls);
        if (empty($got['ok'])) {
            $lastErr = $center . ': ' . ($got['error'] ?? 'fetch failed');
            continue;
        }
        if (strpos((string) $got['body'], '<feed') === false) {
            $lastErr = $center . ': not an Atom feed';
            continue;
        }
        $okFeeds++;
        preg_match_all('#<entry>(.*?)</entry>#s', $got['body'], $mm);
        foreach ($mm[1] as $x) {
            $cat = preg_match('#Category:\s*</strong>\s*([A-Za-z]+)#', $x, $m) ? ucfirst(strtolower($m[1])) : 'Information';
            $lat = preg_match('#<geo:lat>([-0-9.]+)</geo:lat>#', $x, $m) ? (float) $m[1] : null;
            $lon = preg_match('#<geo:long>([-0-9.]+)</geo:long>#', $x, $m) ? (float) $m[1] : null;
            $upd = preg_match('#<updated>([^<]+)</updated>#', $x, $m) ? trim($m[1]) : '';
            $title = preg_match('#<title>(.*?)</title>#s', $x, $m) ? gsa_space_xml_text($m[1]) : '';
            $mag = preg_match('#Magnitude:\s*</strong>\s*([0-9.]+\s*\(?[A-Za-z]*\)?)#', $x, $m) ? trim($m[1]) : '';
            $cap = preg_match('#href="([^"]+CAP\.xml)"#i', $x, $m) ? $m[1] : '';
            $bull = preg_match('#rel="alternate"[^>]*href="([^"]+)"#', $x, $m) ? $m[1] : 'https://www.tsunami.gov/';
            $info = null;
            if ($cap !== '') {
                if (isset($capCache[$cap])) {
                    $info = $capCache[$cap];
                } else {
                    $cg = gsa_space_tsunami_get($cap, $calls);
                    if (!empty($cg['ok'])) {
                        $info = gsa_space_tsunami_cap((string) $cg['body']);
                        $info['seen'] = $now;
                        $capCache[$cap] = $info;
                    }
                }
            }
            $updTs = strtotime($upd) ?: $now;
            $exp = $info && $info['expires'] ? strtotime($info['expires']) : false;
            // No CAP expiry: warnings fall off after 12 h, statements after 6 h.
            $expired = $exp ? $exp < $now : ($now - $updTs) > (isset(array('Warning' => 1, 'Advisory' => 1, 'Watch' => 1, 'Threat' => 1)[$cat]) ? 12 : 6) * 3600;
            if ($info && in_array(strtolower((string) $info['msgType']), array('cancel'), true)) {
                $expired = true;
            }
            if ($cat === 'Cancellation') {
                $expired = $expired || ($now - $updTs) > 3600;
            }
            $entries[] = array(
                'center' => $center,
                'cat' => $cat,
                'region' => gsa_space_clip($title, 120),
                'lat' => $lat !== null ? round($lat, 3) : null,
                'lon' => $lon !== null ? round($lon, 3) : null,
                'mag' => $mag,
                't' => $upd,
                'exp' => $info['expires'] ?? null,
                'head' => $info['headline'] ?? null,
                'areas' => $info['areas'] ?? array(),
                'polys' => array_slice($info['polys'] ?? array(), 0, 20),
                'url' => $bull,
                'expired' => $expired,
            );
        }
    }
    // Forget CAP files older than 3 days.
    foreach ($capCache as $k => $v) {
        if ($now - (int) ($v['seen'] ?? 0) > 3 * 86400) {
            unset($capCache[$k]);
        }
    }
    gsa_atomic_write($capFile, json_encode($capCache));
    if ($okFeeds === 0) {
        return array('ok' => false, 'code' => 0, 'calls' => $calls, 'error' => $lastErr ?? 'No tsunami feed answered', 'retryAfter' => 0);
    }
    $layer = gsa_space_tsunami_build($entries);
    if ($lastErr) {
        $layer['partial'] = $lastErr;
    }
    return array('ok' => true, 'code' => 200, 'calls' => $calls, 'error' => null, 'retryAfter' => 0, 'layer' => $layer,
        'mocked' => (string) ($GLOBALS['GSA_SPACE_MOCK_TSUNAMI'] ?? '') !== '');
}

// ---- generic gate / publish ---------------------------------------------------

function gsa_space_refresh($name, $opts = array())
{
    global $dataDir;
    $feeds = gsa_space_feeds();
    if (!isset($feeds[$name])) {
        return array('ok' => false, 'error' => 'Unknown space feed');
    }
    $meta = $feeds[$name];
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0755, true);
    }
    $lock = fopen($dataDir . '/space-' . $name . '.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        if ($lock) {
            fclose($lock);
        }
        return array('ok' => true, 'busy' => true);
    }
    try {
        $state = gsa_space_state_read();
        $row = $state[$name];
        $now = time();
        $force = !empty($opts['force']);
        if (!$force && (int) $row['retryAfter'] > $now) {
            return array('ok' => true, 'skipped' => true, 'reason' => 'retry-after', 'requestsToday' => (int) $row['requests']);
        }
        // Gate on the last attempt (good or bad) so a dead source is not hammered.
        $lastTry = max((int) $row['lastAt'], (int) $row['tryAt']);
        $age = $lastTry > 0 ? $now - $lastTry : null;
        // After a failed try, retry sooner (15 min at most) instead of waiting a full cycle.
        $wait = (int) $row['tryAt'] > (int) $row['lastAt'] ? min($meta['every'], 15 * 60) : $meta['every'];
        $due = $force || $age === null || $age >= ($wait - GSA_SPACE_SLACK_SEC);
        if (!$due) {
            return array('ok' => true, 'skipped' => true, 'reason' => 'not-due', 'ageSec' => $age, 'requestsToday' => (int) $row['requests']);
        }
        $t0 = microtime(true);
        $fn = 'gsa_space_fetch_' . $name;
        // Test hook (CLI flag --mock-space-fail): no network call, just a failure.
        $got = !empty($GLOBALS['GSA_SPACE_MOCK_FAIL'])
            ? array('ok' => false, 'mocked' => true, 'code' => 0, 'error' => 'Mocked fetch failure', 'retryAfter' => 0)
            : $fn();
        $row['tryAt'] = $now;
        if (empty($got['mocked'])) {
            $row['requests'] = (int) $row['requests'] + (int) ($got['calls'] ?? 1);
        }
        $row['retryAfter'] = (int) ($got['retryAfter'] ?? 0);
        $ms = (int) round((microtime(true) - $t0) * 1000);
        if (!empty($got['ok']) && isset($got['layer'])) {
            $layer = $got['layer'];
            $layer['source'] = $meta['source'];
            $layer['sourceUrl'] = $meta['sourceUrl'];
            $layer['attribution'] = $meta['attribution'];
            $layer['error'] = null;
            $put = gsa_cache_put(gsa_space_cache_file($name), $layer);
            $row['lastAt'] = $now;
            $state[$name] = $row;
            gsa_space_state_write($state);
            return array(
                'ok' => true,
                'count' => $layer['count'] ?? 0,
                'published' => isset($layer['points']) ? count($layer['points']) : 0,
                'bytes' => $put['bytes'] ?? 0,
                'updated' => $layer['updated'] ?? null,
                'requestsToday' => (int) $row['requests'],
                'code' => $got['code'] ?? 200,
                'mocked' => !empty($got['mocked']),
                'ms' => $ms,
            );
        }
        $state[$name] = $row;
        gsa_space_state_write($state);
        // Keep the last good file, flag it stale.
        $prev = gsa_space_cache_read($name);
        if (is_array($prev)) {
            $prev['stale'] = true;
            $prev['error'] = $got['error'] ?? 'Fetch failed';
            gsa_atomic_write(gsa_space_cache_file($name), json_encode($prev));
        }
        return array(
            'ok' => false,
            'error' => $got['error'] ?? 'Fetch failed',
            'code' => $got['code'] ?? 0,
            'retryAfter' => (int) $row['retryAfter'],
            'requestsToday' => (int) $row['requests'],
            'keptLastGood' => is_array($prev),
            'ms' => $ms,
        );
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

// What visitors get from /api/space/<name>. Never calls the source.
function gsa_space_snapshot($name)
{
    $feeds = gsa_space_feeds();
    $meta = $feeds[$name];
    $cached = gsa_space_cache_read($name);
    if (!is_array($cached)) {
        return array(
            'points' => array(),
            'count' => 0,
            'updated' => null,
            'source' => $meta['source'],
            'sourceUrl' => $meta['sourceUrl'],
            'attribution' => $meta['attribution'],
            'stale' => true,
            'error' => 'Awaiting poller',
            'ageSec' => null,
        );
    }
    $fetchedAt = (int) ($cached['fetchedAt'] ?? 0);
    $ageSec = $fetchedAt > 0 ? max(0, time() - $fetchedAt) : null;
    unset($cached['fetchedAt']);
    $cached['ageSec'] = $ageSec;
    $cached['stale'] = $ageSec === null || $ageSec > $meta['staleSec'] || !empty($cached['stale']);
    return $cached;
}

// ---------- INTERNET OUTAGES (IODA, Georgia Tech) ----------
// USA INTERNET OUTAGES and GLOBAL INTERNET OUTAGES read data/ioda-cache.json.
// The */5 aircraft cron refreshes it when it is at least 10 minutes old
// (gsa_ioda_refresh); a visitor request only refreshes a cache older than
// 20 minutes, so IODA sees at most a few calls an hour.
function gsa_ioda_cache_file()
{
    global $dataDir;
    return $dataDir . '/ioda-cache.json';
}

function gsa_ioda_cache_read()
{
    $file = gsa_ioda_cache_file();
    if (!is_file($file)) {
        return null;
    }
    $cached = json_decode((string) file_get_contents($file), true);
    return is_array($cached) ? $cached : null;
}

function gsa_ioda_signal_label($source)
{
    $labels = array(
        'bgp' => 'BGP (routing)',
        'ping-slash24' => 'Active probing',
        'merit-nt' => 'Telescope (darknet traffic)',
        'gtr' => 'Google traffic',
        'gtr-norm' => 'Google traffic',
    );
    return $labels[$source] ?? $source;
}

function gsa_ioda_severity($score)
{
    if ($score >= 100000) {
        return 'high';
    }
    if ($score >= 5000) {
        return 'medium';
    }
    return 'low';
}

// Fetch several IODA URLs at once. Returns decoded bodies keyed like $urls, or
// null when any of them fails.
function gsa_ioda_fetch_all($urls, $timeout = 50)
{
    if (!function_exists('curl_multi_init')) {
        return null;
    }
    $multi = curl_multi_init();
    $handles = array();
    foreach ($urls as $key => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_HTTPHEADER => array(
                'Accept: application/json',
                'User-Agent: GlobalStatusApp/1.0 (+https://globalstatus.app)',
            ),
        ));
        curl_multi_add_handle($multi, $ch);
        $handles[$key] = $ch;
    }
    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) {
            curl_multi_select($multi, 1.0);
        }
    } while ($running && $status === CURLM_OK);
    $out = array();
    $ok = true;
    foreach ($handles as $key => $ch) {
        $body = curl_multi_getcontent($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
        $decoded = ($body !== false && $code >= 200 && $code < 300) ? json_decode((string) $body, true) : null;
        if (!is_array($decoded) || !empty($decoded['error']) || !isset($decoded['data']) || !is_array($decoded['data'])) {
            $ok = false;
            continue;
        }
        $out[$key] = $decoded['data'];
    }
    curl_multi_close($multi);
    return $ok ? $out : null;
}

function gsa_ioda_places($events, $summary, $until, $centroid)
{
    $places = array();
    foreach ($summary as $row) {
        $entity = $row['entity'] ?? array();
        $code = (string) ($entity['code'] ?? '');
        if ($code === '') {
            continue;
        }
        $places[$code] = array(
            'code' => $code,
            'name' => (string) ($entity['name'] ?? $code),
            'score' => (float) ($row['scores']['overall'] ?? 0),
            'events' => (int) ($row['event_cnt'] ?? 0),
            'signals' => array(),
        );
    }
    foreach ($events as $ev) {
        $loc = (string) ($ev['location'] ?? '');
        $code = substr($loc, strpos($loc, '/') + 1);
        if ($code === '') {
            continue;
        }
        if (!isset($places[$code])) {
            $places[$code] = array('code' => $code, 'name' => (string) ($ev['location_name'] ?? $code), 'score' => 0.0, 'events' => 0, 'signals' => array());
        }
        $start = (int) ($ev['start'] ?? 0);
        $end = $start + (int) ($ev['duration'] ?? 0);
        $source = (string) ($ev['datasource'] ?? '');
        $score = (float) ($ev['score'] ?? 0);
        $sig = &$places[$code]['signals'][$source];
        if (!isset($sig)) {
            $sig = array('source' => $source, 'label' => gsa_ioda_signal_label($source), 'score' => 0.0, 'start' => $start, 'end' => $end);
        }
        $sig['score'] = max($sig['score'], $score);
        $sig['start'] = min($sig['start'], $start);
        $sig['end'] = max($sig['end'], $end);
        unset($sig);
    }
    $out = array();
    foreach ($places as $code => $place) {
        $where = $centroid($place);
        if (!$where) {
            continue;
        }
        $signals = array_values($place['signals']);
        $start = 0;
        $end = 0;
        $maxSignal = 0.0;
        foreach ($signals as &$sig) {
            $sig['ongoing'] = $sig['end'] >= $until - 900;
            $sig['score'] = round($sig['score'], 1);
            $start = $start ? min($start, $sig['start']) : $sig['start'];
            $end = max($end, $sig['end']);
            $maxSignal = max($maxSignal, $sig['score']);
        }
        unset($sig);
        usort($signals, function ($a, $b) {
            return $b['score'] <=> $a['score'];
        });
        $score = $place['score'] ?: $maxSignal;
        $out[] = array(
            'code' => $code,
            'name' => $where[2] ?? $place['name'],
            'lat' => $where[0],
            'lon' => $where[1],
            'score' => round($score, 1),
            'severity' => gsa_ioda_severity($score),
            'ongoing' => $signals ? $end >= $until - 900 : true,
            'start' => $start ?: null,
            'end' => $end ?: null,
            'events' => max($place['events'], count($signals)),
            'signals' => $signals,
        );
    }
    usort($out, function ($a, $b) {
        return $b['score'] <=> $a['score'];
    });
    return $out;
}

function gsa_ioda_build()
{
    global $root;
    $until = time();
    $from = $until - 86400;
    $base = 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/';
    $win = 'from=' . $from . '&until=' . $until;
    $data = gsa_ioda_fetch_all(array(
        'countrySummary' => $base . 'summary?entityType=country&' . $win . '&limit=500',
        'countryEvents' => $base . 'events?entityType=country&' . $win . '&limit=3000',
        'usSummary' => $base . 'summary?entityType=region&relatedTo=country/US&' . $win . '&limit=500',
        'usEvents' => $base . 'events?entityType=region&relatedTo=country/US&' . $win . '&limit=3000',
    ));
    if ($data === null) {
        return null;
    }
    $cent = json_decode((string) @file_get_contents($root . '/api/internet-centroids.json'), true);
    $countries = is_array($cent['countries'] ?? null) ? $cent['countries'] : array();
    $states = is_array($cent['states'] ?? null) ? $cent['states'] : array();
    // US territories go with USA INTERNET OUTAGES, not the global layer.
    $usCodes = array('US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM');
    $usCountryEvents = array();
    $usCountrySummary = array();
    $globalEvents = array();
    $globalSummary = array();
    foreach ($data['countryEvents'] as $ev) {
        $code = substr((string) ($ev['location'] ?? ''), 8);
        if (in_array($code, $usCodes, true)) {
            $usCountryEvents[] = $ev;
        } else {
            $globalEvents[] = $ev;
        }
    }
    foreach ($data['countrySummary'] as $row) {
        $code = (string) ($row['entity']['code'] ?? '');
        if (in_array($code, $usCodes, true)) {
            $usCountrySummary[] = $row;
        } else {
            $globalSummary[] = $row;
        }
    }
    $countryAt = function ($place) use ($countries) {
        $c = $countries[$place['code']] ?? null;
        if (!$c) {
            return null;
        }
        if ($place['code'] === 'US') {
            return array(39.83, -98.58, 'United States (nationwide)');
        }
        return $c;
    };
    $stateAt = function ($place) use ($states) {
        $s = $states[$place['name']] ?? null;
        return $s ? array($s[0], $s[1], $place['name']) : null;
    };
    $us = array_merge(
        gsa_ioda_places($data['usEvents'], $data['usSummary'], $until, $stateAt),
        gsa_ioda_places($usCountryEvents, $usCountrySummary, $until, $countryAt)
    );
    usort($us, function ($a, $b) {
        return $b['score'] <=> $a['score'];
    });
    $global = gsa_ioda_places($globalEvents, $globalSummary, $until, $countryAt);
    return array(
        'source' => 'IODA, Georgia Tech',
        'updated' => gmdate('Y-m-d\TH:i:s\Z', $until),
        'from' => $from,
        'until' => $until,
        'us' => $us,
        'global' => $global,
        'counts' => array('us' => count($us), 'global' => count($global)),
    );
}

// opts: force (ignore the 10-minute gate), maxAge (seconds).
function gsa_ioda_refresh($opts = array())
{
    global $dataDir;
    $maxAge = (int) ($opts['maxAge'] ?? 600);
    $cached = gsa_ioda_cache_read();
    if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
        return array('ok' => true, 'skipped' => true);
    }
    $lock = fopen($dataDir . '/ioda.lock', 'c');
    if (!$lock) {
        return array('ok' => false, 'error' => 'no lock file');
    }
    $wait = !empty($opts['wait']);
    if (!flock($lock, $wait ? LOCK_EX : (LOCK_EX | LOCK_NB))) {
        fclose($lock);
        return array('ok' => true, 'busy' => true);
    }
    try {
        // Another request may have refreshed it while this one waited.
        $cached = gsa_ioda_cache_read();
        if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
            return array('ok' => true, 'skipped' => true);
        }
        $t0 = microtime(true);
        $built = gsa_ioda_build();
        if ($built === null) {
            if ($cached) {
                $cached['lastError'] = 'IODA did not answer at ' . gmdate('H:i\Z');
                $cached['lastErrorAt'] = time();
                gsa_atomic_write(gsa_ioda_cache_file(), json_encode($cached));
            }
            return array('ok' => false, 'error' => 'IODA did not answer');
        }
        $built['fetchedAt'] = time();
        gsa_atomic_write(gsa_ioda_cache_file(), json_encode($built));
        return array('ok' => true, 'us' => $built['counts']['us'], 'global' => $built['counts']['global'], 'ms' => (int) round((microtime(true) - $t0) * 1000));
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function gsa_ioda_snapshot()
{
    $cached = gsa_ioda_cache_read();
    $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    if ($age > 1200) {
        // No cron refresh lately: refresh now. With no cache at all, wait for it.
        gsa_ioda_refresh(array('maxAge' => 1200, 'wait' => !$cached));
        $cached = gsa_ioda_cache_read();
        $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    }
    if (!$cached) {
        return array(
            'source' => 'IODA, Georgia Tech',
            'updated' => gmdate('Y-m-d\TH:i:s\Z'),
            'stale' => false,
            'error' => 'IODA did not answer. Try again in a few minutes.',
            'us' => array(),
            'global' => array(),
            'counts' => array('us' => 0, 'global' => 0),
        );
    }
    unset($cached['fetchedAt'], $cached['lastErrorAt']);
    $cached['stale'] = $age > 1800;
    $cached['ageSeconds'] = $age;
    return $cached;
}

// ---------- INTERNET OUTAGES: RIPE Atlas probes that went offline ----------
// RIPE Atlas (RIPE NCC) test devices that dropped off in the last 24 hours. US
// probes go in USA INTERNET OUTAGES, the rest in GLOBAL INTERNET OUTAGES, next
// to the IODA state and country pins. data/ripe-atlas-cache.json is refreshed by
// the */5 aircraft cron at most every 10 minutes (gsa_ripe_refresh); a visitor
// request only refreshes a cache older than 20 minutes.
//
// Inputs, all public and keyless:
//   measurement 7000 results  connect / disconnect events for every public probe
//   /api/v2/probes/?id__in=   location, network and anchor flag for the ones kept
//   ftp.ripe.net asnames      network names, cached for a day
// Place names come from geo/world-cities.json (GeoNames, CC BY 4.0).
const GSA_RIPE_MIN_OFFLINE = 1800;     // still offline: at least 30 minutes
const GSA_RIPE_MIN_RECOVERED = 3600;   // back online: was out at least 1 hour
const GSA_RIPE_FLAP_DROPS = 4;         // 4+ drops of 5+ minutes in 24h = flapping, skip
const GSA_RIPE_FLAP_EVENTS = 12;       // or 12+ disconnects of any length

function gsa_ripe_cache_file()
{
    global $dataDir;
    return $dataDir . '/ripe-atlas-cache.json';
}

function gsa_ripe_cache_read()
{
    $file = gsa_ripe_cache_file();
    if (!is_file($file)) {
        return null;
    }
    $cached = json_decode((string) file_get_contents($file), true);
    return is_array($cached) ? $cached : null;
}

function gsa_ripe_get($url, $timeout = 60)
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_ENCODING => '',
        CURLOPT_HTTPHEADER => array(
            'Accept: application/json, text/plain',
            'User-Agent: GlobalStatusApp/1.0 (+https://globalstatus.app)',
        ),
    ));
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return ($body !== false && $code >= 200 && $code < 300) ? (string) $body : null;
}

// ASN => network name, from ftp.ripe.net/ripe/asnames/asn.txt, cached a day.
// Lines look like "7922 COMCAST-7922 - Comcast Cable Communications, LLC, US".
function gsa_ripe_asnames()
{
    global $dataDir;
    $file = $dataDir . '/ripe-asnames.json';
    $cached = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    if (is_array($cached) && (time() - (int) ($cached['fetchedAt'] ?? 0)) < 86400 && !empty($cached['names'])) {
        return $cached['names'];
    }
    $body = gsa_ripe_get('https://ftp.ripe.net/ripe/asnames/asn.txt', 60);
    if ($body === null) {
        return is_array($cached['names'] ?? null) ? $cached['names'] : array();
    }
    $names = array();
    foreach (explode("\n", $body) as $line) {
        if (!preg_match('/^(\d+)\s+(.+)$/', trim($line), $m)) {
            continue;
        }
        $text = preg_replace('/,\s*[A-Z]{2}$/', '', trim($m[2]));
        $pos = strpos($text, ' - ');
        if ($pos !== false) {
            $text = trim(substr($text, $pos + 3));
        } elseif (preg_match('/^[A-Z0-9][A-Z0-9_.-]*\s+(.{3,})$/', $text, $mm)) {
            // RIPE-region style "HANDLE Org Name": keep the org name.
            $text = trim($mm[1]);
        }
        $names[$m[1]] = $text;
    }
    if ($names) {
        gsa_atomic_write($file, json_encode(array('fetchedAt' => time(), 'names' => $names)));
    }
    return $names;
}

// Nearest GeoNames town (population 15,000+) to a point: array(name, region, km).
function gsa_ripe_nearest_city($rows, $lat, $lon, $cc)
{
    $best = null;
    $bestD = INF;
    $cosLat = cos(deg2rad($lat));
    // Rows are sorted by latitude; only look within about 3 degrees.
    $lo = 0;
    $hi = count($rows);
    while ($lo < $hi) {
        $mid = ($lo + $hi) >> 1;
        if ($rows[$mid][0] < $lat - 3) {
            $lo = $mid + 1;
        } else {
            $hi = $mid;
        }
    }
    for ($i = $lo, $n = count($rows); $i < $n && $rows[$i][0] <= $lat + 3; $i++) {
        $r = $rows[$i];
        $dLat = $r[0] - $lat;
        $dLon = ($r[1] - $lon) * $cosLat;
        $d = $dLat * $dLat + $dLon * $dLon;
        // Prefer a town in the probe's own country.
        if ($r[3] !== $cc) {
            $d *= 4;
        }
        if ($d < $bestD) {
            $bestD = $d;
            $best = $r;
        }
    }
    if (!$best) {
        return null;
    }
    $km = sqrt(pow($best[0] - $lat, 2) + pow(($best[1] - $lon) * $cosLat, 2)) * 111.2;
    return array($best[2], $best[4], round($km), $best[3]);
}

// Walk one probe's events (oldest first) into offline spells: array(start, end|null).
function gsa_ripe_spells($events)
{
    usort($events, function ($a, $b) {
        if ($a[0] === $b[0]) {
            return $a[1] === 'disconnect' ? -1 : 1;
        }
        return $a[0] <=> $b[0];
    });
    $spells = array();
    $down = null;
    foreach ($events as $ev) {
        if ($ev[1] === 'disconnect') {
            if ($down === null) {
                $down = $ev[0];
            }
        } elseif ($ev[1] === 'connect' && $down !== null) {
            $spells[] = array($down, $ev[0]);
            $down = null;
        }
    }
    if ($down !== null) {
        $spells[] = array($down, null);
    }
    return $spells;
}

function gsa_ripe_build()
{
    global $root;
    $until = time();
    $from = $until - 86400;
    // Two extra hours so a probe that dropped just before the window still pairs up.
    $body = gsa_ripe_get('https://atlas.ripe.net/api/v2/measurements/7000/results/?format=json&start=' . ($from - 7200) . '&stop=' . $until, 90);
    $rows = $body !== null ? json_decode($body, true) : null;
    unset($body);
    if (!is_array($rows)) {
        return null;
    }
    $byProbe = array();
    foreach ($rows as $row) {
        $id = (int) ($row['prb_id'] ?? 0);
        $event = (string) ($row['event'] ?? '');
        if ($id <= 0 || ($event !== 'connect' && $event !== 'disconnect')) {
            continue;
        }
        $byProbe[$id][] = array((int) ($row['timestamp'] ?? 0), $event, (int) ($row['asn'] ?? 0));
    }
    unset($rows);

    $candidates = array();
    $stats = array('probesWithEvents' => count($byProbe), 'flapping' => 0, 'anchors' => 0, 'noLocation' => 0, 'notPublic' => 0);
    foreach ($byProbe as $id => $events) {
        $spells = gsa_ripe_spells($events);
        $drops5 = 0;
        foreach ($spells as $s) {
            if ((($s[1] ?? $until) - $s[0]) >= 300) {
                $drops5++;
            }
        }
        $pick = null;
        foreach ($spells as $s) {
            if ($s[0] < $from) {
                continue;
            }
            $len = ($s[1] ?? $until) - $s[0];
            if (($s[1] === null && $len >= GSA_RIPE_MIN_OFFLINE) || ($s[1] !== null && $len >= GSA_RIPE_MIN_RECOVERED)) {
                $pick = $s;
            }
        }
        if (!$pick) {
            continue;
        }
        if ($drops5 >= GSA_RIPE_FLAP_DROPS || count($spells) >= GSA_RIPE_FLAP_EVENTS) {
            $stats['flapping']++;
            continue;
        }
        $asn = 0;
        foreach ($events as $ev) {
            if ($ev[2]) {
                $asn = $ev[2];
            }
        }
        $candidates[$id] = array('start' => $pick[0], 'end' => $pick[1], 'drops' => $drops5, 'asn' => $asn);
    }
    unset($byProbe);

    // Probe details, 200 ids per request.
    $meta = array();
    $ids = array_keys($candidates);
    foreach (array_chunk($ids, 200) as $chunk) {
        $url = 'https://atlas.ripe.net/api/v2/probes/?page_size=500&fields=id,country_code,asn_v4,asn_v6,geometry,is_anchor,is_public,status,status_since,tags&id__in=' . implode(',', $chunk);
        $page = gsa_ripe_get($url, 60);
        $decoded = $page !== null ? json_decode($page, true) : null;
        if (!is_array($decoded) || !isset($decoded['results'])) {
            return null;
        }
        foreach ($decoded['results'] as $p) {
            $meta[(int) $p['id']] = $p;
        }
    }

    $cent = json_decode((string) @file_get_contents($root . '/api/internet-centroids.json'), true);
    $countries = is_array($cent['countries'] ?? null) ? $cent['countries'] : array();
    $cityPack = json_decode((string) @file_get_contents($root . '/geo/world-cities.json'), true);
    $cities = is_array($cityPack['rows'] ?? null) ? $cityPack['rows'] : array();
    $names = gsa_ripe_asnames();
    $usCodes = array('US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM');

    $us = array();
    $global = array();
    foreach ($candidates as $id => $c) {
        $p = $meta[$id] ?? null;
        if (!$p) {
            continue;
        }
        if (empty($p['is_public'])) {
            $stats['notPublic']++;
            continue;
        }
        // Anchors sit in data centers: their drop-offs are rarely what people at home see.
        if (!empty($p['is_anchor'])) {
            $stats['anchors']++;
            continue;
        }
        $tags = array();
        foreach ((array) ($p['tags'] ?? array()) as $t) {
            $tags[] = (string) ($t['slug'] ?? '');
        }
        $coords = $p['geometry']['coordinates'] ?? null;
        // A location guessed only from the country puts the pin at the country middle: skip it.
        if (!is_array($coords) || count($coords) < 2 || in_array('system-auto-geoip-country', $tags, true)) {
            $stats['noLocation']++;
            continue;
        }
        $lon = round((float) $coords[0], 3);
        $lat = round((float) $coords[1], 3);
        $cc = strtoupper((string) ($p['country_code'] ?? ''));
        $status = (int) ($p['status']['id'] ?? 0);
        $end = $c['end'];
        // The events feed can lag: trust the probe's own status when it says it is back.
        if ($end === null && $status === 1 && (int) ($p['status_since'] ?? 0) > $c['start']) {
            $end = (int) $p['status_since'];
            if ($end - $c['start'] < GSA_RIPE_MIN_RECOVERED) {
                continue;
            }
        }
        $asn = (int) ($p['asn_v4'] ?: ($p['asn_v6'] ?: $c['asn']));
        $city = $cities ? gsa_ripe_nearest_city($cities, $lat, $lon, $cc) : null;
        $countryName = $countries[$cc][2] ?? $cc;
        if ($city && $city[2] <= 60) {
            $near = $city[0] . ($city[1] !== '' ? ', ' . $city[1] : '');
        } else {
            $near = '';
        }
        $item = array(
            'code' => 'ripe-' . $id,
            'probe' => $id,
            'lat' => $lat,
            'lon' => $lon,
            'cc' => $cc,
            'country' => $countryName,
            'near' => $near,
            'nearKm' => $city && $near !== '' ? $city[2] : null,
            'approx' => in_array('system-auto-geoip-city', $tags, true),
            'asn' => $asn,
            'network' => $asn ? ($names[(string) $asn] ?? '') : '',
            'start' => $c['start'],
            'end' => $end,
            'ongoing' => $end === null,
            'drops' => $c['drops'],
        );
        if (in_array($cc, $usCodes, true)) {
            $us[] = $item;
        } else {
            $global[] = $item;
        }
    }
    // How many other kept probes on the same network dropped within 15 minutes.
    $all = array_merge($us, $global);
    $sameNet = function (&$list) use ($all) {
        foreach ($list as &$item) {
            $n = 0;
            foreach ($all as $other) {
                if ($other['probe'] !== $item['probe'] && $item['asn'] && $other['asn'] === $item['asn'] && abs($other['start'] - $item['start']) <= 900) {
                    $n++;
                }
            }
            $item['sameNetwork'] = $n;
        }
        unset($item);
        usort($list, function ($a, $b) {
            if ($a['ongoing'] !== $b['ongoing']) {
                return $a['ongoing'] ? -1 : 1;
            }
            return $b['start'] <=> $a['start'];
        });
    };
    $sameNet($us);
    $sameNet($global);
    return array(
        'source' => 'RIPE Atlas (RIPE NCC)',
        'updated' => gmdate('Y-m-d\TH:i:s\Z', $until),
        'from' => $from,
        'until' => $until,
        'us' => $us,
        'global' => $global,
        'counts' => array(
            'us' => count($us),
            'global' => count($global),
            'usOffline' => count(array_filter($us, function ($p) { return $p['ongoing']; })),
            'globalOffline' => count(array_filter($global, function ($p) { return $p['ongoing']; })),
        ),
        'skipped' => $stats,
    );
}

function gsa_ripe_refresh($opts = array())
{
    global $dataDir;
    $maxAge = (int) ($opts['maxAge'] ?? 600);
    $cached = gsa_ripe_cache_read();
    if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
        return array('ok' => true, 'skipped' => true);
    }
    $lock = fopen($dataDir . '/ripe-atlas.lock', 'c');
    if (!$lock) {
        return array('ok' => false, 'error' => 'no lock file');
    }
    $wait = !empty($opts['wait']);
    if (!flock($lock, $wait ? LOCK_EX : (LOCK_EX | LOCK_NB))) {
        fclose($lock);
        return array('ok' => true, 'busy' => true);
    }
    try {
        $cached = gsa_ripe_cache_read();
        if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
            return array('ok' => true, 'skipped' => true);
        }
        $t0 = microtime(true);
        $built = gsa_ripe_build();
        if ($built === null) {
            if ($cached) {
                $cached['lastError'] = 'RIPE Atlas did not answer at ' . gmdate('H:i\Z');
                $cached['lastErrorAt'] = time();
                gsa_atomic_write(gsa_ripe_cache_file(), json_encode($cached));
            }
            return array('ok' => false, 'error' => 'RIPE Atlas did not answer');
        }
        $built['fetchedAt'] = time();
        gsa_atomic_write(gsa_ripe_cache_file(), json_encode($built));
        return array('ok' => true, 'us' => $built['counts']['us'], 'global' => $built['counts']['global'], 'ms' => (int) round((microtime(true) - $t0) * 1000));
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function gsa_ripe_snapshot()
{
    $cached = gsa_ripe_cache_read();
    $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    if ($age > 1200) {
        gsa_ripe_refresh(array('maxAge' => 1200, 'wait' => !$cached));
        $cached = gsa_ripe_cache_read();
        $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    }
    if (!$cached) {
        return array(
            'source' => 'RIPE Atlas (RIPE NCC)',
            'updated' => gmdate('Y-m-d\TH:i:s\Z'),
            'stale' => false,
            'error' => 'RIPE Atlas did not answer. Try again in a few minutes.',
            'us' => array(),
            'global' => array(),
            'counts' => array('us' => 0, 'global' => 0, 'usOffline' => 0, 'globalOffline' => 0),
        );
    }
    unset($cached['fetchedAt'], $cached['lastErrorAt']);
    $cached['stale'] = $age > 1800;
    $cached['ageSeconds'] = $age;
    return $cached;
}

// ---------- FAA TFR (temporary flight restrictions) ----------
// TRANSPORTATION > FAA TFR reads data/tfr-cache.json. The */5 aircraft cron
// refreshes it when it is at least 10 minutes old (gsa_tfr_refresh); a visitor
// request only refreshes a cache older than 20 minutes. Sources, all public
// FAA feeds behind tfr.faa.gov/tfr3:
//   tfrapi/getTfrList                  every published TFR (id, type, facility, state)
//   geoserver/TFR/ows  V_TFR_LOC (WFS) the drawn areas, polygons in EPSG:4326
//   download/detail_<n>_<seq>.xml      per-NOTAM details: times, altitudes, text
// Detail XML is fetched again only when a TFR's modification time changes.
function gsa_tfr_cache_file()
{
    global $dataDir;
    return $dataDir . '/tfr-cache.json';
}

function gsa_tfr_cache_read()
{
    $file = gsa_tfr_cache_file();
    if (!is_file($file)) {
        return null;
    }
    $cached = json_decode((string) file_get_contents($file), true);
    return is_array($cached) ? $cached : null;
}

// Fetch URLs at once; returns raw bodies keyed like $urls (null for a failure).
function gsa_tfr_fetch($urls, $timeout = 40, $batch = 8)
{
    $out = array();
    if (!function_exists('curl_multi_init')) {
        return $out;
    }
    foreach (array_chunk($urls, $batch, true) as $chunk) {
        $multi = curl_multi_init();
        $handles = array();
        foreach ($chunk as $key => $url) {
            $ch = curl_init($url);
            curl_setopt_array($ch, array(
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_ENCODING => '',
                CURLOPT_HTTPHEADER => array('User-Agent: GlobalStatusApp/1.0 (+https://globalstatus.app)'),
            ));
            curl_multi_add_handle($multi, $ch);
            $handles[$key] = $ch;
        }
        do {
            $status = curl_multi_exec($multi, $running);
            if ($running) {
                curl_multi_select($multi, 1.0);
            }
        } while ($running && $status === CURLM_OK);
        foreach ($handles as $key => $ch) {
            $body = curl_multi_getcontent($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_multi_remove_handle($multi, $ch);
            curl_close($ch);
            $out[$key] = ($body !== false && $code >= 200 && $code < 300) ? (string) $body : null;
        }
        curl_multi_close($multi);
    }
    return $out;
}

function gsa_tfr_tag($xml, $tag)
{
    return preg_match('#<' . $tag . '>(.*?)</' . $tag . '>#s', $xml, $m) ? trim(html_entity_decode($m[1], ENT_QUOTES | ENT_XML1, 'UTF-8')) : '';
}

// FAA XML times are UTC without a zone: "2026-11-26T20:30:00".
function gsa_tfr_time($text)
{
    if ($text === '') {
        return null;
    }
    $t = strtotime($text . ' UTC');
    return $t === false ? null : $t;
}

// One altitude: HEI = above ground, ALT = above sea level, STD / FL = flight level.
function gsa_tfr_alt($code, $val, $uom)
{
    if ($val === '') {
        return '';
    }
    $n = (int) $val;
    if (strtoupper($uom) === 'FL' || strtoupper($code) === 'STD') {
        return 'FL' . str_pad((string) $n, 3, '0', STR_PAD_LEFT);
    }
    if ($n === 0 && strtoupper($code) === 'HEI') {
        return 'Surface';
    }
    return number_format($n) . ' ft ' . (strtoupper($code) === 'HEI' ? 'AGL' : 'MSL');
}

function gsa_tfr_parse_detail($xml)
{
    $not = preg_match('#<Not>(.*?)<TfrNot>#s', $xml, $m) ? $m[1] : $xml;
    $areas = array();
    if (preg_match_all('#<aseTFRArea>(.*?)</aseTFRArea>#s', $xml, $mm)) {
        foreach ($mm[1] as $a) {
            $areas[] = array(
                'name' => gsa_tfr_tag($a, 'txtName'),
                'floor' => gsa_tfr_alt(gsa_tfr_tag($a, 'codeDistVerLower'), gsa_tfr_tag($a, 'valDistVerLower'), gsa_tfr_tag($a, 'uomDistVerLower')),
                'ceiling' => gsa_tfr_alt(gsa_tfr_tag($a, 'codeDistVerUpper'), gsa_tfr_tag($a, 'valDistVerUpper'), gsa_tfr_tag($a, 'uomDistVerUpper')),
                'start' => gsa_tfr_time(gsa_tfr_tag($a, 'dateEffective')),
                'end' => gsa_tfr_time(gsa_tfr_tag($a, 'dateExpire')),
            );
        }
    }
    $text = gsa_tfr_tag($xml, 'txtDescrUSNS') ?: gsa_tfr_tag($xml, 'txtDescrTraditional');
    if (strlen($text) > 3000) {
        $text = substr($text, 0, 3000) . '…';
    }
    $reg = preg_match('#<TfrNot>\s*<codeType>([^<]+)</codeType>#', $xml, $r) ? trim($r[1]) : '';
    return array(
        'start' => gsa_tfr_time(gsa_tfr_tag($not, 'dateEffective')),
        'end' => gsa_tfr_time(gsa_tfr_tag($not, 'dateExpire')),
        'issued' => gsa_tfr_time(gsa_tfr_tag($not, 'dateIssued')),
        'zone' => gsa_tfr_tag($not, 'codeTimeZone'),
        'city' => gsa_tfr_tag($not, 'txtNameCity'),
        'stateName' => gsa_tfr_tag($not, 'txtNameUSState'),
        'name' => gsa_tfr_tag($not, 'txtLocalName'),
        'regulation' => $reg !== '' ? '14 CFR ' . $reg : '',
        'areas' => $areas,
        'text' => $text,
    );
}

function gsa_tfr_build($previous)
{
    $base = 'https://tfr.faa.gov/';
    $got = gsa_tfr_fetch(array(
        'list' => $base . 'tfrapi/getTfrList',
        'wfs' => $base . 'geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json&srsname=EPSG:4326',
    ), 45);
    $list = json_decode((string) ($got['list'] ?? ''), true);
    $wfs = json_decode((string) ($got['wfs'] ?? ''), true);
    if (!is_array($list) || !is_array($wfs) || !isset($wfs['features'])) {
        return null;
    }
    // Shapes by NOTAM id ("6/2481-1-FDC-F" -> "6/2481").
    $shapes = array();
    foreach ($wfs['features'] as $f) {
        $key = (string) ($f['properties']['NOTAM_KEY'] ?? '');
        $id = strtok($key, '-');
        $geom = $f['geometry'] ?? null;
        if ($id === '' || !is_array($geom)) {
            continue;
        }
        $polys = $geom['type'] === 'MultiPolygon' ? $geom['coordinates'] : ($geom['type'] === 'Polygon' ? array($geom['coordinates']) : array());
        foreach ($polys as $poly) {
            $ring = array();
            foreach ((array) ($poly[0] ?? array()) as $pt) {
                $ring[] = array(round((float) $pt[0], 5), round((float) $pt[1], 5));
            }
            if (count($ring) >= 3) {
                $shapes[$id][] = $ring;
            }
        }
    }
    // Details, reusing the last copy when the TFR has not changed.
    $prevDetails = array();
    foreach ((array) ($previous['tfrs'] ?? array()) as $t) {
        if (!empty($t['detail']) && isset($t['mod'])) {
            $prevDetails[$t['id'] . '@' . $t['mod']] = $t['detail'];
        }
    }
    foreach ((array) ($previous['textOnly'] ?? array()) as $t) {
        if (!empty($t['detail']) && isset($t['mod'])) {
            $prevDetails[$t['id'] . '@' . $t['mod']] = $t['detail'];
        }
    }
    $need = array();
    foreach ($list as $row) {
        $id = (string) ($row['notam_id'] ?? '');
        $mod = (string) ($row['mod_abs_time'] ?? '');
        if ($id !== '' && !isset($prevDetails[$id . '@' . $mod])) {
            $need[$id] = $base . 'download/detail_' . str_replace('/', '_', $id) . '.xml';
        }
    }
    $fresh = $need ? gsa_tfr_fetch($need, 30, 8) : array();
    $tfrs = array();
    $textOnly = array();
    $now = time();
    foreach ($list as $row) {
        $id = (string) ($row['notam_id'] ?? '');
        if ($id === '') {
            continue;
        }
        $mod = (string) ($row['mod_abs_time'] ?? '');
        $detail = $prevDetails[$id . '@' . $mod] ?? null;
        if ($detail === null && !empty($fresh[$id])) {
            $detail = gsa_tfr_parse_detail($fresh[$id]);
        }
        $item = array(
            'id' => $id,
            'type' => strtoupper(trim((string) ($row['type'] ?? ''))) ?: 'OTHER',
            'facility' => trim((string) ($row['facility'] ?? '')),
            'state' => trim((string) ($row['state'] ?? '')),
            'title' => trim((string) ($row['description'] ?? '')),
            'mod' => $mod,
            'detail' => $detail,
        );
        $start = $detail['start'] ?? null;
        $end = $detail['end'] ?? null;
        $item['status'] = ($start && $start > $now) ? 'upcoming' : (($end && $end < $now) ? 'expired' : 'active');
        if (isset($shapes[$id])) {
            $item['areas'] = $shapes[$id];
            // Center: mean of the largest ring's points.
            $big = $shapes[$id][0];
            foreach ($shapes[$id] as $ring) {
                if (count($ring) > count($big)) {
                    $big = $ring;
                }
            }
            $sx = 0.0;
            $sy = 0.0;
            foreach ($big as $pt) {
                $sx += $pt[0];
                $sy += $pt[1];
            }
            $item['lon'] = round($sx / count($big), 5);
            $item['lat'] = round($sy / count($big), 5);
            $tfrs[] = $item;
        } else {
            $textOnly[] = $item;
        }
    }
    $byType = array();
    $active = 0;
    foreach ($tfrs as $t) {
        $byType[$t['type']] = ($byType[$t['type']] ?? 0) + 1;
        if ($t['status'] === 'active') {
            $active++;
        }
    }
    arsort($byType);
    return array(
        'source' => 'FAA, tfr.faa.gov',
        'updated' => gmdate('Y-m-d\TH:i:s\Z', $now),
        'tfrs' => $tfrs,
        'textOnly' => $textOnly,
        'counts' => array('mapped' => count($tfrs), 'active' => $active, 'upcoming' => count($tfrs) - $active, 'textOnly' => count($textOnly), 'byType' => $byType),
        'detailFetched' => count($need),
    );
}

function gsa_tfr_refresh($opts = array())
{
    global $dataDir;
    $maxAge = (int) ($opts['maxAge'] ?? 600);
    $cached = gsa_tfr_cache_read();
    if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
        return array('ok' => true, 'skipped' => true);
    }
    $lock = fopen($dataDir . '/tfr.lock', 'c');
    if (!$lock) {
        return array('ok' => false, 'error' => 'no lock file');
    }
    $wait = !empty($opts['wait']);
    if (!flock($lock, $wait ? LOCK_EX : (LOCK_EX | LOCK_NB))) {
        fclose($lock);
        return array('ok' => true, 'busy' => true);
    }
    try {
        $cached = gsa_tfr_cache_read();
        if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
            return array('ok' => true, 'skipped' => true);
        }
        $t0 = microtime(true);
        $built = gsa_tfr_build($cached);
        if ($built === null) {
            if ($cached) {
                $cached['lastError'] = 'The FAA TFR feed did not answer at ' . gmdate('H:i\Z');
                $cached['lastErrorAt'] = time();
                gsa_atomic_write(gsa_tfr_cache_file(), json_encode($cached));
            }
            return array('ok' => false, 'error' => 'FAA TFR feed did not answer');
        }
        $built['fetchedAt'] = time();
        gsa_atomic_write(gsa_tfr_cache_file(), json_encode($built));
        return array('ok' => true, 'mapped' => $built['counts']['mapped'], 'details' => $built['detailFetched'], 'ms' => (int) round((microtime(true) - $t0) * 1000));
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function gsa_tfr_snapshot()
{
    $cached = gsa_tfr_cache_read();
    $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    if ($age > 1200) {
        gsa_tfr_refresh(array('maxAge' => 1200, 'wait' => !$cached));
        $cached = gsa_tfr_cache_read();
        $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    }
    if (!$cached) {
        return array(
            'source' => 'FAA, tfr.faa.gov',
            'updated' => gmdate('Y-m-d\TH:i:s\Z'),
            'stale' => false,
            'error' => 'The FAA TFR feed did not answer. Try again in a few minutes.',
            'tfrs' => array(),
            'textOnly' => array(),
            'counts' => array('mapped' => 0, 'active' => 0, 'upcoming' => 0, 'textOnly' => 0, 'byType' => array()),
        );
    }
    unset($cached['fetchedAt'], $cached['lastErrorAt'], $cached['detailFetched']);
    $cached['stale'] = $age > 1800;
    $cached['ageSeconds'] = $age;
    return $cached;
}

// ---------- FAA NAS Status (flight delays) ----------
// TRANSPORTATION > FLIGHT DELAYS reads data/flight-delays-cache.json. The */5 aircraft
// cron refreshes it when it is at least ~5 minutes old (gsa_fd_refresh); a visitor
// request only refreshes a cache older than 10 minutes, and it is flagged stale after
// 20 minutes. Sources, both public FAA feeds behind nasstatus.faa.gov:
//   api/airport-events               JSON, one object per airport with an event (ground
//                                    stops, ground delay programs, arrival / departure
//                                    delays, closures, deicing, NOTAM notices) + coordinates
//   api/airport-status-information   the classic XML: airspace flow programs, and a second
//                                    source for ground stops and delays the JSON lacks
// Names, cities and states come from geo/us-airports.json (OurAirports) when needed.
function gsa_fd_cache_file()
{
    global $dataDir;
    return $dataDir . '/flight-delays-cache.json';
}

function gsa_fd_cache_read()
{
    $file = gsa_fd_cache_file();
    if (!is_file($file)) {
        return null;
    }
    $cached = json_decode((string) file_get_contents($file), true);
    return is_array($cached) ? $cached : null;
}

// "3 hours and 34 minutes", "16 minutes", "15", 214.0 -> minutes (null when unknown).
function gsa_fd_minutes($v)
{
    if ($v === null || $v === '') {
        return null;
    }
    if (is_int($v) || is_float($v) || preg_match('/^\s*\d+(\.\d+)?\s*$/', (string) $v)) {
        return (int) round((float) $v);
    }
    $s = strtolower((string) $v);
    $m = 0;
    $hit = false;
    if (preg_match('/(\d+)\s*hour/', $s, $h)) {
        $m += 60 * (int) $h[1];
        $hit = true;
    }
    if (preg_match('/(\d+)\s*min/', $s, $mm)) {
        $m += (int) $mm[1];
        $hit = true;
    }
    return $hit ? $m : null;
}

function gsa_fd_time($v)
{
    if (!is_string($v) || $v === '') {
        return null;
    }
    $t = strtotime($v);
    return $t === false ? null : $t;
}

function gsa_fd_str($v)
{
    return is_string($v) ? trim($v) : (is_numeric($v) ? (string) $v : '');
}

function gsa_fd_xml_tag($xml, $tag)
{
    return preg_match('#<' . $tag . '(?:\s[^>]*)?>(.*?)</' . $tag . '>#s', $xml, $m) ? trim(html_entity_decode($m[1], ENT_QUOTES | ENT_XML1, 'UTF-8')) : '';
}

// One normalized event list per airport from the JSON feed.
function gsa_fd_events_json($a)
{
    $ev = array();
    $gs = $a['groundStop'] ?? null;
    if (is_array($gs)) {
        $ev[] = array(
            'kind' => 'groundstop',
            'reason' => gsa_fd_str($gs['impactingCondition'] ?? ($gs['reason'] ?? '')),
            'start' => gsa_fd_time($gs['startTime'] ?? null),
            'end' => gsa_fd_time($gs['endTime'] ?? null),
            'updated' => gsa_fd_time($gs['updatedAt'] ?? ($gs['sourceTimeStamp'] ?? null)),
            'center' => gsa_fd_str($gs['center'] ?? ''),
            'scope' => gsa_fd_str($gs['departureScope'] ?? ''),
            'avg' => gsa_fd_minutes($gs['avgDelay'] ?? null),
            'max' => gsa_fd_minutes($gs['maxDelay'] ?? null),
        );
    }
    $gd = $a['groundDelay'] ?? null;
    if (is_array($gd)) {
        $ev[] = array(
            'kind' => 'gdp',
            'reason' => gsa_fd_str($gd['impactingCondition'] ?? ($gd['reason'] ?? '')),
            'avg' => gsa_fd_minutes($gd['avgDelay'] ?? null),
            'max' => gsa_fd_minutes($gd['maxDelay'] ?? null),
            'start' => gsa_fd_time($gd['startTime'] ?? null),
            'end' => gsa_fd_time($gd['endTime'] ?? null),
            'updated' => gsa_fd_time($gd['updatedAt'] ?? ($gd['sourceTimeStamp'] ?? null)),
            'center' => gsa_fd_str($gd['center'] ?? ''),
            'scope' => gsa_fd_str($gd['departureScope'] ?? ''),
        );
    }
    foreach (array('arrivalDelay' => 'arrival', 'departureDelay' => 'departure') as $field => $kind) {
        $d = $a[$field] ?? null;
        if (!is_array($d)) {
            continue;
        }
        $ad = is_array($d['arrivalDeparture'] ?? null) ? $d['arrivalDeparture'] : array();
        $ev[] = array(
            'kind' => $kind,
            'reason' => gsa_fd_str($d['reason'] ?? ''),
            'min' => gsa_fd_minutes($ad['min'] ?? null),
            'max' => gsa_fd_minutes($ad['max'] ?? ($d['maxDelay'] ?? null)),
            'avg' => gsa_fd_minutes($d['averageDelay'] ?? null),
            'trend' => gsa_fd_str($ad['trend'] ?? ($d['trend'] ?? '')),
            'updated' => gsa_fd_time($d['updateTime'] ?? ($d['updatedAt'] ?? null)),
        );
    }
    $cl = $a['airportClosure'] ?? null;
    if (is_array($cl)) {
        $ev[] = array(
            'kind' => 'closure',
            'reason' => gsa_fd_str($cl['text'] ?? ''),
            'text' => gsa_fd_str($cl['simpleText'] ?? ''),
            'start' => gsa_fd_time($cl['startTime'] ?? null),
            'end' => gsa_fd_time($cl['endTime'] ?? null),
            'updated' => gsa_fd_time($cl['updatedAt'] ?? null),
            'daily' => preg_match('/\bDLY\s+(\d{4})-(\d{4})\b/', (string) ($cl['text'] ?? ($cl['simpleText'] ?? '')), $dm) ? array($dm[1], $dm[2]) : null,
        );
    }
    $de = $a['deicing'] ?? null;
    if (is_array($de)) {
        $ev[] = array(
            'kind' => 'deicing',
            'reason' => 'Deicing in progress',
            'start' => gsa_fd_time($de['eventTime'] ?? null),
            'end' => gsa_fd_time($de['expTime'] ?? null),
            'updated' => gsa_fd_time($de['updatedAt'] ?? null),
        );
    }
    $ff = $a['freeForm'] ?? null;
    if (is_array($ff)) {
        $ev[] = array(
            'kind' => 'notice',
            'reason' => gsa_fd_str($ff['text'] ?? ''),
            'text' => gsa_fd_str($ff['simpleText'] ?? ''),
            'start' => gsa_fd_time($ff['startTime'] ?? null),
            'end' => gsa_fd_time($ff['endTime'] ?? null),
            'updated' => gsa_fd_time($ff['updatedAt'] ?? null),
        );
    }
    return $ev;
}

// Ground stops, ground delays and arrival / departure delays from the XML, keyed by airport,
// plus airspace flow programs (no single airport).
function gsa_fd_events_xml($xml)
{
    $by = array();
    $afp = array();
    if (!preg_match_all('#<Delay_type>(.*?)</Delay_type>#s', $xml, $types)) {
        return array($by, $afp);
    }
    foreach ($types[1] as $block) {
        $name = strtolower(gsa_fd_xml_tag($block, 'Name'));
        if (strpos($name, 'airspace flow') !== false) {
            if (preg_match_all('#<Airspace_Flow>(.*?)</Airspace_Flow>#s', $block, $mm)) {
                foreach ($mm[1] as $r) {
                    $afp[] = array(
                        'element' => gsa_fd_xml_tag($r, 'CTL_Element'),
                        'reason' => gsa_fd_xml_tag($r, 'Reason'),
                        'avg' => gsa_fd_minutes(gsa_fd_xml_tag($r, 'Avg')),
                        'start' => gsa_fd_xml_tag($r, 'AFP_StartTime'),
                        'end' => gsa_fd_xml_tag($r, 'AFP_EndTime'),
                    );
                }
            }
            continue;
        }
        if (strpos($name, 'ground stop') !== false) {
            $kind = 'groundstop';
        } elseif (strpos($name, 'ground delay') !== false) {
            $kind = 'gdp';
        } elseif (strpos($name, 'arrival/departure') !== false) {
            $kind = 'arrdep';
        } else {
            continue; // closures come from the JSON, with real times
        }
        if (!preg_match_all('#<(Program|Ground_Delay|Delay)>(.*?)</\1>#s', $block, $mm)) {
            continue;
        }
        foreach ($mm[2] as $r) {
            $arpt = strtoupper(gsa_fd_xml_tag($r, 'ARPT'));
            if ($arpt === '') {
                continue;
            }
            if ($kind === 'arrdep') {
                $type = preg_match('#<Arrival_Departure\s+Type="([^"]+)"#', $r, $t) ? strtolower($t[1]) : 'departure';
                $by[$arpt][] = array(
                    'kind' => strpos($type, 'arr') === 0 ? 'arrival' : 'departure',
                    'reason' => gsa_fd_xml_tag($r, 'Reason'),
                    'min' => gsa_fd_minutes(gsa_fd_xml_tag($r, 'Min')),
                    'max' => gsa_fd_minutes(gsa_fd_xml_tag($r, 'Max')),
                    'trend' => gsa_fd_xml_tag($r, 'Trend'),
                );
            } else {
                $by[$arpt][] = array(
                    'kind' => $kind,
                    'reason' => gsa_fd_xml_tag($r, 'Reason'),
                    'avg' => gsa_fd_minutes(gsa_fd_xml_tag($r, 'Avg')),
                    'max' => gsa_fd_minutes(gsa_fd_xml_tag($r, 'Max')),
                    'endText' => gsa_fd_xml_tag($r, 'End_Time'),
                );
            }
        }
    }
    return array($by, $afp);
}

function gsa_fd_airports()
{
    static $map = null;
    if ($map === null) {
        $file = __DIR__ . '/geo/us-airports.json';
        $body = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        $map = is_array($body) && isset($body['airports']) ? $body['airports'] : array();
    }
    return $map;
}

// $base is only changed by local tests that serve saved FAA files.
function gsa_fd_build($base = 'https://nasstatus.faa.gov/api/')
{
    $got = gsa_tfr_fetch(array('events' => $base . 'airport-events', 'xml' => $base . 'airport-status-information'), 30);
    $events = json_decode((string) ($got['events'] ?? ''), true);
    $xml = (string) ($got['xml'] ?? '');
    $xmlOk = strpos($xml, '<AIRPORT_STATUS_INFORMATION') !== false;
    if (!is_array($events) && !$xmlOk) {
        return null;
    }
    list($xmlBy, $afp) = $xmlOk ? gsa_fd_events_xml($xml) : array(array(), array());
    $feedTime = $xmlOk ? gsa_fd_time(preg_replace('/\s+GMT$/', ' UTC', gsa_fd_xml_tag($xml, 'Update_Time'))) : null;
    $lookup = gsa_fd_airports();
    $airports = array();
    foreach ((is_array($events) ? $events : array()) as $a) {
        $id = strtoupper(gsa_fd_str($a['airportId'] ?? ''));
        if ($id === '') {
            continue;
        }
        $airports[$id] = array('code' => $id, 'name' => gsa_fd_str($a['airportLongName'] ?? ''), 'lat' => is_numeric($a['latitude'] ?? null) ? (float) $a['latitude'] : null,
            'lon' => is_numeric($a['longitude'] ?? null) ? (float) $a['longitude'] : null, 'events' => gsa_fd_events_json($a));
        $cfg = $a['airportConfig'] ?? null;
        if (is_array($cfg)) {
            $airports[$id]['config'] = array('arr' => gsa_fd_str($cfg['arrivalRunwayConfig'] ?? ''), 'dep' => gsa_fd_str($cfg['departureRunwayConfig'] ?? ''), 'rate' => is_numeric($cfg['arrivalRate'] ?? null) ? (int) $cfg['arrivalRate'] : null);
        }
    }
    // XML events the JSON does not already carry (same airport and kind).
    foreach ($xmlBy as $id => $list) {
        if (!isset($airports[$id])) {
            $airports[$id] = array('code' => $id, 'name' => '', 'lat' => null, 'lon' => null, 'events' => array());
        }
        $have = array();
        foreach ($airports[$id]['events'] as $e) {
            $have[$e['kind']] = true;
        }
        foreach ($list as $e) {
            if (empty($have[$e['kind']])) {
                $airports[$id]['events'][] = $e;
            }
        }
    }
    $rank = array('closure' => 6, 'groundstop' => 5, 'gdp' => 4, 'arrival' => 3, 'departure' => 3, 'deicing' => 2, 'notice' => 1);
    $out = array();
    $noLocation = array();
    $counts = array('closure' => 0, 'groundstop' => 0, 'gdp' => 0, 'arrival' => 0, 'departure' => 0, 'deicing' => 0, 'notice' => 0);
    foreach ($airports as $id => $a) {
        if (!$a['events']) {
            continue;
        }
        $k = $lookup[$id] ?? null;
        if ($a['lat'] === null && $k) {
            $a['lat'] = (float) $k[3];
            $a['lon'] = (float) $k[4];
        }
        $a['name'] = $a['name'] !== '' ? $a['name'] : ($k ? $k[0] : '');
        $a['city'] = $k ? $k[1] : '';
        $a['state'] = $k ? $k[2] : '';
        usort($a['events'], function ($x, $y) use ($rank) {
            return ($rank[$y['kind']] ?? 0) - ($rank[$x['kind']] ?? 0);
        });
        $a['top'] = $a['events'][0]['kind'];
        foreach ($a['events'] as $e) {
            $counts[$e['kind']] = ($counts[$e['kind']] ?? 0) + 1;
        }
        if ($a['lat'] === null || $a['lon'] === null) {
            $noLocation[] = $a;
            continue;
        }
        $out[] = $a;
    }
    usort($out, function ($x, $y) use ($rank) {
        return ($rank[$y['top']] ?? 0) - ($rank[$x['top']] ?? 0) ?: strcmp($x['code'], $y['code']);
    });
    $delayed = 0;
    foreach (array_merge($out, $noLocation) as $a) {
        if ($a['top'] !== 'notice') {
            $delayed++;
        }
    }
    return array(
        'source' => 'FAA National Airspace System Status (nasstatus.faa.gov)',
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'feedUpdated' => $feedTime ? gmdate('Y-m-d\TH:i:s\Z', $feedTime) : null,
        'airports' => $out,
        'noLocation' => $noLocation,
        'afp' => $afp,
        'counts' => array('airports' => count($out) + count($noLocation), 'withDelays' => $delayed, 'events' => $counts, 'afp' => count($afp)),
        'feeds' => array('json' => is_array($events), 'xml' => $xmlOk),
    );
}

function gsa_fd_refresh($opts = array())
{
    global $dataDir;
    $maxAge = (int) ($opts['maxAge'] ?? 270);
    $cached = gsa_fd_cache_read();
    if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
        return array('ok' => true, 'skipped' => true);
    }
    $lock = fopen($dataDir . '/flight-delays.lock', 'c');
    if (!$lock) {
        return array('ok' => false, 'error' => 'no lock file');
    }
    if (!flock($lock, !empty($opts['wait']) ? LOCK_EX : (LOCK_EX | LOCK_NB))) {
        fclose($lock);
        return array('ok' => true, 'busy' => true);
    }
    try {
        $cached = gsa_fd_cache_read();
        if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
            return array('ok' => true, 'skipped' => true);
        }
        $t0 = microtime(true);
        $built = gsa_fd_build();
        if ($built === null) {
            if ($cached) {
                $cached['lastError'] = 'The FAA NAS Status feed did not answer at ' . gmdate('H:i\Z');
                gsa_atomic_write(gsa_fd_cache_file(), json_encode($cached));
            }
            return array('ok' => false, 'error' => 'FAA NAS Status feed did not answer');
        }
        $built['fetchedAt'] = time();
        gsa_atomic_write(gsa_fd_cache_file(), json_encode($built));
        return array('ok' => true, 'airports' => $built['counts']['airports'], 'delayed' => $built['counts']['withDelays'], 'ms' => (int) round((microtime(true) - $t0) * 1000));
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function gsa_fd_snapshot()
{
    $cached = gsa_fd_cache_read();
    $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    if ($age > 600) {
        gsa_fd_refresh(array('maxAge' => 600, 'wait' => !$cached));
        $cached = gsa_fd_cache_read();
        $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    }
    if (!$cached) {
        return array('source' => 'FAA National Airspace System Status (nasstatus.faa.gov)', 'updated' => gmdate('Y-m-d\TH:i:s\Z'), 'stale' => false,
            'error' => 'The FAA NAS Status feed did not answer. Try again in a few minutes.', 'airports' => array(), 'noLocation' => array(), 'afp' => array(),
            'counts' => array('airports' => 0, 'withDelays' => 0, 'events' => array(), 'afp' => 0));
    }
    unset($cached['fetchedAt']);
    $cached['stale'] = $age > 1200;
    $cached['ageSeconds'] = $age;
    return $cached;
}

// ---------------------------------------------------------------------------
// HEALTH & HUMANITARIAN > USA AIR QUALITY
// EPA AirNow current monitors (ozone, PM2.5, PM10; ArcGIS FeatureServer, hourly)
// plus NOAA Hazard Mapping System smoke plumes (daily KML, updated through the day).
// Cache: data/airquality-cache.json, refreshed by the */5 aircraft cron about every
// 15 minutes (gsa_aq_refresh), served at /api/air-quality.
// ---------------------------------------------------------------------------

function gsa_aq_cache_file()
{
    global $dataDir;
    return $dataDir . '/airquality-cache.json';
}

function gsa_aq_cache_read()
{
    $file = gsa_aq_cache_file();
    if (!is_file($file)) {
        return null;
    }
    $cached = json_decode((string) file_get_contents($file), true);
    return is_array($cached) ? $cached : null;
}

// US state / territory FIPS codes -> postal abbreviations.
function gsa_aq_fips()
{
    return array(
        '01' => 'AL', '02' => 'AK', '04' => 'AZ', '05' => 'AR', '06' => 'CA', '08' => 'CO', '09' => 'CT', '10' => 'DE', '11' => 'DC',
        '12' => 'FL', '13' => 'GA', '15' => 'HI', '16' => 'ID', '17' => 'IL', '18' => 'IN', '19' => 'IA', '20' => 'KS', '21' => 'KY',
        '22' => 'LA', '23' => 'ME', '24' => 'MD', '25' => 'MA', '26' => 'MI', '27' => 'MN', '28' => 'MS', '29' => 'MO', '30' => 'MT',
        '31' => 'NE', '32' => 'NV', '33' => 'NH', '34' => 'NJ', '35' => 'NM', '36' => 'NY', '37' => 'NC', '38' => 'ND', '39' => 'OH',
        '40' => 'OK', '41' => 'OR', '42' => 'PA', '44' => 'RI', '45' => 'SC', '46' => 'SD', '47' => 'TN', '48' => 'TX', '49' => 'UT',
        '50' => 'VT', '51' => 'VA', '53' => 'WA', '54' => 'WV', '55' => 'WI', '56' => 'WY', '60' => 'AS', '66' => 'GU', '69' => 'MP',
        '72' => 'PR', '78' => 'VI',
    );
}

// The AirNow layer also carries Canada, Mexico, and U.S. embassy monitors abroad.
// Keep US monitors only: 9-character AQS ids that start with a US state / territory
// code, 12-character ids with the US (840) or Puerto Rico (630) country code, and
// tribal monitors (TT...). Returns the state code, '' for tribal, or null for non-US.
function gsa_aq_us_state($aqsid)
{
    $id = (string) $aqsid;
    $fips = gsa_aq_fips();
    if (strlen($id) === 9 && ctype_digit($id)) {
        return $fips[substr($id, 0, 2)] ?? null;
    }
    if (strlen($id) === 12 && substr($id, 0, 3) === '840') {
        return $fips[substr($id, 3, 2)] ?? null;
    }
    if (strlen($id) === 12 && substr($id, 0, 3) === '630') {
        return 'PR';
    }
    if (strncmp($id, 'TT', 2) === 0) {
        return '';
    }
    return null;
}

function gsa_aq_num($v)
{
    if ($v === null || $v === '' || !is_numeric($v)) {
        return null;
    }
    return (int) round((float) $v);
}

function gsa_aq_airnow()
{
    $base = 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Air_Now_Current_Monitors_Ozone_and_PM/FeatureServer/0/query';
    $fields = 'AQSID,SiteName,DataSource,ReportingArea_PipeDelimited,OZONEPM_AQI,OZONE_AQI,PM25_AQI,PM10_AQI,PM25,OZONE,PM10,ValidTime,LocalTimeString,MonitorType,Status';
    $rows = array();
    $page = 2000;
    for ($offset = 0, $guard = 0; $guard < 10; $guard++, $offset += $page) {
        $url = $base . '?' . http_build_query(array(
            'where' => "Status='Active'", 'outFields' => $fields, 'outSR' => 4326, 'returnGeometry' => 'true',
            'orderByFields' => 'ObjectId', 'resultOffset' => $offset, 'resultRecordCount' => $page, 'f' => 'json',
        ));
        $got = gsa_tfr_fetch(array('p' => $url), 40, 1);
        $body = $got['p'] ?? null;
        $data = $body ? json_decode($body, true) : null;
        if (!is_array($data) || !isset($data['features']) || isset($data['error'])) {
            return null;
        }
        foreach ($data['features'] as $f) {
            $rows[] = $f;
        }
        if (empty($data['exceededTransferLimit']) && count($data['features']) < $page) {
            break;
        }
    }
    $monitors = array();
    $tribal = array();
    foreach ($rows as $f) {
        $a = $f['attributes'] ?? array();
        $g = $f['geometry'] ?? array();
        $state = gsa_aq_us_state($a['AQSID'] ?? '');
        if ($state === null || !isset($g['x'], $g['y'])) {
            continue;
        }
        $aqi = gsa_aq_num($a['OZONEPM_AQI'] ?? null);
        $parts = array('Ozone' => gsa_aq_num($a['OZONE_AQI'] ?? null), 'PM2.5' => gsa_aq_num($a['PM25_AQI'] ?? null), 'PM10' => gsa_aq_num($a['PM10_AQI'] ?? null));
        $primary = null;
        if ($aqi !== null) {
            $best = -1;
            foreach ($parts as $name => $v) {
                if ($v !== null && $v > $best) {
                    $best = $v;
                    $primary = $name;
                }
            }
        }
        $area = trim((string) ($a['ReportingArea_PipeDelimited'] ?? ''));
        if ($area !== '') {
            $area = trim(explode('|', $area)[0]);
        }
        $m = array(
            'id' => (string) $a['AQSID'],
            'name' => trim((string) ($a['SiteName'] ?? '')),
            'agency' => trim((string) ($a['DataSource'] ?? '')),
            'area' => $area,
            'state' => $state,
            'lat' => round((float) $g['y'], 4),
            'lon' => round((float) $g['x'], 4),
            'aqi' => $aqi,
            'primary' => $primary,
            'o3' => $parts['Ozone'],
            'pm25' => $parts['PM2.5'],
            'pm10' => $parts['PM10'],
            'time' => !empty($a['ValidTime']) ? (int) floor($a['ValidTime'] / 1000) : null,
            'temp' => ($a['MonitorType'] ?? '') === 'Temporary',
        );
        if ($state === '') {
            $tribal[] = count($monitors);
        }
        $monitors[] = $m;
    }
    // Tribal monitors have no state in their id; the card names the tribe (agency) and area.
    foreach ($tribal as $i) {
        $monitors[$i]['tribal'] = true;
    }
    // Compact: agency names repeat, so send each once and point to it by index.
    $agencies = array();
    $agencyIndex = array();
    foreach ($monitors as $i => $m) {
        if (!isset($agencyIndex[$m['agency']])) {
            $agencyIndex[$m['agency']] = count($agencies);
            $agencies[] = $m['agency'];
        }
        $m['ag'] = $agencyIndex[$m['agency']];
        unset($m['agency']);
        foreach (array('o3', 'pm25', 'pm10', 'primary', 'aqi') as $k) {
            if ($m[$k] === null) {
                unset($m[$k]);
            }
        }
        if (empty($m['temp'])) {
            unset($m['temp']);
        }
        if ($m['area'] === '') {
            unset($m['area']);
        }
        $monitors[$i] = $m;
    }
    return array('monitors' => $monitors, 'agencies' => $agencies, 'feedCount' => count($rows));
}

// "2026329 1610UTC" (year, day of year, HHMM) -> unix seconds.
function gsa_aq_hms_time($text)
{
    if (!preg_match('/(\d{4})(\d{3})\s+(\d{2})(\d{2})/', (string) $text, $m)) {
        return null;
    }
    return gmmktime((int) $m[3], (int) $m[4], 0, 1, (int) $m[2], (int) $m[1]);
}

// Douglas-Peucker on [lon, lat] points (degrees).
function gsa_aq_simplify($pts, $tol)
{
    $n = count($pts);
    if ($n < 3) {
        return $pts;
    }
    $keep = array_fill(0, $n, false);
    $keep[0] = $keep[$n - 1] = true;
    $stack = array(array(0, $n - 1));
    while ($stack) {
        list($s, $e) = array_pop($stack);
        $ax = $pts[$s][0];
        $ay = $pts[$s][1];
        $dx = $pts[$e][0] - $ax;
        $dy = $pts[$e][1] - $ay;
        $len = sqrt($dx * $dx + $dy * $dy);
        $maxD = 0;
        $idx = -1;
        for ($i = $s + 1; $i < $e; $i++) {
            $px = $pts[$i][0] - $ax;
            $py = $pts[$i][1] - $ay;
            $d = $len > 0 ? abs($dx * $py - $dy * $px) / $len : sqrt($px * $px + $py * $py);
            if ($d > $maxD) {
                $maxD = $d;
                $idx = $i;
            }
        }
        if ($idx > 0 && $maxD > $tol) {
            $keep[$idx] = true;
            $stack[] = array($s, $idx);
            $stack[] = array($idx, $e);
        }
    }
    $out = array();
    foreach ($pts as $i => $p) {
        if ($keep[$i]) {
            $out[] = $p;
        }
    }
    return $out;
}

function gsa_aq_smoke_parse($kml)
{
    $plumes = array();
    if (!preg_match_all('#<Placemark>(.*?)</Placemark>#s', $kml, $pm)) {
        return $plumes;
    }
    foreach ($pm[1] as $block) {
        $desc = preg_match('#<description>(.*?)</description>#s', $block, $m) ? $m[1] : '';
        $desc = strip_tags(str_replace(array('<br>', '<br/>', '<br />'), "\n", html_entity_decode(str_replace(array('<![CDATA[', ']]>'), '', $desc), ENT_QUOTES | ENT_XML1, 'UTF-8')));
        $density = preg_match('/Density:\s*(Light|Medium|Heavy)/i', $desc, $m) ? ucfirst(strtolower($m[1])) : null;
        if ($density === null && preg_match('#<styleUrl>\#?Smoke_(Light|Medium|Heavy)#', $block, $m)) {
            $density = $m[1];
        }
        if ($density === null) {
            continue;
        }
        $start = preg_match('/Start Time:\s*([0-9]{7}\s+[0-9]{4})/i', $desc, $m) ? gsa_aq_hms_time($m[1]) : null;
        $end = preg_match('/End Time:\s*([0-9]{7}\s+[0-9]{4})/i', $desc, $m) ? gsa_aq_hms_time($m[1]) : null;
        $sat = preg_match('/Satellite:\s*([^\n]+)/i', $desc, $m) ? trim($m[1]) : '';
        if (!preg_match_all('#<outerBoundaryIs>.*?<coordinates>(.*?)</coordinates>#s', $block, $rings)) {
            continue;
        }
        foreach ($rings[1] as $text) {
            $pts = array();
            foreach (preg_split('/\s+/', trim($text)) as $tok) {
                $xy = explode(',', $tok);
                if (count($xy) >= 2 && is_numeric($xy[0]) && is_numeric($xy[1])) {
                    $pts[] = array((float) $xy[0], (float) $xy[1]);
                }
            }
            if (count($pts) < 4) {
                continue;
            }
            $simple = gsa_aq_simplify($pts, 0.03);
            if (count($simple) < 4) {
                $simple = gsa_aq_simplify($pts, 0.005);
            }
            if (count($simple) < 4) {
                continue;
            }
            $ring = array();
            $sx = $sy = 0;
            foreach ($simple as $p) {
                $ring[] = array(round($p[0], 3), round($p[1], 3));
                $sx += $p[0];
                $sy += $p[1];
            }
            $plumes[] = array(
                'density' => $density,
                'start' => $start,
                'end' => $end,
                'satellite' => $sat,
                'lat' => round($sy / count($simple), 3),
                'lon' => round($sx / count($simple), 3),
                'ring' => $ring,
            );
        }
    }
    return $plumes;
}

// Today's UTC file is posted once analysts start mapping (usually mid-morning ET);
// until then, use yesterday's.
function gsa_aq_smoke()
{
    $base = 'https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/';
    foreach (array(0, 1) as $back) {
        $t = time() - $back * 86400;
        $day = gmdate('Ymd', $t);
        $url = $base . gmdate('Y/m', $t) . '/hms_smoke' . $day . '.kml';
        $got = gsa_tfr_fetch(array('k' => $url), 40, 1);
        $kml = $got['k'] ?? null;
        if (!$kml || strpos($kml, '<kml') === false) {
            continue;
        }
        return array('date' => substr($day, 0, 4) . '-' . substr($day, 4, 2) . '-' . substr($day, 6, 2), 'plumes' => gsa_aq_smoke_parse($kml));
    }
    return null;
}

function gsa_aq_band($aqi)
{
    if ($aqi === null) {
        return 'none';
    }
    if ($aqi <= 50) {
        return 'good';
    }
    if ($aqi <= 100) {
        return 'moderate';
    }
    if ($aqi <= 150) {
        return 'usg';
    }
    if ($aqi <= 200) {
        return 'unhealthy';
    }
    if ($aqi <= 300) {
        return 'veryunhealthy';
    }
    return 'hazardous';
}

function gsa_aq_build($previous = null)
{
    $air = gsa_aq_airnow();
    if ($air === null) {
        return null;
    }
    $smoke = gsa_aq_smoke();
    $smokeError = null;
    if ($smoke === null) {
        $smokeError = 'NOAA HMS smoke file did not answer at ' . gmdate('H:i\Z');
        $smoke = ($previous && isset($previous['smoke'])) ? $previous['smoke'] : array('date' => null, 'plumes' => array());
    }
    $bands = array('good' => 0, 'moderate' => 0, 'usg' => 0, 'unhealthy' => 0, 'veryunhealthy' => 0, 'hazardous' => 0, 'none' => 0);
    $obs = 0;
    foreach ($air['monitors'] as $m) {
        $bands[gsa_aq_band($m['aqi'] ?? null)]++;
        if ($m['time'] && $m['time'] > $obs) {
            $obs = $m['time'];
        }
    }
    $dens = array('Light' => 0, 'Medium' => 0, 'Heavy' => 0);
    foreach ($smoke['plumes'] as $p) {
        $dens[$p['density']]++;
    }
    $out = array(
        'source' => 'EPA AirNow & NOAA HMS Smoke',
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'observed' => $obs ? gmdate('Y-m-d\TH:i:s\Z', $obs) : null,
        'monitors' => $air['monitors'],
        'agencies' => $air['agencies'],
        'smoke' => $smoke,
        'counts' => array('monitors' => count($air['monitors']), 'feedMonitors' => $air['feedCount'], 'bands' => $bands, 'plumes' => count($smoke['plumes']), 'density' => $dens),
    );
    if ($smokeError) {
        $out['smokeError'] = $smokeError;
    }
    return $out;
}

function gsa_aq_refresh($opts = array())
{
    global $dataDir;
    $maxAge = (int) ($opts['maxAge'] ?? 870);
    $cached = gsa_aq_cache_read();
    if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
        return array('ok' => true, 'skipped' => true);
    }
    $lock = fopen($dataDir . '/airquality.lock', 'c');
    if (!$lock) {
        return array('ok' => false, 'error' => 'no lock file');
    }
    if (!flock($lock, !empty($opts['wait']) ? LOCK_EX : (LOCK_EX | LOCK_NB))) {
        fclose($lock);
        return array('ok' => true, 'busy' => true);
    }
    try {
        $cached = gsa_aq_cache_read();
        if (empty($opts['force']) && $cached && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $maxAge) {
            return array('ok' => true, 'skipped' => true);
        }
        $t0 = microtime(true);
        $built = gsa_aq_build($cached);
        if ($built === null) {
            if ($cached) {
                $cached['lastError'] = 'EPA AirNow did not answer at ' . gmdate('H:i\Z');
                gsa_atomic_write(gsa_aq_cache_file(), json_encode($cached));
            }
            return array('ok' => false, 'error' => 'EPA AirNow did not answer');
        }
        $built['fetchedAt'] = time();
        gsa_atomic_write(gsa_aq_cache_file(), json_encode($built));
        return array('ok' => true, 'monitors' => $built['counts']['monitors'], 'plumes' => $built['counts']['plumes'], 'ms' => (int) round((microtime(true) - $t0) * 1000));
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function gsa_aq_snapshot()
{
    $cached = gsa_aq_cache_read();
    $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    if ($age > 1800) {
        gsa_aq_refresh(array('maxAge' => 1800, 'wait' => !$cached));
        $cached = gsa_aq_cache_read();
        $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    }
    if (!$cached) {
        return array('source' => 'EPA AirNow & NOAA HMS Smoke', 'updated' => gmdate('Y-m-d\TH:i:s\Z'), 'stale' => false,
            'error' => 'EPA AirNow did not answer. Try again in a few minutes.', 'monitors' => array(), 'agencies' => array(), 'smoke' => array('date' => null, 'plumes' => array()),
            'counts' => array('monitors' => 0, 'bands' => array(), 'plumes' => 0, 'density' => array()));
    }
    unset($cached['fetchedAt']);
    $cached['stale'] = $age > 3600;
    $cached['ageSeconds'] = $age;
    return $cached;
}
