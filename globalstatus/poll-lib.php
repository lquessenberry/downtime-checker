<?php
// Cache and scan-snapshot helpers for the one-user polling runner (#34).
// HTTP visitors only read these files. The runner is the only writer.

function gsa_runner_mode()
{
    return defined('GSA_RUNNER') && GSA_RUNNER;
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

function gsa_cache_serve($file, $ttl)
{
    if (!is_file($file)) {
        return null;
    }
    $cached = json_decode((string) file_get_contents($file), true);
    if (!is_array($cached)) {
        return null;
    }
    $fetched = (int) ($cached['fetchedAt'] ?? filemtime($file));
    unset($cached['fetchedAt']);
    $cached['stale'] = (time() - $fetched) >= $ttl;
    $cached['ageSec'] = max(0, time() - $fetched);
    return $cached;
}

function gsa_cache_put($file, $payload)
{
    $prev = null;
    if (is_file($file)) {
        $prev = json_decode((string) file_get_contents($file), true);
    }
    $fp = gsa_fingerprint($payload);
    $same = is_array($prev) && gsa_fingerprint($prev) === $fp;
    $now = time();
    if ($same) {
        $prev['fetchedAt'] = $now;
        $prev['updated'] = $payload['updated'] ?? gmdate('Y-m-d\TH:i:s\Z');
        $prev['stale'] = false;
        file_put_contents($file, json_encode($prev), LOCK_EX);
        return array(
            'changed' => false,
            'bytes' => filesize($file),
            'fingerprint' => $fp,
            'count' => isset($prev['count']) ? $prev['count'] : (isset($prev['points']) ? count($prev['points']) : 0),
        );
    }
    $payload['fetchedAt'] = $now;
    $payload['stale'] = false;
    file_put_contents($file, json_encode($payload), LOCK_EX);
    return array(
        'changed' => true,
        'bytes' => filesize($file),
        'fingerprint' => $fp,
        'count' => isset($payload['count']) ? $payload['count'] : (isset($payload['points']) ? count($payload['points']) : 0),
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
    $all['jobs'][$job] = $info;
    $all['updated'] = $info['at'];
    file_put_contents(gsa_poll_status_file(), json_encode($all), LOCK_EX);
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

function gsa_awaiting($source, $sourceUrl, $error)
{
    return array(
        'source' => $source,
        'sourceUrl' => $sourceUrl,
        'updated' => null,
        'stale' => true,
        'error' => $error,
        'count' => 0,
        'points' => array(),
    );
}

function gsa_filter_scan_state($snap, $id, $country)
{
    if (!is_array($snap)) {
        $empty = blank_state();
        $empty['replay'] = true;
        $empty['pending'] = true;
        return $empty;
    }
    if ($id === '' || $id === 'everything') {
        $out = $snap;
        $out['searchId'] = $id !== '' ? $id : ($snap['searchId'] ?? 'everything');
        $out['replay'] = true;
        $out['running'] = false;
        return $out;
    }
    $results = array();
    $up = 0;
    $down = 0;
    foreach (($snap['results'] ?? array()) as $row) {
        if (!is_array($row) || empty($row['address'])) {
            continue;
        }
        if (!target_matches($row, $id, $country)) {
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
    $heading = $id === 'country' ? $country : catalog_label($id);
    return array(
        'running' => false,
        'scanId' => $snap['scanId'] ?? 0,
        'heading' => $heading,
        'searchId' => $id,
        'country' => $country,
        'total' => count($results),
        'done' => count($results),
        'up' => $up,
        'down' => $down,
        'startedAt' => $snap['startedAt'] ?? 0,
        'finishedAt' => $snap['finishedAt'] ?? 0,
        'replay' => true,
        'sourceScan' => $snap['searchId'] ?? 'everything',
        'results' => $results,
    );
}

// Aircraft hex detail: HTTP visitors only read cache. The runner fetches
// upstream at most once every AIRCRAFT_DETAIL_TTL seconds per source.

define('GSA_AIRCRAFT_DETAIL_TTL', 300);
define('GSA_AIRCRAFT_DETAIL_SOURCES', 'adsb.lol,planespotters.net,adsb.im');

function gsa_aircraft_detail_dir()
{
    global $dataDir;
    $dir = $dataDir . '/aircraft-detail';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function gsa_aircraft_detail_cache_file($hex)
{
    return gsa_aircraft_detail_dir() . '/' . $hex . '.json';
}

function gsa_aircraft_detail_queue_file()
{
    global $dataDir;
    return $dataDir . '/aircraft-detail-queue.json';
}

function gsa_aircraft_detail_rate_file()
{
    global $dataDir;
    return $dataDir . '/aircraft-detail-rate.json';
}

function gsa_aircraft_detail_envelope($hex, $overrides = array())
{
    $base = array(
        'hex' => $hex,
        'live' => null,
        'photo' => null,
        'route' => null,
        'typeInfo' => null,
        'stale' => true,
        'queued' => false,
        'error' => null,
        'source' => 'runner-cache',
        'fetchedAt' => null,
        'sourcesFetchedAt' => array(),
    );
    return array_merge($base, $overrides);
}

function gsa_aircraft_detail_read($hex)
{
    $file = gsa_aircraft_detail_cache_file($hex);
    if (!is_file($file)) {
        return null;
    }
    $cached = json_decode((string) file_get_contents($file), true);
    return is_array($cached) ? $cached : null;
}

function gsa_aircraft_detail_write($hex, $payload)
{
    $payload['hex'] = $hex;
    $payload['fetchedAt'] = (int) ($payload['fetchedAt'] ?? time());
    $payload['source'] = 'runner-cache';
    file_put_contents(gsa_aircraft_detail_cache_file($hex), json_encode($payload), LOCK_EX);
    return $payload;
}

function gsa_aircraft_detail_enqueue($hex, $query = array())
{
    $hex = strtolower($hex);
    $file = gsa_aircraft_detail_queue_file();
    $queue = array('hexes' => array());
    if (is_file($file)) {
        $decoded = json_decode((string) file_get_contents($file), true);
        if (is_array($decoded) && isset($decoded['hexes']) && is_array($decoded['hexes'])) {
            $queue = $decoded;
        }
    }
    $prev = $queue['hexes'][$hex] ?? array();
    $hints = is_array($prev) ? $prev : array();
    $hints['hex'] = $hex;
    $hints['queuedAt'] = $hints['queuedAt'] ?? time();
    foreach (array('callsign', 'type', 'lat', 'lon') as $key) {
        if (isset($query[$key]) && $query[$key] !== '' && $query[$key] !== null) {
            $hints[$key] = $query[$key];
        }
    }
    $queue['hexes'][$hex] = $hints;
    file_put_contents($file, json_encode($queue), LOCK_EX);
    return $hints;
}

function gsa_aircraft_detail_dequeue($hex)
{
    $file = gsa_aircraft_detail_queue_file();
    if (!is_file($file)) {
        return;
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    if (!is_array($decoded) || !isset($decoded['hexes'][$hex])) {
        return;
    }
    unset($decoded['hexes'][$hex]);
    file_put_contents($file, json_encode($decoded), LOCK_EX);
}

function gsa_aircraft_detail_queue_read()
{
    $file = gsa_aircraft_detail_queue_file();
    if (!is_file($file)) {
        return array();
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    if (!is_array($decoded) || !isset($decoded['hexes']) || !is_array($decoded['hexes'])) {
        return array();
    }
    return $decoded['hexes'];
}

function gsa_aircraft_source_due($rates, $source, $now, $interval = GSA_AIRCRAFT_DETAIL_TTL)
{
    $last = (int) ($rates[$source] ?? 0);
    return ($now - $last) >= $interval;
}

function gsa_aircraft_detail_plan($queue, $rates, $now, $interval = GSA_AIRCRAFT_DETAIL_TTL, $cachedByHex = array())
{
    $sources = explode(',', GSA_AIRCRAFT_DETAIL_SOURCES);
    $plan = array();
    $used = array();
    // Oldest queued hex first.
    $items = array_values($queue);
    usort($items, function ($a, $b) {
        return ((int) ($a['queuedAt'] ?? 0)) <=> ((int) ($b['queuedAt'] ?? 0));
    });
    foreach ($sources as $source) {
        if (!gsa_aircraft_source_due($rates, $source, $now, $interval)) {
            continue;
        }
        foreach ($items as $item) {
            $hex = strtolower((string) ($item['hex'] ?? ''));
            if ($hex === '' || isset($used[$source])) {
                continue;
            }
            $cached = $cachedByHex[$hex] ?? null;
            $srcAt = is_array($cached) ? (int) (($cached['sourcesFetchedAt'][$source] ?? 0)) : 0;
            if ($srcAt && ($now - $srcAt) < $interval) {
                continue;
            }
            $plan[] = array('hex' => $hex, 'source' => $source, 'hints' => $item);
            $used[$source] = $hex;
        }
    }
    return $plan;
}

function gsa_aircraft_parse_adsb($live)
{
    if (is_array($live) && !empty($live['ac'][0]) && is_array($live['ac'][0])) {
        return $live['ac'][0];
    }
    return null;
}

function gsa_aircraft_parse_photos($photos)
{
    if (!is_array($photos) || empty($photos['photos'][0]) || !is_array($photos['photos'][0])) {
        return null;
    }
    $photo = $photos['photos'][0];
    $thumb = $photo['thumbnail_large'] ?? ($photo['thumbnail'] ?? array());
    $src = is_array($thumb) ? (string) ($thumb['src'] ?? '') : '';
    if (strpos($src, 'https://') !== 0) {
        return null;
    }
    return array(
        'src' => $src,
        'link' => $photo['link'] ?? '',
        'photographer' => $photo['photographer'] ?? '',
    );
}

function gsa_aircraft_parse_routes($routes)
{
    if (!is_array($routes) || !isset($routes[0]) || !is_array($routes[0]) || ($routes[0]['plausible'] ?? true) === false) {
        return null;
    }
    $route = $routes[0];
    $iata = (string) ($route['_airport_codes_iata'] ?? '');
    $icao = (string) ($route['airport_codes'] ?? '');
    if (strtolower($iata) === 'unknown') {
        $iata = '';
    }
    if (strtolower($icao) === 'unknown') {
        $icao = '';
    }
    if ($iata === '' && $icao === '') {
        return null;
    }
    return array(
        'iata' => $iata,
        'icao' => $icao,
        'airline' => $route['airline_code'] ?? '',
    );
}

function gsa_aircraft_detail_typeinfo($typeCode)
{
    $typeCode = strtoupper(trim((string) $typeCode));
    if ($typeCode === '') {
        return null;
    }
    global $root;
    $path = ($root ?: dirname(__DIR__) . '/globalstatus') . '/api/icao_aircraft_types.json';
    if (!is_file($path)) {
        return null;
    }
    $types = json_decode((string) @file_get_contents($path), true);
    if (!is_array($types) || !isset($types[$typeCode]) || !is_array($types[$typeCode])) {
        return null;
    }
    return array(
        'desc' => $types[$typeCode]['desc'] ?? '',
        'wtc' => $types[$typeCode]['wtc'] ?? '',
    );
}

function gsa_aircraft_detail_serve($hex, $query = array(), $ttl = GSA_AIRCRAFT_DETAIL_TTL)
{
    $hex = strtolower($hex);
    $cached = gsa_aircraft_detail_read($hex);
    $now = time();
    $stale = true;
    if (is_array($cached)) {
        $fetched = (int) ($cached['fetchedAt'] ?? 0);
        $stale = !$fetched || ($now - $fetched) >= $ttl;
        $cached['stale'] = $stale;
        $cached['ageSec'] = $fetched ? max(0, $now - $fetched) : null;
        $cached['queued'] = $stale;
        if (empty($cached['typeInfo'])) {
            $typeCode = '';
            if (is_array($cached['live'] ?? null)) {
                $typeCode = (string) ($cached['live']['t'] ?? '');
            }
            if ($typeCode === '' && isset($query['type'])) {
                $typeCode = (string) $query['type'];
            }
            $info = gsa_aircraft_detail_typeinfo($typeCode);
            if ($info) {
                $cached['typeInfo'] = $info;
            }
        }
    }
    if (!is_array($cached) || $stale) {
        gsa_aircraft_detail_enqueue($hex, $query);
    }
    if (is_array($cached)) {
        return $cached;
    }
    return gsa_aircraft_detail_envelope($hex, array(
        'queued' => true,
        'stale' => true,
        'error' => 'Awaiting poller',
        'typeInfo' => gsa_aircraft_detail_typeinfo($query['type'] ?? ''),
    ));
}

function gsa_aircraft_detail_apply_source($cached, $source, $parsed, $now)
{
    if (!is_array($cached)) {
        $cached = gsa_aircraft_detail_envelope('');
    }
    if (!isset($cached['sourcesFetchedAt']) || !is_array($cached['sourcesFetchedAt'])) {
        $cached['sourcesFetchedAt'] = array();
    }
    $cached['sourcesFetchedAt'][$source] = $now;
    $cached['fetchedAt'] = $now;
    $cached['stale'] = false;
    $cached['queued'] = false;
    if ($source === 'adsb.lol') {
        $cached['live'] = $parsed;
    } elseif ($source === 'planespotters.net') {
        $cached['photo'] = $parsed;
    } elseif ($source === 'adsb.im') {
        $cached['route'] = $parsed;
    }
    $missing = array();
    if (empty($cached['live'])) {
        $missing[] = 'adsb.lol';
    }
    if (empty($cached['photo'])) {
        $missing[] = 'planespotters.net';
    }
    $cached['error'] = null;
    return $cached;
}
