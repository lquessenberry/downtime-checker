<?php
// Local php -S front door. Fly uses nginx; GoDaddy uses .htaccess.
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($path === '/') {
    $path = '/index.html';
}
$file = __DIR__ . $path;
if (strncmp($path, '/api', 4) !== 0 && is_file($file)) {
    return false;
}
require __DIR__ . '/router.php';
