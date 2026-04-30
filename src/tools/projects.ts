import type { AnyAgentTool } from '@letta-ai/letta-code-sdk';
import { jsonResult, readStringParam } from '@letta-ai/letta-code-sdk';
import {
  addCard,
  addLog,
  addProject,
  buildDashboard,
  listCards,
  listProjects,
  moveCard,
  recentLogs,
  removeCard,
  type CardStatus,
} from '../projects/store.js';

const VALID_STATUS: readonly CardStatus[] = ['todo', 'doing', 'done'] as const;

function readStatus(params: Record<string, unknown>, key: string, required = false): CardStatus | undefined {
  const raw = readStringParam(params, key, { required });
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (!VALID_STATUS.includes(value as CardStatus)) {
    throw new Error(`Invalid status "${raw}". Use one of: ${VALID_STATUS.join(', ')}`);
  }
  return value as CardStatus;
}

function readOptional(params: Record<string, unknown>, key: string): string | null {
  const v = readStringParam(params, key);
  if (!v) return null;
  return v.trim() || null;
}

export function createManageProjectTool(): AnyAgentTool {
  return {
    label: 'Manage Projects',
    name: 'manage_project',
    description: [
      'Manage personal projects, kanban-style cards, and project logs across contexts (school/work/club/etc).',
      'Use add_project to create a new project, add_card to add a kanban card under a project, move_card to change status (todo/doing/done),',
      'add_log to record a progress note with timestamp, recent_logs to retrieve recent log entries, and dashboard to render a context-grouped overview of all projects.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'add_project',
            'list_projects',
            'add_card',
            'list_cards',
            'move_card',
            'remove_card',
            'add_log',
            'recent_logs',
            'dashboard',
          ],
          description: 'Action to perform.',
        },
        project: {
          type: 'string',
          description: 'Project name (or id prefix). Required for card/log actions.',
        },
        context: {
          type: 'string',
          description: 'Context label, e.g. "school", "work", "club". Required for add_project; optional filter elsewhere.',
        },
        github_repo: {
          type: 'string',
          description: 'Optional GitHub repo "owner/name" for add_project.',
        },
        title: {
          type: 'string',
          description: 'Card title for add_card.',
        },
        status: {
          type: 'string',
          enum: ['todo', 'doing', 'done'],
          description: 'Card status. Default todo for add_card; required for move_card; filter for list_cards.',
        },
        github_url: {
          type: 'string',
          description: 'Optional GitHub issue/PR URL attached to a card.',
        },
        card: {
          type: 'string',
          description: 'Card id (or unique prefix) for move_card / remove_card.',
        },
        content: {
          type: 'string',
          description: 'Log content for add_log.',
        },
        limit: {
          type: 'number',
          description: 'Max rows returned for list/recent_logs. Default 10.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_toolCallId: string, args: unknown) {
      const params = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {};
      const action = readStringParam(params, 'action', { required: true })?.toLowerCase();

      switch (action) {
        case 'add_project': {
          const name = readStringParam(params, 'project', { required: true });
          const context = readStringParam(params, 'context', { required: true });
          const github_repo = readOptional(params, 'github_repo');
          const project = addProject({ name, context, github_repo });
          return jsonResult({ ok: true, action, message: `Added project ${project.name} (${project.context})`, project });
        }

        case 'list_projects': {
          const context = readOptional(params, 'context') || undefined;
          const projects = listProjects({ context });
          return jsonResult({ ok: true, action, count: projects.length, projects });
        }

        case 'add_card': {
          const project = readStringParam(params, 'project', { required: true });
          const title = readStringParam(params, 'title', { required: true });
          const status = readStatus(params, 'status') || 'todo';
          const github_url = readOptional(params, 'github_url');
          const card = addCard({ project, title, status, github_url });
          return jsonResult({ ok: true, action, message: `Added card ${card.id} (${card.status}) under ${project}`, card });
        }

        case 'list_cards': {
          const project = readOptional(params, 'project') || undefined;
          const status = readStatus(params, 'status');
          const cards = listCards({ project, status });
          return jsonResult({ ok: true, action, count: cards.length, cards });
        }

        case 'move_card': {
          const cardId = readStringParam(params, 'card', { required: true });
          const status = readStatus(params, 'status', true)!;
          const card = moveCard({ card: cardId, status });
          return jsonResult({ ok: true, action, message: `Moved card ${card.id} to ${card.status}`, card });
        }

        case 'remove_card': {
          const cardId = readStringParam(params, 'card', { required: true });
          const card = removeCard(cardId);
          return jsonResult({ ok: true, action, message: `Removed card ${card.id}`, card });
        }

        case 'add_log': {
          const project = readStringParam(params, 'project', { required: true });
          const content = readStringParam(params, 'content', { required: true });
          const entry = addLog({ project, content });
          return jsonResult({ ok: true, action, message: `Logged entry ${entry.id} for ${project}`, entry });
        }

        case 'recent_logs': {
          const project = readOptional(params, 'project') || undefined;
          const limitRaw = (params as { limit?: unknown }).limit;
          const limit = typeof limitRaw === 'number' && limitRaw > 0 ? Math.floor(limitRaw) : 10;
          const logs = recentLogs({ project, limit });
          return jsonResult({ ok: true, action, count: logs.length, logs });
        }

        case 'dashboard': {
          const context = readOptional(params, 'context') || undefined;
          const dashboard = buildDashboard({ context });
          return jsonResult({ ok: true, action, count: dashboard.length, dashboard });
        }

        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    },
  };
}
