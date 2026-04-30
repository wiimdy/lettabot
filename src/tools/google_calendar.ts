import type { AnyAgentTool } from '@letta-ai/letta-code-sdk';
import { jsonResult, readStringParam } from '@letta-ai/letta-code-sdk';
import { google, type calendar_v3 } from 'googleapis';

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const DEFAULT_TZ = process.env.GOOGLE_CALENDAR_TIMEZONE || 'Asia/Seoul';

let cachedClient: calendar_v3.Calendar | null = null;

function getCalendarClient(): calendar_v3.Calendar {
  if (cachedClient) return cachedClient;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Calendar credentials missing. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN. ' +
      'Run scripts/google-oauth.mjs locally once to obtain the refresh token.',
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  cachedClient = google.calendar({ version: 'v3', auth: oauth2 });
  return cachedClient;
}

function readOptional(params: Record<string, unknown>, key: string): string | null {
  const v = readStringParam(params, key);
  if (!v) return null;
  return v.trim() || null;
}

function buildEventTime(value: string): calendar_v3.Schema$EventDateTime {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { date: trimmed };
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid datetime: ${value}`);
  }
  return { dateTime: parsed.toISOString(), timeZone: DEFAULT_TZ };
}

function summarizeEvent(event: calendar_v3.Schema$Event) {
  return {
    id: event.id,
    summary: event.summary,
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    location: event.location || null,
    description: event.description || null,
    htmlLink: event.htmlLink || null,
  };
}

export function createGoogleCalendarTool(): AnyAgentTool {
  return {
    label: 'Google Calendar',
    name: 'google_calendar',
    description: [
      'Create, list, update, and delete events on the user\'s primary Google Calendar.',
      'Times accept ISO 8601 (e.g. 2026-05-15T15:00:00) or YYYY-MM-DD for all-day events.',
      `Default timezone is ${DEFAULT_TZ}. Use list_events with timeMin/timeMax to query a window;`,
      'use create_event for new entries, update_event to reschedule or rename, delete_event to remove.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create_event', 'list_events', 'update_event', 'delete_event'],
          description: 'Operation on Google Calendar.',
        },
        summary: {
          type: 'string',
          description: 'Event title for create/update.',
        },
        start: {
          type: 'string',
          description: 'Start datetime (ISO) or date (YYYY-MM-DD). Required for create_event.',
        },
        end: {
          type: 'string',
          description: 'End datetime (ISO) or date. Optional for create_event; defaults to start + 1 hour.',
        },
        description: {
          type: 'string',
          description: 'Optional event description.',
        },
        location: {
          type: 'string',
          description: 'Optional event location.',
        },
        event_id: {
          type: 'string',
          description: 'Event id for update_event / delete_event.',
        },
        time_min: {
          type: 'string',
          description: 'list_events: ISO start of window. Default now.',
        },
        time_max: {
          type: 'string',
          description: 'list_events: ISO end of window. Default 7 days from time_min.',
        },
        query: {
          type: 'string',
          description: 'list_events: free-text search filter (matches summary/description/location).',
        },
        max_results: {
          type: 'number',
          description: 'list_events: max events returned. Default 25.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_toolCallId: string, args: unknown) {
      const params = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {};
      const action = readStringParam(params, 'action', { required: true })?.toLowerCase();
      const calendar = getCalendarClient();

      switch (action) {
        case 'create_event': {
          const summary = readStringParam(params, 'summary', { required: true });
          const startRaw = readStringParam(params, 'start', { required: true });
          const endRaw = readOptional(params, 'end');
          const description = readOptional(params, 'description');
          const location = readOptional(params, 'location');

          const start = buildEventTime(startRaw);
          let end: calendar_v3.Schema$EventDateTime;
          if (endRaw) {
            end = buildEventTime(endRaw);
          } else if (start.dateTime) {
            const startMs = new Date(start.dateTime).getTime();
            end = { dateTime: new Date(startMs + 60 * 60 * 1000).toISOString(), timeZone: DEFAULT_TZ };
          } else {
            end = { date: start.date! };
          }

          const { data } = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            requestBody: {
              summary,
              description: description || undefined,
              location: location || undefined,
              start,
              end,
            },
          });
          return jsonResult({ ok: true, action, message: `Created event ${data.id}`, event: summarizeEvent(data) });
        }

        case 'list_events': {
          const timeMin = readOptional(params, 'time_min') || new Date().toISOString();
          const timeMax = readOptional(params, 'time_max') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          const query = readOptional(params, 'query') || undefined;
          const maxRaw = (params as { max_results?: unknown }).max_results;
          const maxResults = typeof maxRaw === 'number' && maxRaw > 0 ? Math.min(Math.floor(maxRaw), 250) : 25;

          const { data } = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin,
            timeMax,
            q: query,
            maxResults,
            singleEvents: true,
            orderBy: 'startTime',
          });
          const events = (data.items || []).map(summarizeEvent);
          return jsonResult({ ok: true, action, count: events.length, time_min: timeMin, time_max: timeMax, events });
        }

        case 'update_event': {
          const eventId = readStringParam(params, 'event_id', { required: true });
          const patch: calendar_v3.Schema$Event = {};
          const summary = readOptional(params, 'summary');
          if (summary) patch.summary = summary;
          const description = readOptional(params, 'description');
          if (description) patch.description = description;
          const location = readOptional(params, 'location');
          if (location) patch.location = location;
          const startRaw = readOptional(params, 'start');
          if (startRaw) patch.start = buildEventTime(startRaw);
          const endRaw = readOptional(params, 'end');
          if (endRaw) patch.end = buildEventTime(endRaw);

          const { data } = await calendar.events.patch({
            calendarId: CALENDAR_ID,
            eventId,
            requestBody: patch,
          });
          return jsonResult({ ok: true, action, message: `Updated event ${data.id}`, event: summarizeEvent(data) });
        }

        case 'delete_event': {
          const eventId = readStringParam(params, 'event_id', { required: true });
          await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
          return jsonResult({ ok: true, action, message: `Deleted event ${eventId}` });
        }

        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    },
  };
}
