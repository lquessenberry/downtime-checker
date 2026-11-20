<?php
// One synthetic user (#34). Polls upstream, writes cache, visitors read /api.
//
//   php poll-runner.php status
//   php poll-runner.php outages|mesh|disease|animal|mil|jamming|aircraft|grid
//   php poll-runner.php once
//   php poll-runner.php loop
//   php poll-runner.php grid --slice=16
//
// 3 minutes is the max for AIR/JAM. Grid is ~15 minutes.

define('GSA_RUNNER', true);

$root = __DIR__;
require $root . '/router.php';

$argv = $_SERVER['argv'] ?? array('poll-runner.php');
array_shift($argv);
$job = $argv ? array_shift($argv) : 'status';
$slice = 0;
foreach ($argv as $arg) {
    if (strpos($arg, '--slice=') === 0) {
        $slice = (int) substr($arg, 8);
    }
}

$ttls = array(
    'jamming' => 180,
    'aircraft' => 180,
    'outages' => 180,
    'mil' => 180,
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
        gsa_poll_status_note($name, $info);
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
        return runner_timed('mil', function () {
            $snap = military_snapshot();
            return array(
                'ok' => empty($snap['error']),
                'count' => $snap['count'] ?? 0,
                'error' => $snap['error'] ?? null,
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
        return runner_timed('jamming', function () {
            return jamming_refresh();
        });
    }
    if ($name === 'aircraft') {
        return runner_timed('aircraft', function () {
            return aircraft_refresh();
        });
    }
    if ($name === 'grid') {
        return runner_timed('grid', function () use ($slice) {
            return run_scheduled_scan('everything', '', $slice);
        });
    }
    if ($name === 'once') {
        $out = array();
        foreach (array('outages', 'mesh', 'disease', 'animal', 'mil', 'jamming', 'aircraft') as $job) {
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

runner_print(runner_run($job, $slice));
