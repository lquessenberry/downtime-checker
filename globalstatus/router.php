<?php
// Answers the globe's /api calls on shared hosting. The page stays static.
// The down checker only probes the saved public host list for this site.

$root = __DIR__;
$dataDir = $root . '/data';
$stateFile = $dataDir . '/state.json';
$eventFile = $dataDir . '/events.jsonl';
$lockFile = $dataDir . '/scan.lock';
$stopFile = $dataDir . '/stop.flag';

if (!is_dir($dataDir)) {
    mkdir($dataDir, 0755, true);
}

require $root . '/poll-lib.php';

// Web requests only. poll-runner.php (cron) loads this file for its functions.
if (!defined('GSA_RUNNER')) {
    gsa_http_routes();
}

function gsa_http_routes()
{
    global $root;
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

    if ($path === '/api/events' && $method === 'GET') {
        // Left for pages still open from before the switch. The new page
        // does not open this stream.
        stream_events();
    }
    if ($path === '/api/scan' && $method === 'POST') {
        begin_scan();
    }
    if ($path === '/api/scan-state' && $method === 'GET') {
        $id = isset($_GET['id']) ? (string) $_GET['id'] : 'everything';
        $country = clean_country($_GET['country'] ?? '');
        if (!scan_allowed_id($id)) {
            json_out(400, array('error' => 'Unknown check'));
        }
        json_out(200, gsa_filter_scan_state(gsa_scan_cache_read(), $id, $country));
    }
    if ($path === '/api/poll-status' && $method === 'GET') {
        json_out(200, gsa_poll_status_read());
    }
    if ($path === '/api/manifest' && $method === 'GET') {
        json_out(200, gsa_manifest_read());
    }
    if ($path === '/api/jamming' && $method === 'GET') {
        json_out(200, gsa_jamming_snapshot());
    }
    if ($path === '/api/stop' && $method === 'POST') {
        // Stop is local to each visitor now. Visitors can no longer write
        // data/stop.flag, so nobody can abort the scheduled pass.
        json_out(200, array('ok' => true, 'local' => true));
    }
    if ($path === '/api/aircraft' && $method === 'GET') {
        json_out(200, gsa_aircraft_snapshot());
    }
    if (preg_match('#^/api/aircraft/([0-9a-fA-F]{6})$#', $path, $match) && $method === 'GET') {
        json_out(200, aircraft_detail(strtolower($match[1]), $_GET));
    }
    if ($path === '/api/outages' && $method === 'GET') {
        json_out(200, outages_snapshot());
    }
    if ($path === '/api/mil' && $method === 'GET') {
        json_out(200, military_snapshot());
    }
    if ($path === '/api/mesh' && $method === 'GET') {
        json_out(200, mesh_snapshot());
    }
    if ($path === '/api/disease' && $method === 'GET') {
        json_out(200, disease_snapshot());
    }
    if ($path === '/api/animal' && $method === 'GET') {
        json_out(200, animal_snapshot());
    }

    // SPACE & WEATHER caches written by the */5 cron (poll-lib.php).
    if (preg_match('#^/api/space/(nws|hurricanes|wildfires|tsunami|rivers|coastal)$#', $path, $match) && $method === 'GET') {
        json_out(200, gsa_space_snapshot($match[1]));
    }

    if ($path === '/api/feeds' && $method === 'GET') {
        json_out(200, feeds_with_live_layers());
    }

    $files = array(
        '/api/catalog' => 'api/catalog.json',
        '/api/websdr' => 'api/websdr.json',
        '/api/gpsjam' => 'api/gpsjam.json',
        '/api/conflicts' => 'api/conflicts.json',
        '/api/hunger' => 'api/hunger.json',
        '/api/guns-usa' => 'api/guns-usa.json',
        '/api/guns-world' => 'api/guns-world.json',
        '/api/militias' => 'api/militias.json',
        '/api/radio' => 'api/radio.json',
        '/api/streams' => 'api/streams.json',
        '/api/amfm' => 'api/amfm.json',
    );
    if (isset($files[$path]) && $method === 'GET') {
        $file = $root . '/' . $files[$path];
        if (!is_file($file)) {
            json_out(404, array('error' => 'Missing data'));
        }
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('Content-Length: ' . filesize($file));
        readfile($file);
        exit;
    }

    json_out(404, array('error' => 'Not found'));
}

function json_out($code, $payload)
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload);
    exit;
}

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

function read_state()
{
    global $stateFile;
    if (!is_file($stateFile)) {
        return blank_state();
    }
    $decoded = json_decode((string) file_get_contents($stateFile), true);
    return is_array($decoded) ? $decoded : blank_state();
}

function write_state($state)
{
    global $stateFile;
    $tmp = $stateFile . '.tmp';
    file_put_contents($tmp, json_encode($state));
    rename($tmp, $stateFile);
}

