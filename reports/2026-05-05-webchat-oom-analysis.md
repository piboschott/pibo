# Webchat OOM Analysis Report

Date: 2026-05-05
System: Pibo Web Gateway on `pibo.neuralnexus.me`
Host: `217.154.222.150`
Service: `pibo-web.service`

## Summary

The outage was caused by memory exhaustion on the server. The kernel OOM killer terminated a process inside the `pibo-web.service` cgroup. The immediate operational factor was a small host with 3.8 GiB RAM and originally no swap. The underlying product issue is unbounded event growth in the Chat Web path combined with expensive trace reconstruction that loads all events for a session into memory.

After the incident:
- the server was rebooted
- the web app became reachable again
- a 4 GiB swap file was added and activated persistently

This restored availability, but it does not remove the root cause.

## Confirmed Incident Evidence

### Kernel OOM evidence

Previous-boot kernel logs showed:
- OOM kill inside `task_memcg=/system.slice/pibo-web.service`
- killed process name `MainThread`
- `total-vm:2019688kB`
- `anon-rss:669376kB`

This directly ties the outage to the Pibo web service.

### Current service state after reboot

Observed after reboot:
- `pibo-web.service` active and running
- `nginx.service` active and running
- `https://pibo.neuralnexus.me/apps/chat` returned HTTP 200
- host memory: about 3.8 GiB RAM
- original swap before mitigation: `0B`

### Host hardening applied

Mitigation applied on the server:
- created `/swapfile`
- enabled 4 GiB swap
- added swap entry to `/etc/fstab`
- set `vm.swappiness=10`

This reduces the chance of a full host outage during future memory spikes.

## Main Findings

### 1. Chat Web stores a very large event volume

Server-side database sizes:
- `/root/.pibo/web-chat.sqlite`: about 1.2 GiB
- `/root/.pibo/pibo-events.sqlite`: about 644 MiB

Counts observed in `web-chat.sqlite`:
- `web_chat_events`: 704,773 rows
- `chat_events`: 705,010 rows
- `web_chat_sessions`: 57 rows
- `pibo_rooms`: 3 rows
- `chat_retention_policies`: 0 rows

Top event types in `web_chat_events`:
- `thinking_delta`: 581,551
- `assistant_delta`: 96,819
- `tool_call`: 6,724
- `tool_execution_updated`: 5,896

This shows that delta events dominate storage volume.

### 2. The same output events are mirrored into multiple stores

In the Chat Web indexing path, each output event is written to:
- `web_chat_events`
- `chat_events`
- `pibo_event_stream` with topic `pibo.output`

This multiplies storage and memory pressure.

Counts observed in `pibo-events.sqlite`:
- total `pibo_event_stream` rows: 972,294
- rows for topic `pibo.output`: 972,294

Retention classes in `pibo_event_stream`:
- `live_delta`: 936,125
- `trace_event`: 34,950
- `chat_message`: 1,219

No consumer offsets were present in `pibo_event_consumers` during inspection.

### 3. No active retention policy is configured for Chat Web event data

The Chat Web event log schema supports retention policy storage and purge operations, but the server had no configured entries in `chat_retention_policies`.

Observed state:
- `chat_retention_policies`: 0 rows

This means delta-heavy chat traffic can grow indefinitely unless operators prune manually or code actively sets and executes retention.

### 4. Trace reconstruction is memory-expensive by design

The `/api/chat/trace` path rebuilds trace state by loading all stored events for a selected session and passing them into the trace builder.

This is important because some sessions are very large.

Top session event counts observed:
- largest session: 63,934 events
- several other sessions: 30k to 53k events each

A direct reproduction was run on the server in a one-off Node process using the largest session.

Memory profile during reproduction:
- process start: about 136 MiB RSS
- after `listAllEvents(...)`: about 234 MiB RSS
- after `buildTraceView(...)`: about 311 MiB RSS

That measurement was for one isolated trace build only.

This strongly suggests that repeated trace reads on large sessions, combined with a long-lived server process and large backing databases, can push the host toward OOM.

### 5. The running web process already shows elevated memory after startup

Post-reboot inspection showed:
- Node main process RSS around 500+ MiB during analysis
- service cgroup memory around 1.1 GiB

`memory.stat` also showed a split between:
- high anonymous memory
- high file-backed memory

This matches the picture of both:
- JavaScript/runtime memory growth
- large file-backed pressure from SQLite and OS page cache

## Likely Cause Chain

The most likely sequence is:

1. Long or active Chat Web sessions produce very large numbers of `thinking_delta` and `assistant_delta` events.
2. Those events are persisted repeatedly across multiple stores.
3. There is no active retention policy removing old high-volume delta data.
4. Large session traces are rebuilt from the full event history, not a bounded subset.
5. The web process accumulates anonymous memory and file-backed memory pressure.
6. On a 4 GiB host without swap, the kernel eventually kills the web service.

This chain is fully consistent with the observed OOM kill, database sizes, event counts, and reproduced trace-build memory usage.

## Code-Level Risk Areas

The following areas are the highest-probability contributors:

### Chat Web indexing path

Writes every output event into multiple stores. This is the main ingestion multiplier.

### Chat Web trace API

The trace endpoint rebuilds traces from full session event history, which is expensive for large sessions.

### Trace cache

The server keeps a trace cache keyed by session/version/options with a maximum of 128 entries. This may add further memory pressure when many distinct trace versions are generated.

### Reliability store mirror

`pibo.output` mirrors the same event stream for operational replay and debugging, but there is no automatic pruning visible in the inspected runtime path.

## Operational Conclusions

### What fixed the outage

The outage ended because:
- the server was rebooted
- memory pressure was reset
- swap was added afterward

### What did not get fixed yet

The underlying issue remains:
- event growth is still structurally unbounded
- large traces are still rebuilt from full session event history
- multiple stores still keep the same high-volume delta stream

If traffic continues in the same pattern, the host can degrade again, even though swap makes a full crash less immediate.

## Recommended Next Steps

### Immediate product fixes

1. Stop durably storing every `thinking_delta` and `assistant_delta` in all stores.
2. Add default retention for delta-heavy event classes.
3. Execute retention automatically in the web runtime, not only through manual operator commands.
4. Change `/api/chat/trace` so it does not load full session event history into memory for large sessions.
5. Reduce or redesign the server-side trace cache.

### Immediate operational cleanup

1. Prune old `live_delta` rows from `pibo_event_stream`.
2. Prune old `live_delta` and low-value `trace_event` rows from Chat Web storage where product requirements allow it.
3. Consider compacting or vacuuming the affected SQLite databases after cleanup.

### Capacity recommendation

The current workload is risky for a 4 GiB host. Even with swap, the safer medium-term option is either:
- reduce event/storage/memory amplification in the product, or
- move the service to a larger machine

Preferably both.

## Final Assessment

The outage was not a random crash. It was the result of a coherent failure mode:
- high-volume delta generation
- repeated durable mirroring of those deltas
- no active retention
- expensive full-history trace reconstruction
- undersized host memory with no swap at the time of failure

The incident is reproducible in principle and the root cause is credible based on direct server measurements.
