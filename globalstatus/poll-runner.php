<?php
// Scheduled jobs. Run from cPanel cron, never from the web:
//
//   /usr/local/bin/php -q /home/<user>/public_html/globalstatus.app/poll-runner.php grid
//   /usr/local/bin/php -q /home/<user>/public_html/globalstatus.app/poll-runner.php aircraft
//   php poll-runner.php status
//   php poll-runner.php jamming [--force-jam]
//   php poll-runner.php grid --slice=40     (test: first 40 sites only, never published)
//
// World Grid: one full pass is saved to data/scan-cache.json. Visitors'
// LOCK & SCAN replays that file; it never starts a scan.
// Aircraft: one civilian adsb.lol pull each run, plus /v2/mil only when
// the last mil pull is at least 15 minutes old. Visitors read the cache.
// Jamming: the same */5 aircraft cron also refreshes GPSInterference.com
// when the last pull is at least 15 minutes old. No third cron is needed.

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

if ($job === 'status') {
    runner_print(gsa_poll_status_read());
    exit(0);
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

if ($job === 'jamming') {
    $info = runner_jamming($forceJam);
    runner_print(array('jamming' => $info));
    exit(!empty($info['ok']) || !empty($info['busy']) || !empty($info['skipped']) ? 0 : 2);
}

if ($job === 'aircraft') {
    $out = array();
    if ($skipAircraft) {
        $info = array('ok' => true, 'skipped' => true, 'ms' => 0);
    } else {
        $t0 = microtime(true);
        try {
            $info = gsa_aircraft_refresh(array(
                'forceMil' => $forceMil,
                'skipMil' => $skipMil,
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
    if (!$skipJam) {
        $out['jamming'] = runner_jamming($forceJam);
    }
    runner_print($out);
    $airOk = !empty($info['ok']) || !empty($info['busy']) || !empty($info['skipped']);
    $jamOk = $skipJam || !empty($out['jamming']['ok']) || !empty($out['jamming']['busy']) || !empty($out['jamming']['skipped']);
    exit($airOk && $jamOk ? 0 : 2);
}

if ($job !== 'grid') {
    fwrite(STDERR, "Unknown job: $job (use grid, aircraft, jamming, or status)\n");
    exit(1);
}

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
runner_print(array('grid' => $info));
exit(!empty($info['ok']) || !empty($info['busy']) ? 0 : 2);
