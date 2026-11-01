import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BASE_BACKOFF_MS,
  MAX_ATTEMPTS,
  advanceToNextRetry,
  createInitialState,
  processNextMessage,
  runDuePostScheduler,
  runExperiment,
} from '../src/scheduler.js'

test('scheduler produces one publish event per due post', () => {
  const now = 1_800_000_000_000
  const initial = createInitialState(now)
  const state = runDuePostScheduler(initial)

  assert.equal(state.topic.length, 3)
  assert.ok(state.topic.every((message) => message.eventId.startsWith('publish:')))
  assert.ok(state.posts.every((post) => post.status === 'queued'))
  assert.equal(runDuePostScheduler(state).topic.length, 3)
})

test('consumer retries with exponential backoff and eventually publishes recoverable posts', () => {
  const initial = createInitialState(1_800_000_000_000)
  let state = runDuePostScheduler(initial)
  state.topic = state.topic.filter((message) => message.postId === 'post-102')
  state = processNextMessage(state)
  const retryMessage = state.topic[0]
  assert.equal(retryMessage.attempts, 1)
  assert.equal(retryMessage.availableAt, state.now + BASE_BACKOFF_MS)

  state = advanceToNextRetry(state)
  state = processNextMessage(state)
  assert.equal(state.posts.find((post) => post.id === 'post-102').status, 'published')
  assert.ok(state.eventTracker.has('publish:post-102'))
})

test('messages exceeding the retry limit are routed to the DLQ', () => {
  let state = runDuePostScheduler(createInitialState(1_800_000_000_000))
  state.topic = state.topic.filter((message) => message.postId === 'post-103')

  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    state = processNextMessage(state)
    const retryMessage = state.topic[0]
    assert.equal(retryMessage.availableAt - state.now, BASE_BACKOFF_MS * (2 ** (attempt - 1)))
    state = advanceToNextRetry(state)
  }
  state = processNextMessage(state)

  const failed = state.dlq.find((message) => message.postId === 'post-103')
  assert.ok(failed)
  assert.equal(failed.attempts, MAX_ATTEMPTS)
  assert.equal(state.posts.find((post) => post.id === 'post-103').status, 'failed')
})

test('event tracking skips a replayed event and full experiment exercises every outcome', () => {
  const state = runExperiment(createInitialState(1_800_000_000_000))

  assert.equal(state.topic.length, 0)
  assert.equal(state.posts.filter((post) => post.status === 'published').length, 2)
  assert.equal(state.dlq.length, 1)
  assert.equal(state.history.filter((entry) => entry.type === 'retry').length, 3)
  assert.equal(state.history.filter((entry) => entry.type === 'duplicate').length, 1)
  assert.equal(state.eventTracker.size, 2)
})
