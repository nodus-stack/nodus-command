import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { execa } from 'execa';
import { ToolError, firstLine } from './projects.js';

/**
 * Git sobre los repos montados en el proyecto (temas y plugins que se
 * desarrollan en local). Usa las credenciales de Git del usuario.
 */

const BRANCH_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/;

export function isValidBranch(name) {
  return typeof name === 'string' && BRANCH_RE.test(name) && !name.includes('..') && !name.endsWith('/') && !name.endsWith('.lock') && !name.includes('//');
}

// El .git montado es escribible desde el contenedor: nunca ejecutar hooks,
// fsmonitor ni transportes "ext" que el sitio pudiera haber configurado.
const SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never'];

// Claves de .git/config (local) que ejecutan programas: si el sitio las añadió, no se toca el repo.
const DANGEROUS_KEY = /^(core\.(sshcommand|fsmonitor|hookspath|pager|editor|askpass|gitproxy)|filter\.|diff\.[^.]+\.(textconv|command)|merge\.[^.]+\.driver|credential\.|gpg\.|url\.|remote\.[^.]+\.(uploadpack|receivepack|vcs)|uploadpack\.|alias\.|include\.|includeif\.|sequence\.editor)/i;

async function assertSafeConfig(repoPath) {
  const r = await execa('git', ['config', '--local', '--name-only', '--list'], { cwd: repoPath, reject: false, timeout: 15000 });
  const bad = String(r.stdout || '').split('\n').filter((k) => DANGEROUS_KEY.test(k.trim()));
  if (bad.length) {
    throw new ToolError(`Refusing to run git: ${repoPath}/.git/config sets ${bad.join(', ')} (could run programs on this machine). Remove them with "git config --local --unset <key>" if they are yours.`);
  }
}

async function git(cwd, args, { reject = true, timeout = 120000 } = {}) {
  const result = await execa('git', [...SAFE, ...args], { cwd, reject: false, all: true, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (reject && result.exitCode !== 0) {
    throw new ToolError(`git ${args[0]} failed: ${scrub(String(result.all || '').trim().split('\n').slice(-5).join('\n'))}`);
  }
  return result;
}

const out = async (cwd, args) => String((await git(cwd, args)).stdout || '').trim();

function remoteSlug(url) {
  const m = String(url || '').match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function cleanUrl(url) {
  return String(url || '').replace(/(https?:\/\/)[^@/]+@/, '$1');
}

/** Quita credenciales de URLs y tokens conocidos de la salida de git/gh. */
function scrub(text) {
  return String(text || '')
    .replace(/(https?:\/\/)[^@/\s]+@/g, '$1')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '***');
}

/**
 * Repos Git del proyecto: los montajes (config.mounts "host:contenedor[:opts]")
 * de temas/plugins con su propio .git, y wp-content/ si es un repo.
 */
export async function projectRepos(root, config) {
  const repos = [];
  for (const entry of Array.isArray(config.mounts) ? config.mounts : []) {
    const [hostRaw, container] = String(entry).split(':');
    if (!hostRaw || !container) continue;
    const host = path.resolve(root, hostRaw.replace(/^~(?=$|\/)/, os.homedir()));
    if (!(await fs.pathExists(path.join(host, '.git')))) continue;
    const m = container.match(/wp-content\/(themes|plugins)\/([^/]+)\/?$/);
    repos.push({ name: m ? m[2] : path.basename(host), type: m ? m[1].slice(0, -1) : 'other', path: host, container_path: container });
  }
  const wpContent = path.join(root, 'wp-content');
  if (await fs.pathExists(path.join(wpContent, '.git'))) {
    repos.push({ name: 'wp-content', type: 'wp-content', path: wpContent, container_path: '/var/www/html/wp-content' });
  }
  return repos;
}

export async function resolveRepo(root, config, ref) {
  const repos = await projectRepos(root, config);
  if (!repos.length) {
    throw new ToolError('This project has no Git repos mounted. Mount your theme clone with "noduscm init --mount <host-path>:/var/www/html/wp-content/themes/<name>" (mounts in .noduscm.json).');
  }
  if (!ref) {
    if (repos.length === 1) return repos[0];
    throw new ToolError(`Pass repo: ${repos.map((r) => r.name).join(', ')}.`);
  }
  const found = repos.find((r) => r.name === ref || r.path === ref);
  if (!found) throw new ToolError(`Repo "${ref}" not found. Repos: ${repos.map((r) => r.name).join(', ')}.`);
  return found;
}

export async function repoStatus(repoPath, { fetch = false } = {}) {
  await assertSafeConfig(repoPath);
  const branch = await out(repoPath, ['branch', '--show-current']);
  const remote = (await git(repoPath, ['remote', 'get-url', 'origin'], { reject: false })).stdout?.trim() || '';
  let fetchError = null;
  if (fetch) {
    const r = await git(repoPath, ['fetch', 'origin', '--prune', '--quiet'], { reject: false, timeout: 60000 });
    if (r.exitCode !== 0) fetchError = scrub(firstLine(r.all));
  }
  const porcelain = (await git(repoPath, ['status', '--porcelain=v1'])).stdout || '';
  const changes = porcelain
    .split('\n')
    .filter((l) => l.length > 3)
    .slice(0, 300)
    .map((l) => ({ status: l.slice(0, 2).trim(), file: l.slice(3) }));
  const counts = await git(repoPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { reject: false });
  const [ahead, behind] = counts.exitCode === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [null, null];
  const last = (await git(repoPath, ['log', '-1', '--format=%h%x09%s%x09%cI'], { reject: false })).stdout || '';
  const [sha, subject, date] = last.split('\t');
  return {
    path: repoPath,
    branch: branch || null,
    remote: cleanUrl(remote),
    github: remoteSlug(remote),
    has_upstream: counts.exitCode === 0,
    ahead,
    behind,
    changes,
    changes_count: porcelain.split('\n').filter(Boolean).length,
    last_commit: sha ? { sha, message: subject, date } : null,
    fetched: fetch && !fetchError,
    fetch_error: fetchError,
  };
}

function validatePaths(repoPath, paths) {
  return paths.map((p) => {
    const rel = path.normalize(String(p)).replace(/^\/+/, '');
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel) || rel.startsWith('-')) {
      throw new ToolError(`Invalid path: ${p} (relative to the repo, no "..").`);
    }
    if (!path.resolve(repoPath, rel).startsWith(path.resolve(repoPath) + path.sep)) throw new ToolError(`Path outside the repo: ${p}`);
    return rel;
  });
}

