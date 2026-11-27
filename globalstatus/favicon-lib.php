<?php
if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found\n";
    exit;
}

// Favicon cache for World Grid sources. The scheduled grid pass fetches
// each host's icon (favicon.ico, then <link rel=icon>, then the set-1
// fallback mark), normalizes it to 32/64 px PNG, and stores it under
// data/favicons/ with a content-hash name. Visitors read
// /api/favicons/{hash}.png (ETag/304). No third-party favicon API.

defined('GSA_FAVICON_TTL_SEC') || define('GSA_FAVICON_TTL_SEC', 14 * 24 * 3600);
defined('GSA_FAVICON_RETRY_SEC') || define('GSA_FAVICON_RETRY_SEC', 24 * 3600);
defined('GSA_FAVICON_TIMEOUT') || define('GSA_FAVICON_TIMEOUT', 3);
defined('GSA_FAVICON_CONNECT') || define('GSA_FAVICON_CONNECT', 2);
defined('GSA_FAVICON_MAX_BYTES') || define('GSA_FAVICON_MAX_BYTES', 256 * 1024);
defined('GSA_FAVICON_PAGE_BYTES') || define('GSA_FAVICON_PAGE_BYTES', 65536);
defined('GSA_FAVICON_BATCH') || define('GSA_FAVICON_BATCH', 8);
defined('GSA_FAVICON_PASS_CAP') || define('GSA_FAVICON_PASS_CAP', 200);
defined('GSA_FAVICON_REDIRECTS') || define('GSA_FAVICON_REDIRECTS', 3);
defined('GSA_FAVICON_FALLBACK_64') || define('GSA_FAVICON_FALLBACK_64', '/icons/grid-fallback-64.png');
defined('GSA_FAVICON_FALLBACK_32') || define('GSA_FAVICON_FALLBACK_32', '/icons/grid-fallback-32.png');

function gsa_favicon_dir()
{
    global $dataDir;
    $dir = $dataDir . '/favicons';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return $dir;
}

function gsa_favicon_index_file()
{
    global $dataDir;
    return $dataDir . '/favicon-index.json';
}

function gsa_favicon_index_read()
{
    $file = gsa_favicon_index_file();
    if (!is_file($file)) {
        return array('version' => 1, 'hosts' => array());
    }
    $decoded = json_decode((string) file_get_contents($file), true);
    if (!is_array($decoded)) {
        return array('version' => 1, 'hosts' => array());
    }
    if (!isset($decoded['hosts']) || !is_array($decoded['hosts'])) {
        $decoded['hosts'] = array();
    }
    return $decoded;
}

function gsa_favicon_index_write($index)
{
    $index['version'] = 1;
    $index['updated'] = gmdate('Y-m-d\TH:i:s\Z');
    return gsa_atomic_write(gsa_favicon_index_file(), json_encode($index));
}

function gsa_favicon_path($hash, $size = 64)
{
    $hash = strtolower((string) $hash);
    if (!preg_match('/^[a-f0-9]{16,64}$/', $hash)) {
        return '';
    }
    $suffix = ((int) $size === 32) ? '-32.png' : '.png';
    return gsa_favicon_dir() . '/' . $hash . $suffix;
}

function gsa_favicon_url($hash, $size = 64)
{
    $hash = strtolower((string) $hash);
    if (!preg_match('/^[a-f0-9]{16,64}$/', $hash)) {
        return ((int) $size === 32) ? GSA_FAVICON_FALLBACK_32 : GSA_FAVICON_FALLBACK_64;
    }
    $suffix = ((int) $size === 32) ? '-32.png' : '.png';
    return '/api/favicons/' . $hash . $suffix;
}

function gsa_favicon_url_for_host($host, $size = 64)
{
    $host = function_exists('safe_host') ? safe_host($host) : strtolower(trim((string) $host));
    if ($host === '') {
        return ((int) $size === 32) ? GSA_FAVICON_FALLBACK_32 : GSA_FAVICON_FALLBACK_64;
    }
    $index = $GLOBALS['GSA_FAVICON_INDEX'] ?? null;
    if (!is_array($index)) {
        $index = gsa_favicon_index_read();
        $GLOBALS['GSA_FAVICON_INDEX'] = $index;
    }
    $row = $index['hosts'][$host] ?? null;
    if (is_array($row) && ($row['status'] ?? '') === 'ok' && !empty($row['hash'])) {
        $path = gsa_favicon_path($row['hash'], $size);
        if ($path !== '' && is_file($path)) {
            return gsa_favicon_url($row['hash'], $size);
        }
    }
    return ((int) $size === 32) ? GSA_FAVICON_FALLBACK_32 : GSA_FAVICON_FALLBACK_64;
}