function emit_event($state, $event)
{
    global $eventFile;
    write_state($state);
    $fp = fopen($eventFile, 'ab');
    if ($fp) {
        flock($fp, LOCK_EX);
        fwrite($fp, json_encode($event) . "\n");
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function stream_events()
{
    global $eventFile;
    @set_time_limit(0);
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Accel-Buffering: no');
    $hello = array('type' => 'hello', 'state' => read_state());
    echo 'data: ' . json_encode($hello) . "\n\n";
    flush();
    $offset = is_file($eventFile) ? filesize($eventFile) : 0;
    $deadline = time() + 25;
    while (time() < $deadline && !connection_aborted()) {
        clearstatcache(true, $eventFile);
        $size = is_file($eventFile) ? filesize($eventFile) : 0;
        if ($size < $offset) {
            $offset = 0;
        }
        if ($size > $offset) {
            $fp = fopen($eventFile, 'rb');
            if ($fp) {
                fseek($fp, $offset);
                $chunk = stream_get_contents($fp);
                fclose($fp);
                $offset = $size;
                foreach (preg_split("/\n/", (string) $chunk) as $line) {
                    $line = trim($line);
                    if ($line !== '') {
                        echo 'data: ' . $line . "\n\n";
                    }
                }
                flush();
            }
        } else {
            echo ": ping\n\n";
            flush();
        }
        usleep(300000);
    }
    exit;
}

function catalog_label($id)
{
    global $root;
    $catalog = json_decode((string) file_get_contents($root . '/api/catalog.json'), true);
    foreach (($catalog['searches'] ?? array()) as $search) {
        if (($search['id'] ?? '') === $id) {
            return $search['label'] ?? $id;
        }
    }
    return $id;
}

function load_targets()
{
    global $dataDir;
    $candidates = array(
        $dataDir . '/targets.json',
        '/app/share/targets.json',
    );
    foreach ($candidates as $file) {
        if (!is_file($file)) {
            continue;
        }
        $rows = json_decode((string) file_get_contents($file), true);
        if (is_array($rows) && $rows) {
            return $rows;
        }
    }
    return array();
}

function has_kind($row, $kind)
{
    return in_array($kind, $row['kinds'] ?? array(), true);
}

function select_targets($id, $country)
{
    $rows = load_targets();
    $picked = array();
    foreach ($rows as $row) {
        if (!is_array($row) || empty($row['address'])) {
            continue;
        }
        if (!target_matches($row, $id, $country)) {
            continue;
        }
        $picked[] = $row;
    }
    return $picked;
}

function target_matches($row, $id, $country)
{
    $isUs = ($row['country'] ?? '') === 'United States';
    if ($id === 'country') {
        return $country !== '' && strcasecmp((string) ($row['country'] ?? ''), $country) === 0;
    }
    if ($id === 'everything') {
        return true;
    }
    if ($id === 'united-states' || $id === 'us-everything') {
        return $isUs;
    }
    if ($id === 'world') {
        return ($row['source'] ?? '') === 'world';
    }
    if ($id === 'banks') {
        return has_kind($row, 'banks') || has_kind($row, 'exchanges');
    }
    if ($id === 'us-banks') {
        return $isUs && (has_kind($row, 'banks') || has_kind($row, 'exchanges'));
    }
    $kind = $id;
    if (strpos($id, 'us-') === 0) {
        $kind = substr($id, 3);
        if (!$isUs) {
            return false;
        }
    }
    $aliases = array('transport' => 'transportation');
    if (isset($aliases[$kind])) {
        $kind = $aliases[$kind];
    }
    return has_kind($row, $kind);
}

function clean_country($country)
{
    $country = trim((string) $country);
    return (string) preg_replace('/[^\p{L}\p{N} .()\'’-]/u', '', $country);
}

function scan_allowed_id($id)
{
    $allowed = array(
        'everything', 'world', 'united-states', 'banks', 'tech', 'utilities', 'education',
        'medical', 'exchanges', 'transport', 'stores', 'communications', 'military',
        'shipping', 'food', 'weather', 'country', 'us-everything', 'us-banks', 'us-tech',
        'us-utilities', 'us-government', 'us-education', 'us-medical', 'us-exchanges',
        'us-transport', 'us-stores', 'us-communications', 'us-military', 'us-shipping',
        'us-food', 'us-weather',
    );
    return in_array($id, $allowed, true);
}

// LOCK & SCAN: serve the last scheduled pass for this test. No new scan.
function begin_scan()
{
    $body = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($body)) {
        $body = array();
    }
    $id = isset($body['id']) ? (string) $body['id'] : '';
    $country = clean_country($body['country'] ?? '');
    if (!scan_allowed_id($id)) {
        json_out(400, array('error' => 'Unknown check'));
    }
    $snap = gsa_scan_cache_read();
    $filtered = gsa_filter_scan_state($snap, $id, $country);
    $pending = !empty($filtered['pending']);
    json_out(200, array(
        'ok' => true,
        'replay' => true,
        'pending' => $pending,
        'state' => $filtered,
        'error' => $pending ? 'Grid pass not ready yet' : null,
    ));
}

// Cron only (poll-runner.php grid). Same lock as before, so passes never overlap.
function run_scheduled_scan($id = 'everything', $country = '', $slice = 0)
{
    global $lockFile, $stopFile;
    $lock = fopen($lockFile, 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        if ($lock) {
            fclose($lock);
        }
        return array('ok' => false, 'busy' => true, 'error' => 'A pass is already running');
    }
    @unlink($stopFile);
    $targets = select_targets($id, $country);
    if ($slice > 0) {
        $targets = array_slice($targets, 0, $slice);
    }
    $state = blank_state();
    $state['running'] = true;
    $state['scanId'] = time();
    $state['heading'] = catalog_label($id);
    $state['searchId'] = $id;
    $state['total'] = count($targets);
    $state['startedAt'] = (int) round(microtime(true) * 1000);
    $state['results'] = array_fill(0, count($targets), null);
    $state = run_scan($state, $targets, $lock, false, microtime(true) + GSA_GRID_MAX_SEC);
    $info = array(
        'up' => $state['up'],
        'down' => $state['down'],
        'done' => $state['done'],
        'total' => $state['total'],
        'mode' => $state['mode'] ?? '',
        'ms' => $state['ms'] ?? 0,
    );
    $problem = gsa_pass_problem($state);
    if ($problem === null && $slice > 0) {
        $problem = 'Test slice, not published';
    }
    if ($problem !== null) {
        $info['ok'] = false;
        $info['published'] = false;
        $info['error'] = $problem;
        $info['kept'] = is_file(gsa_scan_cache_file()) ? 'last good pass' : 'nothing saved yet';
        return $info;
    }
    $put = gsa_cache_put(gsa_scan_cache_file(), $state);
    $info['ok'] = empty($put['error']);
    $info['published'] = $info['ok'];
    $info['bytes'] = $put['bytes'] ?? 0;
    $info['error'] = $put['error'] ?? null;
    return $info;
}

function close_http($payload, $code)
{
    $body = json_encode($payload);
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('Connection: close');
    header('Content-Length: ' . strlen($body));
    echo $body;
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        return;
    }
    if (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
        return;
    }
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
}

