export const MAX_ATTEMPTS = 3
export const BASE_BACKOFF_MS = 2_000

const minutes = (value) => value * 60_000

function cloneState(state) {
  return {
    ...state,
    posts: state.posts.map((post) => ({ ...post })),
    topic: state.topic.map((message) => ({ ...message })),
    dlq: state.dlq.map((message) => ({ ...message })),
    eventTracker: new Set(state.eventTracker),
    history: state.history.map((entry) => ({ ...entry })),
  }
}

function addActivity(state, type, message, eventId = null, attempt = null) {
  state.history.push({
    type,
    message,
    eventId,
    attempt,
    at: state.now,
  })
}

export function createInitialState(now = Date.now()) {
  return {
    now,
    posts: [
      {
        id: 'post-101',
        title: 'The little things add up',
        channel: 'Instagram',
        thumbnail: '✳',
        dueAt: now - minutes(6),
        dueLabel: '6 minutes ago',
        behavior: 'success',
        attempts: 0,
        status: 'scheduled',
      },
      {
        id: 'post-102',
        title: 'A new week, a fresh start',
        channel: 'LinkedIn',
        thumbnail: '↗',
        dueAt: now - minutes(3),
        dueLabel: '3 minutes ago',
        behavior: 'recover',
        recoverAfter: 2,
        attempts: 0,
        status: 'scheduled',
      },
      {
        id: 'post-103',
        title: 'Behind the scenes: studio day',
        channel: 'X',
        thumbnail: '◉',
        dueAt: now - minutes(1),
        dueLabel: '1 minute ago',
        behavior: 'fail',
        attempts: 0,
        status: 'scheduled',
      },
    ],
    topic: [],
    dlq: [],
    eventTracker: new Set(),
    history: [],
  }
}

export function runDuePostScheduler(currentState, now = currentState.now) {
  const state = cloneState(currentState)
  state.now = now

  for (const post of state.posts) {
    if (post.status !== 'scheduled' || post.dueAt > now) continue

    const eventId = `publish:${post.id}`
    state.topic.push({
      eventId,
      postId: post.id,
      postTitle: post.title,
      attempts: 0,
      availableAt: now,
    })
    post.status = 'queued'
    addActivity(state, 'produced', `Scheduled post added to publish.requests: ${post.title}`, eventId)
  }

  return state
}

export function processNextMessage(currentState, now = currentState.now) {
  const state = cloneState(currentState)
  state.now = now
  const messageIndex = state.topic.findIndex((message) => message.availableAt <= now)
  if (messageIndex === -1) return state

  const [message] = state.topic.splice(messageIndex, 1)
  const post = state.posts.find((item) => item.id === message.postId)

  if (!post) {
    throw new Error(`No scheduled post exists for event ${message.eventId}`)
  }

  if (state.eventTracker.has(message.eventId)) {
    addActivity(state, 'duplicate', `Duplicate event skipped; ${message.eventId} was already processed`, message.eventId)
    return state
  }

  const attempt = message.attempts + 1
  post.attempts = attempt
  const publishSucceeded =
    post.behavior === 'success' ||
    (post.behavior === 'recover' && attempt >= post.recoverAfter)

  if (publishSucceeded) {
    post.status = 'published'
    state.eventTracker.add(message.eventId)
    addActivity(state, 'published', `Published "${post.title}" successfully`, message.eventId, attempt)
    return state
  }

  if (attempt >= MAX_ATTEMPTS) {
    post.status = 'failed'
    const failedMessage = {
      ...message,
      attempts: attempt,
      failedAt: now,
      failure: 'Maximum retry attempts exceeded',
    }
    state.dlq.push(failedMessage)
    addActivity(state, 'dlq', `"${post.title}" moved to the dead letter queue after ${attempt} attempts`, message.eventId, attempt)
    return state
  }

  const delay = BASE_BACKOFF_MS * (2 ** (attempt - 1))
  const retryMessage = {
    ...message,
    attempts: attempt,
    availableAt: now + delay,
  }
  post.status = 'retrying'
  state.topic.push(retryMessage)
  addActivity(state, 'retry', `Attempt ${attempt} failed; retry in ${delay / 1_000}s`, message.eventId, attempt)
  return state
}

export function advanceToNextRetry(currentState) {
  const nextRetryAt = currentState.topic
    .map((message) => message.availableAt)
    .filter((availableAt) => availableAt > currentState.now)
    .sort((left, right) => left - right)[0]

  if (nextRetryAt === undefined) return currentState
  return { ...cloneState(currentState), now: nextRetryAt }
}

export function runExperiment(currentState) {
  let state = runDuePostScheduler(currentState)
  let steps = 0

  while (state.topic.length > 0) {
    if (steps >= state.posts.length * MAX_ATTEMPTS + 1) {
      throw new Error('Experiment exceeded the expected message processing limit')
    }

    const nextAvailableAt = Math.min(...state.topic.map((message) => message.availableAt))
    state = processNextMessage(state, Math.max(state.now, nextAvailableAt))
    steps += 1
  }

  const completedPost = state.posts.find((post) => post.status === 'published')
  if (completedPost) {
    const duplicate = {
      eventId: `publish:${completedPost.id}`,
      postId: completedPost.id,
      postTitle: completedPost.title,
      attempts: 0,
      availableAt: state.now,
    }
    state = { ...cloneState(state), topic: [...state.topic, duplicate] }
    state = processNextMessage(state)
  }

  return state
}
