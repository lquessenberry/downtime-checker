# Load and freshness review

**Snapshot 2026-11-20.** Do not treat this as current runbook.

Later work supersedes parts of it: one-user poll-runner and cache (#34),
Rust `downtime-server` workers, AIR unkeyed 3-minute cache (not a 1.7 MB
file every 8 seconds), OSM default instead of Esri. Merging this PR only
keeps the 11-20 notes. It does not ship those old “fixes” and it does not
close #23–#31.

Checked on the live globe https://globalstatus.app on 2026-11-20.
It is the same list as
https://github.com/lquessenberry/downtime-checker/issues/23 through #31,
linked from the backlog tracker #2.

## Down check

Problem. Lock & Scan makes GoDaddy ping all 1,344 hosts. The visitor only
watches. Only one check can run. A second person gets "A check is already
running." One full check takes a few minutes. Every open visit also holds
the result stream and reconnects about every 25 seconds. Shared GoDaddy
hosting can handle a few dozen of those at once, not a thousand people.
Map pictures come from Esri, not from GoDaddy.

Fix. Every 30 minutes GoDaddy runs one check, saves the up and down
results, and stops. Everyone reads that copy until the next run. The page
stops holding the result connection open. One pass finishes in a few
minutes, so the results can be up to 30 minutes old.

Issues: #23, #24.

## Aircraft file and jammed GPS

Problem. Live Air Traffic and Jammed GPS sit in one saved 1.7 MB file.
The page downloads that whole file every 8 seconds for every visitor, even
when those layers are off. A thousand people would push about 200 megabytes
a second through GoDaddy. The browser cannot read adsb.lol or
GPSInterference.com directly.

What people see today. Normal Live Air Traffic is the evening of
18 November 2026: 2,598 planes that do not move. Jammed GPS is the morning
of 18 November 2026. The military-only filter is the exception. It still
asks adsb.lol about every 3 minutes and shares the same cap of about 500
requests a day.

Fix. Stop the 8 second download. GoDaddy asks adsb.lol once every 30
minutes (about 48 pulls a day) and everyone reads that saved copy. Planes
would be at most 30 minutes old. Put Jammed GPS on that same timer.
GPSInterference.com is a daily-style map, so many of those saves will look
the same. Keep the full aircraft list on the 30 minute save so it does not
share the daily cap with a military filter that runs all day.

Issues: #25, #26, #27.

## Other old layers

Scanners is a saved OpenMHz list from the early morning of 19 November 2026.
Listener counts and on or off marks are from then. Refresh once or twice a
day. Issue #28.

Conflict Tracker is a saved Council on Foreign Relations list from the
afternoon of 19 November 2026. Refresh once or twice a day. Issue #29.

World Hunger is the FAO figure for 2024 on purpose. Leave it. Do not put it
on a 30 minute timer. Issue #30.

## Already current

Leave these. Each one already shares one cached copy while the layer is on.

- Power Outages, Department of Energy, about every 3 minutes.
- Maritime Traffic, from the ship map, not a big file on GoDaddy.
- Mesh Nodes, meshmap.net, about every 90 seconds.
- Disease Outbreak, HealthMap past week, about every 3 minutes.
- Animal Disease Outbreak, GIDEON public animal events, about every 10 minutes.

Issue #31.

## What this does not change

The load that matters is the down check, the always-open connection, and
the 1.7 MB aircraft file. The yearly hunger numbers and the live layers
above stay as they are.