function run_scan($state, $targets, $lock, $halt = true, $deadline = 0)
{
    global $stopFile;
    @set_time_limit(0);
    ignore_user_abort(true);
    $started = microtime(true);
    $mode = probe_mode();
    $batchSize = $mode === 'ping' ? 20 : 16;
    $state['mode'] = $mode;
    $state['batchSize'] = $batchSize;
    $count = count($targets);
    for ($offset = 0; $offset < $count; $offset += $batchSize) {
        $late = $deadline > 0 && microtime(true) >= $deadline;
        if (is_file($stopFile) || $late) {
            $state['running'] = false;
            $state['stopped'] = !$late;
            $state['timedOut'] = $late;
            $state['finishedAt'] = (int) round(microtime(true) * 1000);
            $state['ms'] = (int) round((microtime(true) - $started) * 1000);
            if ($halt) {
                emit_event($state, array('type' => 'scan-stop', 'scanId' => $state['scanId']));
            } else {
                write_state($state);
            }
            flock($lock, LOCK_UN);
            fclose($lock);
            if ($halt) {
                exit;
            }
            return $state;
        }
        $slice = array_slice($targets, $offset, $batchSize, true);
        $checked = $mode === 'ping' ? ping_batch($slice) : https_batch($slice);
        foreach ($checked as $index => $probe) {
            $row = $targets[$index];
            $status = $probe['status'];
            if ($status === 'up') {
                $state['up']++;
            } else {
                $state['down']++;
            }
            $state['done']++;
            $result = array(
                'name' => $row['name'],
                'address' => $row['address'],
                'country' => $row['country'],
                'kinds' => $row['kinds'],
                'source' => $row['source'],
                'status' => $status,
                'method' => $probe['method'],
                'ms' => $probe['ms'],
                'ip' => $probe['ip'],
                'ips' => $probe['ip'] !== '' ? array($probe['ip']) : array(),
                'location' => $row['location'] ?: $row['country'],
                'city' => '',
                'region' => '',
                'lat' => $row['lat'],
                'lon' => $row['lon'],
                'approx' => true,
                'index' => $index,
            );
            $state['results'][$index] = $result;
            if ($halt) {
                emit_event($state, array(
                    'type' => 'result',
                    'scanId' => $state['scanId'],
                    'done' => $state['done'],
                    'up' => $state['up'],
                    'down' => $state['down'],
                    'result' => $result,
                ));
            }
        }
    }
    $state['running'] = false;
    $state['finishedAt'] = (int) round(microtime(true) * 1000);
    $state['ms'] = (int) round((microtime(true) - $started) * 1000);
    if ($halt) {
        emit_event($state, array(
            'type' => 'scan-done',
            'scanId' => $state['scanId'],
            'up' => $state['up'],
            'down' => $state['down'],
            'total' => $state['total'],
            'ms' => $state['ms'],
        ));
    }
    flock($lock, LOCK_UN);
    fclose($lock);
    if ($halt) {
        exit;
    }
    return $state;
}

function probe_mode()
{
    $forced = getenv('GSA_PROBE_MODE');
    if ($forced === 'https' || $forced === 'ping') {
        return $forced;
    }
    if (!function_exists('proc_open')) {
        return 'https';
    }
    $pipes = array();
    $proc = @proc_open(array('ping', '-c', '1', '-W', '1', '127.0.0.1'), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
    if (!is_resource($proc)) {
        return 'https';
    }
    foreach ($pipes as $pipe) {
        fclose($pipe);
    }
    $code = proc_close($proc);
    return $code === 0 ? 'ping' : 'https';
}

function safe_host($host)
{
    $host = strtolower(trim((string) $host));
    return preg_match('/^[a-z0-9.-]+$/', $host) ? $host : '';
}

function ping_batch($slice)
{
    $jobs = array();
    foreach ($slice as $index => $row) {
        $host = safe_host($row['address']);
        $pipes = array();
        $proc = $host === '' ? null : @proc_open(
            array('ping', '-n', '-c', '1', '-W', '2', $host),
            array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')),
            $pipes
        );
        if (is_resource($proc)) {
            stream_set_blocking($pipes[1], false);
            stream_set_blocking($pipes[2], false);
        }
        $jobs[$index] = array(
            'proc' => is_resource($proc) ? $proc : null,
            'pipes' => $pipes,
            'out' => '',
            'start' => microtime(true),
            'row' => $row,
        );
    }
    $pending = $jobs;
    $done = array();
    while ($pending) {
        $still = array();
        foreach ($pending as $index => $job) {
            if (!$job['proc']) {
                $done[$index] = array('status' => 'down', 'method' => 'ping', 'ms' => 0, 'ip' => '');
                continue;
            }
            $job['out'] .= (string) stream_get_contents($job['pipes'][1]);
            $status = proc_get_status($job['proc']);
            if ($status['running'] && (microtime(true) - $job['start']) < 4) {
                $still[$index] = $job;
                continue;
            }
            if ($status['running']) {
                proc_terminate($job['proc']);
            }
            foreach ($job['pipes'] as $pipe) {
                if (is_resource($pipe)) {
                    fclose($pipe);
                }
            }
            $exit = proc_close($job['proc']);
            $ip = '';
            if (preg_match('/\(([0-9.]+)\)/', $job['out'], $match)) {
                $ip = $match[1];
            }
            $up = $exit === 0;
            $done[$index] = array(
                'status' => $up ? 'up' : 'down',
                'method' => 'ping',
                'ms' => (int) round((microtime(true) - $job['start']) * 1000),
                'ip' => $ip,
            );
        }
        $pending = $still;
        if ($pending) {
            usleep(40000);
        }
    }
    return $done;
}

function https_batch($slice)
{
    if (!function_exists('curl_multi_init')) {
        $done = array();
        foreach ($slice as $index => $row) {
            $done[$index] = array('status' => 'down', 'method' => 'https', 'ms' => 0, 'ip' => '');
        }
        return $done;
    }
    $multi = curl_multi_init();
    $handles = array();
    foreach ($slice as $index => $row) {
        $host = safe_host($row['address']);
        $ch = curl_init($host === '' ? 'http://127.0.0.1/' : 'https://' . $host . '/');
        curl_setopt_array($ch, array(
            CURLOPT_NOBODY => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT => browser_agent(),
        ));
        curl_multi_add_handle($multi, $ch);
        $handles[$index] = array($ch, microtime(true), $host !== '');
    }
    $active = null;
    do {
        $code = curl_multi_exec($multi, $active);
        if ($active) {
            curl_multi_select($multi, 0.2);
        }
    } while ($active && $code === CURLM_OK);
    $done = array();
    foreach ($handles as $index => $item) {
        $ch = $item[0];
        $http = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $errno = curl_errno($ch);
        $ip = (string) curl_getinfo($ch, CURLINFO_PRIMARY_IP);
        $up = $item[2] && $errno === 0 && $http > 0;
        $done[$index] = array(
            'status' => $up ? 'up' : 'down',
            'method' => 'https',
            'ms' => (int) round((microtime(true) - $item[1]) * 1000),
            'ip' => $ip,
        );
        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
    }
    curl_multi_close($multi);
    return $done;
}

function browser_agent()
{
    return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

function remote_json($url, $post = null)
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $ch = curl_init($url);
    $headers = array('Accept: application/json', 'User-Agent: ' . browser_agent());
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => $headers,
    ));
    if ($post !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $post);
    }
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $code >= 400) {
        return null;
    }
    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : null;
}

function outage_coverage_note()
{
    return 'US pins are counties from utilities that report to DOE/ORNL ODIN, not every US outage. '
        . 'United Kingdom pins are unplanned outages from UK Power Networks, Northern Powergrid, and National Grid Electricity Distribution. '
        . 'SP Energy Networks, Electricity North West, Northern Ireland Electricity, and SSEN are not included. '
        . 'Canada pins are Hydro-Québec unplanned outages only. '
        . 'Australia, Ireland, New Zealand, and South Africa do not publish an open live location feed that can be pinned.';
}