function gsa_favicon_attach_results($results)
{
    $GLOBALS['GSA_FAVICON_INDEX'] = gsa_favicon_index_read();
    foreach ($results as $i => $row) {
        if (!is_array($row)) {
            continue;
        }
        $results[$i]['favicon'] = gsa_favicon_url_for_host($row['address'] ?? '', 64);
        $results[$i]['favicon32'] = gsa_favicon_url_for_host($row['address'] ?? '', 32);
    }
    return $results;
}

function gsa_favicon_needs_refresh($host, $index, $now = null)
{
    $now = $now === null ? time() : (int) $now;
    $row = $index['hosts'][$host] ?? null;
    if (!is_array($row) || empty($row['updated'])) {
        return true;
    }
    $age = $now - (int) $row['updated'];
    $status = $row['status'] ?? '';
    if ($status === 'ok') {
        return $age >= GSA_FAVICON_TTL_SEC;
    }
    return $age >= GSA_FAVICON_RETRY_SEC;
}

function gsa_favicon_host_allowed($host)
{
    $host = strtolower(trim((string) $host));
    if ($host === '' || $host === 'localhost' || substr($host, -6) === '.local' || substr($host, -10) === '.localhost') {
        return false;
    }
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $flags = FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
        return filter_var($host, FILTER_VALIDATE_IP, $flags) !== false;
    }
    if (!preg_match('/^[a-z0-9.-]+$/', $host) || strpos($host, '.') === false) {
        return false;
    }
    return true;
}

function gsa_favicon_url_allowed($url)
{
    $parts = parse_url((string) $url);
    if (!is_array($parts)) {
        return false;
    }
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if ($scheme !== 'https' && $scheme !== 'http') {
        return false;
    }
    $host = strtolower((string) ($parts['host'] ?? ''));
    if (!gsa_favicon_host_allowed($host)) {
        return false;
    }
    $port = (int) ($parts['port'] ?? 0);
    if ($port && $port !== 80 && $port !== 443) {
        return false;
    }
    $path = $parts['path'] ?? '/';
    if (stripos($path, '..') !== false) {
        return false;
    }
    return true;
}

