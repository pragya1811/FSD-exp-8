# Experiment 08 — Reliable post publishing

A runnable React experiment that demonstrates a due-post scheduler, Kafka-style publish requests, a consumer with exponential-backoff retries, dead-letter routing, and event-ID idempotency.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Choose **Run experiment** to run the complete scenario, or use **Run scheduler**, **Process next message**, and **Advance backoff clock** to step through the lifecycle.

## Experiment behavior

- The scheduler publishes each due post once as a `publish:<post-id>` event to the `publish.requests` topic.
- The consumer publishes successful posts and records completed event IDs in an event tracker.
- A transient-failure sample succeeds on its second attempt. A permanent-failure sample is retried up to three times.
- Retry delays use exponential backoff: 2 seconds, then 4 seconds. The demo advances a virtual clock rather than waiting in real time.
- Messages that exhaust their attempts are moved to `publish.requests.dlq`.
- The full run replays a completed event to show that the consumer skips an already-tracked event.

This frontend-only experiment models Kafka topic behavior in memory; it does not connect to a Kafka broker or persist state across reloads. The processing logic is isolated in `src/scheduler.js` and covered by the built-in Node test runner:

```sh
npm test
npm run build
```
