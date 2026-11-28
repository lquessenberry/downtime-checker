<?php
// LIVE CAMS category (live-cams.js).
// Public camera lists from road agencies, cities and USGS, cut down to
// [id, name, road, lat, lon, image, video] so the globe can pin them.
//
// GET /api/live-cams/<layer>       one layer: every source in it, merged.
//      Each camera is [id, name, road, lat, lon, image, video, extra, source#].
// GET /api/live-cams/img?s=<src>&id=<id>  current snapshot for one camera
//      (only for sources whose image URL changes every minute, or that need
//      a proxy). Answers with a redirect or a short-cached copy, never an
//      arbitrary URL: the id is looked up in the cached list and the host
//      must be on the allowlist.
//
// Lists are cached in data/livecams-<source>.json (data/ is denied by
// .htaccess and is never committed or uploaded) for each source's TTL.
// A failed refresh keeps serving the last good copy.
// Original code for Global Status App.

defined('GSA_LC_LIST_PER_MIN') || define('GSA_LC_LIST_PER_MIN', 90);   // list calls per network per minute
defined('GSA_LC_IMG_PER_MIN') || define('GSA_LC_IMG_PER_MIN', 240);    // snapshot calls per network per minute
defined('GSA_LC_FETCH_TIMEOUT') || define('GSA_LC_FETCH_TIMEOUT', 30);

function gsa_lc_layers()
{
    return array(
        'ushighways' => array('caltrans', 'iowadot', 'deldot'),
        'uscity' => array('nyc', 'austin'),
        'canada' => array('drivebc', 'calgary', 'toronto'),
        'uk' => array('tfl'),
        'europe' => array('dgt', 'digitraffic', 'iceland'),
        'asiapac' => array('hongkong', 'singapore', 'qld', 'nzta'),
        'border' => array('border'),
        'volcano' => array('usgsvolc'),
    );
}

// Each source: credit (plain text, shown in the card), ttl (seconds), hosts the
// image or video may come from, and how its live image is fetched by the card:
// 'direct' (the URL in the list, cache-busted), 'resolve' (ask us, the URL
// rotates), or 'proxy' (ask us, we fetch it).
function gsa_lc_sources()
{
    return array(
        'caltrans' => array('credit' => 'Caltrans CCTV (California DOT)', 'ttl' => 43200, 'img' => 'direct', 'hosts' => array('cwwp2.dot.ca.gov', 'wzmedia.dot.ca.gov')),
        'iowadot' => array('credit' => 'Iowa DOT traffic cameras (Iowa DOT open data)', 'ttl' => 43200, 'img' => 'direct', 'hosts' => array('atmsqf.iowadot.gov')),
        'deldot' => array('credit' => 'DelDOT Transportation Management Center', 'ttl' => 21600, 'img' => 'direct', 'hosts' => array('video.deldot.gov')),
        'nyc' => array('credit' => 'NYC DOT Traffic Management Center', 'ttl' => 43200, 'img' => 'direct', 'hosts' => array('webcams.nyctmc.org')),
        'austin' => array('credit' => 'City of Austin Transportation (Austin open data)', 'ttl' => 43200, 'img' => 'direct', 'hosts' => array('cctv.austinmobility.io')),
        'drivebc' => array('credit' => 'DriveBC, BC Ministry of Transportation and Transit', 'ttl' => 21600, 'img' => 'direct', 'hosts' => array('www.drivebc.ca')),
        'calgary' => array('credit' => 'City of Calgary (Open Calgary)', 'ttl' => 43200, 'img' => 'direct', 'hosts' => array('trafficcam.calgary.ca')),
        'toronto' => array('credit' => 'City of Toronto Open Data (Open Government Licence - Toronto)', 'ttl' => 43200, 'img' => 'direct', 'hosts' => array('opendata.toronto.ca')),
        'tfl' => array('credit' => 'Powered by TfL Open Data (Transport for London JamCams)', 'ttl' => 21600, 'img' => 'direct', 'hosts' => array('s3-eu-west-1.amazonaws.com')),
        'dgt' => array('credit' => 'DGT Spain, National Access Point (DATEX II)', 'ttl' => 43200, 'img' => 'direct', 'hosts' => array('etraffic.dgt.es')),
        'digitraffic' => array('credit' => 'Fintraffic / digitraffic.fi, CC BY 4.0', 'ttl' => 21600, 'img' => 'direct', 'hosts' => array('weathercam.digitraffic.fi')),
        'iceland' => array('credit' => 'Vegagerdin, Icelandic Road and Coastal Administration', 'ttl' => 43200, 'img' => 'direct', 'hosts' => array('www.vegagerdin.is')),
        'hongkong' => array('credit' => 'Transport Department, Hong Kong SAR (DATA.GOV.HK)', 'ttl' => 43200, 'img' => 'direct', 'hosts' => array('tdcctv.data.one.gov.hk')),
        'singapore' => array('credit' => 'Land Transport Authority via data.gov.sg (Singapore Open Data Licence)', 'ttl' => 60, 'img' => 'resolve', 'hosts' => array('images.data.gov.sg')),
        'qld' => array('credit' => 'QLDTraffic, Queensland Department of Transport and Main Roads, CC BY 4.0', 'ttl' => 21600, 'img' => 'direct', 'hosts' => array('cameras.qldtraffic.qld.gov.au')),
        'nzta' => array('credit' => 'NZ Transport Agency Waka Kotahi (trafficnz.info), CC BY 4.0', 'ttl' => 21600, 'img' => 'direct', 'hosts' => array('trafficnz.info', 'www.trafficnz.info')),
        'border' => array('credit' => 'Caltrans CCTV and DriveBC border crossing cameras', 'ttl' => 21600, 'img' => 'direct', 'hosts' => array('cwwp2.dot.ca.gov', 'wzmedia.dot.ca.gov', 'www.drivebc.ca')),
        'usgsvolc' => array('credit' => 'USGS Volcano Hazards Program webcams (public domain)', 'ttl' => 3600, 'img' => 'direct', 'hosts' => array('volcview.wr.usgs.gov')),
    );
}