function outage_credit_text()
{
    return 'U.S. Department of Energy and Oak Ridge National Laboratory, Outage Data Initiative Nationwide. County locations are U.S. Census centroids. '
        . 'United Kingdom: UK Power Networks (CC BY 4.0), Northern Powergrid open data, and National Grid Electricity Distribution open data. '
        . 'Canada: Hydro-Québec outage markers, which are indicative. '
        . 'Australia, Ireland, New Zealand, and South Africa are not pinned.';
}

function outages_snapshot()
{
    global $dataDir;
    $lock = fopen($dataDir . '/outages.lock', 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    try {
        return outages_snapshot_locked();
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

function outages_snapshot_locked()
{
    global $root, $dataDir;
    $cacheFile = $dataDir . '/outages-cache.json';
    $ttl = 300;
    $http = gsa_http_serve_cache($cacheFile, $ttl, 'ODIN', 'https://odin.ornl.gov/');
    if ($http !== null) {
        return $http;
    }
    $cached = null;
    if (is_file($cacheFile)) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
    }
    $fresh = is_array($cached) && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $ttl;
    if ($fresh) {
        unset($cached['fetchedAt']);
        $cached['stale'] = false;
        return $cached;
    }
    $raw = outage_fetch('https://odin.ornl.gov/odi?format=JSON&view=county');
    if (!is_array($raw) || !isset($raw['outage']) || !is_array($raw['outage'])) {
        if (is_array($cached) && !empty($cached['points'])) {
            unset($cached['fetchedAt']);
            $cached['stale'] = true;
            return $cached;
        }
        $built = outages_attach_world(array(
            'sourceUrl' => 'https://odin.ornl.gov/',
            'updated' => gmdate('Y-m-d\TH:i:s\Z'),
            'stale' => false,
            'error' => 'ODIN did not answer',
            'customers' => 0,
            'counties' => 0,
            'utilities' => 0,
            'points' => array(),
        ), true);
        if (!empty($built['points'])) {
            $stored = $built;
            $stored['fetchedAt'] = time();
            gsa_snapshot_put($cacheFile, $stored, gsa_source_from_file($cacheFile));
        }
        return $built;
    }
    $built = outages_attach_world(outages_build($root, $raw), false);
    $stored = $built;
    $stored['fetchedAt'] = time();
    gsa_snapshot_put($cacheFile, $stored, gsa_source_from_file($cacheFile));
    unset($built['fetchedAt']);
    return $built;
}

function outage_body($url)
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => array(
            'Accept: application/json, text/csv, */*',
            'User-Agent: GlobalStatusApp/1.0 (https://globalstatus.app)',
        ),
    ));
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $code < 200 || $code >= 400) {
        return null;
    }
    return (string) $body;
}

function outage_num($value)
{
    if (is_int($value) || is_float($value)) {
        return $value + 0;
    }
    if (!is_string($value)) {
        return null;
    }
    $value = trim($value);
    if ($value === '' || !is_numeric($value)) {
        return null;
    }
    return $value + 0;
}

function outage_make($id, $name, $state, $lat, $lon, $customers, $utilities, $country, $source, $box)
{
    $lat = outage_num($lat);
    $lon = outage_num($lon);
    $customers = (int) $customers;
    if ($lat === null || $lon === null || $customers < 1) {
        return null;
    }
    if ($lat < $box[0] || $lat > $box[1] || $lon < $box[2] || $lon > $box[3]) {
        return null;
    }
    $id = substr(preg_replace('/[^A-Za-z0-9._-]/', '-', (string) $id), 0, 80);
    if ($id === '' || $id === '-') {
        return null;
    }
    $clean = array();
    foreach ($utilities as $utility) {
        $utility = trim((string) $utility);
        if ($utility !== '') {
            $clean[] = $utility;
        }
    }
    return array(
        'id' => $id,
        'name' => $name !== '' ? $name : $country,
        'state' => $state !== '' ? $state : $country,
        'country' => $country,
        'lat' => $lat,
        'lon' => $lon,
        'customers' => $customers,
        'utilities' => $clean,
        'source' => $source,
    );
}

function outage_postcode_label($value)
{
    if (is_array($value)) {
        $value = $value[0] ?? '';
    }
    $value = trim((string) preg_replace('/\s+/', ' ', (string) $value));
    $parts = preg_split('/[;,]/', $value, 2);
    return trim((string) ($parts[0] ?? ''));
}

function outage_ods_results($url, $where, $cap = 300)
{
    $rows = array();
    $offset = 0;
    $limit = 100;
    while ($offset < $cap) {
        $page = $url . '?limit=' . $limit . '&offset=' . $offset . '&where=' . rawurlencode($where);
        $decoded = json_decode((string) outage_body($page), true);
        if (!is_array($decoded)) {
            break;
        }
        $batch = $decoded['results'] ?? null;
        if (!is_array($batch) || !$batch) {
            break;
        }
        foreach ($batch as $row) {
            if (is_array($row)) {
                $rows[] = $row;
            }
        }
        $offset += count($batch);
        $total = (int) ($decoded['total_count'] ?? 0);
        if (count($batch) < $limit || ($total > 0 && $offset >= $total)) {
            break;
        }
    }
    if (count($rows) > $cap) {
        $rows = array_slice($rows, 0, $cap);
    }
    return $rows;
}

function outages_ukpn()
{
    $rows = outage_ods_results(
        'https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults/records',
        'powercuttype="Unplanned" AND nocustomeraffected>0'
    );
    $box = array(49.0, 61.2, -8.8, 2.3);
    $points = array();
    foreach ($rows as $row) {
        if (strcasecmp((string) ($row['powercuttype'] ?? ''), 'Unplanned') !== 0) {
            continue;
        }
        $geo = $row['geopoint'] ?? null;
        if (!is_array($geo)) {
            continue;
        }
        $name = outage_postcode_label($row['postcodesaffected'] ?? '');
        $zone = trim((string) ($row['operatingzone'] ?? ''));
        $point = outage_make(
            'ukpn-' . ($row['incidentreference'] ?? ''),
            $name !== '' ? $name : 'United Kingdom',
            $zone !== '' ? $zone : 'United Kingdom',
            $geo['lat'] ?? null,
            $geo['lon'] ?? null,
            (int) ($row['nocustomeraffected'] ?? 0),
            array('UK Power Networks'),
            'United Kingdom',
            'UK Power Networks',
            $box
        );
        if ($point) {
            $points[] = $point;
        }
    }
    return $points;
}

