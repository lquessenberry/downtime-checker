<?php
// Hash, write-only-on-change, cadence, and the layer manifest (phase 2).
// Loaded from poll-lib.php. Visitors never include this file directly.

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found\n";
    exit;
}

function gsa_hash_algo()
{
    static $algo = null;
    if ($algo === null) {
        $algos = hash_algos();
        if (in_array('xxh128', $algos, true)) {
            $algo = 'xxh128';
        } elseif (in_array('xxh3', $algos, true)) {
            $algo = 'xxh3';
        } else {
            $algo = 'sha1';
        }
    }
    return $algo;
}

// Canonical payload for change detection. Drops poll clocks so a no-op
// refresh does not look like new data. Points are keyed by id/hex and
// sorted once so hash order is stable.
function gsa_normalize_for_hash($payload)
{
    if (!is_array($payload)) {
        return $payload;
    }
    if (isset($payload['points']) && is_array($payload['points'])) {
        $core = array();
        foreach ($payload['points'] as $point) {
            if (!is_array($point)) {
                continue;
            }
            $row = $point;
            unset($row['ts'], $row['seen_pos'], $row['fetchedAt'], $row['ageSec'], $row['stale'], $row['hash']);
            $id = (string) ($row['hex'] ?? $row['id'] ?? (($row['lat'] ?? '') . ',' . ($row['lon'] ?? '') . ',' . ($row['name'] ?? '')));
            $core[$id] = $row;
        }
        ksort($core, SORT_STRING);
        return $core;
    }
    if (isset($payload['results']) && is_array($payload['results'])) {
        $core = array();
        foreach ($payload['results'] as $row) {
            if (!is_array($row)) {
                continue;
            }
            $addr = (string) ($row['address'] ?? $row['index'] ?? '');
            $core[$addr] = array(
                'address' => $addr,
                'status' => $row['status'] ?? '',
            );
        }
        ksort($core, SORT_STRING);
        return $core;
    }
    $copy = $payload;
    unset($copy['fetchedAt'], $copy['updated'], $copy['stale'], $copy['ageSec'], $copy['at'], $copy['hash']);
    return $copy;
}

function gsa_payload_hash($payload)
{
    $norm = gsa_normalize_for_hash($payload);
    $body = json_encode($norm, JSON_UNESCAPED_SLASHES);
    if ($body === false) {
        $body = serialize($norm);
    }
    return hash(gsa_hash_algo(), $body);
}

function gsa_source_from_file($file)
{
    $base = basename($file);
    $map = array(
        'scan-cache.json' => 'grid',
        'aircraft-cache.json' => 'aircraft',
        'jamming-cache.json' => 'jamming',
        'mil-cache.json' => 'mil',
        'outages-cache.json' => 'outages',
        'mesh-cache.json' => 'mesh',
        'disease-cache.json' => 'disease',
        'animal-cache.json' => 'animal',
        'space-nws.json' => 'space-nws',
        'space-hurricanes.json' => 'space-hurricanes',
        'space-wildfires.json' => 'space-wildfires',
        'space-tsunami.json' => 'space-tsunami',
        'space-rivers.json' => 'space-rivers',
        'space-coastal.json' => 'space-coastal',
        'poll-status.json' => 'poll-status',
        'manifest.json' => 'manifest',
    );
    if (isset($map[$base])) {
        return $map[$base];
    }
    if (preg_match('/^space-([a-z]+)\.json$/', $base, $m)) {
        return 'space-' . $m[1];
    }
    return preg_replace('/(-cache)?\.json$/', '', $base);
}

function gsa_source_base_ttl($name)
{
    static $ttls = array(
        'aircraft' => 300,
        'jamming' => 900,
        'mil' => 900,
        'outages' => 300,
        'mesh' => 300,
        'disease' => 300,
        'animal' => 600,
        'space-nws' => 300,
        'space-hurricanes' => 900,
        'space-wildfires' => 10800,
        'space-tsunami' => 300,
        'space-rivers' => 900,
        'space-coastal' => 900,
        'grid' => 600,
    );
    if ($name === 'mil') {
        return $ttls['mil'];
    }
    return $ttls[$name] ?? 300;
}

// Visitors should not sit on data more than about 10 minutes for 5-minute
// sources. Stretch slowly when a source keeps the same hash; never go
// faster than the base ttl.
function gsa_source_ttl_cap($name, $base)
{
    if ($name === 'grid' || $base >= 900) {
        return $base;
    }
    if ($base <= 300) {
        return 600;
    }
    if ($base <= 600) {
        return 1200;
    }
    return $base;
}

