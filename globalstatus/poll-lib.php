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