function outages_npg()
{
    $rows = outage_ods_results(
        'https://northernpowergrid.opendatasoft.com/api/explore/v2.1/catalog/datasets/live-power-cuts-data/records',
        'isaffected=1 AND totalconfirmedpowercut>0'
    );
    $box = array(49.0, 61.2, -8.8, 2.3);
    $points = array();
    foreach ($rows as $row) {
        if ((int) ($row['isaffected'] ?? 0) !== 1) {
            continue;
        }
        $nature = strtolower((string) ($row['natureofoutage'] ?? ''));
        if (strpos($nature, 'planned') !== false) {
            continue;
        }
        $geo = is_array($row['geopoint'] ?? null) ? $row['geopoint'] : null;
        $name = outage_postcode_label($row['postcode'] ?? '');
        $area = trim((string) ($row['area'] ?? ''));
        $point = outage_make(
            'npg-' . ($row['reference'] ?? ''),
            $name !== '' ? $name : 'United Kingdom',
            $area !== '' ? $area : 'United Kingdom',
            $geo['lat'] ?? ($row['lat'] ?? null),
            $geo['lon'] ?? ($row['lng'] ?? null),
            (int) ($row['totalconfirmedpowercut'] ?? 0),
            array('Northern Powergrid'),
            'United Kingdom',
            'Northern Powergrid',
            $box
        );
        if ($point) {
            $points[] = $point;
        }
    }
    return $points;
}

function outages_nged()
{
    $body = outage_body('https://connecteddata.nationalgrid.co.uk/dataset/d6672e1e-c684-4cea-bb78-c7e5248b62a2/resource/a1365982-4e05-463c-8304-8323a2ba0ccd/download/live_detailed_power_cuts.csv');
    if ($body === null || $body === '') {
        return array();
    }
    $handle = fopen('php://temp', 'r+');
    if (!$handle) {
        return array();
    }
    fwrite($handle, $body);
    rewind($handle);
    $header = fgetcsv($handle);
    if (!is_array($header)) {
        fclose($handle);
        return array();
    }
    $box = array(49.0, 61.2, -8.8, 2.3);
    $points = array();
    while (($cols = fgetcsv($handle)) !== false) {
        if (!is_array($cols)) {
            continue;
        }
        $row = array();
        foreach ($header as $i => $name) {
            $row[$name] = $cols[$i] ?? '';
        }
        $planned = strtolower(trim((string) ($row['planned'] ?? '')));
        if ($planned === 'true' || $planned === '1' || $planned === 'yes') {
            continue;
        }
        $name = outage_postcode_label($row['postcode'] ?? '');
        $area = trim((string) ($row['licence_area'] ?? ''));
        $point = outage_make(
            'nged-' . ($row['fault_id'] ?? ''),
            $name !== '' ? $name : 'United Kingdom',
            $area !== '' ? $area : 'United Kingdom',
            $row['location_latitude'] ?? null,
            $row['location_longitude'] ?? null,
            (int) ($row['confirmed_off'] ?? 0),
            array('National Grid Electricity Distribution'),
            'United Kingdom',
            'National Grid Electricity Distribution',
            $box
        );
        if ($point) {
            $points[] = $point;
        }
    }
    fclose($handle);
    return $points;
}

function outage_is_list($value)
{
    if (!is_array($value)) {
        return false;
    }
    $i = 0;
    foreach ($value as $key => $unused) {
        if ($key !== $i) {
            return false;
        }
        $i++;
    }
    return true;
}

function outages_hydroquebec()
{
    $version = json_decode((string) outage_body('https://pannes.hydroquebec.com/pannes/donnees/v3_0/bisversion.json'), true);
    if (!is_string($version) || !preg_match('/^\d{10,20}$/', $version)) {
        return array();
    }
    $decoded = json_decode((string) outage_body(
        'https://pannes.hydroquebec.com/pannes/donnees/v3_0/bismarkers' . $version . '.json'
    ), true);
    $rows = array();
    if (is_array($decoded) && isset($decoded['pannes']) && is_array($decoded['pannes'])) {
        $rows = $decoded['pannes'];
    } elseif (outage_is_list($decoded)) {
        $rows = $decoded;
    }
    $box = array(44.0, 63.5, -80.5, -56.0);
    $points = array();
    foreach ($rows as $row) {
        if (!is_array($row) || count($row) < 5 || (string) ($row[3] ?? '') !== 'P') {
            continue;
        }
        $coords = json_decode((string) $row[4], true);
        if (!is_array($coords) || count($coords) < 2) {
            continue;
        }
        $lat = outage_num($coords[1]);
        $lon = outage_num($coords[0]);
        if ($lat === null || $lon === null) {
            continue;
        }
        $stamp = preg_replace('/\D/', '', (string) ($row[1] ?? ''));
        $point = outage_make(
            'hq-' . $stamp . '-' . sprintf('%.4f', $lat) . '-' . sprintf('%.4f', $lon),
            'Quebec',
            'Canada',
            $lat,
            $lon,
            (int) ($row[0] ?? 0),
            array('Hydro-Québec'),
            'Canada',
            'Hydro-Québec',
            $box
        );
        if ($point) {
            $points[] = $point;
        }
    }
    if (count($points) > 1500) {
        usort($points, function ($a, $b) {
            return $b['customers'] <=> $a['customers'];
        });
        $points = array_slice($points, 0, 1500);
    }
    return $points;
}

function outages_world_points()
{
    $points = array();
    foreach (array('outages_ukpn', 'outages_npg', 'outages_nged', 'outages_hydroquebec') as $fn) {
        try {
            $rows = $fn();
        } catch (Throwable $e) {
            $rows = array();
        }
        if (!is_array($rows)) {
            continue;
        }
        foreach ($rows as $row) {
            if (is_array($row) && isset($row['lat'], $row['lon'])) {
                $points[] = $row;
            }
        }
    }
    return $points;
}

function outages_attach_world($built, $usFailed)
{
    if (!is_array($built)) {
        $built = array('points' => array());
    }
    $points = is_array($built['points'] ?? null) ? $built['points'] : array();
    $world = outages_world_points();
    if ($world) {
        $points = array_merge($points, $world);
    }
    usort($points, function ($a, $b) {
        $left = (int) ($a['customers'] ?? 0);
        $right = (int) ($b['customers'] ?? 0);
        if ($left === $right) {
            return strcmp((string) ($a['name'] ?? ''), (string) ($b['name'] ?? ''));
        }
        return $right <=> $left;
    });
    $customers = 0;
    foreach ($points as $point) {
        $customers += (int) ($point['customers'] ?? 0);
    }
    $built['points'] = $points;
    $built['customers'] = $customers;
    $note = outage_coverage_note();
    if ($usFailed) {
        $note = 'The US feed did not answer this time. ' . $note;
    }
    $built['note'] = $note;
    $built['credit'] = outage_credit_text();
    $built['source'] = 'DOE/ORNL ODIN, UK Power Networks, Northern Powergrid, National Grid Electricity Distribution, Hydro-Québec';
    return $built;
}

