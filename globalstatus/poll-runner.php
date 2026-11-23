<?php
// Scheduled World Grid pass (#34). Run from cPanel cron, never from the web:
//
//   /usr/local/bin/php -q /home/<user>/public_html/globalstatus.app/poll-runner.php grid
//   php poll-runner.php status
//   php poll-runner.php grid --slice=40     (test: first 40 sites only, never published)
//
// One full "everything" pass is saved to data/scan-cache.json. Visitors'
// LOCK & SCAN replays that file; it never starts a scan.

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
foreach ($argv as $arg) {
    if (strpos($arg, '--slice=') === 0) {
        $slice = (int) substr($arg, 8);
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
if ($job !== 'grid') {
    fwrite(STDERR, "Unknown job: $job (use grid or status)\n");
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
