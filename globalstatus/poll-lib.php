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