function gsa_cadence_file()
{
    global $dataDir;
    return $dataDir . '/cadence-state.json';
}

function gsa_cadence_lock_file()
{
    global $dataDir;
    return $dataDir . '/cadence-state.lock';
}

function gsa_cadence_all()
{
    $file = gsa_cadence_file();
    if (!is_file($file)) {
        return array();
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    return is_array($decoded) ? $decoded : array();
}

function gsa_cadence_read($name)
{
    $all = gsa_cadence_all();
    return isset($all[$name]) && is_array($all[$name]) ? $all[$name] : array();
}

function gsa_cadence_note($name, $hash, $changed, $extra = array())
{
    global $dataDir;
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0755, true);
    }
    $lock = fopen(gsa_cadence_lock_file(), 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    try {
        $all = gsa_cadence_all();
        $row = isset($all[$name]) && is_array($all[$name]) ? $all[$name] : array(
            'hash' => '',
            'fetchedAt' => 0,
            'changedAt' => 0,
            'unchangedStreak' => 0,
            'history' => array(),
        );
        $now = time();
        $row['hash'] = $hash;
        $row['fetchedAt'] = $now;
        $row['algo'] = gsa_hash_algo();
        if ($changed) {
            $row['changedAt'] = $now;
            $row['unchangedStreak'] = 0;
        } else {
            $row['unchangedStreak'] = (int) ($row['unchangedStreak'] ?? 0) + 1;
        }
        foreach ($extra as $k => $v) {
            $row[$k] = $v;
        }
        $hist = isset($row['history']) && is_array($row['history']) ? $row['history'] : array();
        $hist[] = array(
            'at' => gmdate('Y-m-d\TH:i:s\Z', $now),
            'hash' => $hash,
            'changed' => (bool) $changed,
        );
        if (count($hist) > 12) {
            $hist = array_slice($hist, -12);
        }
        $row['history'] = $hist;
        $all[$name] = $row;
        gsa_atomic_write(gsa_cadence_file(), json_encode($all));
        gsa_manifest_rebuild(true);
        return $row;
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

function gsa_adaptive_ttl($name)
{
    $base = max(300, gsa_source_base_ttl($name));
    if ($name === 'grid') {
        return $base;
    }
    $cap = gsa_source_ttl_cap($name, $base);
    $streak = (int) (gsa_cadence_read($name)['unchangedStreak'] ?? 0);
    if ($streak < 3) {
        return $base;
    }
    if ($streak >= 5) {
        return $cap;
    }
    return (int) round(($base + $cap) / 2);
}

function gsa_manifest_file()
{
    global $dataDir;
    return $dataDir . '/manifest.json';
}

function gsa_manifest_paths()
{
    return array(
        'aircraft' => array('file' => 'aircraft-cache.json', 'path' => '/api/aircraft'),
        'jamming' => array('file' => 'jamming-cache.json', 'path' => '/api/jamming'),
        'mil' => array('file' => 'mil-cache.json', 'path' => '/api/mil'),
        'outages' => array('file' => 'outages-cache.json', 'path' => '/api/outages'),
        'mesh' => array('file' => 'mesh-cache.json', 'path' => '/api/mesh'),
        'disease' => array('file' => 'disease-cache.json', 'path' => '/api/disease'),
        'animal' => array('file' => 'animal-cache.json', 'path' => '/api/animal'),
        'space-nws' => array('file' => 'space-nws.json', 'path' => '/api/space/nws'),
        'space-hurricanes' => array('file' => 'space-hurricanes.json', 'path' => '/api/space/hurricanes'),
        'space-wildfires' => array('file' => 'space-wildfires.json', 'path' => '/api/space/wildfires'),
        'space-tsunami' => array('file' => 'space-tsunami.json', 'path' => '/api/space/tsunami'),
        'space-rivers' => array('file' => 'space-rivers.json', 'path' => '/api/space/rivers'),
        'space-coastal' => array('file' => 'space-coastal.json', 'path' => '/api/space/coastal'),
        'grid' => array('file' => 'scan-cache.json', 'path' => '/api/scan-state'),
        'poll-status' => array('file' => 'poll-status.json', 'path' => '/api/poll-status'),
    );
}

function gsa_manifest_rebuild($locked = false)
{
    global $dataDir;
    if (!is_dir($dataDir)) {
        return;
    }
    $lock = null;
    if (!$locked) {
        $lock = fopen(gsa_cadence_lock_file(), 'c');
        if ($lock) {
            flock($lock, LOCK_EX);
        }
    }
    try {
    $cadence = gsa_cadence_all();
    $layers = array();
    foreach (gsa_manifest_paths() as $name => $spec) {
        $file = $dataDir . '/' . $spec['file'];
        $row = isset($cadence[$name]) && is_array($cadence[$name]) ? $cadence[$name] : array();
        $fetched = (int) ($row['fetchedAt'] ?? 0);
        if ($fetched <= 0 && is_file($file)) {
            $fetched = (int) filemtime($file);
        }
        $changed = (int) ($row['changedAt'] ?? 0);
        $hash = (string) ($row['hash'] ?? '');
        if ($hash === '' && is_file($file . '.hash')) {
            $hash = trim((string) file_get_contents($file . '.hash'));
        }
        $layers[$name] = array(
            'hash' => $hash,
            'ts' => $fetched > 0 ? gmdate('Y-m-d\TH:i:s\Z', $fetched) : null,
            'changedAt' => $changed > 0 ? gmdate('Y-m-d\TH:i:s\Z', $changed) : null,
            'count' => isset($row['count']) ? $row['count'] : null,
            'bytes' => is_file($file) ? filesize($file) : 0,
            'ttlSec' => gsa_source_base_ttl($name),
            'pollSec' => gsa_adaptive_ttl($name),
            'path' => $spec['path'],
        );
    }
    $body = array(
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'hashAlgo' => gsa_hash_algo(),
        'layers' => $layers,
    );
    gsa_atomic_write(gsa_manifest_file(), json_encode($body, JSON_UNESCAPED_SLASHES));
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

function gsa_mil_cache_file()
{
    global $dataDir;
    return $dataDir . '/mil-cache.json';
}

function gsa_write_mil_from_aircraft($layer)
{
    $points = array();
    foreach (($layer['points'] ?? array()) as $point) {
        if (is_array($point) && !empty($point['mil'])) {
            $points[] = $point;
        }
    }
    $mil = $layer;
    $mil['points'] = $points;
    $mil['count'] = count($points);
    $mil['sourceUrl'] = 'https://api.adsb.lol/v2/mil';
    return gsa_snapshot_put(gsa_mil_cache_file(), $mil, 'mil');
}

// Write the snapshot only when the normalized hash changes. Always records
// the poll in cadence-state and refreshes the manifest.
function gsa_snapshot_put($file, $payload, $source)
{
    if (!is_array($payload)) {
        return array('changed' => false, 'error' => 'Bad payload', 'bytes' => 0, 'hash' => '');
    }
    $hash = gsa_payload_hash($payload);
    $prevHash = '';
    if (is_file($file . '.hash')) {
        $prevHash = trim((string) file_get_contents($file . '.hash'));
    } elseif (is_file($file)) {
        $prev = json_decode((string) file_get_contents($file), true);
        if (is_array($prev)) {
            $prevHash = (string) ($prev['hash'] ?? gsa_payload_hash($prev));
        }
    }
    $changed = ($hash !== $prevHash);
    $count = 0;
    if (isset($payload['points']) && is_array($payload['points'])) {
        $count = count($payload['points']);
    } elseif (isset($payload['results']) && is_array($payload['results'])) {
        $count = count($payload['results']);
    } elseif (isset($payload['count'])) {
        $count = (int) $payload['count'];
    }
    $bytes = is_file($file) ? filesize($file) : 0;
    if ($changed) {
        $payload['fetchedAt'] = time();
        $payload['stale'] = false;
        $payload['hash'] = $hash;
        if (empty($payload['updated'])) {
            $payload['updated'] = gmdate('Y-m-d\TH:i:s\Z');
        }
        $body = json_encode($payload, JSON_UNESCAPED_SLASHES);
        if ($body === false || !gsa_atomic_write($file, $body)) {
            return array('changed' => false, 'error' => 'Could not save ' . basename($file), 'bytes' => 0, 'hash' => $hash);
        }
        @file_put_contents($file . '.hash', $hash);
        $bytes = strlen($body);
    }
    gsa_cadence_note($source, $hash, $changed, array('count' => $count, 'bytes' => $bytes));
    return array(
        'changed' => $changed,
        'bytes' => $bytes,
        'fingerprint' => $hash,
        'hash' => $hash,
        'count' => $count,
    );
}

function gsa_manifest_read()
{
    $file = gsa_manifest_file();
    if (!is_file($file)) {
        return array('updated' => null, 'hashAlgo' => gsa_hash_algo(), 'layers' => array(), 'error' => 'Awaiting poller');
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    if (!is_array($decoded)) {
        return array('updated' => null, 'hashAlgo' => gsa_hash_algo(), 'layers' => array(), 'error' => 'Awaiting poller');
    }
    return $decoded;
}