function gsa_favicon_absolute($host, $href)
{
    $href = html_entity_decode(trim((string) $href), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    if ($href === '' || stripos($href, 'javascript:') === 0 || stripos($href, 'data:') === 0 || stripos($href, 'file:') === 0) {
        return '';
    }
    if (preg_match('#^https?://#i', $href)) {
        return gsa_favicon_url_allowed($href) ? $href : '';
    }
    if (strpos($href, '//') === 0) {
        $url = 'https:' . $href;
        return gsa_favicon_url_allowed($url) ? $url : '';
    }
    $host = function_exists('safe_host') ? safe_host($host) : strtolower(trim((string) $host));
    if ($host === '' || !gsa_favicon_host_allowed($host)) {
        return '';
    }
    if (isset($href[0]) && $href[0] === '/') {
        $url = 'https://' . $host . $href;
    } else {
        $url = 'https://' . $host . '/' . ltrim($href, '/');
    }
    return gsa_favicon_url_allowed($url) ? $url : '';
}

// Pick the best <link rel="icon"> (or shortcut icon / apple-touch-icon) href.
function gsa_favicon_parse_links($html, $host)
{
    $picked = array();
    if (!preg_match_all('#<link\b[^>]*>#i', (string) $html, $matches)) {
        return array();
    }
    foreach ($matches[0] as $tag) {
        if (!preg_match('#\brel\s*=\s*["\']([^"\']+)["\']#i', $tag, $rel)) {
            continue;
        }
        $rels = strtolower($rel[1]);
        if (strpos($rels, 'icon') === false) {
            continue;
        }
        if (!preg_match('#\bhref\s*=\s*["\']([^"\']+)["\']#i', $tag, $href)) {
            continue;
        }
        $url = gsa_favicon_absolute($host, $href[1]);
        if ($url === '') {
            continue;
        }
        $type = '';
        if (preg_match('#\btype\s*=\s*["\']([^"\']+)["\']#i', $tag, $t)) {
            $type = strtolower($t[1]);
        }
        $score = 10;
        if (strpos($rels, 'apple-touch') !== false) {
            $score = 5;
        }
        if (strpos($type, 'png') !== false || preg_match('/\.png(\?|$)/i', $url)) {
            $score += 8;
        } elseif (strpos($type, 'svg') !== false || preg_match('/\.svg(\?|$)/i', $url)) {
            $score += 6;
        } elseif (strpos($type, 'icon') !== false || preg_match('/\.ico(\?|$)/i', $url)) {
            $score += 3;
        }
        if (preg_match('#\bsizes\s*=\s*["\']([^"\']+)["\']#i', $tag, $s) && preg_match('/(\d+)/', $s[1], $n)) {
            $px = (int) $n[1];
            if ($px >= 32 && $px <= 128) {
                $score += 4;
            } elseif ($px > 128) {
                $score += 2;
            }
        }
        $picked[] = array('url' => $url, 'score' => $score);
    }
    usort($picked, function ($a, $b) {
        return $b['score'] - $a['score'];
    });
    $urls = array();
    foreach ($picked as $row) {
        if (!in_array($row['url'], $urls, true)) {
            $urls[] = $row['url'];
        }
    }
    return $urls;
}

function gsa_favicon_http_multi($requests)
{
    $mock = $GLOBALS['GSA_FAVICON_HTTP'] ?? null;
    if (is_callable($mock)) {
        $out = array();
        foreach ($requests as $key => $req) {
            $out[$key] = $mock($req);
        }
        return $out;
    }
    if (!function_exists('curl_multi_init')) {
        $out = array();
        foreach ($requests as $key => $req) {
            $out[$key] = array('code' => 0, 'body' => '', 'error' => 'no curl');
        }
        return $out;
    }
    $multi = curl_multi_init();
    $handles = array();
    $buffers = array();
    foreach ($requests as $key => $req) {
        $url = $req['url'] ?? '';
        if ($url === '' || !gsa_favicon_url_allowed($url)) {
            $handles[$key] = null;
            continue;
        }
        $ch = curl_init($url);
        $headers = array('Accept: image/png,image/x-icon,image/webp,image/svg+xml,image/*,*/*;q=0.8', 'User-Agent: ' . (function_exists('browser_agent') ? browser_agent() : 'GlobalStatusFavicon/1.0'));
        if (!empty($req['etag'])) {
            $headers[] = 'If-None-Match: ' . $req['etag'];
        }
        if (!empty($req['lastModified'])) {
            $headers[] = 'If-Modified-Since: ' . $req['lastModified'];
        }
        $max = !empty($req['maxBytes']) ? (int) $req['maxBytes'] : GSA_FAVICON_MAX_BYTES;
        $buffers[$key] = array('data' => '', 'max' => $max, 'cut' => false);
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_TIMEOUT => GSA_FAVICON_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => GSA_FAVICON_CONNECT,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_HEADER => true,
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$buffers, $key) {
                $left = $buffers[$key]['max'] - strlen($buffers[$key]['data']);
                if ($left <= 0) {
                    $buffers[$key]['cut'] = true;
                    return 0;
                }
                $buffers[$key]['data'] .= substr($chunk, 0, $left);
                return strlen($chunk) > $left ? $left : strlen($chunk);
            },
        ));
        curl_multi_add_handle($multi, $ch);
        $handles[$key] = array(
            'ch' => $ch,
            'url' => $url,
            'hop' => (int) ($req['hop'] ?? 0),
            'maxBytes' => $max,
        );
    }
    $active = null;
    do {
        $code = curl_multi_exec($multi, $active);
        if ($active) {
            curl_multi_select($multi, 0.2);
        }
    } while ($active && $code === CURLM_OK);
    $out = array();
    $redirects = array();
    foreach ($handles as $key => $item) {
        if ($item === null) {
            $out[$key] = array('code' => 0, 'body' => '', 'error' => 'blocked url');
            continue;
        }
        $ch = $item['ch'];
        $raw = $buffers[$key]['data'] ?? '';
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $header = substr($raw, 0, $headerSize);
        $body = substr($raw, $headerSize);
        $http = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $ctype = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $err = curl_errno($ch) ? curl_error($ch) : '';
        $etag = '';
        $lastMod = '';
        $location = '';
        foreach (preg_split('/\r\n|\n|\r/', $header) as $line) {
            if (stripos($line, 'ETag:') === 0) {
                $etag = trim(substr($line, 5));
            } elseif (stripos($line, 'Last-Modified:') === 0) {
                $lastMod = trim(substr($line, 14));
            } elseif (stripos($line, 'Location:') === 0) {
                $location = trim(substr($line, 9));
            }
        }
        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
        if ($http >= 300 && $http < 400 && $location !== '' && $item['hop'] < GSA_FAVICON_REDIRECTS) {
            $next = $location;
            if ($next[0] === '/' || strpos($next, '://') === false) {
                $base = parse_url($item['url']);
                $scheme = $base['scheme'] ?? 'https';
                $host = $base['host'] ?? '';
                if ($next[0] === '/') {
                    $next = $scheme . '://' . $host . $next;
                } else {
                    $next = $scheme . '://' . $host . '/' . $next;
                }
            }
            if (gsa_favicon_url_allowed($next)) {
                $redirects[$key] = array(
                    'url' => $next,
                    'etag' => '',
                    'lastModified' => '',
                    'maxBytes' => $item['maxBytes'],
                    'hop' => $item['hop'] + 1,
                );
                continue;
            }
        }
        $out[$key] = array(
            'code' => $http,
            'body' => $body,
            'type' => $ctype,
            'etag' => $etag,
            'lastModified' => $lastMod,
            'url' => $item['url'],
            'error' => $err,
        );
    }
    curl_multi_close($multi);
    if ($redirects) {
        $followed = gsa_favicon_http_multi($redirects);
        foreach ($followed as $key => $row) {
            $out[$key] = $row;
        }
    }
    return $out;
}