function outage_fetch($url, $agent = '')
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $ua = $agent !== '' ? $agent : 'GlobalStatusApp/1.0 (https://globalstatus.app)';
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => array(
            'Accept: application/json',
            'User-Agent: ' . $ua,
        ),
    ));
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $code >= 400) {
        return null;
    }
    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : null;
}

function outages_build($root, $raw)
{
    $centroids = json_decode((string) @file_get_contents($root . '/api/county-centroids.json'), true);
    if (!is_array($centroids)) {
        $centroids = array('counties' => array());
    }
    $index = array();
    foreach (($centroids['counties'] ?? array()) as $county) {
        if (!is_array($county)) {
            continue;
        }
        $geoid = (string) ($county['geoid'] ?? '');
        if ($geoid !== '') {
            $index[$geoid] = $county;
        }
    }
    $grouped = array();
    foreach ($raw['outage'] as $row) {
        if (!is_array($row)) {
            continue;
        }
        $digits = preg_replace('/\D/', '', (string) ($row['communityDescriptor'] ?? ''));
        if ($digits === '') {
            continue;
        }
        $fips = str_pad($digits, 5, '0', STR_PAD_LEFT);
        if (strlen($fips) !== 5) {
            continue;
        }
        $meters = (int) ($row['metersAffected'] ?? 0);
        if ($meters < 1) {
            continue;
        }
        $utility = '';
        foreach (($row['names'] ?? array()) as $name) {
            if (is_array($name) && ($name['nameType'] ?? '') === 'UtilityName') {
                $utility = (string) ($name['name'] ?? $utility);
            }
        }
        if (!isset($grouped[$fips])) {
            $grouped[$fips] = array('customers' => 0, 'utilities' => array());
        }
        $grouped[$fips]['customers'] += $meters;
        if ($utility !== '') {
            $grouped[$fips]['utilities'][$utility] = true;
        }
    }
    $points = array();
    $utilityNames = array();
    foreach ($grouped as $fips => $slot) {
        if (!isset($index[$fips])) {
            continue;
        }
        $county = $index[$fips];
        $utilities = array_keys($slot['utilities']);
        sort($utilities);
        foreach ($utilities as $name) {
            $utilityNames[$name] = true;
        }
        $points[] = array(
            'id' => $fips,
            'name' => (string) ($county['name'] ?? $fips),
            'state' => (string) ($county['usps'] ?? ''),
            'country' => 'United States',
            'lat' => $county['lat'] ?? null,
            'lon' => $county['lon'] ?? null,
            'customers' => $slot['customers'],
            'utilities' => $utilities,
            'source' => 'DOE/ORNL ODIN',
        );
    }
    usort($points, function ($a, $b) {
        if ($a['customers'] === $b['customers']) {
            return strcmp($a['name'], $b['name']);
        }
        return $b['customers'] <=> $a['customers'];
    });
    $customers = 0;
    foreach ($points as $point) {
        $customers += $point['customers'];
    }
    return array(
        'source' => 'DOE/ORNL ODIN',
        'sourceUrl' => 'https://odin.ornl.gov/',
        'credit' => outage_credit_text(),
        'note' => outage_coverage_note(),
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'stale' => false,
        'customers' => $customers,
        'counties' => count($points),
        'utilities' => count($utilityNames),
        'points' => $points,
    );
}

function feeds_with_live_layers()
{
    global $root;
    $file = $root . '/api/feeds.json';
    $pack = array();
    if (is_file($file)) {
        $decoded = json_decode((string) file_get_contents($file), true);
        if (is_array($decoded)) {
            $pack = $decoded;
        }
    }
    // Ships and conflicts stay as they are in the static file.
    // Aircraft and jamming come from the cron caches so visitors never
    // trigger adsb.lol or api.gpsinterference.com.
    $pack['aircraft'] = gsa_aircraft_snapshot();
    $pack['jamming'] = gsa_jamming_snapshot();
    return $pack;
}

function feeds_with_live_aircraft()
{
    return feeds_with_live_layers();
}

function military_snapshot()
{
    $snap = gsa_aircraft_snapshot();
    $points = array();
    foreach (($snap['points'] ?? array()) as $point) {
        if (is_array($point) && !empty($point['mil'])) {
            $points[] = $point;
        }
    }
    $error = $snap['error'] ?? null;
    if (!$points && $error === null && empty($snap['points'])) {
        $error = 'Awaiting poller';
    }
    return array(
        'source' => 'adsb.lol',
        'sourceUrl' => 'https://api.adsb.lol/v2/mil',
        'updated' => $snap['updated'] ?? null,
        'attribution' => 'adsb.lol (ODbL 1.0)',
        'stale' => !empty($snap['stale']) || !$points,
        'error' => $error,
        'count' => count($points),
        'points' => $points,
        'ageSec' => $snap['ageSec'] ?? null,
    );
}

function aircraft_detail($hex, $query)
{
    global $root;
    $detail = array('hex' => $hex, 'live' => null, 'photo' => null, 'route' => null, 'typeInfo' => null, 'cached' => true);
    $aircraft = null;
    $snap = gsa_aircraft_snapshot();
    foreach (($snap['points'] ?? array()) as $point) {
        if (is_array($point) && strtolower((string) ($point['hex'] ?? '')) === $hex) {
            $aircraft = $point;
            break;
        }
    }
    if (is_array($aircraft)) {
        $detail['live'] = array(
            'hex' => $hex,
            'flight' => $aircraft['name'] ?? '',
            'r' => $aircraft['r'] ?? '',
            't' => $aircraft['t'] ?? '',
            'squawk' => $aircraft['squawk'] ?? '',
            'gs' => $aircraft['gs'] ?? null,
            'alt_baro' => $aircraft['alt'] ?? null,
            'track' => $aircraft['track'] ?? null,
            'lat' => $aircraft['lat'] ?? null,
            'lon' => $aircraft['lon'] ?? null,
            'baro_rate' => $aircraft['baro_rate'] ?? null,
            'seen_pos' => $aircraft['seen_pos'] ?? null,
            'type' => $aircraft['src'] ?? '',
            'emergency' => $aircraft['emergency'] ?? null,
            'category' => $aircraft['category'] ?? '',
            'mil' => !empty($aircraft['mil']),
        );
    }
    $typeCode = is_array($aircraft) ? strtoupper(trim((string) ($aircraft['t'] ?? ''))) : '';
    if ($typeCode === '' && isset($query['type'])) {
        $typeCode = strtoupper(trim((string) $query['type']));
    }
    if ($typeCode !== '') {
        $types = json_decode((string) @file_get_contents($root . '/api/icao_aircraft_types.json'), true);
        if (is_array($types) && isset($types[$typeCode]) && is_array($types[$typeCode])) {
            $detail['typeInfo'] = array(
                'desc' => $types[$typeCode]['desc'] ?? '',
                'wtc' => $types[$typeCode]['wtc'] ?? '',
            );
        }
    }
    // Photos come from PlaneSpotters, not adsb.lol, and do not spend the
    // 500/day cap. Skip quietly if the photo service is down.
    $photos = remote_json('https://api.planespotters.net/pub/photos/hex/' . strtoupper($hex));
    if (is_array($photos) && !empty($photos['photos'][0]) && is_array($photos['photos'][0])) {
        $photo = $photos['photos'][0];
        $thumb = $photo['thumbnail_large'] ?? ($photo['thumbnail'] ?? array());
        $src = is_array($thumb) ? (string) ($thumb['src'] ?? '') : '';
        if (strpos($src, 'https://') === 0) {
            $detail['photo'] = array(
                'src' => $src,
                'link' => $photo['link'] ?? '',
                'photographer' => $photo['photographer'] ?? '',
            );
        }
    }
    return $detail;
}

