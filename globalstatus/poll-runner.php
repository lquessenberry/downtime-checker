<?php
// Scheduled jobs. On GoDaddy these are cPanel crons. On Fly FrankenPHP
// start.sh runs: php poll-runner.php loop
//
//   php poll-runner.php grid
//   php poll-runner.php aircraft
//   php poll-runner.php status
//   php poll-runner.php jamming [--force-jam]
//   php poll-runner.php space [--force-space] [--only=nws,hurricanes,wildfires,tsunami,rivers,coastal]
//   php poll-runner.php outages|mesh|disease|animal
//   php poll-runner.php ioda [--force-ioda]
//   php poll-runner.php ripe [--force-ripe]
//   php poll-runner.php tfr [--force-tfr]
//   php poll-runner.php delays [--force-delays]
//   php poll-runner.php airquality [--force-aq]
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
// Internet outages: the loop refreshes the IODA (Georgia Tech) cache
// when it is at least 10 minutes old (gsa_ioda_refresh), and the RIPE Atlas
// probe cache on the same 10-minute gate (gsa_ripe_refresh), and the FAA TFR
// cache on the same gate (gsa_tfr_refresh), and the FAA NAS Status flight delays
// cache at least every 5 minutes (gsa_fd_refresh).
// USA AIR QUALITY: the loop refreshes the EPA AirNow monitors and NOAA HMS
// smoke plumes about every 15 minutes (gsa_aq_refresh); AirNow updates hourly.
// Power outages: the loop refreshes the US, United Kingdom, Canada, and
// Australia outage caches when they are at least 10 minutes old.

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
$solo = false;
$onlySpace = array();
$forceIoda = false;
$skipIoda = false;
$forceRipe = false;
$skipRipe = false;
$forceTfr = false;
$skipTfr = false;
$forceDelays = false;
$skipDelays = false;
$forceAq = false;
$skipAq = false;
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
    } elseif ($arg === '--solo') {
        $solo = true;
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
        if (empty($info['busy'])) {
            gsa_poll_status_note('space-' . $name, $info);
        }
        $out[$name] = $info;
    }
    return $out;
}

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

