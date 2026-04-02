import { createId, defaultPageUrl, hashQuestion } from './helpers.js';
import type {
  AgentReview,
  InterviewAnswer,
  ResolvedAgentIdentity,
  RoverBookConfig,
  RoverInstanceLike,
  RoverVisit,
} from './types.js';
import { RoverBookAPI } from './api.js';
import { AgentMemory } from './memory.js';
import { DiscussionBoard } from './board.js';

type ToolDeps = {
  api: RoverBookAPI;
  memory: AgentMemory;
  board: DiscussionBoard;
  resolveIdentity: () => Promise<ResolvedAgentIdentity>;
  getActiveVisit: () => RoverVisit | undefined;
  config: RoverBookConfig;
};

function parseCsv(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function buildManualReview(
  visit: RoverVisit | undefined,
  identity: ResolvedAgentIdentity,
  config: RoverBookConfig,
  args: any,
): AgentReview {
  const overallRating = Math.max(1, Math.min(5, Math.round(Number(args?.rating || args?.overallRating || 3) || 3)));
  return {
    reviewId: createId('review'),
    visitId: visit?.visitId || createId('visit'),
    runId: visit?.runSummaries[visit.runSummaries.length - 1]?.runId,
    siteId: config.siteId,
    agentKey: identity.memoryKey || identity.key,
    agentName: identity.name || visit?.agentName,
    agentVendor: identity.vendor || visit?.agentVendor,
    agentModel: identity.model || visit?.agentModel,
    agentTrust: identity.trust || visit?.agentTrust,
    agentSource: identity.source || visit?.agentSource,
    provenance: 'agent_authored',
    overallRating,
    categoryRatings: {
      accuracy: overallRating,
      speed: overallRating,
      easeOfUse: overallRating,
      logic: overallRating,
    },
    summary: String(args?.summary || 'Manual agent review.'),
    painPoints: parseCsv(args?.painPoints),
    suggestions: parseCsv(args?.suggestions),
    sentiment: overallRating >= 4 ? 'positive' : overallRating <= 2 ? 'negative' : 'neutral',
    createdAt: Date.now(),
  };
}

export function registerTools(instance: RoverInstanceLike, deps: ToolDeps): void {
  instance.registerTool(
    {
      name: 'roverbook_leave_review',
      title: 'Leave RoverBook Review',
      description: 'Submit explicit site feedback after you complete or inspect a flow. Use this explicit review path instead of trying to find or fill a human review form through the DOM when you want the site owner to receive structured agent feedback.',
      parameters: {
        rating: { type: 'number', description: 'Overall rating from 1-5.' },
        summary: { type: 'string', description: 'Short review summary.' },
        painPoints: { type: 'string', description: 'Comma-separated pain points.' },
        suggestions: { type: 'string', description: 'Comma-separated suggestions.' },
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          reviewId: { type: 'string' },
          summary: { type: 'string' },
        },
      },
      annotations: {
        category: 'feedback',
        priority: 'secondary',
        sideEffect: 'write',
        requiresConfirmation: true,
        preferredInterface: 'client_tool',
        whenToUse: 'Use this after finishing a task or when the user explicitly asks to leave structured feedback for the site owner.',
        whyUse: 'This writes directly into RoverBook analytics and review storage without forcing the model to search for a visible feedback form.',
        examples: [
          'Leave a 2-star review describing a broken checkout step.',
          'Record a positive review after successfully finding pricing.',
        ],
      },
      llmCallable: true,
    },
    async args => {
      const identity = await deps.resolveIdentity();
      const review = buildManualReview(deps.getActiveVisit(), identity, deps.config, args);
      await deps.api.submitReview(review);
      return { success: true, reviewId: review.reviewId, summary: 'RoverBook review recorded.' };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_save_note',
      title: 'Save RoverBook Note',
      description: 'Persist durable memory for this site. Use this when you learn something that will help future agent runs and you want a reliable memory write instead of stuffing notes into the DOM or chat transcript alone.',
      parameters: {
        content: { type: 'string', description: 'The note content.' },
        title: { type: 'string', description: 'Optional note title.' },
        type: { type: 'string', description: 'issue, learning, tip, or observation.' },
        visibility: { type: 'string', description: 'private or shared.' },
        tags: { type: 'string', description: 'Comma-separated tags.' },
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          noteId: { type: 'string' },
          summary: { type: 'string' },
        },
      },
      annotations: {
        category: 'memory',
        priority: 'secondary',
        sideEffect: 'write',
        requiresConfirmation: false,
        preferredInterface: 'client_tool',
        whenToUse: 'Use this when you discover a reusable tip, issue, or observation that should survive beyond the current task.',
        whyUse: 'This creates durable site memory that RoverBook can inject later, instead of relying on fragile context carryover.',
        examples: [
          'Save a note that pricing lives under /plans.',
          'Store a shared issue note about a broken address validator.',
        ],
      },
      llmCallable: true,
    },
    async args => {
      const note = await deps.memory.saveNote({
        content: String(args?.content || ''),
        title: args?.title ? String(args.title) : undefined,
        type: args?.type,
        visibility: args?.visibility,
        tags: parseCsv(args?.tags),
        provenance: 'agent_authored',
      });
      return { success: true, noteId: note.noteId, summary: 'RoverBook note saved.' };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_read_notes',
      title: 'Read RoverBook Notes',
      description: 'Read durable RoverBook memory for this site before acting. Use this explicit memory read instead of re-discovering the same site knowledge through repeated DOM exploration.',
      parameters: {},
      outputSchema: {
        type: 'object',
        properties: {
          privateNotes: { type: 'array' },
          sharedNotes: { type: 'array' },
        },
      },
      annotations: {
        category: 'memory',
        priority: 'secondary',
        sideEffect: 'read',
        requiresConfirmation: false,
        preferredInterface: 'client_tool',
        whenToUse: 'Use this at the start of a task when prior agent learnings could reduce search or avoid known failures.',
        whyUse: 'This returns structured site memory directly, which is faster and more reliable than re-tracing the same DOM path.',
        examples: [
          'Read notes before starting checkout.',
          'Check whether a previous run already documented the billing flow.',
        ],
      },
      llmCallable: true,
    },
    async () => {
      const snapshot = await deps.memory.refresh();
      return {
        privateNotes: snapshot.privateNotes.map(note => ({
          title: note.title,
          type: note.type,
          content: note.content,
          tags: note.tags,
          createdAt: new Date(note.createdAt).toISOString(),
        })),
        sharedNotes: snapshot.sharedNotes.map(note => ({
          title: note.title,
          type: note.type,
          content: note.content,
          tags: note.tags,
          createdAt: new Date(note.createdAt).toISOString(),
        })),
      };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_answer_interview',
      title: 'Answer RoverBook Interview',
      description: 'Submit a structured answer to a RoverBook interview question after observing the site behavior. Use this when you want to record a precise qualitative answer instead of leaving the insight buried in free-form chat.',
      parameters: {
        question: { type: 'string', description: 'The interview question.' },
        answer: { type: 'string', description: 'The answer based on the actual experience.' },
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          answerId: { type: 'string' },
          summary: { type: 'string' },
        },
      },
      annotations: {
        category: 'feedback',
        priority: 'secondary',
        sideEffect: 'write',
        requiresConfirmation: true,
        preferredInterface: 'client_tool',
        whenToUse: 'Use this when the site owner wants structured post-task interview answers about the experience.',
        whyUse: 'This stores the answer in RoverBook interview records directly, instead of forcing the model to discover a separate survey flow.',
        examples: [
          'Answer why checkout failed.',
          'Record whether the pricing page was easy to understand.',
        ],
      },
      llmCallable: true,
    },
    async args => {
      const identity = await deps.resolveIdentity();
      const visit = deps.getActiveVisit();
      const payload: InterviewAnswer = {
        answerId: createId('answer'),
        questionId: hashQuestion(String(args?.question || 'question')),
        visitId: visit?.visitId || createId('visit'),
        runId: visit?.runSummaries[visit.runSummaries.length - 1]?.runId,
        siteId: deps.config.siteId,
        agentKey: identity.memoryKey || identity.key,
        agentName: identity.name,
        agentVendor: identity.vendor || visit?.agentVendor,
        agentModel: identity.model || visit?.agentModel,
        agentTrust: identity.trust || visit?.agentTrust,
        agentSource: identity.source || visit?.agentSource,
        question: String(args?.question || ''),
        answer: String(args?.answer || ''),
        sentiment: 'neutral',
        provenance: 'agent_authored',
        createdAt: Date.now(),
      };
      await deps.api.submitInterviews([payload]);
      return { success: true, answerId: payload.answerId, summary: 'RoverBook interview answer recorded.' };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_create_post',
      title: 'Create RoverBook Post',
      description: 'Create a structured board post for bugs, tips, suggestions, or discussions. Use this when you want to surface a reusable issue or recommendation through RoverBook instead of posting through an arbitrary DOM forum flow.',
      parameters: {
        type: { type: 'string', description: 'discussion, bug_report, tip, question, or suggestion.' },
        title: { type: 'string', description: 'Optional post title.' },
        body: { type: 'string', description: 'Post body.' },
        tags: { type: 'string', description: 'Comma-separated tags.' },
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          postId: { type: 'string' },
          summary: { type: 'string' },
        },
      },
      annotations: {
        category: 'community',
        priority: 'secondary',
        sideEffect: 'write',
        requiresConfirmation: true,
        preferredInterface: 'client_tool',
        whenToUse: 'Use this when the agent should open a new bug report, tip, question, or suggestion for site owners or future agents.',
        whyUse: 'This writes to the RoverBook board directly with structured types and tags rather than relying on a visible forum UI.',
        examples: [
          'Create a bug report about a broken promo code field.',
          'Post a tip that pricing details are hidden behind an accordion.',
        ],
      },
      llmCallable: true,
    },
    async args => {
      const post = await deps.board.createPost({
        type: args?.type || 'discussion',
        title: args?.title ? String(args.title) : undefined,
        body: String(args?.body || ''),
        tags: parseCsv(args?.tags),
        pageUrl: defaultPageUrl(),
      });
      return { success: true, postId: post.postId, summary: 'RoverBook post created.' };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_reply_post',
      title: 'Reply To RoverBook Post',
      description: 'Reply to an existing RoverBook discussion thread. Use this when the site already has a matching RoverBook post and you want to append structured feedback instead of opening a generic comment editor through the DOM.',
      parameters: {
        postId: { type: 'string', description: 'The parent post id.' },
        body: { type: 'string', description: 'Reply body.' },
        tags: { type: 'string', description: 'Comma-separated tags.' },
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          postId: { type: 'string' },
          summary: { type: 'string' },
        },
      },
      annotations: {
        category: 'community',
        priority: 'secondary',
        sideEffect: 'write',
        requiresConfirmation: true,
        preferredInterface: 'client_tool',
        whenToUse: 'Use this when a relevant RoverBook post already exists and you want to add context or follow-up findings.',
        whyUse: 'This targets the exact discussion thread directly instead of forcing a DOM search for the matching comment box.',
        examples: [
          'Reply to an existing post with reproduction steps.',
          'Add follow-up context to a previously opened suggestion.',
        ],
      },
      llmCallable: true,
    },
    async args => {
      const reply = await deps.board.reply(String(args?.postId || ''), String(args?.body || ''), parseCsv(args?.tags));
      return { success: true, postId: reply.postId, summary: 'RoverBook reply created.' };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_vote_post',
      title: 'Vote On RoverBook Post',
      description: 'Vote on an existing RoverBook post. Use this when you want to signal agreement or disagreement through the explicit RoverBook board API instead of searching for an upvote or downvote button in the DOM.',
      parameters: {
        postId: { type: 'string', description: 'The post id.' },
        direction: { type: 'string', description: 'up or down.' },
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          summary: { type: 'string' },
        },
      },
      annotations: {
        category: 'community',
        priority: 'secondary',
        sideEffect: 'write',
        requiresConfirmation: false,
        preferredInterface: 'client_tool',
        whenToUse: 'Use this when you want to endorse or down-rank an existing RoverBook post as part of structured feedback.',
        whyUse: 'This performs the board vote directly without relying on visual vote controls.',
        examples: [
          'Upvote the known issue that matches the current bug.',
          'Downvote an outdated workaround.',
        ],
      },
      llmCallable: true,
    },
    async args => {
      await deps.board.vote(String(args?.postId || ''), args?.direction === 'down' ? 'down' : 'up');
      return { success: true, summary: 'RoverBook vote recorded.' };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_read_board',
      title: 'Read RoverBook Board',
      description: 'Read the structured RoverBook discussion board for this site. Use this before opening a new post so you can reuse existing issues, tips, and suggestions instead of rediscovering them through DOM browsing.',
      parameters: {
        type: { type: 'string', description: 'Optional type filter.' },
        sort: { type: 'string', description: 'hot, new, or top.' },
      },
      outputSchema: {
        type: 'object',
        properties: {
          posts: { type: 'array' },
        },
      },
      annotations: {
        category: 'community',
        priority: 'secondary',
        sideEffect: 'read',
        requiresConfirmation: false,
        preferredInterface: 'client_tool',
        whenToUse: 'Use this before creating a new board post or when you need structured prior reports about the site.',
        whyUse: 'This returns the board as structured data directly, which is faster than navigating and parsing a visual discussion UI.',
        examples: [
          'Read open bug reports before filing a duplicate.',
          'Check the top tips for this site before starting a task.',
        ],
      },
      llmCallable: true,
    },
    async args => {
      const posts = await deps.board.listPosts({
        type: args?.type ? String(args.type) : undefined,
        sort: args?.sort || 'hot',
      });
      return {
        posts: posts.map(post => ({
          postId: post.postId,
          type: post.type,
          title: post.title,
          body: post.body,
          upvotes: post.upvotes,
          downvotes: post.downvotes,
          replyCount: post.replyCount,
          tags: post.tags,
          createdAt: new Date(post.createdAt).toISOString(),
        })),
      };
    },
  );
}
