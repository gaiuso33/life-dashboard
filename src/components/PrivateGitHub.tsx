import { useState } from 'react';
import { GitHubError } from '../github';
import { MAX_REPOS, checkToken, clearToken, listRepos, loadChoices, loadToken, looksLikeToken, maskToken, saveChoices, saveToken } from '../githubPrivate';
import type { RepoChoice, RepoInfo } from '../githubPrivate';

/** Optional: a read-only GitHub token so private repositories and other branches count. Everything about it stays on this device. */
export function PrivateGitHub({ onChanged }: { onChanged: () => void }) {
  const [token, setToken] = useState(loadToken);
  const [typed, setTyped] = useState('');
  const [choices, setChoices] = useState<RepoChoice[]>(loadChoices);
  const [available, setAvailable] = useState<RepoInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'note'; text: string }>({ kind: 'note', text: '' });

  const fail = (e: unknown) => setMsg({ kind: 'error', text: e instanceof GitHubError ? e.message : 'Something went wrong. Try again.' });

  const saveNew = async () => {
    const t = typed.trim();
    if (!looksLikeToken(t)) {
      setMsg({ kind: 'error', text: 'That doesn’t look like a GitHub token. It starts with github_pat_ (fine-grained) or ghp_ (classic).' });
      return;
    }
    setBusy(true);
    try {
      const who = await checkToken(t);
      if (!saveToken(t)) {
        setMsg({ kind: 'error', text: 'This browser wouldn’t let the app keep the token, so it was not saved.' });
        return;
      }
      setToken(t);
      setTyped('');
      setMsg({
        kind: who.canWrite ? 'error' : 'ok',
        text: who.canWrite
          ? `Saved for ${who.login}, but this classic token can also change your code, not only read it. Replace it with a fine-grained token that has Contents: Read-only.`
          : `Saved. It belongs to ${who.login}.`,
      });
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    setBusy(true);
    setMsg({ kind: 'note', text: '' });
    try {
      const list = await listRepos(token);
      setAvailable(list);
      if (!list.length) setMsg({ kind: 'note', text: 'The token can’t see any repositories. Give it access to the ones you want counted.' });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const update = (next: RepoChoice[]) => {
    setChoices(next);
    saveChoices(next);
    onChanged();
  };
  const toggleRepo = (name: string, on: boolean) => {
    if (on && choices.length >= MAX_REPOS) {
      setMsg({ kind: 'note', text: `Up to ${MAX_REPOS} repositories. Untick one to add another.` });
      return;
    }
    update(on ? [...choices, { name, allBranches: false }] : choices.filter((c) => c.name !== name));
  };

  return (
    <details className="private-gh">
      <summary>Private repositories and other branches (optional)</summary>
      <p className="note first">
        Without this, only public commits on default branches count. With a token, the repositories you choose count too, private ones included, and so can every branch.
      </p>
      <ul className="note-list">
        <li>
          <b>What it can see.</b> Whatever you give it access to, nothing else. Make a <b>fine-grained</b> token at github.com/settings/personal-access-tokens, choose <b>Only select repositories</b>, and set <b>Contents: Read-only</b>. A read-only token cannot change anything.
        </li>
        <li>
          <b>Where it stays.</b> In this browser on this device only, like your AI keys. It is not in backups or downloads, the cloud copy, the advisor’s summary or the push server, and it is sent only to GitHub.
        </li>
        <li>
          <b>Revoking it.</b> “Remove” below forgets it here. To make it stop working everywhere, delete it at github.com/settings/personal-access-tokens (or Tokens (classic)).
        </li>
      </ul>

      {token ? (
        <div className="row-action">
          <span>
            Token <code>{maskToken(token)}</code> is saved on this device.
          </span>
          <button className="btn" type="button" disabled={busy} onClick={() => void choose()}>
            {busy ? 'Looking…' : choices.length ? 'Change repositories' : 'Choose repositories'}
          </button>
          <button
            className="btn ghost danger"
            type="button"
            onClick={() => {
              clearToken();
              setToken('');
              setChoices([]);
              setAvailable(null);
              setMsg({ kind: 'note', text: 'Removed from this device. Revoke it at GitHub too if you won’t use it again.' });
              onChanged();
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <form
          className="load-row"
          onSubmit={(e) => {
            e.preventDefault();
            void saveNew();
          }}
        >
          <label className="load">
            <span>GitHub token</span>
            <input type="password" value={typed} placeholder="github_pat_…" autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <button className="btn primary" type="submit" disabled={busy || !typed.trim()}>
            {busy ? 'Checking…' : 'Save token'}
          </button>
        </form>
      )}

      {token && choices.length > 0 && !available && (
        <p className="note">
          Counting: {choices.map((c) => `${c.name}${c.allBranches ? ' (all branches)' : ''}`).join(', ')}.
        </p>
      )}

      {available && (
        <fieldset className="repo-pick">
          <legend>Repositories to count (up to {MAX_REPOS})</legend>
          <ul className="rows">
            {available.map((r) => {
              const picked = choices.find((c) => c.name === r.name);
              return (
                <li key={r.name} className="row">
                  <label className="check">
                    <input type="checkbox" checked={!!picked} onChange={(e) => toggleRepo(r.name, e.target.checked)} />
                    <span>
                      {r.name} {r.private && <small className="muted-s">private</small>}
                    </span>
                  </label>
                  {picked && (
                    <label className="check">
                      <input type="checkbox" checked={picked.allBranches} onChange={(e) => update(choices.map((c) => (c.name === r.name ? { ...c, allBranches: e.target.checked } : c)))} />
                      <span>All branches</span>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          {available.length >= 100 && <p className="note">Showing the 100 most recently pushed repositories.</p>}
        </fieldset>
      )}

      {msg.text && (
        <p className={msg.kind === 'error' ? 'err' : msg.kind === 'ok' ? 'ok' : 'note'} role="status">
          {msg.text}
        </p>
      )}
    </details>
  );
}
