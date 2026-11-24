<?php
// Scheduled jobs. On GoDaddy these are two cPanel crons. On Fly FrankenPHP
// start.sh runs: php poll-runner.php loop
//
//   php poll-runner.php grid
//   php poll-runner.php aircraft
//   php poll-runner.php status
//   php poll-runner.php jamming [--force-jam]
//   php poll-runner.php space [--force-space] [--only=nws,hurricanes,wildfires,tsunami,rivers,coastal]
//   php poll-runner.php outages|mesh|disease|animal
//   php poll-runner.php grid --slice=40     (test: first 40 sites only, never published)
//   php poll-runner.php loop                (Fly: grid every 10 min, aircraft every 5 min)
//
// World Grid: one full pass is saved to data/scan-cache.json. Visitors'
// LOCK & SCAN replays that file; it never starts a scan.
// Aircraft: one civilian adsb.lol pull each run, plus /v2/mil only when
// the last mil pull is at least 15 minutes old. Visitors read the cache.
// Jamming: the same aircraft job also refreshes GPSInterference.com
// when the last pull is at least 15 minutes old.
// Space & Weather: the same aircraft job also refreshes NWS alerts
// (every run), NHC storms (15 min), NASA FIRMS fires (3 h), tsunami.gov
// alerts (every run), NWPS river gauges (15 min) and CO-OPS coastal water
// levels (15 min). Each feed is time-gated in poll-lib.php (gsa_space_refresh).
// Outages, mesh, disease (5 min) and animal (10 min) piggyback on the
// aircraft job the same way. HTTP visitors only read the caches.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found\n";
    exit;
}

define('GSA_RUNNER', true);

$root = __DIR__;
require $root . '/router.php';

$argv = $_SERVER['argv'] ?? array('poll-runner.php');
array_shift($argv);
$job = $argv ? array_shift($argv) : 'status';
$slice = 0;
$forceMil = false;
$skipMil = false;
$forceJam = false;
$skipJam = false;
$skipAircraft = false;
$forceSpace = false;
$skipSpace = false;
$skipLayers = false;
$onlySpace = array();
foreach ($argv as $arg) {
    if (strpos($arg, '--slice=') === 0) {
        $slice = (int) substr($arg, 8);
    } elseif ($arg === '--force-mil') {
        $forceMil = true;
    } elseif ($arg === '--skip-mil') {
        $skipMil = true;
    } elseif ($arg === '--force-jam') {
        $forceJam = true;
    } elseif ($arg === '--skip-jam') {
        $skipJam = true;
    } elseif ($arg === '--force-space') {
        $forceSpace = true;
    } elseif ($arg === '--skip-space') {
        $skipSpace = true;
    } elseif ($arg === '--skip-layers') {
        $skipLayers = true;
    } elseif (strpos($arg, '--only=') === 0) {
        $onlySpace = array_filter(explode(',', substr($arg, 7)));
    } elseif ($arg === '--mock-space-fail') {
        $GLOBALS['GSA_SPACE_MOCK_FAIL'] = true;
    } elseif (strpos($arg, '--mock-nhc=') === 0) {
        $GLOBALS['GSA_SPACE_MOCK_NHC'] = substr($arg, 11);
    } elseif (strpos($arg, '--mock-tsunami=') === 0) {
        $GLOBALS['GSA_SPACE_MOCK_TSUNAMI'] = substr($arg, 15);
    } elseif (strpos($arg, '--mock-coops=') === 0) {
        $GLOBALS['GSA_SPACE_MOCK_COOPS'] = substr($arg, 13);
    } elseif ($arg === '--skip-aircraft') {
        $skipAircraft = true;
    } elseif (strpos($arg, '--mock=') === 0) {
        $GLOBALS['GSA_ADSB_MOCK'] = substr($arg, 7);
    } elseif (strpos($arg, '--mock-jam=') === 0) {
        $GLOBALS['GSA_JAM_MOCK'] = substr($arg, 11);
    }
}

