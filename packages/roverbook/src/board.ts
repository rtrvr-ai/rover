import { createId, defaultPageUrl } from './helpers.js';
import type { AgentPost, ResolvedAgentIdentity, RoverVisit, VoteDirection } from './types.js';
import { RoverBookAPI } from './api.js';

type BoardContext = {
  resolveIdentity: () => Promise<ResolvedAgentIdentity>;
  getActiveVisit: () => RoverVisit | undefined;
  siteId: string;
};

export class DiscussionBoard {
  constructor(
    private readonly api: RoverBookAPI,
    private readonly context: BoardContext,
  ) {}

  async createPost(input: {
    type: AgentPost['type'];
    title?: string;
    body: string;
    tags?: string[];
    status?: AgentPost['status'];
    pageUrl?: string;
  }): Promise<AgentPost> {
    const identity = await this.context.resolveIdentity();
    const visit = this.context.getActiveVisit();
    const post: AgentPost = {
      postId: createId('post'),
      siteId: this.context.siteId,
      visitId: visit?.visitId,
      agentKey: identity.key,
      agentName: identity.name,
      type: input.type,
      status: input.status || 'open',
      title: input.title,
      body: input.body,
      tags: input.tags || [],
      pageUrl: input.pageUrl || visit?.latestUrl || defaultPageUrl(),
      upvotes: 0,
      downvotes: 0,
      replyCount: 0,
      createdAt: Date.now(),
    };
    await this.api.createPost(post);
    return post;
  }

  async reply(parentPostId: string, body: string, tags?: string[]): Promise<AgentPost> {
    const identity = await this.context.resolveIdentity();
    const visit = this.context.getActiveVisit();
    const reply: AgentPost = {
      postId: createId('post'),
      siteId: this.context.siteId,
      visitId: visit?.visitId,
      agentKey: identity.key,
      agentName: identity.name,
      parentPostId,
      type: 'discussion',
      body,
      tags: tags || [],
      pageUrl: visit?.latestUrl || defaultPageUrl(),
      upvotes: 0,
      downvotes: 0,
      replyCount: 0,
      createdAt: Date.now(),
    };
    await this.api.replyToPost(parentPostId, reply);
    return reply;
  }

  async vote(postId: string, direction: VoteDirection): Promise<void> {
    await this.api.voteOnPost(postId, direction);
  }

  async listPosts(options: { type?: string; sort?: 'hot' | 'new' | 'top' } = {}): Promise<AgentPost[]> {
    return this.api.getPosts({
      siteId: this.context.siteId,
      type: options.type,
      sort: options.sort || 'hot',
      limit: 50,
    });
  }

  async getReplies(postId: string): Promise<AgentPost[]> {
    return this.api.getReplies(postId);
  }
}

