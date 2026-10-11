import { useEffect, useMemo, useRef, useState } from 'react';
import { SHARE_LABEL, buildSummary, enabledAreas, summaryJson } from '../advisorData';
import { isDemo } from '../demo';
import { AiError, PROVIDERS, SUGGESTED_QUESTIONS, askAi, clearKey, isProviderId, keyAdvice, loadKey, looksLikeKey, maskKey, providerOf, saveKey, systemWith, weeklyReviewPrompt } from '../ai';
import type { ChatTurn } from '../ai';
import { dailyNudges, reviewToText, weeklyReview } from '../coach';
import { forecasts } from '../forecast';
import type { Tab, TrainView } from '../nav';
import { useStore } from '../store';
import type { ShareArea } from '../types';
import { addDays, fmtShort, mondayOf, todayKey } from '../utils';

const AREAS = Object.keys(SHARE_LABEL) as ShareArea[];

export function Advisor({ go }: { go: (t: Tab, v?: TrainView) => void }) {
  const { data, dispatch } = useStore();
  const today = todayKey();
  const monday = mondayOf(today);
  const [which, setWhich] = useState<'this' | 'last'>('this');
  const [keyTick, setKeyTick] = useState(0);
  const [draft, setDraft] = useState('');
  const [keyMsg, setKeyMsg] = useState('');
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'chat' | 'review' | null>(null);
  const [error, setError] = useState<{ where: 'chat' | 'review'; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const { settings } = data.advisor;
  const provider = providerOf(settings.provider);
  // Read again whenever the provider changes or a key is saved or removed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => (isDemo ? '' : loadKey(provider.id)), [provider.id, keyTick]);
  const nudges = useMemo(() => dailyNudges(data, today), [data, today]);
  const reviewMonday = which === 'this' ? monday : addDays(monday, -7);
  const review = useMemo(() => weeklyReview(data, reviewMonday, today), [data, reviewMonday, today]);
  const fc = useMemo(() => forecasts(data, today), [data, today]);
  const summary = useMemo(() => summaryJson(buildSummary(data, today, settings.share)), [data, today, settings.share]);
  const saved = data.advisor.reviews.find((r) => r.week === reviewMonday);
  const areas = enabledAreas(settings.share);
  const hasKey = key.length > 0;

  const fail = (where: 'chat' | 'review', e: unknown) => {
    if ((e as { name?: string })?.name === 'AbortError') return;
    setError({ where, text: e instanceof AiError ? e.message : 'Something went wrong. Try again.' });
  };

  const writeReview = async () => {
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy('review');
    setError(null);
    try {
      const text = await askAi({ provider: provider.id, apiKey: key, model: settings.model, system: systemWith(summary), messages: [{ role: 'user', content: weeklyReviewPrompt(reviewToText(review)) }], maxTokens: 800, signal: abort.current.signal });
      dispatch({ t: 'review-save', review: { week: reviewMonday, text, at: new Date().toISOString(), model: settings.model } });
    } catch (e) {
      fail('review', e);
    } finally {
      setBusy(null);
    }
  };

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    const turns: ChatTurn[] = [...chat, { role: 'user', content: text }];
    setChat(turns);
    setQuestion('');
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy('chat');
    setError(null);
    try {
      const reply = await askAi({ provider: provider.id, apiKey: key, model: settings.model, system: systemWith(summary), messages: turns.slice(-8), signal: abort.current.signal });
      setChat([...turns, { role: 'assistant', content: reply }]);
    } catch (e) {
      fail('chat', e);
    } finally {
      setBusy(null);
    }
  };

  const connect = () => {
    const k = draft.trim();
    if (!looksLikeKey(k, provider.id)) {
      setKeyMsg(keyAdvice(provider.id));
      return;
    }
    if (!saveKey(k, provider.id)) {
      setKeyMsg('This browser wouldn’t let the key be saved, so it can’t be kept on this device.');
      return;
    }
    setKeyTick((n) => n + 1);
    setDraft('');
    setKeyMsg('');
  };

  const toggle = (a: ShareArea) => dispatch({ t: 'advisor-set', settings: { ...settings, share: { ...settings.share, [a]: !settings.share[a] } } });

  return (
    <div className="page">
      <header className="page-head">
        <h1>Advisor</h1>
        <p className="sub">Nudges and your weekly review work on their own, without internet or an API key. Connect an AI provider (Claude, OpenAI, Gemini, or hundreds of other models through OpenRouter) to get written advice and ask questions.</p>
      </header>

      <div className="cols">
        <div className="stack">
          <section className="panel">
            <h2>Today</h2>
            {nudges.length === 0 ? (
              <p className="note first">Nothing needs attention. Keep going.</p>
            ) : (
              <ul className="nudges">
                {nudges.map((n) => (
                  <li key={n.id}>
                    <span>{n.text}</span>
                    {n.go && (
                      <button className="btn" onClick={() => go(n.go!, n.view)}>
                        Open
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-top">
              <h2>Weekly review</h2>
              <div className="segment small two" role="radiogroup" aria-label="Week">
                <button role="radio" aria-checked={which === 'this'} onClick={() => setWhich('this')}>
                  This week
                </button>
                <button role="radio" aria-checked={which === 'last'} onClick={() => setWhich('last')}>
                  Last week
                </button>
              </div>
            </div>
            <p className="note first">
              {review.label}
              
            </p>
            <dl className="stats compact">
              {review.stats.map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd className={s.value.length > 8 ? 'long' : undefined}>
                    {s.value}
                    {s.note && <small className="stat-note">{s.note}</small>}
                  </dd>
                </div>
              ))}
            </dl>
            {review.wins.length > 0 && (
              <>
                <h3>Wins</h3>
                <ul className="bullets">{review.wins.map((w) => <li key={w}>{w}</li>)}</ul>
              </>
            )}
            {review.open.length > 0 && (
              <>
                <h3>{review.complete ? 'Missed' : 'Still to do'}</h3>
                <ul className="bullets">{review.open.map((w) => <li key={w}>{w}</li>)}</ul>
              </>
            )}
            {review.focus.length > 0 && (
              <>
                <h3>{review.complete ? 'Focus for next week' : 'Focus'}</h3>
                <ul className="bullets">{review.focus.map((w) => <li key={w}>{w}</li>)}</ul>
              </>
            )}

            <div className="ai-block">
              <h3>The AI’s take</h3>
              {saved ? (
                <>
                  <p className="ai-text">{saved.text}</p>
                  <p className="note">Written {fmtShort(saved.at.slice(0, 10))}.</p>
                </>
              ) : (
                <p className="note first">{hasKey ? 'Not written yet for this week.' : 'Connect an AI provider below to add a written review.'}</p>
              )}
              <button className="btn primary" disabled={!hasKey || busy !== null || areas.length === 0} onClick={writeReview}>
                {busy === 'review' ? 'Writing…' : saved ? 'Write it again' : 'Write my review'}
              </button>
              {error?.where === 'review' && <p className="err" role="alert">{error.text}</p>}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <h2>Where you’re heading</h2>
            <ul className="forecasts">
              {fc.map((f) => (
                <li key={f.id} className={`tone-${f.tone}`}>
                  <b>{f.title}</b>
                  <span className="fc-head">{f.headline}</span>
                  <small>{f.detail}</small>
                </li>
              ))}
            </ul>
            <p className="note">Simple trend lines from your own logs. They get sharper as the history grows.</p>
          </section>

          <section className="panel">
            <h2>Ask the advisor</h2>
            {!hasKey ? (
              <p className="note first">Connect an AI provider below to ask questions about your numbers.</p>
            ) : (
              <>
                {chat.length === 0 && (
                  <div className="chips">
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <button key={q} className="chip-btn" disabled={busy !== null} onClick={() => ask(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
                <ol className="chat" aria-live="polite">
                  {chat.map((t, i) => (
                    <li key={i} className={t.role}>
                      {t.content}
                    </li>
                  ))}
                  {busy === 'chat' && <li className="assistant pending">Thinking…</li>}
                </ol>
                {error?.where === 'chat' && <p className="err" role="alert">{error.text}</p>}
                <form
                  className="ask"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask(question);
                  }}
                >
                  <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your week, weight or money" aria-label="Your question" maxLength={400} />
                  <button className="btn primary" disabled={busy !== null || !question.trim() || areas.length === 0}>
                    Ask
                  </button>
                </form>
                {chat.length > 0 && (
                  <button className="btn ghost" onClick={() => { setChat([]); setError(null); }}>
                    Clear conversation
                  </button>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <h2>AI setup and privacy</h2>
            <label className="field provider">
              <span>Provider</span>
              <select
                value={settings.provider}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!isProviderId(id)) return;
                  dispatch({ t: 'advisor-set', settings: { ...settings, provider: id, models: { ...settings.models, [settings.provider]: settings.model }, model: settings.models?.[id] ?? providerOf(id).defaultModel } });
                  setChat([]);
                  setDraft('');
                  setKeyMsg('');
                  setError(null);
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {isDemo ? (
              <p className="note first">AI answers need your own API key, so they’re switched off in the demo. The coach and weekly review above work without one.</p>
            ) : hasKey ? (
              <div className="keyrow">
                <span>
                  Connected, key ending <b>{maskKey(key)}</b>
                </span>
                <button className="btn" onClick={() => { clearKey(provider.id); setKeyTick((n) => n + 1); setChat([]); }}>
                  Remove key
                </button>
              </div>
            ) : (
              <form className="keyform" onSubmit={(e) => { e.preventDefault(); connect(); }}>
                <label className="field">
                  <span>{providerOf(settings.provider).name} API key</span>
                  <input type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={provider.keyPlaceholder} />
                </label>
                <button className="btn primary">Connect</button>
              </form>
            )}
            {keyMsg && <p className="err" role="alert">{keyMsg}</p>}

            <label className="field model">
              <span>Model</span>
              <input value={settings.model} onChange={(e) => dispatch({ t: 'advisor-set', settings: { ...settings, model: e.target.value } })} onBlur={() => { if (!settings.model.trim()) dispatch({ t: 'advisor-set', settings: { ...settings, model: provider.defaultModel } }); }} spellCheck={false} aria-describedby="model-hint" />
              <small id="model-hint" className="stat-note">{provider.modelHint}</small>
            </label>

            <h3>What the AI can see</h3>
            <ul className="shares">
              {AREAS.map((a) => (
                <li key={a}>
                  <label>
                    <input type="checkbox" checked={settings.share[a]} onChange={() => toggle(a)} />
                    <span>
                      <b>{SHARE_LABEL[a].title}</b>
                      <small>{SHARE_LABEL[a].blurb}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <details className="preview">
              <summary>Show exactly what gets sent</summary>
              <pre>{summary}</pre>
            </details>
            <p className="note">
              Only these numbers are sent, with each question. Notes, names, project titles and your GitHub username never leave this device.
            </p>
            <p className="note">
              The key stays in this browser, separate from your data, and isn’t in the exported file. The numbers go straight from this browser to {provider.name}, whose data terms apply. {provider.billing} Use a key with a low monthly spend limit. Anyone who can open this browser profile can use the key.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
