<?php
// Speed tests for the one-user cache (#34).
// Default: cache reads only (no upstream). --live hits each source once.

$root = dirname(__DIR__) . '/globalstatus';
$dataDir = $root . '/data';
require $root . '/poll-lib.php';

$live = in_array('--live', $argv, true);
$repeat = 32;

function bench_ms($fn, $times = 1)
{
    $best = null;
    $last = null;
    for ($i = 0; $i < $times; $i++) {
        $t0 = microtime(true);
        $last = $fn();
        $ms = (microtime(true) - $t0) * 1000;
        if ($best === null || $ms < $best) {
            $best = $ms;
        }
    }
    return array($best, $last);
}

function curl_once($url, $timeout = 25)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HTTPHEADER => array(
            'Accept: application/json',
            'User-Agent: GlobalStatusApp/1.0 (https://globalstatus.app; poll-bench)',
        ),
    ));
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $ms = curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000;
    $bytes = strlen((string) $body);
    curl_close($ch);
    return array(
        'url' => $url,
        'http' => $code,
        'ms' => round($ms, 1),
        'bytes' => $bytes,
        'ok' => $body !== false && $code >= 200 && $code < 400,
    );
}

$files = array(
    'outages' => $dataDir . '/outages-cache.json',
    'mil' => $dataDir . '/mil-cache.json',
    'mesh' => $dataDir . '/mesh-cache.json',
    'disease' => $dataDir . '/disease-cache.json',
    'animal' => $dataDir . '/animal-cache.json',
    'feeds-cache' => $dataDir . '/feeds-cache.json',
    'feeds-static' => $root . '/api/feeds.json',
    'scan-cache' => $dataDir . '/scan-cache.json',
);

$report = array('cache' => array(), 'concurrent' => array(), 'live' => array());

foreach ($files as $name => $file) {
    if (!is_file($file)) {
        $report['cache'][$name] = array('missing' => true);
        continue;
    }
    list($ms, $payload) = bench_ms(function () use ($file) {
        return json_decode((string) file_get_contents($file), true);
    }, 8);
    $count = 0;
    if (is_array($payload)) {
        if (isset($payload['points'])) {
            $count = count($payload['points']);
        } elseif (isset($payload['results'])) {
            $count = count(array_filter($payload['results']));
        } elseif (isset($payload['aircraft']['points'])) {
            $count = count($payload['aircraft']['points']);
        }
    }
    $report['cache'][$name] = array(
        'bytes' => filesize($file),
        'decodeMs' => round($ms, 2),
        'count' => $count,
    );
}

$feeds = $root . '/api/feeds.json';
if (is_file($feeds)) {
    $t0 = microtime(true);
    for ($i = 0; $i < $repeat; $i++) {
        json_decode((string) file_get_contents($feeds), true);
    }
    $report['concurrent'] = array(
        'note' => "$repeat serial reads of static feeds.json (stand-in for many browsers hitting one cache)",
        'totalMs' => round((microtime(true) - $t0) * 1000, 1),
        'eachMs' => round(((microtime(true) - $t0) * 1000) / $repeat, 2),
        'users' => $repeat,
    );
}

list($sameMs, $same) = bench_ms(function () {
    $a = array('points' => array(array('id' => 1), array('id' => 2)));
    $b = array('points' => array(array('id' => 1), array('id' => 2)));
    return gsa_fingerprint($a) === gsa_fingerprint($b);
}, 20);
$report['fingerprintSameMs'] = round($sameMs, 3);
$report['fingerprintSame'] = $same;

if ($live) {
    $report['live'] = array(
        'healthmap' => curl_once('https://www.healthmap.org/getAlerts.php?category%5B%5D=1&category%5B%5D=2&category%5B%5D=29&time_interval=1%20week&heatscore=1'),
        'gideon' => curl_once('https://app.gideononline.com/api/public/diseases/events?return=simple', 40),
        'meshmap' => curl_once('https://meshmap.net/nodes.json'),
        'odin' => curl_once('https://odin.ornl.gov/odi?format=JSON&view=county'),
        'gpsinterference' => curl_once('https://api.gpsinterference.com/v1/interference/latest'),
        'adsb_mil' => curl_once('https://api.adsb.lol/v2/mil'),
        'digitraffic' => curl_once('https://meri.digitraffic.fi/api/ais/v1/locations?radius=1000'),
    );
}

echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
