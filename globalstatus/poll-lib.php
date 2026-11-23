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