function gsa_lc_file($name)
{
    global $dataDir;
    return $dataDir . '/livecams-' . $name . '.json';
}

function gsa_lc_ua()
{
    return 'GlobalStatusApp/1.0 (globalstatus.app; live cams list cache)';
}

function gsa_lc_get($url, $accept = 'application/json', $headers = array())
{
    if (!function_exists('curl_init')) {
        return array('ok' => false, 'body' => null, 'error' => 'curl is missing');
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => GSA_LC_FETCH_TIMEOUT,
        CURLOPT_ENCODING => '',
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
        CURLOPT_HTTPHEADER => array_merge(array('Accept: ' . $accept, 'User-Agent: ' . gsa_lc_ua()), $headers),
    ));
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $err = curl_error($ch);
    curl_close($ch);
    $ok = $body !== false && $code >= 200 && $code < 300;
    return array('ok' => $ok, 'code' => $code, 'type' => $type, 'body' => $ok ? (string) $body : null, 'error' => $ok ? null : ($body === false ? ($err ?: 'No answer') : 'HTTP ' . $code));
}

function gsa_lc_json($url)
{
    $r = gsa_lc_get($url);
    if (!$r['ok']) {
        throw new RuntimeException($r['error']);
    }
    $j = json_decode($r['body'], true);
    if (!is_array($j)) {
        throw new RuntimeException('Bad JSON');
    }
    return $j;
}

// Plain text only: no tags, no URLs, no phone links, printable characters.
function gsa_lc_txt($v, $max = 120)
{
    if (!is_string($v) && !is_numeric($v)) {
        return '';
    }
    $s = (string) $v;
    $s = strip_tags($s);
    $s = preg_replace('#(https?://|www\.|tel:|mailto:)\S*#iu', '', $s);
    $s = preg_replace('/[\x00-\x1F\x7F<>"`\\\\{}]/u', ' ', $s);
    $s = trim(preg_replace('/\s+/u', ' ', $s));
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max, 'UTF-8');
    }
    return substr($s, 0, $max);
}