function runner_delays($force)
{
    $t0 = microtime(true);
    try {
        $info = gsa_fd_refresh(array('force' => $force, 'maxAge' => 300));
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    if (empty($info['busy']) && empty($info['skipped'])) {
        gsa_poll_status_note('delays', $info);
    }
    return $info;
}

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

// Outages / mesh / disease every 5–10 min, animal every 10 min. The runner
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

function runner_outages_regions()
{
    $t0 = microtime(true);
    try {
        $info = outages_regions_refresh();
    } catch (Throwable $e) {
        $info = array('ok' => false, 'error' => $e->getMessage());
    }
    if (!isset($info['ok']) && is_array($info)) {
        $ok = true;
        $skipped = true;
        foreach ($info as $row) {
            if (!is_array($row)) {
                continue;
            }
            $ok = $ok && runner_ok($row);
            $skipped = $skipped && !empty($row['skipped']);
        }
        $info['ok'] = $ok;
        if ($skipped) {
            $info['skipped'] = true;
        }
    }
    $info['ms'] = $info['ms'] ?? (int) round((microtime(true) - $t0) * 1000);
    if (empty($info['skipped'])) {
        gsa_poll_status_note('outages', $info);
    }
    return $info;
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
        if (empty($opts['skipOutages'])) {
            $out['outages'] = runner_outages_regions();
        }
    }
    if (empty($opts['skipIoda'])) {
        $out['ioda'] = runner_ioda(!empty($opts['forceIoda']));
    }
    if (empty($opts['skipRipe'])) {
        $out['ripe'] = runner_ripe(!empty($opts['forceRipe']));
    }
    if (empty($opts['skipTfr'])) {
        $out['tfr'] = runner_tfr(!empty($opts['forceTfr']));
    }
    if (empty($opts['skipDelays'])) {
        $out['delays'] = runner_delays(!empty($opts['forceDelays']));
    }
    if (empty($opts['skipAq'])) {
        $out['airquality'] = runner_aq(!empty($opts['forceAq']));
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
    global $forceIoda, $skipIoda, $forceRipe, $skipRipe, $forceTfr, $skipTfr, $forceDelays, $skipDelays, $forceAq, $skipAq;
    return array(
        'forceMil' => $forceMil,
        'skipMil' => $skipMil,
        'forceJam' => $forceJam,
        'skipJam' => $skipJam,
        'skipAircraft' => $skipAircraft,
        'forceSpace' => $forceSpace,
        'skipSpace' => $skipSpace,
        'skipLayers' => $skipLayers,
        'skipOutages' => $skipLayers,
        'onlySpace' => $onlySpace,
        'forceIoda' => $forceIoda,
        'skipIoda' => $skipIoda,
        'forceRipe' => $forceRipe,
        'skipRipe' => $skipRipe,
        'forceTfr' => $forceTfr,
        'skipTfr' => $skipTfr,
        'forceDelays' => $forceDelays,
        'skipDelays' => $skipDelays,
        'forceAq' => $forceAq,
        'skipAq' => $skipAq,
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

if ($job === 'ioda') {
    $info = runner_ioda($forceIoda);
    runner_print(array('ioda' => $info));
    exit(runner_ok($info) ? 0 : 2);
}

if ($job === 'ripe') {
    $info = runner_ripe($forceRipe);
    runner_print(array('ripe' => $info));
    exit(runner_ok($info) ? 0 : 2);
}

if ($job === 'tfr') {
    $info = runner_tfr($forceTfr);
    runner_print(array('tfr' => $info));
    exit(runner_ok($info) ? 0 : 2);
}

if ($job === 'delays') {
    $info = runner_delays($forceDelays);
    runner_print(array('delays' => $info));
    exit(runner_ok($info) ? 0 : 2);
}

if ($job === 'airquality') {
    $info = runner_aq($forceAq);
    runner_print(array('airquality' => $info));
    exit(runner_ok($info) ? 0 : 2);
}

if ($job === 'outages') {
    $info = runner_outages_regions();
    runner_print(array('outages' => $info));
    exit(runner_ok($info) ? 0 : 2);
}

if ($job === 'mesh' || $job === 'disease' || $job === 'animal') {
    $info = runner_layer($job, 0, function () use ($job) {
        if ($job === 'mesh') {
            return mesh_snapshot();
        }
        if ($job === 'disease') {
            return disease_snapshot();
        }
        return animal_snapshot();
    });
    runner_print(array($job => $info));
    exit(runner_ok($info) ? 0 : 2);
}

if ($job === 'aircraft') {
    $opts = runner_aircraft_opts();
    if ($solo) {
        $opts['skipJam'] = true;
        $opts['skipSpace'] = true;
        $opts['skipLayers'] = true;
        $opts['skipOutages'] = true;
        $opts['skipIoda'] = true;
        $opts['skipRipe'] = true;
        $opts['skipTfr'] = true;
        $opts['skipDelays'] = true;
        $opts['skipAq'] = true;
    }
    $out = runner_aircraft($opts);
    runner_print($out);
    $airOk = runner_ok($out['aircraft']);
    $jamOk = !empty($opts['skipJam']) || runner_ok($out['jamming'] ?? array('skipped' => true));
    exit($airOk && $jamOk ? 0 : 2);
}

function runner_http_jobs()
{
    return array(
        'aircraft',
        'jamming',
        'space-nws',
        'space-hurricanes',
        'space-wildfires',
        'space-tsunami',
        'space-rivers',
        'space-coastal',
        'outages',
        'mesh',
        'disease',
        'animal',
        'ioda',
        'ripe',
        'tfr',
        'delays',
        'airquality',
    );
}

function runner_job_argv($name)
{
    if (strpos($name, 'space-') === 0) {
        return array('space', '--only=' . substr($name, 6), '--solo');
    }
    return array($name, '--solo');
}

// Run due HTTP jobs as child processes (own lock + cadence), at most three
// at a time, so one 512 MB machine stays inside its memory cap. Grid is
// exclusive: it is a 2-4 minute ping pass and runs alone.
function runner_spawn_jobs($names, $max = 4)
{
    $php = PHP_BINARY;
    $script = __DIR__ . '/poll-runner.php';
    $queue = array_values($names);
    $procs = array();
    $results = array();
    while ($queue || $procs) {
        while ($queue && count($procs) < $max) {
            $name = array_shift($queue);
            $args = runner_job_argv($name);
            $cmd = array_merge(array($php, $script), $args);
            fwrite(STDERR, gmdate('c') . " poll $name\n");
            $descriptors = array(
                1 => array('pipe', 'w'),
                2 => array('pipe', 'w'),
            );
            $pipes = array();
            $proc = @proc_open($cmd, $descriptors, $pipes, __DIR__);
            if (!is_resource($proc)) {
                $results[$name] = array('ok' => false, 'error' => 'Could not start job');
                continue;
            }
            $procs[$name] = array('proc' => $proc, 'pipes' => $pipes);
        }
        foreach (array_keys($procs) as $name) {
            $row = $procs[$name];
            $status = proc_get_status($row['proc']);
            if (!empty($status['running'])) {
                continue;
            }
            $stdout = stream_get_contents($row['pipes'][1]);
            $stderr = stream_get_contents($row['pipes'][2]);
            foreach ($row['pipes'] as $pipe) {
                fclose($pipe);
            }
            $code = proc_close($row['proc']);
            if ($stdout !== '') {
                echo $stdout;
            }
            if ($stderr !== '') {
                fwrite(STDERR, $stderr);
            }
            $results[$name] = array('ok' => $code === 0, 'code' => $code);
            unset($procs[$name]);
        }
        if ($procs) {
            usleep(100000);
        }
    }
    return $results;
}

if ($job === 'loop') {
    fwrite(STDERR, 'gsa poll-runner loop pid=' . getmypid() . "\n");
    while (true) {
        $dueHttp = array();
        foreach (runner_http_jobs() as $name) {
            if (runner_job_age($name) >= gsa_adaptive_ttl($name)) {
                $dueHttp[] = $name;
            }
        }
        $gridDue = runner_job_age('grid') >= gsa_adaptive_ttl('grid');
        if ($dueHttp) {
            runner_spawn_jobs($dueHttp, 3);
        }
        if ($gridDue) {
            fwrite(STDERR, gmdate('c') . " poll grid\n");
            runner_print(array('grid' => runner_grid($slice)));
        }
        sleep(15);
    }
}

if ($job !== 'grid') {
    fwrite(STDERR, "Unknown job: $job (use grid, aircraft, jamming, space, outages, mesh, disease, animal, ioda, ripe, tfr, delays, airquality, loop, or status)\n");
    exit(1);
}

$info = runner_grid($slice);
runner_print(array('grid' => $info));
exit(!empty($info['ok']) || !empty($info['busy']) ? 0 : 2);