async function commitChanges(repoPath, message, paths) {
  if (paths?.length) await git(repoPath, ['add', '-A', '--', ...validatePaths(repoPath, paths)]);
  else await git(repoPath, ['add', '-A']);
  const staged = await git(repoPath, ['diff', '--cached', '--quiet'], { reject: false });
  if (staged.exitCode === 0) return null; // nada que commitear
  await git(repoPath, ['commit', '-m', message]);
  return out(repoPath, ['rev-parse', '--short', 'HEAD']);
}

async function hasGh() {
  const r = await execa('gh', ['auth', 'status'], { reject: false, timeout: 15000 });
  return r.exitCode === 0;
}

/**
 * Publica los cambios del repo en la rama conectada en producción.
 *   direct: commit + integración en target_branch (rebase o merge en un
 *           worktree temporal, sin tocar los archivos del sitio local) + push.
 *   pr:     commit en una rama de trabajo + push + PR hacia target_branch
 *           (con gh si está instalado; si no, devuelve la URL para abrirlo).
 */
export async function publish(repoPath, { message, targetBranch, mode = 'direct', paths, branch, mergePr = false, slug = 'site' }) {
  if (!isValidBranch(targetBranch)) throw new ToolError('target_branch is not a valid branch name.');
  if (branch && !isValidBranch(branch)) throw new ToolError('branch is not a valid branch name.');
  await assertSafeConfig(repoPath);
  const current = await out(repoPath, ['branch', '--show-current']);
  if (!current) throw new ToolError('The repo is in detached HEAD: check out a branch first.');
  const remote = (await git(repoPath, ['remote', 'get-url', 'origin'], { reject: false })).stdout?.trim();
  if (!remote) throw new ToolError('The repo has no "origin" remote.');

  await git(repoPath, ['fetch', 'origin', '--quiet'], { timeout: 120000 });
  const targetExists = (await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${targetBranch}`], { reject: false })).exitCode === 0;
  if (!targetExists) throw new ToolError(`origin/${targetBranch} does not exist. Check the branch connected in production (jet.repos_list).`);

  const result = { repo: remoteSlug(remote), target_branch: targetBranch, mode };

  if (mode === 'pr') {
    let work = current;
    if (current === targetBranch) {
      work = branch || `nodus/${slug}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
      await git(repoPath, ['checkout', '-b', work]);
    }
    const sha = await commitChanges(repoPath, message, paths);
    await git(repoPath, ['push', '-u', 'origin', work], { timeout: 180000 });
    Object.assign(result, { branch: work, commit: sha || (await out(repoPath, ['rev-parse', '--short', 'HEAD'])) });

    if (await hasGh()) {
      const existing = await execa('gh', ['pr', 'view', work, '--json', 'url', '-q', '.url'], { cwd: repoPath, reject: false, timeout: 30000 });
      let url = existing.exitCode === 0 ? existing.stdout.trim() : '';
      if (!url) {
        const created = await execa('gh', ['pr', 'create', '--base', targetBranch, '--head', work, '--title', message, '--body', 'Cambios generados con Nodus Designer desde el entorno local (noduscm).'], {
          cwd: repoPath,
          reject: false,
          all: true,
          timeout: 60000,
        });
        if (created.exitCode !== 0) throw new ToolError(`gh pr create failed: ${scrub(firstLine(created.all))}`);
        url = created.stdout.trim().split('\n').pop();
      }
      result.pr_url = url;
      if (mergePr) {
        const merged = await execa('gh', ['pr', 'merge', url, '--merge'], { cwd: repoPath, reject: false, all: true, timeout: 120000 });
        if (merged.exitCode !== 0) throw new ToolError(`PR created (${url}) but merge failed: ${scrub(firstLine(merged.all))}`);
        result.merged = true;
      }
    } else if (result.repo) {
      result.pr_url = `https://github.com/${result.repo}/compare/${encodeURIComponent(targetBranch)}...${encodeURIComponent(work)}?expand=1`;
      result.note = 'GitHub CLI (gh) is not installed or not logged in: open pr_url to create the PR.';
    }
    return result;
  }

  // direct
  const sha = await commitChanges(repoPath, message, paths);
  if (current === targetBranch) {
    const rebase = await git(repoPath, ['pull', '--rebase', 'origin', targetBranch], { reject: false, timeout: 180000 });
    if (rebase.exitCode !== 0) {
      await git(repoPath, ['rebase', '--abort'], { reject: false });
      throw new ToolError(`Could not rebase on origin/${targetBranch} (conflicts?). Your commit is kept locally; resolve it or use mode "pr".\n${scrub(firstLine(rebase.all))}`);
    }
    await git(repoPath, ['push', 'origin', `HEAD:refs/heads/${targetBranch}`], { timeout: 180000 });
    return Object.assign(result, { branch: current, commit: await out(repoPath, ['rev-parse', '--short', 'HEAD']), pushed: true, committed: Boolean(sha) });
  }

  // Rama de trabajo distinta: se sube y se integra en target en un worktree temporal.
  await git(repoPath, ['push', '-u', 'origin', current], { timeout: 180000 });
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'noduscm-merge-'));
  try {
    await git(repoPath, ['worktree', 'add', '--detach', tmp, `origin/${targetBranch}`]);
    const merged = await git(tmp, ['merge', '--no-ff', '-m', `Merge ${current} into ${targetBranch}: ${message}`, current], { reject: false, timeout: 120000 });
    if (merged.exitCode !== 0) {
      await git(tmp, ['merge', '--abort'], { reject: false });
      throw new ToolError(`${current} conflicts with ${targetBranch}. It was pushed as ${current}; resolve the conflict or use mode "pr".`);
    }
    await git(tmp, ['push', 'origin', `HEAD:refs/heads/${targetBranch}`], { timeout: 180000 });
    return Object.assign(result, { branch: current, commit: await out(tmp, ['rev-parse', '--short', 'HEAD']), pushed: true, merged_into_target: true, committed: Boolean(sha) });
  } finally {
    await git(repoPath, ['worktree', 'remove', '--force', tmp], { reject: false });
    await fs.remove(tmp).catch(() => {});
  }
}