function gsa_lc_url($u, $hosts)
{
    if (!is_string($u) || $u === '') {
        return '';
    }
    $p = parse_url($u);
    if (!$p || ($p['scheme'] ?? '') !== 'https' || !in_array(strtolower($p['host'] ?? ''), $hosts, true)) {
        return '';
    }
    return $u;
}

function gsa_lc_cam($id, $name, $road, $lat, $lon, $img, $vid, $hosts, $extra = '')
{
    $lat = is_numeric($lat) ? round((float) $lat, 5) : null;
    $lon = is_numeric($lon) ? round((float) $lon, 5) : null;
    if ($lat === null || $lon === null || abs($lat) > 90 || abs($lon) > 180 || ($lat == 0 && $lon == 0)) {
        return null;
    }
    $img = gsa_lc_url($img, $hosts);
    $vurl = '';
    if ($vid) {
        list($kind, $u) = explode(':', $vid, 2);
        $u = gsa_lc_url($u, $hosts);
        $vurl = $u ? $kind . ':' . $u : '';
    }
    if ($img === '' && $vurl === '') {
        return null;
    }
    $name = gsa_lc_txt(str_replace('_', ' ', (string) $name), 110);
    return array(gsa_lc_txt($id, 64), $name !== '' ? $name : 'Camera', gsa_lc_txt($road, 90), $lat, $lon, $img, $vurl, preg_replace('/[^A-Z0-9,]/', '', (string) $extra));
}

// ---------------------------------------------------------------- fetchers
// The twelve district files are fetched in parallel (~10 MB in all).
function gsa_lc_fetch_caltrans($hosts)
{
    $out = array();
    $ok = 0;
    $mh = curl_multi_init();
    $handles = array();
    for ($d = 1; $d <= 12; $d++) {
        $dd = str_pad((string) $d, 2, '0', STR_PAD_LEFT);
        $ch = curl_init("https://cwwp2.dot.ca.gov/data/d$d/cctv/cctvStatusD$dd.json");
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => GSA_LC_FETCH_TIMEOUT,
            CURLOPT_ENCODING => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_HTTPHEADER => array('Accept: application/json', 'User-Agent: ' . gsa_lc_ua()),
        ));
        curl_multi_add_handle($mh, $ch);
        $handles[$d] = $ch;
    }
    do {
        $status = curl_multi_exec($mh, $running);
        if ($running) {
            curl_multi_select($mh, 1.0);
        }
    } while ($running && $status === CURLM_OK);
    foreach ($handles as $d => $ch) {
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $body = curl_multi_getcontent($ch);
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
        $j = $code === 200 ? json_decode((string) $body, true) : null;
        if (!is_array($j)) {
            continue;
        }
        $ok++;
        foreach ($j['data'] ?? array() as $row) {
            $c = $row['cctv'] ?? array();
            if (($c['inService'] ?? '') !== 'true') {
                continue;
            }
            $l = $c['location'] ?? array();
            $im = $c['imageData'] ?? array();
            $hls = $im['streamingVideoURL'] ?? '';
            $cam = gsa_lc_cam('d' . $d . '-' . ($c['index'] ?? ''), $l['locationName'] ?? '', trim(($l['route'] ?? '') . ' · ' . ($l['nearbyPlace'] ?? '') . ' · District ' . $d, ' ·'), $l['latitude'] ?? null, $l['longitude'] ?? null, $im['static']['currentImageURL'] ?? '', $hls ? 'hls:' . $hls : '', $hosts);
            if ($cam) {
                $out[] = $cam;
            }
        }
    }
    curl_multi_close($mh);
    if (!$ok) {
        throw new RuntimeException('No Caltrans district answered');
    }
    return $out;
}

function gsa_lc_fetch_iowadot($hosts)
{
    $out = array();
    $base = 'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query?where=1%3D1&outFields=Desc_,Route,ImageURL&returnGeometry=true&outSR=4326&f=json&resultRecordCount=1000&resultOffset=';
    for ($off = 0; $off < 6000; $off += 1000) {
        $j = gsa_lc_json($base . $off);
        foreach ($j['features'] ?? array() as $f) {
            $a = $f['attributes'] ?? array();
            $g = $f['geometry'] ?? array();
            $cam = gsa_lc_cam(md5((string) ($a['ImageURL'] ?? '')), $a['Desc_'] ?? '', $a['Route'] ?? '', $g['y'] ?? null, $g['x'] ?? null, $a['ImageURL'] ?? '', '', $hosts);
            if ($cam) {
                $out[] = $cam;
            }
        }
        if (empty($j['exceededTransferLimit']) || count($j['features'] ?? array()) === 0) {
            break;
        }
    }
    return $out;
}

