<?php
// One synthetic user (#34). Polls upstream, writes cache, visitors read /api.
//
//   php poll-runner.php status
//   php poll-runner.php outages|mesh|disease|animal|mil|jamming|aircraft|grid
//   php poll-runner.php once
//   php poll-runner.php loop
//   php poll-runner.php grid --slice=16
//   php poll-runner.php aircraft [--force-mil|--skip-mil|--mock=PATH|--force-jam|--skip-jam|--skip-aircraft|--mock-jam=PATH]
//   php poll-runner.php jamming [--force-jam|--mock-jam=PATH]
//
// Aircraft on globalstatus.app (cPanel cron, every 5 minutes): one civilian
// adsb.lol pull each run, plus /v2/mil only when the last mil pull is at least
// 15 minutes old (~384 requests/day, under the 500/day unkeyed cap).
// Visitors read the cache. The same aircraft cron also refreshes
// GPSInterference.com when the last jamming pull is at least 15 minutes
// old (96 requests/day worst case). No third cron is needed. Grid is ~10 minutes.
//
// Live cPanel crons:
//   /usr/local/bin/php -q /home/<user>/public_html/globalstatus.app/poll-runner.php grid
//   /usr/local/bin/php -q /home/<user>/public_html/globalstatus.app/poll-runner.php aircraft > /home/<user>/globalstatus-aircraft-last.log 2>&1
// Visitors' LOCK & SCAN replays data/scan-cache.json; it never starts a scan.

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

$ttls = array(
    'jamming' => 900,
    'aircraft' => 300,
    'outages' => 180,
    'mesh' => 90,
    'disease' => 180,
    'animal' => 600,
    'grid' => 900,
);

function runner_timed($name, $fn)
{
    $t0 = microtime(true);
    try {
        $info = $fn();
        if (!is_array($info)) {
            $info = array('ok' => true);
        }
        $info['ms'] = (int) round((microtime(true) - $t0) * 1000);
        $info['error'] = $info['error'] ?? null;
        // A second cron run that finds a pass still going leaves status alone.
        if (empty($info['busy'])) {
            gsa_poll_status_note($name, $info);
        }
        return $info;
    } catch (Throwable $e) {
        $info = array(
            'ok' => false,
            'error' => $e->getMessage(),
            'ms' => (int) round((microtime(true) - $t0) * 1000),
        );
        gsa_poll_status_note($name, $info);
        return $info;
    }
}

function runner_run($name, $slice = 0)
{
    if ($name === 'status') {
        return gsa_poll_status_read();
    }
    if ($name === 'outages') {
        return runner_timed('outages', function () {
            $snap = outages_snapshot();
            return array(
                'ok' => empty($snap['error']),
                'count' => $snap['count'] ?? ($snap['counties'] ?? 0),
                'error' => $snap['error'] ?? null,
            );
        });
    }
    if ($name === 'mil') {
        // Military positions come from the aircraft cache (15-minute mil pull).
        // This job never calls adsb.lol on its own.
        return runner_timed('mil', function () {
            $snap = military_snapshot();
            return array(
                'ok' => empty($snap['error']),
                'count' => $snap['count'] ?? 0,
                'error' => $snap['error'] ?? null,
                'cacheOnly' => true,
            );
        });
    }
    if ($name === 'mesh') {
        return runner_timed('mesh', function () {
            $snap = mesh_snapshot();
            return array(
                'ok' => empty($snap['error']),
                'count' => $snap['count'] ?? 0,
                'error' => $snap['error'] ?? null,
            );
        });
    }
    if ($name === 'disease') {
        return runner_timed('disease', function () {
            $snap = disease_snapshot();
            return array(
                'ok' => empty($snap['error']),
                'count' => $snap['count'] ?? 0,
                'error' => $snap['error'] ?? null,
            );
        });
    }
    if ($name === 'animal') {
        return runner_timed('animal', function () {
            $snap = animal_snapshot();
            return array(
                'ok' => empty($snap['error']),
                'count' => $snap['count'] ?? 0,
                'error' => $snap['error'] ?? null,
            );
        });
    }
    if ($name === 'jamming') {
        return runner_timed('jamming', function () use ($forceJam) {
            return jamming_refresh(array('force' => $forceJam));
        });
    }
    if ($name === 'aircraft') {
        return runner_timed('aircraft', function () use ($forceMil, $skipMil) {
            return aircraft_refresh(array(
                'forceMil' => $forceMil,
                'skipMil' => $skipMil,
            ));
        });
    }
    if ($name === 'grid') {
        return runner_timed('grid', function () use ($slice) {
            return run_scheduled_scan('everything', '', $slice);
        });
    }
    if ($name === 'once') {
        $out = array();
        foreach (array('outages', 'mesh', 'disease', 'animal', 'jamming', 'aircraft') as $job) {
            $out[$job] = runner_run($job);
        }
        return $out;
    }
    fwrite(STDERR, "Unknown job: $name\n");
    exit(1);
}

function runner_due($ttls)
{
    $status = gsa_poll_status_read();
    $jobs = $status['jobs'] ?? array();
    $due = array();
    foreach ($ttls as $name => $ttl) {
        $at = $jobs[$name]['at'] ?? '';
        if ($name === 'grid' && $at === '') {
            gsa_poll_status_note('grid', array('ok' => true, 'deferred' => true, 'ms' => 0));
            continue;
        }
        $age = $at === '' ? PHP_INT_MAX : max(0, time() - strtotime($at . ' UTC'));
        if ($age >= $ttl) {
            $due[] = $name;
        }
    }
    return $due;
}

function runner_print($data)
{
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
}

if ($job === 'loop') {
    fwrite(STDERR, "gsa poll-runner loop pid=" . getmypid() . "\n");
    while (true) {
        $due = runner_due($ttls);
        if (!$due) {
            sleep(15);
            continue;
        }
        foreach ($due as $name) {
            fwrite(STDERR, gmdate('c') . " poll $name\n");
            runner_print(array($name => runner_run($name, $slice)));
        }
        sleep(5);
    }
}

// The live cPanel cron is `poll-runner.php aircraft`. Piggyback jamming
// on that same run (15-minute throttle inside gsa_jamming_refresh).
if ($job === 'aircraft') {
    $out = array();
    if ($skipAircraft) {
        $info = array('ok' => true, 'skipped' => true, 'ms' => 0);
    } else {
        $info = runner_run('aircraft', $slice);
    }
    $out['aircraft'] = $info;
    if (!$skipJam) {
        $out['jamming'] = runner_run('jamming', $slice);
    }
    runner_print($out);
    $airOk = !empty($info['ok']) || !empty($info['busy']) || !empty($info['skipped']);
    $jamOk = $skipJam || !empty($out['jamming']['ok']) || !empty($out['jamming']['busy']) || !empty($out['jamming']['skipped']);
    exit($airOk && $jamOk ? 0 : 2);
}

runner_print(runner_run($job, $slice));
