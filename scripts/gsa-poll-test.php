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

passthru('rm -rf ' . escapeshellarg($dataDir));
echo $fail ? "\n$fail failed\n" : "\nall passed\n";
exit($fail ? 1 : 0);