function gsa_lc_fetch_deldot($hosts)
{
    $j = gsa_lc_json('https://tmc.deldot.gov/json/videocamera.json');
    $out = array();
    foreach ($j['videoCameras'] ?? array() as $c) {
        if (empty($c['enabled']) || ($c['status'] ?? '') !== 'Active') {
            continue;
        }
        $hls = $c['urls']['m3u8s'] ?? '';
        $cam = gsa_lc_cam($c['id'] ?? '', $c['title'] ?? '', trim(($c['county'] ?? '') . ' County, Delaware'), $c['lat'] ?? null, $c['lon'] ?? null, '', $hls ? 'hls:' . $hls : '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_nyc($hosts)
{
    $j = gsa_lc_json('https://webcams.nyctmc.org/api/cameras');
    $out = array();
    foreach ($j as $c) {
        if (($c['isOnline'] ?? 'true') !== 'true' && ($c['isOnline'] ?? true) !== true) {
            continue;
        }
        $cam = gsa_lc_cam($c['id'] ?? '', $c['name'] ?? '', ($c['area'] ?? '') . ', New York City', $c['latitude'] ?? null, $c['longitude'] ?? null, $c['imageUrl'] ?? '', '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_austin($hosts)
{
    $j = gsa_lc_json('https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=5000&camera_status=TURNED_ON');
    $out = array();
    foreach ($j as $c) {
        $co = $c['location']['coordinates'] ?? array(null, null);
        $cam = gsa_lc_cam($c['camera_id'] ?? '', $c['location_name'] ?? '', 'Austin, Texas', $co[1] ?? null, $co[0] ?? null, $c['screenshot_address'] ?? '', '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_drivebc_rows()
{
    $j = gsa_lc_json('https://www.drivebc.ca/api/webcams/');
    return is_array($j) ? $j : array();
}

function gsa_lc_drivebc_cam($c, $hosts)
{
    if (isset($c['is_on']) && !$c['is_on']) {
        return null;
    }
    $co = $c['location']['coordinates'] ?? array(null, null);
    $img = 'https://www.drivebc.ca/images/' . (int) ($c['id'] ?? 0) . '.jpg';
    $road = trim('Highway ' . ($c['highway_display'] ?? '') . ' · ' . ($c['region_name'] ?? ''), ' ·');
    return gsa_lc_cam('bc' . ($c['id'] ?? ''), $c['name'] ?? '', $road, $co[1] ?? null, $co[0] ?? null, $img, '', $hosts);
}

function gsa_lc_fetch_drivebc($hosts)
{
    $out = array();
    foreach (gsa_lc_drivebc_rows() as $c) {
        $cam = gsa_lc_drivebc_cam($c, $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_calgary($hosts)
{
    $j = gsa_lc_json('https://data.calgary.ca/resource/k7p9-kppz.json?$limit=2000');
    $out = array();
    foreach ($j as $c) {
        $co = $c['point']['coordinates'] ?? array(null, null);
        $u = $c['camera_url']['url'] ?? '';
        $cam = gsa_lc_cam(basename((string) $u), $c['camera_location'] ?? '', 'Calgary, Alberta · ' . ($c['quadrant'] ?? ''), $co[1] ?? null, $co[0] ?? null, $u, '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_toronto($hosts)
{
    $j = gsa_lc_json('https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson');
    $out = array();
    foreach ($j['features'] ?? array() as $f) {
        $p = $f['properties'] ?? array();
        $co = $f['geometry']['coordinates'] ?? array();
        if (isset($co[0]) && is_array($co[0])) {
            $co = $co[0];
        }
        $name = trim(($p['MAINROAD'] ?? '') . ' at ' . ($p['CROSSROAD'] ?? ''));
        $cam = gsa_lc_cam($p['REC_ID'] ?? '', $name, 'Toronto, Ontario', $co[1] ?? null, $co[0] ?? null, $p['IMAGEURL'] ?? '', '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_tfl($hosts)
{
    $j = gsa_lc_json('https://api.tfl.gov.uk/Place/Type/JamCam');
    $out = array();
    foreach ($j as $c) {
        $props = array();
        foreach ($c['additionalProperties'] ?? array() as $ap) {
            $props[$ap['key'] ?? ''] = $ap['value'] ?? '';
        }
        if (($props['available'] ?? 'true') !== 'true') {
            continue;
        }
        $mp4 = $props['videoUrl'] ?? '';
        $cam = gsa_lc_cam($c['id'] ?? '', $c['commonName'] ?? '', 'London' . (($props['view'] ?? '') !== '' ? ' · view ' . $props['view'] : ''), $c['lat'] ?? null, $c['lon'] ?? null, $props['imageUrl'] ?? '', $mp4 ? 'mp4:' . $mp4 : '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_dgt($hosts)
{
    $r = gsa_lc_get('https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v36.xml', 'application/xml');
    if (!$r['ok']) {
        throw new RuntimeException($r['error']);
    }
    $out = array();
    if (!preg_match_all('#<ns2:device\b[^>]*\bid="([^"]+)"[^>]*>(.*?)</ns2:device>#s', $r['body'], $m, PREG_SET_ORDER)) {
        throw new RuntimeException('No cameras in the DATEX file');
    }
    foreach ($m as $dev) {
        $x = $dev[2];
        $g = function ($tag) use ($x) {
            return preg_match('#<' . $tag . '>([^<]*)</' . $tag . '>#', $x, $mm) ? html_entity_decode($mm[1], ENT_QUOTES | ENT_XML1, 'UTF-8') : '';
        };
        $road = $g('loc:roadName');
        $km = $g('lse:kilometerPoint');
        $prov = $g('lse:province');
        $dest = $g('loc:roadDestination');
        $name = trim($road . ($km !== '' ? ' km ' . $km : '') . ($dest !== '' ? ' toward ' . ucwords(strtolower($dest)) : ''));
        $cam = gsa_lc_cam($dev[1], $name, trim(ucwords(strtolower($prov)) . ', Spain', ', '), $g('loc:latitude'), $g('loc:longitude'), $g('fse:deviceUrl'), '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_digitraffic($hosts)
{
    $j = gsa_lc_json('https://tie.digitraffic.fi/api/weathercam/v1/stations');
    $out = array();
    foreach ($j['features'] ?? array() as $f) {
        $p = $f['properties'] ?? array();
        if (($p['collectionStatus'] ?? '') !== 'GATHERING') {
            continue;
        }
        $co = $f['geometry']['coordinates'] ?? array(null, null);
        $views = array();
        foreach ($p['presets'] ?? array() as $ps) {
            if (!empty($ps['inCollection']) && preg_match('/^[A-Z0-9]+$/', (string) ($ps['id'] ?? ''))) {
                $views[] = $ps['id'];
            }
        }
        if (!$views) {
            continue;
        }
        $name = preg_replace('/^[a-z]+\d*_/', '', (string) ($p['name'] ?? ''));
        $name = str_replace('_', ' ', $name);
        // Other views from the same station (other directions) go in the extra
        // field so the card can page through them.
        $cam = gsa_lc_cam($p['id'] ?? '', $name, 'Finland road weather camera', $co[1] ?? null, $co[0] ?? null, 'https://weathercam.digitraffic.fi/' . $views[0] . '.jpg', '', $hosts, implode(',', array_slice($views, 1, 5)));
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_iceland($hosts)
{
    $j = gsa_lc_json('https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1');
    $out = array();
    $seen = array();
    foreach ($j as $c) {
        $u = $c['Slod'] ?? '';
        if (!$u || isset($seen[$u])) {
            continue;
        }
        $seen[$u] = 1;
        $name = trim(($c['Myndavel'] ?? '') . ' · ' . ($c['Skyring'] ?? ''), ' ·');
        $road = trim(($c['Vegheiti'] ?? '') . (isset($c['NrVegur']) ? ' (road ' . $c['NrVegur'] . ')' : '') . ', Iceland');
        $cam = gsa_lc_cam(basename((string) $u, '.jpg'), $name, $road, $c['Breidd'] ?? null, $c['Lengd'] ?? null, $u, '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_hongkong($hosts)
{
    $r = gsa_lc_get('https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml', 'application/xml');
    if (!$r['ok']) {
        throw new RuntimeException($r['error']);
    }
    $out = array();
    preg_match_all('#<image>(.*?)</image>#s', $r['body'], $m);
    foreach ($m[1] as $x) {
        $g = function ($tag) use ($x) {
            return preg_match('#<' . $tag . '>([^<]*)</' . $tag . '>#', $x, $mm) ? html_entity_decode($mm[1], ENT_QUOTES | ENT_XML1, 'UTF-8') : '';
        };
        $name = preg_replace('/\s*\[[A-Z0-9]+\]\s*$/', '', $g('description'));
        $cam = gsa_lc_cam($g('key'), $name, trim($g('district') . ', ' . $g('region'), ', ') . ', Hong Kong', $g('latitude'), $g('longitude'), $g('url'), '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_singapore($hosts)
{
    $j = gsa_lc_json('https://api.data.gov.sg/v1/transport/traffic-images');
    $out = array();
    foreach ($j['items'][0]['cameras'] ?? array() as $c) {
        $id = (string) ($c['camera_id'] ?? '');
        $cam = gsa_lc_cam($id, 'Traffic camera ' . $id, 'Singapore expressways', $c['location']['latitude'] ?? null, $c['location']['longitude'] ?? null, $c['image'] ?? '', '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_qld($hosts)
{
    // QLDTraffic publishes this key for public use in its developer guide.
    $j = gsa_lc_json('https://api.qldtraffic.qld.gov.au/v1/webcams?apikey=3e83add325cbb69ac4d8e5bf433d770b');
    $out = array();
    foreach ($j['features'] ?? array() as $f) {
        $p = $f['properties'] ?? array();
        $co = $f['geometry']['coordinates'] ?? array(null, null);
        $cam = gsa_lc_cam($p['id'] ?? '', $p['description'] ?? '', trim(($p['locality'] ?? '') . ', ' . ($p['district'] ?? '') . ', Queensland', ', '), $co[1] ?? null, $co[0] ?? null, $p['image_url'] ?? '', '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

function gsa_lc_fetch_nzta($hosts)
{
    $r = gsa_lc_get('https://trafficnz.info/service/traffic/rest/4/cameras/all', 'application/json');
    if (!$r['ok']) {
        throw new RuntimeException($r['error']);
    }
    $j = json_decode($r['body'], true);
    $out = array();
    foreach ($j['response']['camera'] ?? array() as $c) {
        if (!empty($c['offline']) || !empty($c['underMaintenance'])) {
            continue;
        }
        $img = 'https://trafficnz.info' . (string) ($c['imageUrl'] ?? '');
        $road = trim(($c['highway'] ?? '') . ' · ' . ($c['region']['name'] ?? (is_string($c['region'] ?? null) ? $c['region'] : '')) . ', New Zealand', ' ·');
        $cam = gsa_lc_cam($c['id'] ?? '', trim(($c['name'] ?? '') . ' · ' . ($c['description'] ?? ''), ' ·'), $road, $c['latitude'] ?? null, $c['longitude'] ?? null, $img, '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

// Cameras that look straight at a US-Mexico or US-Canada port of entry.
function gsa_lc_fetch_border($hosts)
{
    $out = array();
    // Caltrans District 11 (San Diego / Imperial): San Ysidro, Otay Mesa, Calexico.
    $cal = gsa_lc_source_list('caltrans');
    foreach ($cal['cams'] ?? array() as $c) {
        if (strpos($c[0], 'd11-') !== 0) {
            continue;
        }
        $near = ($c[3] < 32.585) || preg_match('/San Ysidro|Calexico|Otay Mesa Rd|Tecate|Dairy Mart/i', $c[1] . ' ' . $c[2]);
        if (!$near || $c[3] > 32.72) {
            continue;
        }
        $c[2] = 'US-Mexico border · ' . $c[2];
        $out[] = $c;
    }
    foreach (gsa_lc_drivebc_rows() as $row) {
        $text = ($row['name'] ?? '') . ' ' . ($row['caption'] ?? '');
        if (!preg_match('#border crossing|Canada/USA border#i', $text)) {
            continue;
        }
        $c = gsa_lc_drivebc_cam($row, $hosts);
        if ($c) {
            $c[2] = 'Canada-US border · ' . $c[2];
            $out[] = $c;
        }
    }
    if (!$out) {
        throw new RuntimeException('No border cameras found');
    }
    return $out;
}

function gsa_lc_fetch_usgsvolc($hosts)
{
    $j = gsa_lc_json('https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams');
    $out = array();
    $now = time();
    foreach ($j['webcams'] ?? array() as $w) {
        $last = (int) ($w['lastImageTimestamp'] ?? 0);
        if (!$last || $now - $last > 3 * 86400) {
            continue; // camera has not sent a picture in three days
        }
        $cam = gsa_lc_cam($w['webcamCode'] ?? '', $w['webcamName'] ?? '', trim(($w['vName'] ?? '') . ' volcano'), $w['latitude'] ?? null, $w['longitude'] ?? null, $w['currentMediumImageUrl'] ?? ($w['currentImageUrl'] ?? ''), '', $hosts);
        if ($cam) {
            $out[] = $cam;
        }
    }
    return $out;
}

// ---------------------------------------------------------------- cache
function gsa_lc_source_list($key, $force = false)
{
    $srcs = gsa_lc_sources();
    $src = $srcs[$key];
    $file = gsa_lc_file($key);
    $cached = is_file($file) ? json_decode((string) @file_get_contents($file), true) : null;
    $fresh = is_array($cached) && isset($cached['at']) && (time() - (int) $cached['at'] < $src['ttl']);
    $retryOk = !is_array($cached) || empty($cached['failAt']) || time() - (int) $cached['failAt'] > 300;
    if ($fresh && !$force) {
        return $cached;
    }
    if (!$retryOk && is_array($cached) && !empty($cached['cams'])) {
        return $cached; // failed in the last 5 minutes: serve the old copy
    }
    $lock = @fopen($file . '.lock', 'c');
    if ($lock && !flock($lock, LOCK_EX | LOCK_NB)) {
        // Someone else is refreshing; serve what we have, or wait for them.
        if (is_array($cached) && !empty($cached['cams'])) {
            fclose($lock);
            return $cached;
        }
        flock($lock, LOCK_EX);
        flock($lock, LOCK_UN);
        fclose($lock);
        $again = is_file($file) ? json_decode((string) @file_get_contents($file), true) : null;
        return is_array($again) ? $again : array('cams' => array(), 'error' => 'Source is loading');
    }
    $fn = 'gsa_lc_fetch_' . $key;
    try {
        $cams = $fn($src['hosts']);
        if (!$cams) {
            throw new RuntimeException('Empty list');
        }
        $payload = array('at' => time(), 'cams' => array_values($cams));
        gsa_atomic_write($file, json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    } catch (Throwable $e) {
        $payload = is_array($cached) ? $cached : array('at' => 0, 'cams' => array());
        $payload['error'] = gsa_lc_txt($e->getMessage(), 80);
        $payload['failAt'] = time();
        gsa_atomic_write($file, json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }
    if ($lock) {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
    return $payload;
}

function gsa_lc_rate($bucket, $limit)
{
    $key = function_exists('gsa_cf_client_key') ? gsa_cf_client_key() : 'all';
    $file = gsa_lc_file('rate');
    $fh = @fopen($file, 'c+');
    if (!$fh) {
        return true;
    }
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $store = json_decode((string) $raw, true);
    if (!is_array($store)) {
        $store = array();
    }
    $min = (int) floor(time() / 60);
    if (($store['min'] ?? 0) !== $min) {
        $store = array('min' => $min, 'n' => array());
    }
    $k = $bucket . ':' . $key;
    $n = (int) ($store['n'][$k] ?? 0) + 1;
    $store['n'][$k] = $n;
    $site = (int) ($store['n']['site:' . $bucket] ?? 0) + 1;
    $store['n']['site:' . $bucket] = $site;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($store));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $n <= $limit && $site <= $limit * 40;
}

function gsa_lc_layer_route($layer)
{
    $layers = gsa_lc_layers();
    if (!isset($layers[$layer])) {
        json_out(404, array('error' => 'Unknown camera layer'));
    }
    if (!gsa_lc_rate('list', GSA_LC_LIST_PER_MIN)) {
        header('Retry-After: 60');
        json_out(429, array('error' => 'Too many requests, try again in a minute'));
    }
    // A cold cache can take a while (Caltrans is ~10 MB); finish and save it
    // even if this visitor goes away.
    @set_time_limit(120);
    @ignore_user_abort(true);
    $srcs = gsa_lc_sources();
    $out = array('layer' => $layer, 'sources' => array(), 'cams' => array());
    foreach ($layers[$layer] as $i => $key) {
        $list = gsa_lc_source_list($key);
        $n = 0;
        foreach ($list['cams'] ?? array() as $c) {
            $c[] = $i; // index into sources
            $out['cams'][] = $c;
            $n++;
        }
        $out['sources'][] = array(
            'key' => $key,
            'credit' => $srcs[$key]['credit'],
            'img' => $srcs[$key]['img'],
            'count' => $n,
            'at' => (int) ($list['at'] ?? 0),
            'error' => isset($list['error']) && $n === 0 ? $list['error'] : null,
        );
    }
    $out['count'] = count($out['cams']);
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=300');
    echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// Current picture for one camera of a 'resolve' or 'proxy' source.
function gsa_lc_img_route()
{
    $srcKey = (string) ($_GET['s'] ?? '');
    $id = (string) ($_GET['id'] ?? '');
    $srcs = gsa_lc_sources();
    if (!isset($srcs[$srcKey]) || $srcs[$srcKey]['img'] === 'direct' || !preg_match('/^[A-Za-z0-9._-]{1,64}$/', $id)) {
        json_out(404, array('error' => 'Unknown camera'));
    }
    if (!gsa_lc_rate('img', GSA_LC_IMG_PER_MIN)) {
        header('Retry-After: 60');
        json_out(429, array('error' => 'Too many requests, try again in a minute'));
    }
    $list = gsa_lc_source_list($srcKey);
    $url = '';
    foreach ($list['cams'] ?? array() as $c) {
        if ($c[0] === $id) {
            $url = gsa_lc_url($c[5], $srcs[$srcKey]['hosts']);
            break;
        }
    }
    if ($url === '') {
        json_out(404, array('error' => 'Camera not in the current list'));
    }
    if ($srcs[$srcKey]['img'] === 'resolve') {
        header('Cache-Control: no-store');
        header('Location: ' . $url, true, 302);
        exit;
    }
    // proxy: short file cache so one camera is fetched at most every 20 s.
    $cache = gsa_lc_file('img-' . $srcKey . '-' . md5($id));
    if (!is_file($cache) || time() - filemtime($cache) > 20) {
        $r = gsa_lc_get($url, 'image/*');
        if ($r['ok'] && strpos($r['type'], 'image/') === 0 && strlen($r['body']) < 3000000) {
            gsa_atomic_write($cache, $r['body']);
        } elseif (!is_file($cache)) {
            json_out(502, array('error' => 'Camera did not answer'));
        }
    }
    header('Content-Type: image/jpeg');
    header('Cache-Control: public, max-age=20');
    header('Content-Length: ' . filesize($cache));
    readfile($cache);
    exit;
}

function gsa_lc_routes($path, $method)
{
    if ($method !== 'GET') {
        return;
    }
    if ($path === '/api/live-cams/img') {
        gsa_lc_img_route();
    }
    if (preg_match('#^/api/live-cams/([a-z]{2,16})$#', $path, $m)) {
        gsa_lc_layer_route($m[1]);
    }
}
