import { createId, hashQuestion, truncate } from './helpers.js';
import type {
  AgentNote,
  NotesSnapshot,
  ResolvedAgentIdentity,
  RoverBookConfig,
  RoverVisit,
} from './types.js';
import { RoverBookAPI } from './api.js';

type MemoryContext = {
  resolveIdentity: () => Promise<ResolvedAgentIdentity>;
  getActiveVisit: () => RoverVisit | undefined;
};

const DEFAULT_MEMORY_CONFIG = {
  enabled: true,
  sharedAccess: 'read_shared',
  injectIntoPrompt: true,
  maxPromptNotes: 4,
  maxPromptChars: 900,
  autoDerivedNotes: true,
} as const;

export class AgentMemory {
  private snapshot: NotesSnapshot = { privateNotes: [], sharedNotes: [] };
  private loadedAgentKey?: string;

  constructor(
    private readonly api: RoverBookAPI,
    private readonly config: RoverBookConfig,
    private readonly context: MemoryContext,
  ) {}

  async refresh(force = false): Promise<NotesSnapshot> {
    const settings = { ...DEFAULT_MEMORY_CONFIG, ...(this.config.memory || {}) };
    if (settings.enabled === false) {
      this.snapshot = { privateNotes: [], sharedNotes: [] };
      return this.snapshot;
    }
    const identity = await this.context.resolveIdentity();
    if (!force && this.loadedAgentKey === identity.key) {
      return this.snapshot;
    }
    const [privateNotes, sharedNotes] = await Promise.all([
      this.api.getNotes({
        siteId: this.config.siteId,
        agentId: identity.key,
        visibility: 'private',
        limit: 50,
      }),
      settings.sharedAccess === 'private_only'
        ? Promise.resolve([])
        : this.api.getNotes({
          siteId: this.config.siteId,
          visibility: 'shared',
          limit: 50,
        }),
    ]);
    this.loadedAgentKey = identity.key;
    this.snapshot = {
      privateNotes,
      sharedNotes: sharedNotes.filter(note => note.agentKey !== identity.key || note.visibility === 'shared'),
    };
    return this.snapshot;
  }

  async buildPromptContext(): Promise<string | undefined> {
    const settings = { ...DEFAULT_MEMORY_CONFIG, ...(this.config.memory || {}) };
    if (settings.enabled === false || settings.injectIntoPrompt === false) {
      return undefined;
    }
    const snapshot = await this.refresh();
    const maxNotes = Math.max(1, settings.maxPromptNotes || 4);
    const items = [...snapshot.privateNotes, ...snapshot.sharedNotes]
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .slice(0, maxNotes);
    if (!items.length) return undefined;
    const lines = items.map(note => {
      const label = note.visibility === 'shared' ? 'shared' : 'private';
      const title = note.title ? `${note.title}: ` : '';
      return `- (${label}/${note.type}) ${title}${note.content}`;
    });
    const text = `Relevant prior RoverBook memory for this site:\n${lines.join('\n')}`;
    return truncate(text, settings.maxPromptChars || 900);
  }

  async saveNote(input: {
    type?: AgentNote['type'];
    title?: string;
    content: string;
    tags?: string[];
    visibility?: AgentNote['visibility'];
    linkedUrl?: string;
    provenance?: AgentNote['provenance'];
  }): Promise<AgentNote> {
    const identity = await this.context.resolveIdentity();
    const visit = this.context.getActiveVisit();
    const settings = { ...DEFAULT_MEMORY_CONFIG, ...(this.config.memory || {}) };
    const note: AgentNote = {
      noteId: createId('note'),
      siteId: this.config.siteId,
      visitId: visit?.visitId,
      runId: visit?.runSummaries[visit.runSummaries.length - 1]?.runId,
      agentKey: identity.key,
      agentName: identity.name,
      type: input.type || 'observation',
      title: input.title,
      content: input.content,
      tags: input.tags || [],
      linkedUrl: input.linkedUrl || visit?.latestUrl,
      visibility:
        input.visibility
        || (settings.sharedAccess === 'read_write_shared' ? 'shared' : 'private'),
      provenance: input.provenance || 'agent_authored',
      createdAt: Date.now(),
    };
    const ok = await this.api.saveNote(note);
    if (!ok) {
      throw new Error(`Failed to save RoverBook note for site ${this.config.siteId}`);
    }
    if (note.visibility === 'shared') {
      this.snapshot.sharedNotes = [note, ...this.snapshot.sharedNotes];
    } else {
      this.snapshot.privateNotes = [note, ...this.snapshot.privateNotes];
    }
    return note;
  }

  async createDerivedNotes(visit: RoverVisit): Promise<AgentNote[]> {
    const settings = { ...DEFAULT_MEMORY_CONFIG, ...(this.config.memory || {}) };
    if (settings.enabled === false || settings.autoDerivedNotes === false) return [];
    const notes: AgentNote[] = [];
    if (visit.latestError) {
      notes.push(await this.saveNote({
        type: 'issue',
        title: 'Recent task failure',
        content: visit.latestError,
        tags: ['error', hashQuestion(visit.latestError)],
        provenance: 'derived',
      }));
    }
    if (visit.outcome === 'success' && visit.latestSummary) {
      notes.push(await this.saveNote({
        type: 'learning',
        title: 'Successful task pattern',
        content: visit.latestSummary,
        tags: ['success'],
        provenance: 'derived',
      }));
    }
    return notes;
  }

  getSnapshot(): NotesSnapshot {
    return {
      privateNotes: [...this.snapshot.privateNotes],
      sharedNotes: [...this.snapshot.sharedNotes],
    };
  }
}
