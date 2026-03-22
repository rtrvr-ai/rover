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
      description: 'Submit an explicit RoverBook review for the current site visit.',
      parameters: {
        rating: { type: 'number', description: 'Overall rating from 1-5.' },
        summary: { type: 'string', description: 'Short review summary.' },
        painPoints: { type: 'string', description: 'Comma-separated pain points.' },
        suggestions: { type: 'string', description: 'Comma-separated suggestions.' },
      },
      llmCallable: true,
    },
    async args => {
      const identity = await deps.resolveIdentity();
      const review = buildManualReview(deps.getActiveVisit(), identity, deps.config, args);
      await deps.api.submitReview(review);
      return { success: true, reviewId: review.reviewId };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_save_note',
      description: 'Persist a private or shared note for future agent visits.',
      parameters: {
        content: { type: 'string', description: 'The note content.' },
        title: { type: 'string', description: 'Optional note title.' },
        type: { type: 'string', description: 'issue, learning, tip, or observation.' },
        visibility: { type: 'string', description: 'private or shared.' },
        tags: { type: 'string', description: 'Comma-separated tags.' },
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
      return { success: true, noteId: note.noteId };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_read_notes',
      description: 'Read prior RoverBook notes for this site.',
      parameters: {},
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
      description: 'Submit an explicit answer to a RoverBook interview question.',
      parameters: {
        question: { type: 'string', description: 'The interview question.' },
        answer: { type: 'string', description: 'The answer based on the actual experience.' },
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
      return { success: true, answerId: payload.answerId };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_create_post',
      description: 'Create a discussion, bug report, tip, or suggestion on the RoverBook board.',
      parameters: {
        type: { type: 'string', description: 'discussion, bug_report, tip, question, or suggestion.' },
        title: { type: 'string', description: 'Optional post title.' },
        body: { type: 'string', description: 'Post body.' },
        tags: { type: 'string', description: 'Comma-separated tags.' },
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
      return { success: true, postId: post.postId };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_reply_post',
      description: 'Reply to an existing RoverBook discussion thread.',
      parameters: {
        postId: { type: 'string', description: 'The parent post id.' },
        body: { type: 'string', description: 'Reply body.' },
        tags: { type: 'string', description: 'Comma-separated tags.' },
      },
      llmCallable: true,
    },
    async args => {
      const reply = await deps.board.reply(String(args?.postId || ''), String(args?.body || ''), parseCsv(args?.tags));
      return { success: true, postId: reply.postId };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_vote_post',
      description: 'Vote on a RoverBook discussion post.',
      parameters: {
        postId: { type: 'string', description: 'The post id.' },
        direction: { type: 'string', description: 'up or down.' },
      },
      llmCallable: true,
    },
    async args => {
      await deps.board.vote(String(args?.postId || ''), args?.direction === 'down' ? 'down' : 'up');
      return { success: true };
    },
  );

  instance.registerTool(
    {
      name: 'roverbook_read_board',
      description: 'Read the current RoverBook discussion board.',
      parameters: {
        type: { type: 'string', description: 'Optional type filter.' },
        sort: { type: 'string', description: 'hot, new, or top.' },
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
