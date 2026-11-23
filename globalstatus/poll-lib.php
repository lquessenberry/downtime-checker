<?php
// Cache and scan-snapshot helpers for the one-user polling runner (#34).
// HTTP visitors only read these files. The runner (cron) is the only writer.

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
        gsa_atomic_write($file, json_encode($prev));
        return array(
            'changed' => false,
            'bytes' => filesize($file),
            'fingerprint' => $fp,
            'count' => isset($prev['count']) ? $prev['count'] : (isset($prev['points']) ? count($prev['points']) : 0),
        );
    }
    $payload['fetchedAt'] = $now;
    $payload['stale'] = false;
    $body = json_encode($payload);
    if ($body === false || !gsa_atomic_write($file, $body)) {
        return array('changed' => false, 'error' => 'Could not save ' . basename($file));
    }
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
