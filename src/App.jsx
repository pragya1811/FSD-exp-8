import { useState } from 'react'
import {
  advanceToNextRetry,
  createInitialState,
  processNextMessage,
  runDuePostScheduler,
  runExperiment,
} from './scheduler.js'
import './App.css'

const initialState = () => createInitialState()

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function StatusBadge({ status }) {
  const labels = {
    scheduled: 'Scheduled',
    queued: 'In topic',
    retrying: 'Retrying',
    published: 'Published',
    failed: 'In DLQ',
  }

  return <span className={`status-badge status-${status}`}>{labels[status]}</span>
}

function App() {
  const [state, setState] = useState(initialState)
  const published = state.posts.filter((post) => post.status === 'published').length
  const retries = state.history.filter((entry) => entry.type === 'retry').length
  const duePosts = state.posts.filter(
    (post) => post.status === 'scheduled' && post.dueAt <= state.now,
  ).length
  const readyMessages = state.topic.filter((message) => message.availableAt <= state.now).length
  const duplicateSkips = state.history.filter((entry) => entry.type === 'duplicate').length

  function reset() {
    setState(createInitialState())
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Queueboard home">
          <span className="brand-mark" aria-hidden="true">q</span>
          <span>queueboard</span>
        </a>
        <div className="topbar-right">
          <span className="environment"><span className="online-dot" /> Local experiment</span>
          <span className="avatar" aria-label="Experiment 8">E8</span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="Main navigation">
          <div className="workspace-label">WORKSPACE</div>
          <a className="nav-item active" href="#overview"><span className="nav-icon">◫</span> Overview</a>
          <a className="nav-item" href="#scheduled"><span className="nav-icon">◷</span> Scheduled posts <span className="nav-count">{state.posts.length}</span></a>
          <a className="nav-item" href="#topic"><span className="nav-icon">⇢</span> Kafka topic <span className="nav-count">{state.topic.length}</span></a>
          <a className="nav-item" href="#dead-letter"><span className="nav-icon">⚑</span> Dead letter queue <span className="nav-count">{state.dlq.length}</span></a>

          <div className="sidebar-divider" />
          <div className="workspace-label">EXPERIMENT</div>
          <div className="experiment-card">
            <span className="experiment-number">08</span>
            <div><strong>Reliable publishing</strong><small>Scheduler · retries · DLQ</small></div>
            <span className="experiment-check">✓</span>
          </div>
          <div className="sidebar-note">
            <span className="note-icon">i</span>
            <p>Messages and event tracking are held in memory for this runnable demo.</p>
          </div>
          <div className="sidebar-footer">
            <span className="footer-avatar">L</span>
            <span><strong>Local workspace</strong><small>Experiment environment</small></span>
            <span className="more-icon">···</span>
          </div>
        </aside>

        <section className="main-content" id="overview">
          <div className="page-heading">
            <div>
              <div className="breadcrumb">Experiments <span>/</span> 08</div>
              <h1>Reliable publishing</h1>
              <p className="page-description">Schedule posts, stream publish requests, and recover from failures automatically.</p>
            </div>
            <div className="heading-actions">
              <button className="button button-quiet" onClick={reset}>Reset demo</button>
              <button className="button button-primary" onClick={() => setState((current) => runExperiment(current))}>
                <span aria-hidden="true">▶</span> Run experiment
              </button>
            </div>
          </div>

          <div className="run-strip">
            <div className="run-indicator"><span className="online-dot" /> Ready to run</div>
            <span className="run-divider" />
            <span>Virtual clock <strong>{formatTime(state.now)}</strong></span>
            <span className="run-hint">Backoff time advances instantly in the experiment</span>
          </div>

          <section className="metrics-grid" aria-label="Pipeline metrics">
            <article className="metric-card">
              <div className="metric-top"><span>Due posts</span><span className="metric-icon violet">◷</span></div>
              <div className="metric-value">{duePosts}</div>
              <div className="metric-caption">Waiting for scheduler</div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Topic messages</span><span className="metric-icon blue">⇢</span></div>
              <div className="metric-value">{state.topic.length}</div>
              <div className="metric-caption"><span className="caption-dot" /> {readyMessages} ready to consume</div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Published</span><span className="metric-icon green">✓</span></div>
              <div className="metric-value">{published}<span className="metric-unit">/{state.posts.length}</span></div>
              <div className="metric-caption">Successfully delivered</div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Retries / DLQ</span><span className="metric-icon orange">↻</span></div>
              <div className="metric-value">{retries}<span className="metric-unit"> / {state.dlq.length}</span></div>
              <div className="metric-caption">{duplicateSkips} duplicate event{duplicateSkips === 1 ? '' : 's'} skipped</div>
            </article>
          </section>

          <section className="pipeline-section" aria-label="Publishing pipeline">
            <div className="section-heading">
              <div><h2>Publishing pipeline</h2><p>Follow each post from its scheduled time to its final outcome.</p></div>
              <span className="live-label"><span className="online-dot" /> LIVE SIMULATION</span>
            </div>
            <div className="pipeline">
              <div className="pipeline-step"><span className="step-icon step-clock">◷</span><strong>Scheduler</strong><small>Find due posts</small><span className="step-count">{duePosts} due</span></div>
              <span className="pipeline-arrow">→</span>
              <div className="pipeline-step"><span className="step-icon step-topic">⇢</span><strong>Kafka topic</strong><small>publish.requests</small><span className="step-count">{state.topic.length} queued</span></div>
              <span className="pipeline-arrow">→</span>
              <div className="pipeline-step"><span className="step-icon step-consumer">⚙</span><strong>Consumer</strong><small>Publish &amp; retry</small><span className="step-count">{retries} retries</span></div>
              <span className="pipeline-arrow">→</span>
              <div className="pipeline-step"><span className="step-icon step-dlq">⚑</span><strong>Dead letter</strong><small>After 3 attempts</small><span className="step-count">{state.dlq.length} failed</span></div>
            </div>
          </section>

          <section className="posts-section" id="scheduled">
            <div className="section-heading posts-heading">
              <div><h2>Scheduled posts</h2><p>Three sample posts cover success, transient failure, and exhausted retries.</p></div>
              <button className="button button-outline" onClick={() => setState((current) => runDuePostScheduler(current))} disabled={duePosts === 0}>
                <span aria-hidden="true">↻</span> Run scheduler
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>POST</th><th>SCHEDULED FOR</th><th>ATTEMPTS</th><th>STATUS</th></tr></thead>
                <tbody>
                  {state.posts.map((post) => (
                    <tr key={post.id}>
                      <td><div className="post-cell"><span className={`post-thumb thumb-${post.id}`}>{post.thumbnail}</span><span><strong>{post.title}</strong><small>{post.channel} · {post.id}</small></span></div></td>
                      <td><span className="scheduled-time">{formatTime(post.dueAt)}</span><small className="muted-cell">{post.dueLabel}</small></td>
                      <td><span className="attempt-count">{post.attempts}<span> / 3</span></span></td>
                      <td><StatusBadge status={post.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="bottom-grid">
            <section className="stream-panel" id="topic">
              <div className="panel-heading"><div><h2>Topic stream</h2><p><span className="topic-dot" /> publish.requests</p></div><span className="topic-count">{state.topic.length} messages</span></div>
              {state.topic.length === 0 ? (
                <div className="empty-state"><span className="empty-icon">⇢</span><strong>No messages in topic</strong><span>Run the scheduler to produce due post events.</span></div>
              ) : (
                <div className="message-list">
                  {state.topic.map((message, index) => (
                    <article className="message-row" key={`${message.eventId}-${index}`}>
                      <span className="message-icon">⇢</span>
                      <div className="message-details"><strong>{message.postTitle}</strong><code>{message.eventId}</code></div>
                      <div className="message-meta"><span>Attempt {message.attempts + 1}</span><small>{message.availableAt > state.now ? `Retry at ${formatTime(message.availableAt)}` : 'Ready now'}</small></div>
                    </article>
                  ))}
                </div>
              )}
              <div className="panel-actions">
                <button className="button button-outline" onClick={() => setState((current) => processNextMessage(current))} disabled={readyMessages === 0}>
                  Process next message
                </button>
                <button className="text-button" onClick={() => setState((current) => advanceToNextRetry(current))} disabled={!state.topic.some((message) => message.availableAt > state.now)}>
                  Advance backoff clock
                </button>
              </div>
            </section>

            <section className="stream-panel dlq-panel" id="dead-letter">
              <div className="panel-heading"><div><h2>Dead letter queue</h2><p>publish.requests.dlq</p></div><span className="dlq-count">{state.dlq.length}</span></div>
              {state.dlq.length === 0 ? (
                <div className="empty-state"><span className="empty-icon empty-warning">⚑</span><strong>Nothing failed permanently</strong><span>Messages land here after all retry attempts fail.</span></div>
              ) : (
                <div className="message-list">
                  {state.dlq.map((message) => (
                    <article className="message-row" key={message.eventId}>
                      <span className="message-icon message-error">!</span>
                      <div className="message-details"><strong>{message.postTitle}</strong><code>{message.eventId}</code></div>
                      <div className="message-meta"><span className="failure-label">Failed</span><small>{message.attempts} attempts</small></div>
                    </article>
                  ))}
                </div>
              )}
              <div className="panel-actions panel-footnote"><span>Messages are preserved with their event IDs for inspection.</span></div>
            </section>
          </div>

          <section className="activity-section">
            <div className="section-heading activity-heading"><div><h2>Event activity</h2><p>Producer, consumer, retry, and idempotency events.</p></div><span className="activity-count">{state.history.length} events</span></div>
            {state.history.length === 0 ? (
              <div className="activity-empty">Run the experiment to see the event lifecycle.</div>
            ) : (
              <ol className="activity-list">
                {[...state.history].reverse().slice(0, 7).map((entry, index) => (
                  <li className="activity-item" key={`${entry.at}-${entry.type}-${index}`}>
                    <span className={`activity-marker marker-${entry.type}`} />
                    <span className="activity-time">{formatTime(entry.at)}</span>
                    <span className="activity-message">{entry.message}</span>
                    {entry.eventId && <code>{entry.eventId}</code>}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <footer className="page-footer"><span>Experiment 08 <span className="footer-separator">·</span> Event-driven post scheduler</span><span>In-memory Kafka-style topic <span className="footer-separator">·</span> Exponential backoff <span className="footer-separator">·</span> Idempotent consumer</span></footer>
        </section>
      </div>
    </main>
  )
}

export default App
