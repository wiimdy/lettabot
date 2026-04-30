import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataDir } from '../utils/paths.js';

const PROJECT_STORE_VERSION = 1;

export type CardStatus = 'todo' | 'doing' | 'done';

export interface Project {
  id: string;
  name: string;
  context: string;
  github_repo: string | null;
  created_at: string;
}

export interface Card {
  id: string;
  project_id: string;
  title: string;
  status: CardStatus;
  github_url: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface LogEntry {
  id: string;
  project_id: string;
  content: string;
  created_at: string;
}

interface StoreFile {
  version: number;
  projects: Project[];
  cards: Card[];
  logs: LogEntry[];
}

export function getProjectStorePath(): string {
  return resolve(getDataDir(), 'projects', 'store.json');
}

function emptyStore(): StoreFile {
  return { version: PROJECT_STORE_VERSION, projects: [], cards: [], logs: [] };
}

function loadStore(path: string): StoreFile {
  if (!existsSync(path)) return emptyStore();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoreFile>;
    return {
      version: PROJECT_STORE_VERSION,
      projects: Array.isArray(raw.projects) ? raw.projects : [],
      cards: Array.isArray(raw.cards) ? raw.cards : [],
      logs: Array.isArray(raw.logs) ? raw.logs : [],
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(path: string, store: StoreFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

function findOne<T extends { id: string }>(items: T[], idOrPrefix: string, kind: string): T {
  const needle = idOrPrefix.trim();
  if (!needle) throw new Error(`${kind} id is required`);
  const exact = items.find((i) => i.id === needle);
  if (exact) return exact;
  const matches = items.filter((i) => i.id.startsWith(needle));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`${kind} id prefix "${needle}" is ambiguous: ${matches.map((m) => m.id).join(', ')}`);
  }
  throw new Error(`${kind} not found: ${needle}`);
}

function resolveProject(store: StoreFile, nameOrId: string): Project {
  const needle = nameOrId.trim();
  if (!needle) throw new Error('project name/id is required');
  const byName = store.projects.find((p) => p.name === needle);
  if (byName) return byName;
  return findOne(store.projects, needle, 'project');
}

export function addProject(input: { name: string; context: string; github_repo?: string | null }): Project {
  const path = getProjectStorePath();
  const store = loadStore(path);
  const name = input.name.trim();
  if (!name) throw new Error('project name is required');
  if (store.projects.some((p) => p.name === name)) {
    throw new Error(`project already exists: ${name}`);
  }
  const project: Project = {
    id: `proj-${randomUUID()}`,
    name,
    context: input.context.trim() || 'general',
    github_repo: input.github_repo?.trim() || null,
    created_at: new Date().toISOString(),
  };
  store.projects.push(project);
  saveStore(path, store);
  return project;
}

export function listProjects(filter?: { context?: string }): Project[] {
  const store = loadStore(getProjectStorePath());
  const ctx = filter?.context?.trim();
  return ctx ? store.projects.filter((p) => p.context === ctx) : store.projects;
}

export function addCard(input: { project: string; title: string; status?: CardStatus; github_url?: string | null }): Card {
  const path = getProjectStorePath();
  const store = loadStore(path);
  const project = resolveProject(store, input.project);
  const title = input.title.trim();
  if (!title) throw new Error('card title is required');
  const card: Card = {
    id: `card-${randomUUID()}`,
    project_id: project.id,
    title,
    status: input.status || 'todo',
    github_url: input.github_url?.trim() || null,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  store.cards.push(card);
  saveStore(path, store);
  return card;
}

export function moveCard(input: { card: string; status: CardStatus }): Card {
  const path = getProjectStorePath();
  const store = loadStore(path);
  const card = findOne(store.cards, input.card, 'card');
  card.status = input.status;
  card.completed_at = input.status === 'done' ? new Date().toISOString() : null;
  saveStore(path, store);
  return card;
}

export function listCards(input: { project?: string; status?: CardStatus }): Card[] {
  const store = loadStore(getProjectStorePath());
  let cards = store.cards;
  if (input.project) {
    const project = resolveProject(store, input.project);
    cards = cards.filter((c) => c.project_id === project.id);
  }
  if (input.status) {
    cards = cards.filter((c) => c.status === input.status);
  }
  return cards;
}

export function removeCard(idOrPrefix: string): Card {
  const path = getProjectStorePath();
  const store = loadStore(path);
  const card = findOne(store.cards, idOrPrefix, 'card');
  store.cards = store.cards.filter((c) => c.id !== card.id);
  saveStore(path, store);
  return card;
}

export function addLog(input: { project: string; content: string }): LogEntry {
  const path = getProjectStorePath();
  const store = loadStore(path);
  const project = resolveProject(store, input.project);
  const content = input.content.trim();
  if (!content) throw new Error('log content is required');
  const entry: LogEntry = {
    id: `log-${randomUUID()}`,
    project_id: project.id,
    content,
    created_at: new Date().toISOString(),
  };
  store.logs.push(entry);
  saveStore(path, store);
  return entry;
}

export function recentLogs(input: { project?: string; limit?: number }): LogEntry[] {
  const store = loadStore(getProjectStorePath());
  const limit = input.limit ?? 10;
  let logs = store.logs;
  if (input.project) {
    const project = resolveProject(store, input.project);
    logs = logs.filter((l) => l.project_id === project.id);
  }
  return [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

export interface DashboardProject {
  project: Project;
  doing: Card[];
  todo_count: number;
  done_recent: number;
  latest_log: LogEntry | null;
}

export function buildDashboard(filter?: { context?: string }): DashboardProject[] {
  const store = loadStore(getProjectStorePath());
  const ctx = filter?.context?.trim();
  const projects = ctx ? store.projects.filter((p) => p.context === ctx) : store.projects;
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  return projects.map((project) => {
    const cards = store.cards.filter((c) => c.project_id === project.id);
    const doing = cards.filter((c) => c.status === 'doing');
    const todo_count = cards.filter((c) => c.status === 'todo').length;
    const done_recent = cards.filter(
      (c) => c.status === 'done' && c.completed_at && c.completed_at >= oneWeekAgo,
    ).length;
    const projectLogs = store.logs.filter((l) => l.project_id === project.id);
    const latest_log = projectLogs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
    return { project, doing, todo_count, done_recent, latest_log };
  });
}
