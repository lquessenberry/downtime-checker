<?php
// Unit checks for the World Grid favicon cache (no live network).

$root = dirname(__DIR__) . '/globalstatus';
$dataDir = sys_get_temp_dir() . '/gsa-favicon-test-' . getmypid();
@mkdir($dataDir, 0755, true);
@mkdir($dataDir . '/favicons', 0755, true);
$GLOBALS['root'] = $root;
$GLOBALS['dataDir'] = $dataDir;

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

function safe_host($host)
{
    $host = strtolower(trim((string) $host));
    return preg_match('/^[a-z0-9.-]+$/', $host) ? $host : '';
}

$fix = dirname(__FILE__) . '/favicon-tests/fixtures';

// SSRF / host allowlist
check(gsa_favicon_host_allowed('example.com'), 'public hostname allowed');
check(!gsa_favicon_host_allowed('localhost'), 'localhost blocked');
check(!gsa_favicon_host_allowed('127.0.0.1'), 'loopback IP blocked');
check(!gsa_favicon_host_allowed('10.0.0.5'), 'private IP blocked');
check(!gsa_favicon_host_allowed('192.168.1.1'), 'rfc1918 blocked');
check(!gsa_favicon_host_allowed('169.254.1.1'), 'link-local blocked');
check(!gsa_favicon_url_allowed('javascript:alert(1)'), 'javascript url blocked');
check(!gsa_favicon_url_allowed('file:///etc/passwd'), 'file url blocked');
check(!gsa_favicon_url_allowed('https://127.0.0.1/x.png'), 'loopback url blocked');
check(gsa_favicon_url_allowed('https://example.com/favicon.ico'), 'https url allowed');

// URL joining
check(gsa_favicon_absolute('news.example', '/fav-32.png') === 'https://news.example/fav-32.png', 'root-relative href');
check(gsa_favicon_absolute('news.example', 'icons/app.png') === 'https://news.example/icons/app.png', 'relative href');
check(gsa_favicon_absolute('news.example', '//cdn.ok.test/i.png') === 'https://cdn.ok.test/i.png', 'protocol-relative href');
check(gsa_favicon_absolute('news.example', 'javascript:alert(1)') === '', 'javascript href empty');

// HTML parse: prefers 32px PNG over shortcut ico
$links = gsa_favicon_parse_links(file_get_contents($fix . '/page.html'), 'news.example');
check(!empty($links) && $links[0] === 'https://news.example/fav-32.png', 'parse prefers png 32: ' . ($links[0] ?? ''));

$ssrf = gsa_favicon_parse_links(file_get_contents($fix . '/page-ssrf.html'), 'news.example');
check($ssrf === array('https://news.example/ok.png'), 'ssrf hrefs dropped, same-host kept');

// Normalize PNG to 32 and 64, stable hash
$png = file_get_contents($fix . '/mark-16.png');
$norm = gsa_favicon_normalize($png);
check(is_array($norm) && strlen($norm['hash']) === 32, 'normalize returns 32-char hash');
check(substr($norm['png64'], 0, 8) === "\x89PNG\r\n\x1a\n", '64 px is png');
check(substr($norm['png32'], 0, 8) === "\x89PNG\r\n\x1a\n", '32 px is png');
$again = gsa_favicon_normalize($png);
check($again['hash'] === $norm['hash'], 'hash is stable for the same image');

$im64 = imagecreatefromstring($norm['png64']);
$im32 = imagecreatefromstring($norm['png32']);
check($im64 && imagesx($im64) === 64 && imagesy($im64) === 64, '64 px canvas');
check($im32 && imagesx($im32) === 32 && imagesy($im32) === 32, '32 px canvas');
if ($im64) imagedestroy($im64);
if ($im32) imagedestroy($im32);

// ICO with embedded PNG
$ico = gsa_favicon_normalize(file_get_contents($fix . '/mark.ico'));
check(is_array($ico) && strlen($ico['png64']) > 8, 'ico with embedded png decodes');

check(gsa_favicon_store($norm), 'store writes hashed pngs');
check(is_file(gsa_favicon_path($norm['hash'], 64)), '64 file exists');
check(is_file(gsa_favicon_path($norm['hash'], 32)), '32 file exists');

// Index / TTL
$index = array('version' => 1, 'hosts' => array());
gsa_favicon_record($index, 'example.com', array('status' => 'ok', 'hash' => $norm['hash']));
$index['hosts']['example.com']['updated'] = time();
check(!gsa_favicon_needs_refresh('example.com', $index), 'fresh ok entry is not due');
$index['hosts']['example.com']['updated'] = time() - GSA_FAVICON_TTL_SEC - 10;
check(gsa_favicon_needs_refresh('example.com', $index), 'expired ok entry is due');
gsa_favicon_record($index, 'down.example', array('status' => 'fallback', 'hash' => ''));
$index['hosts']['down.example']['updated'] = time();
check(!gsa_favicon_needs_refresh('down.example', $index), 'recent fallback is not retried yet');
$index['hosts']['down.example']['updated'] = time() - GSA_FAVICON_RETRY_SEC - 10;
check(gsa_favicon_needs_refresh('down.example', $index), 'stale fallback is retried');
check(gsa_favicon_needs_refresh('missing.example', $index), 'unknown host is due');

gsa_favicon_index_write($index);
$GLOBALS['GSA_FAVICON_INDEX'] = null;
check(strpos(gsa_favicon_url_for_host('example.com', 64), $norm['hash']) !== false, 'url_for_host uses hash');
check(gsa_favicon_url_for_host('missing.example', 64) === GSA_FAVICON_FALLBACK_64, 'missing host uses fallback');