function mesh_snapshot()
{
    global $dataDir;
    $lock = fopen($dataDir . '/mesh.lock', 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    try {
        return mesh_snapshot_locked();
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

function mesh_degrees($value, $limit)
{
    if (!is_numeric($value)) {
        return null;
    }
    $n = (float) $value;
    if (abs($n) > $limit) {
        $n = $n / 10000000.0;
    }
    if ($n < -$limit || $n > $limit) {
        return null;
    }
    return round($n, 5);
}

function mesh_snapshot_locked()
{
    global $dataDir;
    $cacheFile = $dataDir . '/mesh-cache.json';
    $ttl = 300;
    $http = gsa_http_serve_cache($cacheFile, $ttl, 'meshmap.net', 'https://meshmap.net/');
    if ($http !== null) {
        return $http;
    }
    $cached = null;
    if (is_file($cacheFile)) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
    }
    if (is_array($cached) && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $ttl && !empty($cached['points'])) {
        unset($cached['fetchedAt']);
        $cached['stale'] = false;
        return $cached;
    }
    $raw = null;
    if (function_exists('curl_init')) {
        $ch = curl_init('https://meshmap.net/nodes.json');
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 25,
            CURLOPT_HTTPHEADER => array(
                'Accept: application/json',
                'User-Agent: GlobalStatusApp/1.0 (https://globalstatus.app)',
            ),
        ));
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($body !== false && $code >= 200 && $code < 400) {
            $decoded = json_decode((string) $body, true);
            if (is_array($decoded)) {
                $raw = $decoded;
            }
        }
    }
    if (!is_array($raw)) {
        if (is_array($cached) && !empty($cached['points'])) {
            unset($cached['fetchedAt']);
            $cached['stale'] = true;
            return $cached;
        }
        return array(
            'source' => 'meshmap.net',
            'sourceUrl' => 'https://meshmap.net/',
            'updated' => gmdate('Y-m-d\TH:i:s\Z'),
            'stale' => false,
            'error' => 'MeshMap did not answer',
            'count' => 0,
            'points' => array(),
        );
    }
    $points = array();
    foreach ($raw as $id => $node) {
        if (!is_array($node)) {
            continue;
        }
        $lat = mesh_degrees($node['latitude'] ?? null, 90);
        $lon = mesh_degrees($node['longitude'] ?? null, 180);
        if ($lat === null || $lon === null || ($lat == 0.0 && $lon == 0.0)) {
            continue;
        }
        $name = trim((string) ($node['longName'] ?? ''));
        $short = trim((string) ($node['shortName'] ?? ''));
        if ($name === '') {
            $name = $short !== '' ? $short : (string) $id;
        }
        $points[] = array(
            'id' => (string) $id,
            'name' => $name,
            'short' => $short,
            'hw' => (string) ($node['hwModel'] ?? ''),
            'role' => (string) ($node['role'] ?? ''),
            'lat' => $lat,
            'lon' => $lon,
        );
    }
    if (!$points) {
        if (is_array($cached) && !empty($cached['points'])) {
            unset($cached['fetchedAt']);
            $cached['stale'] = true;
            return $cached;
        }
        return array(
            'source' => 'meshmap.net',
            'sourceUrl' => 'https://meshmap.net/',
            'updated' => gmdate('Y-m-d\TH:i:s\Z'),
            'stale' => false,
            'error' => 'MeshMap had no positions',
            'count' => 0,
            'points' => array(),
        );
    }
    $built = array(
        'source' => 'meshmap.net',
        'sourceUrl' => 'https://meshmap.net/',
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'stale' => false,
        'count' => count($points),
        'points' => $points,
    );
    $stored = $built;
    $stored['fetchedAt'] = time();
    gsa_snapshot_put($cacheFile, $stored, gsa_source_from_file($cacheFile));
    return $built;
}

function outbreak_coord($value, $limit)
{
    if (!is_numeric($value)) {
        return null;
    }
    $n = (float) $value;
    if ($n < -$limit || $n > $limit) {
        return null;
    }
    return round($n, 5);
}

function outbreak_lock($name, $callback)
{
    global $dataDir;
    $lock = fopen($dataDir . '/' . $name . '.lock', 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    try {
        return $callback();
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

function outbreak_fetch($url, $timeout)
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HTTPHEADER => array(
            'Accept: application/json',
            'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ),
    ));
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $code < 200 || $code >= 400) {
        return null;
    }
    $decoded = json_decode((string) $body, true);
    return is_array($decoded) ? $decoded : null;
}

function outbreak_cached($cacheFile, $ttl, $fetch, $emptyError, $source, $sourceUrl)
{
    $http = gsa_http_serve_cache($cacheFile, $ttl, $source, $sourceUrl);
    if ($http !== null) {
        return $http;
    }
    $cached = null;
    if (is_file($cacheFile)) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
    }
    if (is_array($cached) && (time() - (int) ($cached['fetchedAt'] ?? 0)) < $ttl && !empty($cached['points'])) {
        unset($cached['fetchedAt']);
        $cached['stale'] = false;
        return $cached;
    }
    $points = $fetch();
    if (!$points) {
        if (is_array($cached) && !empty($cached['points'])) {
            unset($cached['fetchedAt']);
            $cached['stale'] = true;
            return $cached;
        }
        return array(
            'source' => $source,
            'sourceUrl' => $sourceUrl,
            'updated' => gmdate('Y-m-d\TH:i:s\Z'),
            'stale' => false,
            'error' => $emptyError,
            'count' => 0,
            'points' => array(),
        );
    }
    $built = array(
        'source' => $source,
        'sourceUrl' => $sourceUrl,
        'updated' => gmdate('Y-m-d\TH:i:s\Z'),
        'stale' => false,
        'count' => count($points),
        'points' => $points,
    );
    $stored = $built;
    $stored['fetchedAt'] = time();
    gsa_snapshot_put($cacheFile, $stored, gsa_source_from_file($cacheFile));
    return $built;
}