function gsa_favicon_decode_image($bytes)
{
    if ($bytes === '' || $bytes === false || $bytes === null) {
        return null;
    }
    $magic = substr($bytes, 0, 8);
    if (substr($magic, 0, 4) === "\x00\x00\x01\x00") {
        return gsa_favicon_decode_ico($bytes);
    }
    if (strncmp($magic, '<svg', 4) === 0 || strncmp(ltrim($bytes), '<svg', 4) === 0 || strncmp($magic, '<?xml', 5) === 0) {
        return gsa_favicon_decode_svg($bytes);
    }
    if (!function_exists('imagecreatefromstring')) {
        return null;
    }
    $im = @imagecreatefromstring($bytes);
    return $im ?: null;
}

function gsa_favicon_decode_svg($bytes)
{
    $rsvg = trim((string) shell_exec('command -v rsvg-convert 2>/dev/null'));
    if ($rsvg === '') {
        return null;
    }
    $in = tempnam(sys_get_temp_dir(), 'gsaico');
    $out = $in . '.png';
    file_put_contents($in, $bytes);
    $cmd = escapeshellcmd($rsvg) . ' -w 64 -h 64 ' . escapeshellarg($in) . ' -o ' . escapeshellarg($out) . ' 2>/dev/null';
    @exec($cmd, $ignored, $code);
    $png = ($code === 0 && is_file($out)) ? (string) file_get_contents($out) : '';
    @unlink($in);
    @unlink($out);
    if ($png === '' || !function_exists('imagecreatefromstring')) {
        return null;
    }
    $im = @imagecreatefromstring($png);
    return $im ?: null;
}

function gsa_favicon_u16($bin, $off)
{
    $p = unpack('v', substr($bin, $off, 2));
    return $p ? $p[1] : 0;
}

function gsa_favicon_u32($bin, $off)
{
    $p = unpack('V', substr($bin, $off, 4));
    return $p ? $p[1] : 0;
}

