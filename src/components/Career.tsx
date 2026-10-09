import { useState } from 'react';
import type { FormEvent } from 'react';
import { commitStreak, commitsOn, goalForecast, heatmap, level, milestoneProgress, newId, totalCommits, weekStats } from '../career';
import { GitHubError, SYNC_DAYS, fetchCommits, mergeCommits } from '../github';
import { useStore } from '../store';
import type { CareerData, Project, ProjectStatus } from '../types';
import { addDays, fmtLong, fmtShort, todayKey, weekdayName } from '../utils';

const weeks = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;

const STATUSES: { key: ProjectStatus; label: string }[] = [
  { key: 'idea', label: 'Idea' },
  { key: 'building', label: 'Building' },
  { key: 'shipped', label: 'Shipped' },
];

export function Career() {
  const { data, dispatch } = useStore();
  const c = data.career;
  const today = todayKey();
  const fc = goalForecast(c, today);
  const week = weekStats(c, today);
  const streak = commitStreak(c, today);
  const map = heatmap(c, today, 12);
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; text: string }>({ kind: 'idle', text: '' });
  const [name, setName] = useState('');
  const [concept, setConcept] = useState('');
  const [course, setCourse] = useState('');
  const [note, setNote] = useState('');

  const set = (patch: Partial<CareerData>) => dispatch({ t: 'career-set', patch });
  const setProjects = (projects: Project[]) => set({ projects });
  const patchProject = (id: string, patch: Partial<Project>) => setProjects(c.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const sync = async () => {
    setStatus({ kind: 'busy', text: 'Syncing with GitHub…' });
    try {
      const r = await fetchCommits(c.githubUser);
      set({ commits: mergeCommits(c.commits, r), lastSync: today });
      const repos = r.repos.length ? ` across ${r.repos.length} ${r.repos.length === 1 ? 'repo' : 'repos'}` : '';
      setStatus({
        kind: 'ok',
        text: r.total === 0 ? `No public commits found in the last ${SYNC_DAYS} days.` : `Found ${r.total} commits${repos}.${r.truncated ? ' GitHub limits results, so the oldest days may be missing.' : ''}`,
      });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof GitHubError ? e.message : 'Something went wrong while syncing. Try again.' });
    }
  };

  const addProject = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setProjects([...c.projects, { id: newId(), name: name.trim(), repo: '', concept: concept.trim(), status: 'idea', milestones: [] }]);
    setName('');
    setConcept('');
  };

  const addLearning = (e: FormEvent) => {
    e.preventDefault();
    if (!course.trim()) return;
    set({ learning: [{ id: newId(), date: today, course: course.trim(), note: note.trim() }, ...c.learning] });
    setCourse('');
    setNote('');
  };

  const recentDays = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const weeksLeft = Math.round(fc.weeksLeft);
  const emptySlots = Math.max(0, c.goalCount - c.projects.length);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Career</h1>
        <p className="sub">
          Goal: {c.goalCount} solid portfolio projects that put your course concepts to work, by {fmtLong(c.deadline)}, {c.deadline.slice(0, 4)}.
        </p>
      </header>

      <section className="panel goal">
        <div className="goal-count" aria-label={`${fc.shipped} of ${c.goalCount} projects shipped`}>
          <b>{fc.shipped}</b>
          <span>of {c.goalCount} shipped</span>
        </div>
        <div className="goal-slots" aria-hidden="true">
          {Array.from({ length: c.goalCount }).map((_, i) => (
            <i key={i} className={i < fc.shipped ? 'on' : ''} />
          ))}
        </div>
        <p className="note">
          {fc.remaining === 0
            ? 'Goal reached. Everything from here is a bonus.'
            : `${weeks(weeksLeft)} left. To finish on time, ship one about every ${weeks(Math.max(1, Math.round(fc.neededWeeksEach)))}.${
                fc.actualWeeksEach != null ? ` So far you’ve been shipping one every ${weeks(Math.max(1, Math.round(fc.actualWeeksEach)))}, which is ${fc.onTrack ? 'on pace' : 'behind pace'}.` : ' Ship your first one to see how your pace compares.'
              }`}
        </p>
      </section>

      <div className="cols">
        <section className="panel">
          <h2>GitHub activity</h2>
          <form
            className="load-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (c.githubUser.trim()) void sync();
            }}
          >
            <label className="load">
              <span>GitHub username</span>
              <input value={c.githubUser} placeholder="e.g. octocat" autoComplete="off" onChange={(e) => set({ githubUser: e.target.value })} />
            </label>
            <button className="btn primary" type="submit" disabled={!c.githubUser.trim() || status.kind === 'busy'}>
              {status.kind === 'busy' ? 'Syncing…' : 'Sync now'}
            </button>
          </form>
          <p className={status.kind === 'error' ? 'err' : status.kind === 'ok' ? 'ok' : 'note'} role="status">
            {status.text || (c.lastSync ? `Last synced ${fmtShort(c.lastSync)}. Only public commits show up.` : 'Counts public commits on default branches from the last 90 days. Private repositories and other branches stay invisible, so mark those days by hand on Today.')}
          </p>

          <dl className="stats compact">
            <div>
              <dt>Commit streak</dt>
              <dd>
                {streak}
                <small>{streak === 1 ? 'day' : 'days'}</small>
              </dd>
            </div>
            <div>
              <dt>This week</dt>
              <dd>
                {week.commits}
                <small>{week.commits === 1 ? 'commit' : 'commits'}</small>
              </dd>
            </div>
            <div>
              <dt>Last 30 days</dt>
              <dd>
                {totalCommits(c, today, 30)}
                <small>commits</small>
              </dd>
            </div>
          </dl>

          <div className="heat-wrap">
            <div className="heat-days" aria-hidden="true">
              <span>Mon</span>
              <span />
              <span>Wed</span>
              <span />
              <span>Fri</span>
              <span />
              <span />
            </div>
            <div className="heat" role="img" aria-label={`Commits per day over the last 12 weeks. ${totalCommits(c, today, 84)} commits in total.`}>
              {map.cells.map((cell) => (
                <i key={cell.date} className={`l${level(cell.n)}${cell.future ? ' future' : ''}`} title={`${fmtShort(cell.date)}: ${cell.n} ${cell.n === 1 ? 'commit' : 'commits'}`} />
              ))}
            </div>
          </div>
          <div className="heat-legend" aria-hidden="true">
            Fewer
            {[0, 1, 2, 3, 4].map((l) => (
              <i key={l} className={`l${l}`} />
            ))}
            More
          </div>

          <details className="table-view">
            <summary>Show the last 7 days as a list</summary>
            <ul>
              {recentDays.map((d) => (
                <li key={d}>
                  <span>{d === today ? 'Today' : weekdayName(d)}</span>
                  <b>{commitsOn(c, d)}</b>
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section className="panel">
          <h2>Learning log</h2>
          <form className="form" onSubmit={addLearning}>
            <label className="field">
              <span>Course or topic</span>
              <input value={course} placeholder="e.g. Data Structures" onChange={(e) => setCourse(e.target.value)} />
            </label>
            <label className="field">
              <span>What you finished (optional)</span>
              <input value={note} placeholder="e.g. Week 3 on graphs" onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="finish">
              <button className="btn primary" type="submit" disabled={!course.trim()}>
                Add to log
              </button>
            </div>
          </form>
          {c.learning.length === 0 ? (
            <p className="empty">Nothing logged yet. Add each module you finish and it shows up here.</p>
          ) : (
            <ul className="txns">
              {c.learning.slice(0, 8).map((l) => (
                <li key={l.id} className="txn learning">
                  <span className="txn-date">{fmtShort(l.date)}</span>
                  <span className="txn-main">
                    <b>{l.course}</b>
                    {l.note && <span>{l.note}</span>}
                  </span>
                  <span />
                  <button className="btn ghost" aria-label={`Remove ${l.course} entry`} onClick={() => set({ learning: c.learning.filter((x) => x.id !== l.id) })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Projects</h2>
        <form className="two add-project" onSubmit={addProject}>
          <label className="field">
            <span>Project name</span>
            <input value={name} placeholder="e.g. Study planner" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Concept it puts to work</span>
            <input value={concept} placeholder="e.g. REST APIs" onChange={(e) => setConcept(e.target.value)} />
          </label>
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            Add project
          </button>
        </form>

        <ul className="projects">
          {c.projects.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              onChange={(patch) => patchProject(p.id, patch)}
              onRemove={() => {
                if (window.confirm(`Remove “${p.name}” and its milestones?`)) setProjects(c.projects.filter((x) => x.id !== p.id));
              }}
              today={today}
            />
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <li key={`slot${i}`} className="project slot">
              Project {c.projects.length + i + 1} of {c.goalCount}: add it above when you’re ready to plan it.
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ProjectCard({ p, onChange, onRemove, today }: { p: Project; onChange: (patch: Partial<Project>) => void; onRemove: () => void; today: string }) {
  const [text, setText] = useState('');
  const prog = milestoneProgress(p);
  const pct = prog.total ? (prog.done / prog.total) * 100 : p.status === 'shipped' ? 100 : 0;

  return (
    <li className={`project panel ${p.status}`}>
      <div className="ex-head">
        <h3>{p.name}</h3>
        <div className="segment small" role="radiogroup" aria-label={`Status of ${p.name}`}>
          {STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={p.status === s.key}
              onClick={() => onChange({ status: s.key, shippedOn: s.key === 'shipped' ? p.shippedOn ?? today : undefined })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="note">
        {p.concept ? `Uses: ${p.concept}.` : 'Add the course concept this project uses.'}
        {p.shippedOn ? ` Shipped ${fmtShort(p.shippedOn)}.` : ''}
      </p>

      <label className="field repo">
        <span>Repository (owner/name)</span>
        <input value={p.repo} placeholder="e.g. octocat/study-planner" onChange={(e) => onChange({ repo: e.target.value })} />
      </label>
      {p.repo.includes('/') && (
        <a className="link-btn" href={`https://github.com/${p.repo.trim()}`} target="_blank" rel="noreferrer">
          Open on GitHub
        </a>
      )}

      <div className="meter">
        <div className="meter-top">
          <span>Milestones</span>
          <b>
            {prog.done} of {prog.total}
          </b>
        </div>
        <div className="meter-bar" role="progressbar" aria-label={`${p.name} milestones`} aria-valuenow={prog.done} aria-valuemin={0} aria-valuemax={prog.total}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ul className="milestones">
        {p.milestones.map((m) => (
          <li key={m.id}>
            <label>
              <input type="checkbox" checked={m.done} onChange={() => onChange({ milestones: p.milestones.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)) })} />
              <span className={m.done ? 'done' : ''}>{m.text}</span>
            </label>
            <button className="btn ghost" aria-label={`Remove milestone ${m.text}`} onClick={() => onChange({ milestones: p.milestones.filter((x) => x.id !== m.id) })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="load-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onChange({ milestones: [...p.milestones, { id: newId(), text: text.trim(), done: false }] });
          setText('');
        }}
      >
        <label className="load">
          <span>Add a milestone</span>
          <input value={text} placeholder="e.g. Deploy it" onChange={(e) => setText(e.target.value)} />
        </label>
        <button className="btn" type="submit" disabled={!text.trim()}>
          Add
        </button>
        <button className="btn ghost" type="button" onClick={onRemove}>
          Remove project
        </button>
      </form>
    </li>
  );
}
