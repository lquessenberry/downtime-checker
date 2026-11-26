<?php
// Scheduled jobs. Run from cPanel cron, never from the web:
//
//   /usr/local/bin/php -q /home/<user>/public_html/globalstatus.app/poll-runner.php grid
//   /usr/local/bin/php -q /home/<user>/public_html/globalstatus.app/poll-runner.php aircraft
//   php poll-runner.php status
//   php poll-runner.php jamming [--force-jam]
//   php poll-runner.php space [--force-space] [--only=nws,hurricanes,wildfires,tsunami,rivers,coastal]
//   php poll-runner.php ioda [--force-ioda]
//   php poll-runner.php ripe [--force-ripe]
//   php poll-runner.php tfr [--force-tfr]
//   php poll-runner.php delays [--force-delays]
//   php poll-runner.php airquality [--force-aq]
//   php poll-runner.php grid --slice=40     (test: first 40 sites only, never published)
//
// World Grid: one full pass is saved to data/scan-cache.json. Visitors'
// LOCK & SCAN replays that file; it never starts a scan.
// Aircraft: one civilian adsb.lol pull each run, plus /v2/mil only when
// the last mil pull is at least 15 minutes old. Visitors read the cache.
// Jamming: the same */5 aircraft cron also refreshes GPSInterference.com
// when the last pull is at least 15 minutes old. No third cron is needed.
// Space & Weather: the same */5 aircraft cron also refreshes NWS alerts
// (every run), NHC storms (15 min), NASA FIRMS fires (3 h), tsunami.gov
// alerts (every run), NWPS river gauges (15 min) and CO-OPS coastal water
// levels (15 min). Each feed is
// time-gated in poll-lib.php (gsa_space_refresh). Still no new cron.
// Internet outages: the same */5 cron refreshes the IODA (Georgia Tech) cache
// when it is at least 10 minutes old (gsa_ioda_refresh), and the RIPE Atlas
// probe cache on the same 10-minute gate (gsa_ripe_refresh), and the FAA TFR
// cache on the same gate (gsa_tfr_refresh), and the FAA NAS Status flight delays
// cache about every 5 minutes (gsa_fd_refresh).
// USA AIR QUALITY: the same */5 cron refreshes the EPA AirNow monitors and NOAA HMS
// smoke plumes about every 15 minutes (gsa_aq_refresh); AirNow updates hourly.

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
$onlySpace = array();
$forceIoda = false;
$skipIoda = false;
$forceRipe = false;
$forceTfr = false;
$forceDelays = false;
$forceAq = false;
$skipAq = false;
$skipDelays = false;
$skipTfr = false;
$skipRipe = false;
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
    } elseif ($arg === '--force-aq') {
        $forceAq = true;
    } elseif ($arg === '--skip-aq') {
        $skipAq = true;
    } elseif ($arg === '--force-delays') {
        $forceDelays = true;
    } elseif ($arg === '--skip-delays') {
        $skipDelays = true;
    } elseif ($arg === '--force-tfr') {
        $forceTfr = true;
    } elseif ($arg === '--skip-tfr') {
        $skipTfr = true;
    } elseif ($arg === '--force-ripe') {
        $forceRipe = true;
    } elseif ($arg === '--skip-ripe') {
        $skipRipe = true;
    } elseif ($arg === '--force-ioda') {
        $forceIoda = true;
    } elseif ($arg === '--skip-ioda') {
        $skipIoda = true;
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

// Internet outages (IODA). A failure never changes the aircraft job's exit code.
function runner_ioda($force)
{
    $t0 = microtime(true);
    try {
        $info = gsa_ioda_refresh(array('force' => $force));
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    if (empty($info['busy']) && empty($info['skipped'])) {
        gsa_poll_status_note('ioda', $info);
    }
    return $info;
}

// RIPE Atlas probes that went offline. A failure never changes the aircraft job's exit code.
function runner_ripe($force)
{
    $t0 = microtime(true);
    try {
        $info = gsa_ripe_refresh(array('force' => $force));
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    if (empty($info['busy']) && empty($info['skipped'])) {
        gsa_poll_status_note('ripe', $info);
    }
    return $info;
}

// FAA TFRs. A failure never changes the aircraft job's exit code.
function runner_tfr($force)
{
    $t0 = microtime(true);
    try {
        $info = gsa_tfr_refresh(array('force' => $force));
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    if (empty($info['busy']) && empty($info['skipped'])) {
        gsa_poll_status_note('tfr', $info);
    }
    return $info;
}

// FAA NAS Status flight delays. A failure never changes the aircraft job's exit code.
function runner_delays($force)
{
    $t0 = microtime(true);
    try {
        $info = gsa_fd_refresh(array('force' => $force));
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    if (empty($info['busy']) && empty($info['skipped'])) {
        gsa_poll_status_note('delays', $info);
    }
    return $info;
}

// EPA AirNow + NOAA HMS smoke. A failure never changes the aircraft job's exit code.
function runner_aq($force)
{
    $t0 = microtime(true);
    try {
        $info = gsa_aq_refresh(array('force' => $force));
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    if (empty($info['busy']) && empty($info['skipped'])) {
        gsa_poll_status_note('airquality', $info);
    }
    return $info;
}

if ($job === 'airquality') {
    $info = runner_aq($forceAq);
    runner_print(array('airquality' => $info));
    exit(!empty($info['ok']) ? 0 : 2);
}

if ($job === 'delays') {
    $info = runner_delays($forceDelays);
    runner_print(array('delays' => $info));
    exit(!empty($info['ok']) ? 0 : 2);
}

if ($job === 'tfr') {
    $info = runner_tfr($forceTfr);
    runner_print(array('tfr' => $info));
    exit(!empty($info['ok']) ? 0 : 2);
}

if ($job === 'ripe') {
    $info = runner_ripe($forceRipe);
    runner_print(array('ripe' => $info));
    exit(!empty($info['ok']) ? 0 : 2);
}

if ($job === 'ioda') {
    $info = runner_ioda($forceIoda);
    runner_print(array('ioda' => $info));
    exit(!empty($info['ok']) ? 0 : 2);
}

if ($job === 'space') {
    $info = runner_space($forceSpace, $onlySpace);
    runner_print(array('space' => $info));
    $ok = true;
    foreach ($info as $row) {
        $ok = $ok && (!empty($row['ok']) || !empty($row['busy']) || !empty($row['skipped']));
    }
    exit($ok ? 0 : 2);
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
    if (!$skipSpace) {
        $out['space'] = runner_space($forceSpace, $onlySpace);
    }
    if (!$skipIoda) {
        $out['ioda'] = runner_ioda($forceIoda);
    }
    if (!$skipRipe) {
        $out['ripe'] = runner_ripe($forceRipe);
    }
    if (!$skipTfr) {
        $out['tfr'] = runner_tfr($forceTfr);
    }
    if (!$skipDelays) {
        $out['delays'] = runner_delays($forceDelays);
    }
    if (!$skipAq) {
        $out['airquality'] = runner_aq($forceAq);
    }
    runner_print($out);
    $airOk = !empty($info['ok']) || !empty($info['busy']) || !empty($info['skipped']);
    $jamOk = $skipJam || !empty($out['jamming']['ok']) || !empty($out['jamming']['busy']) || !empty($out['jamming']['skipped']);
    exit($airOk && $jamOk ? 0 : 2);
}

if ($job !== 'grid') {
    fwrite(STDERR, "Unknown job: $job (use grid, aircraft, jamming, space, ioda, ripe, tfr, delays, airquality, or status)\n");
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
