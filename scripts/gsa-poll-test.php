<?php
// Unit checks for scan filter + cache-if-same (#34).

$root = dirname(__DIR__) . '/globalstatus';
$dataDir = sys_get_temp_dir() . '/gsa-poll-test-' . getmypid();
@mkdir($dataDir, 0755, true);
require $root . '/poll-lib.php';

$fail = 0;
function check($ok, $msg)
{
    global $fail;
    if ($ok) {
        echo "ok  $msg\n";
        return;
    }
    $fail++;
    echo "FAIL  $msg\n";
}

$tmp = $dataDir . '/sample.json';
$payload = array('points' => array(array('id' => 'a', 'lat' => 1), array('id' => 'b', 'lat' => 2)), 'count' => 2, 'updated' => '2026-01-01T00:00:00Z');
$first = gsa_cache_put($tmp, $payload);
check(!empty($first['changed']), 'first write is a change');
$second = gsa_cache_put($tmp, $payload);
check(empty($second['changed']), 'same points skip rewrite mark');
$payload['points'][0]['lat'] = 9;
$third = gsa_cache_put($tmp, $payload);
check(!empty($third['changed']), 'changed points rewrite');

$served = gsa_cache_serve($tmp, 180);
check(is_array($served) && $served['stale'] === false, 'fresh cache is not stale');
check(($served['count'] ?? 0) === 2, 'served count');

function blank_state()
{
    return array(
        'running' => false,
        'scanId' => 0,
        'heading' => '',
        'searchId' => '',
        'total' => 0,
        'done' => 0,
        'up' => 0,
        'down' => 0,
        'startedAt' => 0,
        'finishedAt' => 0,
        'results' => array(),
    );
}

function catalog_label($id)
{
    return $id === 'us-banks' ? 'US banks' : $id;
}

function target_matches($row, $id, $country)
{
    $isUs = ($row['country'] ?? '') === 'United States';
    if ($id === 'country') {
        return strcasecmp((string) ($row['country'] ?? ''), $country) === 0;
    }
    if ($id === 'us-banks') {
        return $isUs && in_array('banks', $row['kinds'] ?? array(), true);
    }
    return true;
}

$snap = array(
    'scanId' => 9,
    'searchId' => 'everything',
    'startedAt' => 1,
    'finishedAt' => 2,
    'results' => array(
        array('address' => 'a.com', 'country' => 'United States', 'kinds' => array('banks'), 'status' => 'up'),
        array('address' => 'b.com', 'country' => 'United States', 'kinds' => array('tech'), 'status' => 'down'),
        array('address' => 'c.com', 'country' => 'France', 'kinds' => array('banks'), 'status' => 'up'),
    ),
);
$banks = gsa_filter_scan_state($snap, 'us-banks', '');
check($banks['total'] === 1, 'us-banks filters to one host');
check($banks['up'] === 1 && $banks['down'] === 0, 'us-banks counts');
check($banks['replay'] === true, 'replay flag');
$fr = gsa_filter_scan_state($snap, 'country', 'France');
check($fr['total'] === 1 && $fr['results'][0]['address'] === 'c.com', 'country filter');
$all = gsa_filter_scan_state($snap, 'everything', '');
check(count($all['results']) === 3, 'everything keeps all');

$pending = gsa_filter_scan_state(null, 'everything', '');
check(!empty($pending['pending']), 'missing snapshot is pending');