// Attach onto scan results
$attached = gsa_favicon_attach_results(array(
    array('address' => 'example.com', 'status' => 'up', 'name' => 'Example'),
    array('address' => 'missing.example', 'status' => 'down', 'name' => 'Missing'),
));
check(strpos($attached[0]['favicon'], $norm['hash']) !== false, 'attach ok host');
check($attached[1]['favicon'] === GSA_FAVICON_FALLBACK_64, 'attach missing host fallback');

// ETag / 304
$ok = gsa_favicon_http_response($norm['hash'], 64, '');
check($ok['code'] === 200 && $ok['headers']['Content-Type'] === 'image/png', 'serve 200 png');
check(!empty($ok['headers']['ETag']) && strpos($ok['headers']['Cache-Control'], 'max-age=604800') !== false, 'serve etag and cache-control');
$notmod = gsa_favicon_http_response($norm['hash'], 64, $ok['headers']['ETag']);
check($notmod['code'] === 304 && $notmod['body'] === '', 'if-none-match returns 304');
$miss = gsa_favicon_http_response('ffffffffffffffffffffffffffffffff', 64, '');
check($miss['code'] === 200 && substr($miss['body'], 0, 8) === "\x89PNG\r\n\x1a\n", 'unknown hash serves set-1 fallback png');

// Refresh uses mock HTTP: ico first, then link, 304 reuse, down hosts skipped
$mockBodies = array();
$mockBodies['https://fresh.test/favicon.ico'] = array('code' => 200, 'body' => file_get_contents($fix . '/mark-32.png'), 'etag' => '"abc"', 'lastModified' => '', 'url' => 'https://fresh.test/favicon.ico', 'error' => '');
$mockBodies['https://html.test/favicon.ico'] = array('code' => 404, 'body' => 'no', 'etag' => '', 'lastModified' => '', 'url' => 'https://html.test/favicon.ico', 'error' => '');
$mockBodies['https://html.test/'] = array('code' => 200, 'body' => file_get_contents($fix . '/page.html'), 'etag' => '', 'lastModified' => '', 'url' => 'https://html.test/', 'error' => '');
$mockBodies['https://html.test/fav-32.png'] = array('code' => 200, 'body' => file_get_contents($fix . '/mark-64.png'), 'etag' => '"png"', 'lastModified' => '', 'url' => 'https://html.test/fav-32.png', 'error' => '');
$mockBodies['https://cached.test/favicon.ico'] = array('code' => 304, 'body' => '', 'etag' => '"old"', 'lastModified' => '', 'url' => 'https://cached.test/favicon.ico', 'error' => '');

$GLOBALS['GSA_FAVICON_HTTP'] = function ($req) use ($mockBodies) {
    $url = $req['url'] ?? '';
    if (isset($mockBodies[$url])) {
        return $mockBodies[$url];
    }
    return array('code' => 0, 'body' => '', 'error' => 'unexpected ' . $url, 'url' => $url);
};

$scanIndex = array('version' => 1, 'hosts' => array(
    'cached.test' => array(
        'status' => 'ok',
        'hash' => $norm['hash'],
        'source' => 'https://cached.test/favicon.ico',
        'etag' => '"old"',
        'updated' => time() - GSA_FAVICON_TTL_SEC - 50,
    ),
));
$batch = gsa_favicon_refresh_hosts(array('fresh.test', 'html.test', 'cached.test'), $scanIndex);
check(($batch['ok'] ?? 0) === 2, 'refresh stores ico and html-link icons: ' . json_encode($batch));
check(($batch['notmod'] ?? 0) === 1, 'conditional 304 reuses cache');
check(($scanIndex['hosts']['fresh.test']['status'] ?? '') === 'ok', 'fresh.test recorded ok');
check(($scanIndex['hosts']['html.test']['source'] ?? '') === 'https://html.test/fav-32.png', 'html.test used link href');
check(($scanIndex['hosts']['cached.test']['status'] ?? '') === 'ok', '304 kept ok status');

$scanState = array(
    'results' => array(
        array('address' => 'fresh.test', 'status' => 'up'),
        array('address' => 'down.test', 'status' => 'down'),
    ),
);
// down.test is due but must be skipped because the host was down this pass
$emptyIndex = array('version' => 1, 'hosts' => array());
gsa_favicon_index_write($emptyIndex);
$GLOBALS['GSA_FAVICON_INDEX'] = $emptyIndex;
$info = gsa_favicon_refresh_scan($scanState, microtime(true) + 30);
check(($info['due'] ?? 0) === 1, 'refresh_scan only queues up hosts, due=' . ($info['due'] ?? 'nil'));

// Deadline skip
$infoLate = gsa_favicon_refresh_scan(array(
    'results' => array(array('address' => 'html.test', 'status' => 'up')),
), microtime(true) - 1);
check(!empty($infoLate['skipped']) || ($infoLate['due'] ?? 0) === 0 || !empty($infoLate['busy']), 'deadline or busy is reported');

foreach (glob($dataDir . '/favicons/*') as $f) {
    @unlink($f);
}
@unlink($dataDir . '/favicon-index.json');
@rmdir($dataDir . '/favicons');
@rmdir($dataDir);

if ($fail) {
    echo "FAILED $fail\n";
    exit(1);
}
echo "All favicon checks passed\n";
exit(0);