function gsa_favicon_decode_ico($bytes)
{
    if (strlen($bytes) < 6 || gsa_favicon_u16($bytes, 0) !== 0 || gsa_favicon_u16($bytes, 2) !== 1) {
        return null;
    }
    $count = gsa_favicon_u16($bytes, 4);
    if ($count < 1 || $count > 64) {
        return null;
    }
    $entries = array();
    for ($i = 0; $i < $count; $i++) {
        $base = 6 + $i * 16;
        if ($base + 16 > strlen($bytes)) {
            break;
        }
        $w = ord($bytes[$base]);
        $h = ord($bytes[$base + 1]);
        $size = gsa_favicon_u32($bytes, $base + 8);
        $off = gsa_favicon_u32($bytes, $base + 12);
        $w = $w === 0 ? 256 : $w;
        $h = $h === 0 ? 256 : $h;
        if ($off <= 0 || $size <= 0 || $off + $size > strlen($bytes)) {
            continue;
        }
        $blob = substr($bytes, $off, $size);
        $isPng = substr($blob, 0, 8) === "\x89PNG\r\n\x1a\n";
        $entries[] = array('w' => $w, 'h' => $h, 'blob' => $blob, 'png' => $isPng, 'score' => ($isPng ? 1000 : 0) + min($w, 128));
    }
    usort($entries, function ($a, $b) {
        return $b['score'] - $a['score'];
    });
    foreach ($entries as $ent) {
        if ($ent['png'] && function_exists('imagecreatefromstring')) {
            $im = @imagecreatefromstring($ent['blob']);
            if ($im) {
                return $im;
            }
        }
        $im = gsa_favicon_decode_ico_dib($ent['blob']);
        if ($im) {
            return $im;
        }
    }
    return null;
}

function gsa_favicon_decode_ico_dib($dib)
{
    if (!function_exists('imagecreatetruecolor') || strlen($dib) < 40) {
        return null;
    }
    $header = gsa_favicon_u32($dib, 0);
    if ($header < 40) {
        return null;
    }
    $w = unpack('l', substr($dib, 4, 4))[1];
    $hAll = unpack('l', substr($dib, 8, 4))[1];
    $planes = gsa_favicon_u16($dib, 12);
    $bpp = gsa_favicon_u16($dib, 14);
    $comp = gsa_favicon_u32($dib, 16);
    if ($w <= 0 || $w > 512 || $planes !== 1 || $comp !== 0 || $bpp !== 32) {
        return null;
    }
    $h = (int) abs($hAll / 2);
    if ($h <= 0) {
        $h = abs($hAll);
    }
    $xorOff = $header;
    $needed = $xorOff + ($w * $h * 4);
    if (strlen($dib) < $needed) {
        return null;
    }
    $im = imagecreatetruecolor($w, $h);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    for ($y = 0; $y < $h; $y++) {
        $srcY = $h - 1 - $y;
        $row = $xorOff + $srcY * $w * 4;
        for ($x = 0; $x < $w; $x++) {
            $i = $row + $x * 4;
            $b = ord($dib[$i]);
            $g = ord($dib[$i + 1]);
            $r = ord($dib[$i + 2]);
            $a = ord($dib[$i + 3]);
            $alpha = 127 - (int) floor($a / 2);
            $col = imagecolorallocatealpha($im, $r, $g, $b, $alpha);
            imagesetpixel($im, $x, $y, $col);
        }
    }
    return $im;
}

function gsa_favicon_resize_png($im, $size)
{
    if (!$im || !function_exists('imagecreatetruecolor')) {
        return '';
    }
    $out = imagecreatetruecolor($size, $size);
    imagealphablending($out, false);
    imagesavealpha($out, true);
    $clear = imagecolorallocatealpha($out, 0, 0, 0, 127);
    imagefilledrectangle($out, 0, 0, $size, $size, $clear);
    imagealphablending($out, true);
    $w = imagesx($im);
    $h = imagesy($im);
    if ($w < 1 || $h < 1) {
        imagedestroy($out);
        return '';
    }
    $scale = min($size / $w, $size / $h);
    $nw = max(1, (int) round($w * $scale));
    $nh = max(1, (int) round($h * $scale));
    $x = (int) floor(($size - $nw) / 2);
    $y = (int) floor(($size - $nh) / 2);
    imagecopyresampled($out, $im, $x, $y, 0, 0, $nw, $nh, $w, $h);
    imagesavealpha($out, true);
    ob_start();
    imagepng($out, null, 6);
    $png = ob_get_clean();
    imagedestroy($out);
    return $png ?: '';
}