function runner_print($data)
{
    echo gmdate('c') . ' ' . json_encode($data, JSON_UNESCAPED_SLASHES) . "\n";
}

function runner_job_age($name)
{
    $status = gsa_poll_status_read();
    $at = $status['jobs'][$name]['at'] ?? '';
    if ($at === '') {
        return PHP_INT_MAX;
    }
    $ts = strtotime($at);
    if ($ts === false) {
        return PHP_INT_MAX;
    }
    return max(0, time() - $ts);
}

function runner_ok($info)
{
    return !empty($info['ok']) || !empty($info['busy']) || !empty($info['skipped']);
}

function runner_jamming($forceJam)
{
    $t0 = microtime(true);
    try {
        $info = gsa_jamming_refresh(array('force' => $forceJam));
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    if (empty($info['busy'])) {
        gsa_poll_status_note('jamming', $info);
    }
    return $info;
}

// Space & Weather feeds. A failure here never changes the exit code of the
// aircraft job; the last good cache stays up, marked stale.
function runner_space($force, $only)
{
    $out = array();
    foreach (array_keys(gsa_space_feeds()) as $name) {
        if ($only && !in_array($name, $only, true)) {
            continue;
        }
        $t0 = microtime(true);
        try {
            $info = gsa_space_refresh($name, array('force' => $force));
        } catch (Throwable $e) {
            $info = array('ok' => false, 'error' => $e->getMessage());
        }
        $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
        if (empty($info['busy']) && empty($info['skipped'])) {
            gsa_poll_status_note('space-' . $name, $info);
        }
        $out[$name] = $info;
    }
    return $out;
}

// Outages / mesh / disease every 5 min, animal every 10 min. The runner
// time-gates; a skip does not rewrite poll-status (so the clock stays put).
function runner_layer($name, $ttl, $fn)
{
    $age = runner_job_age($name);
    if ($age < $ttl) {
        return array('ok' => true, 'skipped' => true, 'reason' => 'not-due', 'ageSec' => $age, 'ttl' => $ttl);
    }
    $t0 = microtime(true);
    try {
        $snap = $fn();
        $info = array(
            'ok' => empty($snap['error']),
            'count' => $snap['count'] ?? ($snap['counties'] ?? 0),
            'error' => $snap['error'] ?? null,
        );
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    gsa_poll_status_note($name, $info);
    return $info;
}

function runner_layers($force = false)
{
    $out = array();
    $jobs = array(
        'outages' => array(300, function () { return outages_snapshot(); }),
        'mesh' => array(300, function () { return mesh_snapshot(); }),
        'disease' => array(300, function () { return disease_snapshot(); }),
        'animal' => array(600, function () { return animal_snapshot(); }),
    );
    foreach ($jobs as $name => $spec) {
        if ($force) {
            $t0 = microtime(true);
            try {
                $snap = $spec[1]();
                $info = array(
                    'ok' => empty($snap['error']),
                    'count' => $snap['count'] ?? ($snap['counties'] ?? 0),
                    'error' => $snap['error'] ?? null,
                    'ms' => (int) round((microtime(true) - $t0) * 1000),
                );
            } catch (Throwable $e) {
                $info = array(
                    'ok' => false,
                    'error' => $e->getMessage(),
                    'ms' => (int) round((microtime(true) - $t0) * 1000),
                );
            }
            gsa_poll_status_note($name, $info);
            $out[$name] = $info;
        } else {
            $out[$name] = runner_layer($name, $spec[0], $spec[1]);
        }
    }
    return $out;
}

function runner_aircraft($opts)
{
    $out = array();
    if (!empty($opts['skipAircraft'])) {
        $info = array('ok' => true, 'skipped' => true, 'ms' => 0);
    } else {
        $t0 = microtime(true);
        try {
            $info = gsa_aircraft_refresh(array(
                'forceMil' => !empty($opts['forceMil']),
                'skipMil' => !empty($opts['skipMil']),
            ));
        } catch (Throwable $e) {
            $info = array('ok' => false, 'error' => $e->getMessage());
        }
        $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
        if (empty($info['busy'])) {
            gsa_poll_status_note('aircraft', $info);
        }
    }
    $out['aircraft'] = $info;
    if (empty($opts['skipJam'])) {
        $out['jamming'] = runner_jamming(!empty($opts['forceJam']));
    }
    if (empty($opts['skipSpace'])) {
        $out['space'] = runner_space(!empty($opts['forceSpace']), $opts['onlySpace'] ?? array());
    }
    if (empty($opts['skipLayers'])) {
        $out['layers'] = runner_layers();
    }
    return $out;
}

function runner_grid($slice)
{
    $t0 = microtime(true);
    try {
        $info = run_scheduled_scan('everything', '', $slice);
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    if (empty($info['busy'])) {
        gsa_poll_status_note('grid', $info);
    }
    return $info;
}

function runner_aircraft_opts()
{
    global $forceMil, $skipMil, $forceJam, $skipJam, $skipAircraft, $forceSpace, $skipSpace, $skipLayers, $onlySpace;
    return array(
        'forceMil' => $forceMil,
        'skipMil' => $skipMil,
        'forceJam' => $forceJam,
        'skipJam' => $skipJam,
        'skipAircraft' => $skipAircraft,
        'forceSpace' => $forceSpace,
        'skipSpace' => $skipSpace,
        'skipLayers' => $skipLayers,
        'onlySpace' => $onlySpace,
    );
}

if ($job === 'status') {
    runner_print(gsa_poll_status_read());
    exit(0);
}

if ($job === 'space') {
    $info = runner_space($forceSpace, $onlySpace);
    runner_print(array('space' => $info));
    $ok = true;
    foreach ($info as $row) {
        $ok = $ok && runner_ok($row);
    }
    exit($ok ? 0 : 2);
}

if ($job === 'jamming') {
    $info = runner_jamming($forceJam);
    runner_print(array('jamming' => $info));
    exit(runner_ok($info) ? 0 : 2);
}

if ($job === 'outages' || $job === 'mesh' || $job === 'disease' || $job === 'animal') {
    $all = runner_layers(true);
    $info = $all[$job];
    runner_print(array($job => $info));
    exit(runner_ok($info) ? 0 : 2);
}

if ($job === 'aircraft') {
    $out = runner_aircraft(runner_aircraft_opts());
    runner_print($out);
    $airOk = runner_ok($out['aircraft']);
    $jamOk = $skipJam || runner_ok($out['jamming'] ?? array('skipped' => true));
    exit($airOk && $jamOk ? 0 : 2);
}

if ($job === 'loop') {
    fwrite(STDERR, 'gsa poll-runner loop pid=' . getmypid() . "\n");
    // Lee approved keeping Will's live 10-minute grid on staging (t103u).
    // Never poll a source faster than 5 minutes.
    $gridTtl = max(300, (int) (getenv('GSA_GRID_SEC') ?: 600));
    $airTtl = max(300, (int) (getenv('GSA_AIRCRAFT_SEC') ?: 300));
    $opts = runner_aircraft_opts();
    while (true) {
        if (runner_job_age('aircraft') >= $airTtl) {
            fwrite(STDERR, gmdate('c') . " poll aircraft\n");
            runner_print(runner_aircraft($opts));
        }
        if (runner_job_age('grid') >= $gridTtl) {
            fwrite(STDERR, gmdate('c') . " poll grid\n");
            runner_print(array('grid' => runner_grid($slice)));
        }
        sleep(15);
    }
}

if ($job !== 'grid') {
    fwrite(STDERR, "Unknown job: $job (use grid, aircraft, jamming, space, outages, mesh, disease, animal, loop, or status)\n");
    exit(1);
}

$info = runner_grid($slice);
runner_print(array('grid' => $info));
exit(!empty($info['ok']) || !empty($info['busy']) ? 0 : 2);