function disease_clip($text, $limit)
{
    $text = trim(preg_replace('/\s+/', ' ', (string) $text));
    if ($text === '') {
        return '';
    }
    if (function_exists('mb_strlen') && mb_strlen($text) > $limit) {
        return mb_substr($text, 0, $limit - 1) . '…';
    }
    if (strlen($text) > $limit) {
        return substr($text, 0, $limit - 1) . '…';
    }
    return $text;
}

function disease_points($raw)
{
    $markers = is_array($raw) ? ($raw['markers'] ?? null) : null;
    if (!is_array($markers)) {
        return array();
    }
    $points = array();
    foreach ($markers as $marker) {
        if (!is_array($marker)) {
            continue;
        }
        $lat = outbreak_coord($marker['lat'] ?? null, 90);
        $lon = outbreak_coord($marker['lon'] ?? null, 180);
        if ($lat === null || $lon === null || ($lat == 0.0 && $lon == 0.0)) {
            continue;
        }
        $html = (string) ($marker['html'] ?? '');
        $date = '';
        $summary = '';
        if (preg_match('/<span class="d">\s*([^<]+)/i', $html, $match)) {
            $date = trim(html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'), " \t\n\r\0\x0B-");
        }
        if (preg_match('/<a\b[^>]*>([^<]+)<\/a>/i', $html, $match)) {
            $summary = trim(html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }
        $name = trim((string) ($marker['label'] ?? ''), " \t\n\r\0\x0B,");
        if ($name === '') {
            $name = 'Disease alert';
        }
        $id = trim((string) ($marker['place_id'] ?? ''));
        if ($id === '') {
            $id = $lat . ',' . $lon;
        }
        $alerts = 0;
        if (isset($marker['alertids']) && is_array($marker['alertids'])) {
            $alerts = count($marker['alertids']);
        }
        $points[] = array(
            'id' => $id,
            'name' => disease_clip($name, 80),
            'place' => disease_clip($marker['place_name'] ?? '', 120),
            'date' => disease_clip($date, 40),
            'summary' => disease_clip($summary, 160),
            'alerts' => $alerts,
            'lat' => $lat,
            'lon' => $lon,
        );
    }
    return $points;
}

function disease_snapshot()
{
    global $dataDir;
    return outbreak_lock('disease', function () use ($dataDir) {
        return outbreak_cached(
            $dataDir . '/disease-cache.json',
            300,
            function () {
                $query = 'category%5B%5D=1&category%5B%5D=2&category%5B%5D=29&time_interval=1%20week&heatscore=1';
                $raw = outbreak_fetch('https://www.healthmap.org/getAlerts.php?' . $query, 25);
                return disease_points($raw);
            },
            'HealthMap did not answer',
            'healthmap.org',
            'https://www.healthmap.org/en/'
        );
    });
}

function outbreak_count($n, $one, $many)
{
    return $n . ' ' . ($n === 1 ? $one : $many);
}

function animal_flag($value)
{
    return $value === true || $value === 1 || $value === '1';
}

function animal_points($raw)
{
    $rows = is_array($raw) ? ($raw['data'] ?? null) : null;
    if (!is_array($rows)) {
        return array();
    }
    $points = array();
    foreach ($rows as $row) {
        if (!is_array($row) || !animal_flag($row['is_animal'] ?? null)) {
            continue;
        }
        $lat = outbreak_coord($row['latitude'] ?? null, 90);
        $lon = outbreak_coord($row['longitude'] ?? null, 180);
        if ($lat === null || $lon === null || (abs($lat) < 0.001 && abs($lon) < 0.001)) {
            continue;
        }
        $place = array();
        foreach (array('city', 'state', 'region', 'country') as $key) {
            $part = trim((string) ($row[$key] ?? ''));
            if ($part !== '' && !in_array($part, $place, true)) {
                $place[] = $part;
            }
        }
        $start = is_numeric($row['outbreak_start'] ?? null) ? (int) $row['outbreak_start'] : 0;
        $end = is_numeric($row['outbreak_last_reported'] ?? null) ? (int) $row['outbreak_last_reported'] : 0;
        $when = '';
        if ($start && $end && $start !== $end) {
            $when = $start . '–' . $end;
        } elseif ($end) {
            $when = (string) $end;
        } elseif ($start) {
            $when = (string) $start;
        }
        $note = array();
        if (is_numeric($row['animal_cases'] ?? null)) {
            $note[] = outbreak_count((int) $row['animal_cases'], 'animal case', 'animal cases');
        } elseif (is_numeric($row['cases'] ?? null)) {
            $note[] = outbreak_count((int) $row['cases'], 'case', 'cases');
        }
        if (is_numeric($row['animal_deaths'] ?? null)) {
            $note[] = outbreak_count((int) $row['animal_deaths'], 'animal death', 'animal deaths');
        } elseif (is_numeric($row['deaths'] ?? null)) {
            $note[] = outbreak_count((int) $row['deaths'], 'death', 'deaths');
        }
        $id = trim((string) ($row['hash_id'] ?? ''));
        if ($id === '') {
            $id = trim((string) ($row['id'] ?? ''));
        }
        $name = trim((string) ($row['disease'] ?? ''));
        if ($name === '') {
            $name = 'Animal disease';
        }
        $points[] = array(
            'id' => $id,
            'name' => disease_clip($name, 80),
            'place' => disease_clip(implode(', ', $place), 140),
            'when' => $when,
            'note' => implode(' · ', $note),
            'lat' => $lat,
            'lon' => $lon,
        );
    }
    return $points;
}

function animal_snapshot()
{
    global $dataDir;
    return outbreak_lock('animal', function () use ($dataDir) {
        return outbreak_cached(
            $dataDir . '/animal-cache.json',
            600,
            function () {
                $raw = outbreak_fetch('https://app.gideononline.com/api/public/diseases/events?return=simple', 40);
                return animal_points($raw);
            },
            'GIDEON did not answer',
            'gideononline.com',
            'https://app.gideononline.com/updates/outbreaks'
        );
    });
}