function gsa_favicon_normalize($bytes)
{
    $im = gsa_favicon_decode_image($bytes);
    if (!$im) {
        return null;
    }
    $png64 = gsa_favicon_resize_png($im, 64);
    $png32 = gsa_favicon_resize_png($im, 32);
    imagedestroy($im);
    if ($png64 === '' || $png32 === '') {
        return null;
    }
    return array(
        'hash' => substr(hash('sha256', $png64), 0, 32),
        'png64' => $png64,
        'png32' => $png32,
    );
}

function gsa_favicon_store($normalized)
{
    if (!is_array($normalized) || empty($normalized['hash'])) {
        return false;
    }
    $ok64 = gsa_atomic_write(gsa_favicon_path($normalized['hash'], 64), $normalized['png64']);
    $ok32 = gsa_atomic_write(gsa_favicon_path($normalized['hash'], 32), $normalized['png32']);
    return $ok64 && $ok32;
}

function gsa_favicon_record(&$index, $host, $fields)
{
    $prev = $index['hosts'][$host] ?? array();
    $index['hosts'][$host] = array_merge($prev, $fields, array('updated' => time(), 'host' => $host));
}

// Scheduled refresh: cache-miss and expired hosts, up-first, capped, deadline-aware.
function gsa_favicon_refresh_scan($state, $deadline = 0)
{
    $results = $state['results'] ?? array();
    $index = gsa_favicon_index_read();
    $due = array();
    foreach ($results as $row) {
        if (!is_array($row)) {
            continue;
        }
        $host = function_exists('safe_host') ? safe_host($row['address'] ?? '') : '';
        if ($host === '' || !gsa_favicon_host_allowed($host)) {
            continue;
        }
        if (($row['status'] ?? '') !== 'up') {
            continue;
        }
        if (gsa_favicon_needs_refresh($host, $index)) {
            $due[] = $host;
        }
        if (count($due) >= GSA_FAVICON_PASS_CAP) {
            break;
        }
    }
    $info = array('due' => count($due), 'ok' => 0, 'fallback' => 0, 'notmod' => 0, 'error' => 0, 'skipped' => 0);
    if (!$due) {
        return $info;
    }
    $lockPath = (isset($GLOBALS['dataDir']) ? $GLOBALS['dataDir'] : sys_get_temp_dir()) . '/favicon.lock';
    $lock = fopen($lockPath, 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        if ($lock) {
            fclose($lock);
        }
        $info['skipped'] = count($due);
        $info['busy'] = true;
        return $info;
    }
    foreach (array_chunk($due, GSA_FAVICON_BATCH) as $chunk) {
        if ($deadline > 0 && microtime(true) >= $deadline) {
            $info['skipped'] += count($chunk);
            continue;
        }
        $batchInfo = gsa_favicon_refresh_hosts($chunk, $index);
        $info['ok'] += $batchInfo['ok'];
        $info['fallback'] += $batchInfo['fallback'];
        $info['notmod'] += $batchInfo['notmod'];
        $info['error'] += $batchInfo['error'];
        gsa_favicon_index_write($index);
    }
    flock($lock, LOCK_UN);
    fclose($lock);
    $GLOBALS['GSA_FAVICON_INDEX'] = $index;
    return $info;
}

