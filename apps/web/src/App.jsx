import { useEffect, useRef, useState } from 'react';

function Icon({name, ...props}) {
  const paths = {book: 'M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4z M12 5v15', arrow: 'M5 12h14 M13 6l6 6-6 6', plus: 'M12 5v14 M5 12h14', link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2', chat: 'M4 4h16v13H9l-5 4z', shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6', logout: 'M10 4H4v16h6 M10 12h10 M16 8l4 4-4 4', check: 'M5 12l4 4L19 6'};
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.book}/></svg>;
}

export default function App() {
  const [token, setToken] = useState(''); // Memory only; sign in again after reload or expiry.
  const [mode, setMode] = useState('login');
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [backendReady, setBackendReady] = useState(null);
  const [allowedHosts, setAllowedHosts] = useState([]);
  const [indexedChunks, setIndexedChunks] = useState(null);
  const [sourceJobs, setSourceJobs] = useState([]);
  const [question, setQuestion] = useState('');
  const [adding, setAdding] = useState(false);
  const conversationEnd = useRef(null);
  const generation = useRef(0);
  function logout() { generation.current++; setToken(''); setMessages([]); setJob(null); setBusy(false); setAllowedHosts([]); setIndexedChunks(null); setSourceJobs([]); setQuestion(''); }
  useEffect(() => { conversationEnd.current?.scrollIntoView({block: 'nearest'}); }, [messages, busy]);

  async function api(path, body, signal) {
    const response = await fetch(`/api${path}`, {
      method: body ? 'POST' : 'GET', signal,
      headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('The backend is unavailable. Start the services and try again.'); }
    if (!response.ok) {
      if (response.status === 401 && token) logout();
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function checkBackend() {
      try {
        const response = await fetch('/api/health', {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])});
        const data = response.ok ? await response.json() : null;
        if (active) setBackendReady(response.ok && data?.status === 'ready');
      } catch { if (active) setBackendReady(false); }
    }
    checkBackend();
    const timer = setInterval(checkBackend, 10000);
    return () => {active = false; clearInterval(timer); controller.abort();};
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    api('/sources/policy', undefined, controller.signal)
      .then(policy => setAllowedHosts(policy.allowedHosts))
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let checking = false;
    async function checkSources() {
      if (checking) return;
      checking = true;
      try {
        const data = await api('/sources', undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
        if (controller.signal.aborted) return;
        setIndexedChunks(data.indexedChunks);
        setSourceJobs(data.jobs);
        setJob(previous => previous ? (data.jobs.find(j => j.id === previous.id) || previous) : (data.jobs[0] || null));
      } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
      finally { checking = false; }
    }
    checkSources();
    const timer = setInterval(checkSources, 5000);
    return () => {clearInterval(timer); controller.abort();};
  }, [token]);

  async function authenticate(event) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {setToken((await api(`/auth/${mode}`, {email: form.get('email'), password: form.get('password')})).token);}
    catch (e) {setError(e.message);}
    finally {setBusy(false);}
  }
  async function send(event) {
    event.preventDefault(); setError('');
    const form = event.currentTarget;
    const message = new FormData(form).get('message').trim();
    if (!message || busy || !indexedChunks) return;
    const current = generation.current;
    setMessages(prev => [...prev, {role: 'user', text: message}]);
    setQuestion(''); setBusy(true);
    try {
      const result = await api('/chat', {message}, AbortSignal.timeout(60000));
      if (current === generation.current) setMessages(prev => [...prev, {role: 'assistant', text: result.answer, sources: result.sources}]);
    } catch (e) {setError(e.message);}
    finally {if (current === generation.current) setBusy(false);}
  }
  async function indexWebsite(url) {
    setError(''); setAdding(true);
    try {setJob({url, ...await api('/jobs', {url})});}
    catch (e) {setError(e.message);}
    finally {setAdding(false);}
  }
  async function addWebsite(event) {
    event.preventDefault();
    await indexWebsite(new FormData(event.currentTarget).get('url'));
  }
  const ready = indexedChunks > 0;
  const failed = job?.status === 'failed';
  const processing = adding || (job && ['queued', 'running'].includes(job.status));
  const suggestions = ['Give me a quick summary of my sources.', 'What topics appear in these sources?', 'List the key names mentioned on these pages.'];
  const hostOf = url => { try { return new URL(url).hostname; } catch { return 'Website'; } };
  const sourceEntries = job && !sourceJobs.some(j => j.id === job.id) ? [job, ...sourceJobs] : sourceJobs;
  const visibleSources = sourceEntries.filter((source, index, list) => list.findIndex(item => item.url === source.url) === index);
  return <div className={`shell ${token ? 'workspace' : 'welcome'}`}>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Sourcebook home"><span className="brand-mark"><Icon name="book"/></span><span>Sourcebook<small>YOUR AI RESEARCH SPACE</small></span></a>
      {token ? <>
        <button className="new-chat" disabled={busy} onClick={() => {setMessages([]); setQuestion(''); setError('');}}><Icon name="plus"/>New conversation</button>
        <div className="section-label">YOUR SOURCES<span>{visibleSources.length}</span></div>
        <form onSubmit={addWebsite} className="source-form">
          <label htmlFor="url">Add a website</label>
          <input id="url" name="url" type="url" placeholder={`https://${allowedHosts[0] || 'example.com'}`} aria-describedby="source-policy" required maxLength={2048}/>
          <button disabled={processing || !backendReady}><Icon name="plus"/>{adding ? 'Adding source...' : 'Add source'}</button>
          <details id="source-policy"><summary>Which websites can I add?</summary><p>Use HTTPS with one of these exact domains:</p><div className="host-tags">{allowedHosts.map(host => <span key={host}>{host}</span>)}</div><p>To approve another domain, add it to SCRAPE_ALLOWED_HOSTS in the local .env and recreate the API and worker containers. Subdomains need their own entry.</p></details>
        </form>
        <div className="source-list" aria-label="Your sources">
          {!sourceJobs.length && <p className="sidebar-hint">Your saved websites will appear here.</p>}
          {visibleSources.slice(0, 5).map(source => <div className="source-item" key={source.id}><span className="source-icon"><Icon name="link"/></span><div><strong>{hostOf(source.url)}</strong><span className={`source-status ${source.status}`}>{source.status === 'completed' ? 'Ready to use' : source.status === 'failed' ? 'Needs attention' : 'Indexing...'}</span></div>{source.status === 'completed' && <Icon name="check" className="source-check"/>}{source.status === 'failed' && <button className="retry-source" disabled={processing} onClick={() => indexWebsite(source.url)} aria-label={`Retry ${hostOf(source.url)}`}>Retry</button>}</div>)}
        </div>
        {job?.status === 'failed' && job.error && <p className="source-error" role="status">This source could not be read. Use Retry to try again.</p>}
      </> : <div className="sidebar-intro"><span className="section-label">A LITTLE LESS SEARCHING</span><h2>Your sources.<br/>One conversation.</h2><p>A private place to make sense of the websites that matter to you.</p><div className="sidebar-note"><Icon name="shield"/><span>Your sources stay in your account.</span></div></div>}
      <div className="sidebar-footer"><div className="workspace-avatar">S</div><div><strong>Personal workspace</strong><small>Private by default</small></div>{token && <button className="icon-button" onClick={logout} aria-label="Sign out" title="Sign out"><Icon name="logout"/></button>}</div>
    </aside>
    <main>
      <header className="topbar"><div className="breadcrumb">Workspace<span>/</span><strong>{token ? 'Research assistant' : 'Getting started'}</strong></div><div className={`connection ${backendReady ? 'online' : ''}`}><span/>{backendReady ? 'Connected' : backendReady === null ? 'Connecting' : 'Offline'}</div></header>
      {backendReady === false && <div className="error" role="status">Your workspace is offline. Start the services to continue.</div>}
      {error && <div className="error" role="alert">{error}<button className="dismiss" onClick={() => setError('')} aria-label="Dismiss error">Close</button></div>}
      {!token ? <div className="welcome-content">
        <section className="welcome-story"><div className="eyebrow"><span/>KNOWLEDGE, WITH CONTEXT</div><h1>Less searching.<br/>More understanding.</h1><p>Add a website. Ask a question. Get an answer grounded in your sources, with links to explore further.</p><div className="how-it-works">{[['01', 'Add your sources', 'Save a page from an approved website.'], ['02', 'Let us read it', 'We organise the page into searchable information.'], ['03', 'Start a conversation', 'Ask questions and follow the source links.']].map(([number, title, text]) => <div key={number}><span>{number}</span><section><h3>{title}</h3><p>{text}</p></section></div>)}</div><div className="scope-note"><Icon name="link"/>Each source reads the page you add, rather than the whole website.</div></section>
        <section className="auth"><div className="auth-icon"><Icon name="book"/></div><h2>{mode === 'login' ? 'Welcome back.' : 'Make room for ideas.'}</h2><p>{mode === 'login' ? 'Sign in to your research workspace.' : 'Create your private research workspace.'}</p><form onSubmit={authenticate}><label htmlFor="email">Email address</label><input id="email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required/><label htmlFor="password">Password</label><input id="password" name="password" type="password" placeholder="Enter your password" minLength={12} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required/><small>At least 12 characters.</small><button disabled={busy || !backendReady}>{busy ? 'Please wait...' : mode === 'login' ? 'Open my workspace' : 'Create workspace'}<Icon name="arrow"/></button></form><div className="auth-switch">{mode === 'login' ? 'New here?' : 'Already have an account?'}<button className="text-button" onClick={() => {setMode(mode === 'login' ? 'register' : 'login'); setError('');}}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div><div className="privacy-note"><Icon name="shield"/>Sources are only available to your account.</div></section>
      </div> : <>
        <div className="chat-heading"><div><div className="eyebrow">YOUR RESEARCH ASSISTANT</div><h1>Ask a little. Discover more.</h1></div><div className={`readiness ${ready ? 'ready' : ''}`} role="status"><span/>{ready ? 'Sources ready' : indexedChunks === null ? 'Checking sources' : processing ? 'Reading your website' : failed ? 'Source needs attention' : 'Add a source to begin'}</div></div>
        <section className="messages" aria-label="Conversation" aria-live="polite">
          {!messages.length && <div className="empty"><div className="empty-icon"><Icon name="chat"/></div><h2>{ready ? 'What would you like to know?' : failed ? "Let's give that source another try." : 'Good answers start with a source.'}</h2><p>{ready ? 'Explore your saved pages with a question. Every answer stays grounded in your sources.' : processing ? 'Your website is being read and indexed. We will enable chat as soon as it is ready.' : failed ? 'We could not finish reading your page. Use Retry in the source panel, or add a different website.' : 'Add a website in the source panel. Once it is ready, you can ask about its contents.'}</p><div className="prompt-grid">{suggestions.map((prompt, i) => <button key={prompt} disabled={!ready || busy} onClick={() => setQuestion(prompt)}><span>0{i + 1}</span><strong>{['Get the big picture', 'Find the main topics', 'Explore key details'][i]}</strong><p>{prompt}</p><Icon name="arrow"/></button>)}</div><p className="empty-note">A useful place to start: a company, project, or reference page.</p></div>}
          {messages.map((m, i) => <article key={i} className={`message ${m.role}`}><div className="message-avatar">{m.role === 'user' ? 'Y' : <Icon name="book"/>}</div><div className="message-body"><strong>{m.role === 'user' ? 'You' : 'Sourcebook'}{m.role === 'assistant' && <span className="answer-label">FROM YOUR SOURCES</span>}</strong><p>{m.text}</p>{m.sources?.length > 0 && <div className="sources"><span>Explore the sources</span>{m.sources.filter(s => /^https:\/\//.test(s)).map(s => <a key={s} href={s} target="_blank" rel="noreferrer"><Icon name="link"/>{hostOf(s)}<Icon name="arrow"/></a>)}</div>}</div></article>)}
          {busy && <div className="thinking" role="status"><span className="pulse"/>Reading your sources and putting an answer together...</div>}
          <div ref={conversationEnd}/>
        </section>
        <div className="composer-wrap"><form className="composer" onSubmit={send}><label className="sr-only" htmlFor="message">Your question</label><textarea id="message" name="message" rows={2} value={question} onChange={e => setQuestion(e.target.value)} placeholder={ready ? 'Ask a question about your sources...' : 'Your conversation starts when a source is ready.'} disabled={!ready} required maxLength={4000}/><div className="composer-bottom"><span><Icon name="shield"/>Only your indexed pages are used</span><button disabled={busy || !ready || !question.trim()} aria-label="Send question">Ask Sourcebook<Icon name="arrow"/></button></div></form><p className="composer-note">AI answers can miss details. Check the linked sources when accuracy matters.</p></div>
      </>}
    </main>
  </div>;
}
