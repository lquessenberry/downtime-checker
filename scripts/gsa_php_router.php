<?php
// Fly / php -S front door for globalstatus/. Static files pass through;
// /api/* goes to router.php (same as Apache + .htaccess on GoDaddy).
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$root = __DIR__;
if ($path === '/') {
    $path = '/index.html';
}
$file = $root . $path;
if (strncmp($path, '/api', 4) !== 0 && is_file($file)) {
    return false;
}
require $root . '/router.php';