function gsa_favicon_refresh_hosts($hosts, &$index)
{
    $info = array('ok' => 0, 'fallback' => 0, 'notmod' => 0, 'error' => 0);
    $icoReqs = array();
    foreach ($hosts as $host) {
        $prev = $index['hosts'][$host] ?? array();
        $url = 'https://' . $host . '/favicon.ico';
        $req = array('url' => $url, 'maxBytes' => GSA_FAVICON_MAX_BYTES);
        if (!empty($prev['source']) && $prev['source'] === $url) {
            $req['etag'] = $prev['etag'] ?? '';
            $req['lastModified'] = $prev['lastModified'] ?? '';
        }
        $icoReqs[$host] = $req;
    }
    $icoResp = gsa_favicon_http_multi($icoReqs);
    $needPage = array();
    foreach ($hosts as $host) {
        $resp = $icoResp[$host] ?? array('code' => 0, 'body' => '');
        if ((int) ($resp['code'] ?? 0) === 304 && !empty($index['hosts'][$host]['hash'])) {
            gsa_favicon_record($index, $host, array('status' => 'ok'));
            $info['notmod']++;
            continue;
        }
        $norm = ((int) ($resp['code'] ?? 0) >= 200 && (int) $resp['code'] < 300)
            ? gsa_favicon_normalize($resp['body'] ?? '')
            : null;
        if ($norm && gsa_favicon_store($norm)) {
            gsa_favicon_record($index, $host, array(
                'status' => 'ok',
                'hash' => $norm['hash'],
                'source' => $resp['url'] ?? $icoReqs[$host]['url'],
                'etag' => $resp['etag'] ?? '',
                'lastModified' => $resp['lastModified'] ?? '',
                'bytes' => strlen($norm['png64']),
            ));
            $info['ok']++;
            continue;
        }
        $needPage[$host] = true;
    }
    if (!$needPage) {
        return $info;
    }
    $pageReqs = array();
    foreach ($needPage as $host => $_) {
        $pageReqs[$host] = array('url' => 'https://' . $host . '/', 'maxBytes' => GSA_FAVICON_PAGE_BYTES + 4096);
    }
    $pages = gsa_favicon_http_multi($pageReqs);
    $hrefReqs = array();
    $hrefMap = array();
    foreach ($needPage as $host => $_) {
        $html = $pages[$host]['body'] ?? '';
        $links = gsa_favicon_parse_links($html, $host);
        if ($links) {
            $hrefMap[$host] = $links[0];
            $hrefReqs[$host] = array('url' => $links[0], 'maxBytes' => GSA_FAVICON_MAX_BYTES);
        }
    }
    $hrefResp = $hrefReqs ? gsa_favicon_http_multi($hrefReqs) : array();
    foreach ($needPage as $host => $_) {
        $resp = $hrefResp[$host] ?? null;
        $norm = null;
        if ($resp && (int) ($resp['code'] ?? 0) >= 200 && (int) $resp['code'] < 300) {
            $norm = gsa_favicon_normalize($resp['body'] ?? '');
        }
        if ($norm && gsa_favicon_store($norm)) {
            gsa_favicon_record($index, $host, array(
                'status' => 'ok',
                'hash' => $norm['hash'],
                'source' => $resp['url'] ?? ($hrefMap[$host] ?? ''),
                'etag' => $resp['etag'] ?? '',
                'lastModified' => $resp['lastModified'] ?? '',
                'bytes' => strlen($norm['png64']),
            ));
            $info['ok']++;
            continue;
        }
        gsa_favicon_record($index, $host, array(
            'status' => 'fallback',
            'hash' => '',
            'source' => '',
            'error' => $resp['error'] ?? 'no icon',
        ));
        $info['fallback']++;
    }
    return $info;
}

function gsa_favicon_http_response($hash, $size = 64, $ifNoneMatch = '')
{
    $path = gsa_favicon_path($hash, $size);
    if ($path === '' || !is_file($path)) {
        $fallback = (($size === 32) ? 'icons/grid-fallback-32.png' : 'icons/grid-fallback-64.png');
        $root = $GLOBALS['root'] ?? dirname(__FILE__);
        $path = $root . '/' . $fallback;
        $etag = '"' . substr(hash('sha256', 'fallback-' . $size), 0, 32) . '"';
    } else {
        $etag = '"' . $hash . ($size === 32 ? '-32' : '') . '"';
    }
    $cache = 'public, max-age=604800, stale-while-revalidate=86400';
    if (!is_file($path)) {
        return array(
            'code' => 404,
            'headers' => array('Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-store'),
            'body' => '{"error":"Not found"}',
        );
    }
    if ($ifNoneMatch !== '' && trim($ifNoneMatch) === $etag) {
        return array(
            'code' => 304,
            'headers' => array('ETag' => $etag, 'Cache-Control' => $cache),
            'body' => '',
        );
    }
    $bytes = (string) file_get_contents($path);
    return array(
        'code' => 200,
        'headers' => array(
            'Content-Type' => 'image/png',
            'ETag' => $etag,
            'Cache-Control' => $cache,
            'Content-Length' => (string) strlen($bytes),
        ),
        'body' => $bytes,
    );
}

function gsa_favicon_http_serve($hash, $size = 64)
{
    $resp = gsa_favicon_http_response($hash, $size, $_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
    http_response_code($resp['code']);
    foreach ($resp['headers'] as $name => $value) {
        header($name . ': ' . $value);
    }
    echo $resp['body'];
    exit;
}