// #96 follow-up: aircraft detail is cache-only for HTTP visitors.
$adsb = gsa_aircraft_parse_adsb(array('ac' => array(array('hex' => 'abc123', 'flight' => 'UAL1', 't' => 'B738', 'lat' => 35.1, 'lon' => -90.2))));
check(is_array($adsb) && $adsb['flight'] === 'UAL1', 'parse adsb.lol ac[0]');
check(gsa_aircraft_parse_adsb(array('ac' => array())) === null, 'parse empty adsb');
$photo = gsa_aircraft_parse_photos(array('photos' => array(array(
    'thumbnail_large' => array('src' => 'https://cdn.example/ps.jpg'),
    'link' => 'https://www.planespotters.net/photo/1',
    'photographer' => 'Test',
))));
check(is_array($photo) && $photo['photographer'] === 'Test', 'parse planespotters https thumb');
check(gsa_aircraft_parse_photos(array('photos' => array(array('thumbnail' => array('src' => 'http://insecure.example/x.jpg'))))) === null, 'reject non-https photo');
$route = gsa_aircraft_parse_routes(array(array('plausible' => true, '_airport_codes_iata' => 'MEM-ORD', 'airport_codes' => 'KMEM-KORD', 'airline_code' => 'UA')));
check(is_array($route) && $route['iata'] === 'MEM-ORD', 'parse adsb.im route');

$miss = gsa_aircraft_detail_serve('abc123', array('callsign' => 'UAL1', 'type' => 'B738'));
check(!empty($miss['queued']) && !empty($miss['stale']), 'cache miss is stale queued envelope');
check($miss['live'] === null && $miss['error'] === 'Awaiting poller', 'cache miss does not invent live data');
$q = gsa_aircraft_detail_queue_read();
check(isset($q['abc123']) && $q['abc123']['callsign'] === 'UAL1', 'miss enqueues hex with hints');

$now = time();
$written = gsa_aircraft_detail_apply_source(gsa_aircraft_detail_envelope('abc123'), 'adsb.lol', $adsb, $now);
$written = gsa_aircraft_detail_write('abc123', $written);
$hit = gsa_aircraft_detail_serve('abc123', array());
check(($hit['live']['flight'] ?? '') === 'UAL1', 'fresh cache is served to HTTP');
check(empty($hit['stale']), 'fresh cache is not stale');

$rates = array('adsb.lol' => $now, 'planespotters.net' => $now, 'adsb.im' => $now);
$plan = gsa_aircraft_detail_plan($q, $rates, $now, 300, array('abc123' => $written));
check($plan === array(), 'no plan when every source was fetched this second');
$plan = gsa_aircraft_detail_plan($q, array(), $now, 300, array());
$sources = array_column($plan, 'source');
check(count($plan) === 3 && count($sources) === count(array_unique($sources)), 'plan is at most one fetch per source');
$planSoon = gsa_aircraft_detail_plan($q, array('adsb.lol' => $now - 10), $now, 300, array());
$soonSources = array_column($planSoon, 'source');
check(!in_array('adsb.lol', $soonSources, true) && in_array('planespotters.net', $soonSources, true), 'source rate limit skips adsb.lol inside 5 minutes');

// Config smoke: the four #96 review fixes stay in place.
$root = dirname(__DIR__);
$fly = file_get_contents($root . '/fly.gsa.toml');
check(strpos($fly, "auto_stop_machines = 'stop'") !== false, 'fly auto_stop_machines is stop');
check(strpos($fly, 'min_machines_running = 0') !== false, 'fly min_machines_running is 0');
check(strpos($fly, "auto_stop_machines = 'off'") === false, 'fly does not disable auto-stop');
$ngx = file_get_contents($root . '/nginx.gsa.conf');
check(strpos($ngx, 'location ~* \.php$') !== false, 'nginx denies static *.php');
check(strpos($ngx, 'deny all;') !== false && strpos($ngx, 'try_files $uri $uri/ =404;') !== false, 'nginx still serves static assets after php deny');
$df = file_get_contents($root . '/Dockerfile.gsa');
check(strpos($df, 'rm -f /app/dev-router.php') !== false, 'image build drops dev-router.php');
$router = file_get_contents($root . '/globalstatus/router.php');
check(strpos($router, "\$path === '/api/stop'") === false, 'public /api/stop route is removed');
$cesium = file_get_contents($root . '/globalstatus/cesium.js');
check(strpos($cesium, 'fetch("/api/stop"') === false, 'resetMap does not POST /api/stop');

passthru('rm -rf ' . escapeshellarg($dataDir));
echo $fail ? "\n$fail failed\n" : "\nall passed\n";
exit($fail ? 1 : 0);
