import type { FrameworkElementMetadataWire, MainWorldToolRequest } from '@rover/shared/lib/system-tools/wire.js';
import type { FrameworkElementMetadata, FrameworkName } from '@rover/shared/lib/utils/main-listener-utils.js';
import type { PageConfig } from '@rover/shared';
import { SYSTEM_TOOLS_ELEMENT_ID_KEYS, SystemToolNames, normalizeDescribeImageIds } from '@rover/shared/lib/system-tools/tools.js';
import { FrameworkNameToCode, ToolNameToOpcode } from '@rover/shared/lib/system-tools/wire.js';
import { getDocumentContext, resolveInteractiveElementById } from '@rover/shared/lib/page/index.js';
import { EventHandlerReverseMap, parseNumericListenerAttribute } from '@rover/a11y-tree';
import type { UploadFilePayload } from '@rover/shared/lib/system-tools/wire.js';
import { fetchFileForUploadSmart } from '@rover/shared/lib/page/file-upload-utils.js';
import { buildPageData, buildSnapshot, executeMainWorldTool, ensureMainWorldActions, ensureScrollDetector } from '@rover/dom';
import { installInstrumentation, type InstrumentationController, type InstrumentationOptions } from '@rover/instrumentation';
import {
  extractHostname,
  isUrlAllowedByDomains,
  normalizeAllowedDomains,
} from './navigationScope.js';

export type DomainScopeMode = 'host_only' | 'registrable_domain';
export type ExternalNavigationPolicy = 'open_new_tab_notice' | 'block' | 'allow';
export type CrossHostPolicy = 'open_new_tab' | 'same_tab';
export type ActionGateContext = {
  mode?: 'controller' | 'observer';
  controllerRuntimeId?: string;
  activeLogicalTabId?: number;
  localLogicalTabId?: number;
  reason?: string;
};

export type NavigationGuardrailEvent = {
  blockedUrl: string;
  currentUrl: string;
  policyAction: Exclude<ExternalNavigationPolicy, 'allow'>;
  reason: string;
  allowedDomains: string[];
  openedInNewTab: boolean;
};

export type NavigationIntentEvent = {
  handoffId: string;
  targetUrl: string;
  sourceRuntimeId?: string;
  sourceLogicalTabId?: number;
  runId?: string;
  isCrossHost: boolean;
  ts: number;
};

export type NavigationPreflightDecision = {
  decision?: 'allow_same_tab' | 'open_new_tab' | 'block' | 'stale_run';
  reason?: string;
  decisionReason?: string;
};

export type BridgeOptions = {
  root?: Element;
  includeFrames?: boolean;
  disableDomAnnotations?: boolean;
  allowActions?: boolean;
  runtimeId?: string;
  allowedDomains?: string[];
  domainScopeMode?: DomainScopeMode;
  externalNavigationPolicy?: ExternalNavigationPolicy;
  crossHostPolicy?: CrossHostPolicy;
  onNavigationGuardrail?: (event: NavigationGuardrailEvent) => void;
  onBeforeAgentNavigation?: (
    event: NavigationIntentEvent,
  ) => NavigationPreflightDecision | Promise<NavigationPreflightDecision | void> | void;
  onBeforeCrossHostNavigation?: (event: NavigationIntentEvent) => void;
  registerOpenedTab?: (payload: {
    url: string;
    title?: string;
    external?: boolean;
    openerRuntimeId?: string;
  }) => { logicalTabId: number } | Promise<{ logicalTabId: number } | undefined> | undefined;
  listKnownTabs?: () => Array<{ logicalTabId: number; runtimeId?: string; url?: string; title?: string; external?: boolean }>;
  switchToLogicalTab?: (
    logicalTabId: number,
  ) => { ok: boolean; delegated?: boolean; reason?: string } | Promise<{ ok: boolean; delegated?: boolean; reason?: string }>;
  instrumentation?: InstrumentationController;
  instrumentationOptions?: InstrumentationOptions;
  uploadBytesProvider?: (args: { token: string; byteLength: number; timeoutMs?: number }) => Promise<ArrayBuffer>;
  navigationDelayMs?: number;
  domSettle?: {
    debounceMs?: number;
    maxWaitMs?: number;
    retries?: number;
    sparseTreeRetryDelayMs?: number;
    sparseTreeRetryMaxAttempts?: number;
  };
};

export class Bridge {
  private root: Element;
  private includeFrames: boolean;
  private disableDomAnnotations: boolean;
  private allowActions: boolean;
  private runtimeId?: string;
  private domainScopeMode: DomainScopeMode;
  private allowedDomains: string[];
  private externalNavigationPolicy: ExternalNavigationPolicy;
  private crossHostPolicy: CrossHostPolicy;
  private registerOpenedTab?: BridgeOptions['registerOpenedTab'];
  private listKnownTabs?: BridgeOptions['listKnownTabs'];
  private switchToLogicalTab?: BridgeOptions['switchToLogicalTab'];
  private onNavigationGuardrail?: BridgeOptions['onNavigationGuardrail'];
  private onBeforeAgentNavigation?: BridgeOptions['onBeforeAgentNavigation'];
  private onBeforeCrossHostNavigation?: BridgeOptions['onBeforeCrossHostNavigation'];
  private instrumentation: InstrumentationController;
  private highlightEl: HTMLDivElement | null = null;
  private clientTools = new Map<string, { handler: (args: any) => any | Promise<any>; def: any }>();
  private navigationDelayMs: number;
  private domSettleDebounceMs: number;
  private domSettleMaxWaitMs: number;
  private domSettleRetries: number;
  private sparseTreeRetryDelayMs: number;
  private sparseTreeRetryMaxAttempts: number;
  private uploadStore = new Map<string, { bytes: ArrayBuffer; createdAt: number }>();
  private uploadProviderInstalled = false;
  private actionGateContext: ActionGateContext = {};
  private static readonly NAV_PREFLIGHT_TIMEOUT_MS = 1500;

  constructor(opts: BridgeOptions = {}) {
    this.root = opts.root ?? document.body ?? document.documentElement;
    this.includeFrames = opts.includeFrames ?? true;
    this.disableDomAnnotations = opts.disableDomAnnotations ?? true;
    this.allowActions = opts.allowActions ?? true;
    this.runtimeId = opts.runtimeId;
    this.domainScopeMode = normalizeDomainScopeMode(opts.domainScopeMode);
    this.allowedDomains = normalizeAllowedDomains(opts.allowedDomains, window.location.hostname, this.domainScopeMode);
    this.externalNavigationPolicy = normalizeExternalNavigationPolicy(opts.externalNavigationPolicy);
    this.crossHostPolicy = normalizeCrossHostPolicy(opts.crossHostPolicy);
    this.registerOpenedTab = opts.registerOpenedTab;
    this.listKnownTabs = opts.listKnownTabs;
    this.switchToLogicalTab = opts.switchToLogicalTab;
    this.onNavigationGuardrail = opts.onNavigationGuardrail;
    this.onBeforeAgentNavigation = opts.onBeforeAgentNavigation;
    this.onBeforeCrossHostNavigation = opts.onBeforeCrossHostNavigation;
    this.navigationDelayMs = opts.navigationDelayMs ?? 80;
    this.domSettleDebounceMs = normalizeDomSettleNumber(opts.domSettle?.debounceMs, 24, 8, 500);
    this.domSettleMaxWaitMs = normalizeDomSettleNumber(opts.domSettle?.maxWaitMs, 220, 80, 5000);
    this.domSettleRetries = normalizeDomSettleNumber(opts.domSettle?.retries, 0, 0, 6);
    this.sparseTreeRetryDelayMs = normalizeDomSettleNumber(opts.domSettle?.sparseTreeRetryDelayMs, 35, 20, 1000);
    this.sparseTreeRetryMaxAttempts = normalizeDomSettleNumber(opts.domSettle?.sparseTreeRetryMaxAttempts, 1, 0, 4);
    this.instrumentation =
      opts.instrumentation ??
      installInstrumentation({
        includeIframes: true,
        scanInlineHandlers: true,
        observeInlineMutations: true,
        ...(opts.instrumentationOptions || {}),
      });

    ensureMainWorldActions();
    ensureScrollDetector();

    if (opts.uploadBytesProvider) {
      this.setUploadBytesProvider(opts.uploadBytesProvider);
    }
  }

  setAllowActions(allow: boolean): void {
    this.allowActions = !!allow;
  }

  setActionGateContext(context?: ActionGateContext): void {
    const next: ActionGateContext = {};
    if (context?.mode === 'controller' || context?.mode === 'observer') next.mode = context.mode;
    if (typeof context?.controllerRuntimeId === 'string' && context.controllerRuntimeId.trim()) {
      next.controllerRuntimeId = context.controllerRuntimeId.trim();
    }
    if (Number.isFinite(Number(context?.activeLogicalTabId)) && Number(context?.activeLogicalTabId) > 0) {
      next.activeLogicalTabId = Number(context?.activeLogicalTabId);
    }
    if (Number.isFinite(Number(context?.localLogicalTabId)) && Number(context?.localLogicalTabId) > 0) {
      next.localLogicalTabId = Number(context?.localLogicalTabId);
    }
    if (typeof context?.reason === 'string' && context.reason.trim()) {
      next.reason = context.reason.trim().slice(0, 240);
    }
    this.actionGateContext = next;
  }

  setNavigationPolicy(options: {
    allowedDomains?: string[];
    domainScopeMode?: DomainScopeMode;
    externalNavigationPolicy?: ExternalNavigationPolicy;
    crossHostPolicy?: CrossHostPolicy;
  }): void {
    if (options.domainScopeMode) {
      this.domainScopeMode = normalizeDomainScopeMode(options.domainScopeMode);
      if (!options.allowedDomains) {
        this.allowedDomains = normalizeAllowedDomains(undefined, window.location.hostname, this.domainScopeMode);
      }
    }
    if (options.allowedDomains) {
      this.allowedDomains = normalizeAllowedDomains(options.allowedDomains, window.location.hostname, this.domainScopeMode);
    }
    if (options.externalNavigationPolicy) {
      this.externalNavigationPolicy = normalizeExternalNavigationPolicy(options.externalNavigationPolicy);
    }
    if (options.crossHostPolicy) {
      this.crossHostPolicy = normalizeCrossHostPolicy(options.crossHostPolicy);
    }
  }

  async getSnapshot() {
    await ensureListenerScan(this.root);
    return buildSnapshot(this.root, this.instrumentation, {
      includeFrames: this.includeFrames,
      disableDomAnnotations: this.disableDomAnnotations,
    });
  }

  async getPageData(params?: { pageConfig?: PageConfig }) {
    await ensureListenerScan(this.root);
    const pageConfig: PageConfig = {
      ...(params?.pageConfig || {}),
      adaptiveSettleDebounceMs:
        Number((params?.pageConfig as any)?.adaptiveSettleDebounceMs) > 0
          ? Number((params?.pageConfig as any)?.adaptiveSettleDebounceMs)
          : this.domSettleDebounceMs,
      adaptiveSettleMaxWaitMs:
        Number((params?.pageConfig as any)?.adaptiveSettleMaxWaitMs) > 0
          ? Number((params?.pageConfig as any)?.adaptiveSettleMaxWaitMs)
          : this.domSettleMaxWaitMs,
      adaptiveSettleRetries:
        Number.isFinite(Number((params?.pageConfig as any)?.adaptiveSettleRetries))
          ? Number((params?.pageConfig as any)?.adaptiveSettleRetries)
          : this.domSettleRetries,
      sparseTreeRetryDelayMs:
        Number((params?.pageConfig as any)?.sparseTreeRetryDelayMs) > 0
          ? Number((params?.pageConfig as any)?.sparseTreeRetryDelayMs)
          : this.sparseTreeRetryDelayMs,
      sparseTreeRetryMaxAttempts:
        Number.isFinite(Number((params?.pageConfig as any)?.sparseTreeRetryMaxAttempts))
          ? Number((params?.pageConfig as any)?.sparseTreeRetryMaxAttempts)
          : this.sparseTreeRetryMaxAttempts,
    };
    return await buildPageData(this.root, this.instrumentation, {
      includeFrames: this.includeFrames,
      disableDomAnnotations: this.disableDomAnnotations,
      pageConfig,
    });
  }

  async executeTool(call: { name: string; args?: Record<string, any> }, payload?: UploadFilePayload): Promise<any> {
    const toolName = normalizeToolName(call?.name) as SystemToolNames;
    if (!toolName) {
      return { success: false, error: `Unknown tool: ${String(call?.name)}`, allowFallback: false };
    }

    if (this.shouldBlockForOutOfScopeContext(toolName)) {
      const reason = 'Current tab is outside the allowed navigation scope.';
      return this.domainScopeBlockedResponse(window.location.href, reason, { fromCurrentContext: true });
    }

    if (!this.allowActions && !NON_ACTION_TOOLS.has(toolName)) {
      const reason = this.actionGateContext.mode === 'observer'
        ? 'Actions are disabled because this tab is currently in observer mode.'
        : (this.actionGateContext.reason || 'Actions disabled by configuration');
      return {
        success: false,
        error: 'Actions disabled by configuration',
        allowFallback: false,
        output: {
          reason,
          actionGate: this.actionGateContext,
        },
      };
    }

    // Navigation and control tools handled here (not in main-world executor)
    const navResult = await this.handleNavigationTools(toolName, call?.args || {});
    if (navResult) return navResult;

    if (toolName === SystemToolNames.wait_action) {
      const duration = Number((call?.args as any)?.duration ?? 1000);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(duration, 60_000))));
      return { success: true };
    }

    if (toolName === SystemToolNames.wait_for_element) {
      return this.waitForElement(call?.args || {});
    }

    if (toolName === SystemToolNames.answer_task) {
      return { success: true };
    }

    if (toolName === SystemToolNames.solve_captcha) {
      return capabilityUnavailableResponse(
        'CAPTCHA solving requires human intervention in embed mode.',
        'HUMAN_INTERVENTION_REQUIRED',
      );
    }

    if (toolName === SystemToolNames.network_run_recipe) {
      return capabilityUnavailableResponse(
        'network_run_recipe is not supported in embed mode.',
        'CAPABILITY_UNAVAILABLE',
      );
    }

    const args = call?.args || {};
    const hasElementContext = hasAnyElementContext(args);
    const iframeContext = getDocumentContext(document, args.iframe_id);
    if (args.iframe_id != null && iframeContext.unresolvedPath.length > 0 && !hasElementContext) {
      return this.iframeContextUnavailableResponse(args.iframe_id, iframeContext);
    }

    if (toolName === SystemToolNames.click_element && (args as any)?.open_in_new_tab) {
      return this.openElementInNewTab(args);
    }

    if (toolName === SystemToolNames.click_element) {
      const intercepted = this.getInterceptedClickTarget(args);
      if (intercepted?.targetUrl) {
        if (intercepted.forceOpenInNewTab) {
          return this.openUrlInNewTab(intercepted.targetUrl, {
            policyBlocked: true,
            reason: intercepted.reason,
            decisionReason: 'open_new_tab',
          });
        }
        const reason = intercepted.reason;
        if (this.externalNavigationPolicy === 'open_new_tab_notice') {
          return this.openUrlInNewTab(intercepted.targetUrl, {
            policyBlocked: true,
            reason,
            decisionReason: 'open_new_tab',
          });
        }
        return this.domainScopeBlockedResponse(intercepted.targetUrl, reason, {
          decisionReason: 'policy_blocked',
        });
      }
      // Notify agent navigation before executing any click.
      // For anchors: use resolved URL. For non-anchors: use current page URL as fallback.
      // If the click navigates, auto-resume works. If not, the notification is harmless.
      const clickTargetUrl = this.getClickTargetUrl(args);
      if (clickTargetUrl) {
        const intent = this.buildNavigationIntent(clickTargetUrl);
        if (intent.isCrossHost) {
          const preflight = await this.resolveAgentNavigationDecision(
            intent,
            this.getNavigationFallbackDecision(clickTargetUrl),
          );
          if (preflight.decision === 'block') {
            return this.domainScopeBlockedResponse(
              clickTargetUrl,
              preflight.reason || 'Navigation blocked by policy.',
              { decisionReason: preflight.decisionReason || 'policy_blocked' },
            );
          }
          if (preflight.decision === 'open_new_tab') {
            return this.openUrlInNewTab(clickTargetUrl, {
              policyBlocked: true,
              reason: preflight.reason || 'Navigation policy requires opening a new tab.',
              decisionReason: preflight.decisionReason || 'open_new_tab',
            });
          }
          this.notifyCrossHostNavigation(intent);
        } else {
          this.notifyAgentNavigation(intent);
        }
      }
    }

    if (toolName === SystemToolNames.describe_images) {
      return this.describeImages(call?.args || {});
    }

    if (!(toolName in ToolNameToOpcode)) {
      return { success: false, error: `Unknown tool: ${String(call?.name)}`, allowFallback: false };
    }

    const { doc } = iframeContext;

    const elementId = getPrimaryElementId(args);
    const targetEl = elementId ? resolveInteractiveElementById(doc, elementId) : null;

    let elementData: FrameworkElementMetadataWire | undefined;
    if (targetEl) {
      const md = this.instrumentation.getFrameworkMetadata(targetEl);
      const pattern = inferInteractionPattern(md.listenersRaw || '', toolName);
      const value = args?.value ?? args?.text ?? null;
      elementData = toWire({ ...md, pattern, value });
    }

    const opcode = ToolNameToOpcode[toolName];
    if (toolName === SystemToolNames.upload_file && !payload) {
      payload = await this.buildUploadPayload(args).catch(() => undefined);
    }

    const request: MainWorldToolRequest = {
      opcode,
      call: { name: toolName, args },
      elementData,
      tabIndex: 0,
      payload,
    };

    return executeMainWorldTool(request);
  }

  private iframeContextUnavailableResponse(
    iframeIdRaw: any,
    ctx: {
      iframePath: number[];
      resolvedPath: number[];
      unresolvedPath: number[];
    },
  ): any {
    const unresolved = ctx.unresolvedPath.join('>');
    const message = `iframe_id unresolved: remaining=${unresolved || '(none)'} (cross-origin, not-ready, or not found)`;

    return {
      success: false,
      error: message,
      allowFallback: false,
      output: {
        success: false,
        error: {
          code: 'IFRAME_CONTEXT_UNAVAILABLE',
          message,
          retryable: false,
        },
        iframe_context: {
          requested_iframe_id: iframeIdRaw,
          requested_path: ctx.iframePath,
          resolved_path: ctx.resolvedPath,
          unresolved_path: ctx.unresolvedPath,
        },
      },
      errorDetails: {
        code: 'IFRAME_CONTEXT_UNAVAILABLE',
        message,
        retryable: false,
        details: {
          requested_iframe_id: iframeIdRaw,
          requested_path: ctx.iframePath,
          resolved_path: ctx.resolvedPath,
          unresolved_path: ctx.unresolvedPath,
        },
      },
    };
  }

  highlight(elementId: number): void {
    const el = resolveInteractiveElementById(document, elementId);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (!this.highlightEl) {
      const box = document.createElement('div');
      box.style.position = 'fixed';
      box.style.pointerEvents = 'none';
      box.style.border = '2px solid #ff7a59';
      box.style.boxShadow = '0 0 0 2px rgba(255, 122, 89, 0.2)';
      box.style.borderRadius = '6px';
      box.style.zIndex = '2147483647';
      this.highlightEl = box;
      document.body.appendChild(box);
    }

    this.highlightEl.style.left = `${rect.left}px`;
    this.highlightEl.style.top = `${rect.top}px`;
    this.highlightEl.style.width = `${Math.max(0, rect.width)}px`;
    this.highlightEl.style.height = `${Math.max(0, rect.height)}px`;
    this.highlightEl.style.display = 'block';
  }

  clearHighlight(): void {
    if (this.highlightEl) this.highlightEl.style.display = 'none';
  }

  setUploadBytesProvider(fn: (args: { token: string; byteLength: number; timeoutMs?: number }) => Promise<ArrayBuffer>): void {
    (window as any).__ROVER_UPLOAD_BYTES__ = fn;
  }

  registerTool(
    nameOrDef: string | { name: string; description?: string; parameters?: Record<string, any>; required?: string[]; schema?: any; llmCallable?: boolean },
    handler?: (args: any) => any | Promise<any>,
  ): void {
    const def = typeof nameOrDef === 'string' ? { name: nameOrDef } : nameOrDef;
    if (!def?.name || typeof handler !== 'function') return;
    this.clientTools.set(def.name, { handler, def });
  }

  async executeClientTool(name: string, args: any): Promise<any> {
    const entry = this.clientTools.get(name);
    if (!entry) throw new Error(`Unknown client tool: ${name}`);
    return entry.handler(args);
  }

  listClientTools(): any[] {
    return Array.from(this.clientTools.values()).map(entry => entry.def);
  }

  private async handleNavigationTools(toolName: SystemToolNames, args: Record<string, any>): Promise<any | null> {
    switch (toolName) {
      case SystemToolNames.goto_url: {
        const rawUrl = String(args.url || '').trim();
        if (!rawUrl) return { success: false, error: 'goto_url: missing url', allowFallback: true };

        const targetUrl = normalizeUrl(rawUrl, window.location.href);
        if (!targetUrl) return { success: false, error: `goto_url: invalid url "${rawUrl}"`, allowFallback: true };

        if (this.shouldPreserveHostRuntime(targetUrl)) {
          const intent = this.buildNavigationIntent(targetUrl);
          const inAllowedDomain = isUrlAllowedByDomains(targetUrl, this.allowedDomains);
          if (!inAllowedDomain && this.externalNavigationPolicy === 'block') {
            return this.domainScopeBlockedResponse(targetUrl, 'Navigation blocked by domain policy.');
          }
          const preflight = await this.resolveAgentNavigationDecision(
            intent,
            this.getNavigationFallbackDecision(targetUrl),
          );
          if (preflight.decision === 'block') {
            return this.domainScopeBlockedResponse(
              targetUrl,
              preflight.reason || 'Navigation blocked by policy.',
              { decisionReason: preflight.decisionReason },
            );
          }
          if (preflight.decision === 'allow_same_tab') {
            return this.scheduleSameTabNavigation(targetUrl, intent, {
              decisionReason: preflight.decisionReason || 'allow_same_tab',
              reason: preflight.reason || 'Navigation allowed.',
            });
          }
          return await this.openUrlInNewTab(targetUrl, {
            policyBlocked: true,
            reason: preflight.reason || 'Opened in a new tab to preserve Rover runtime continuity across hostnames.',
            decisionReason: preflight.decisionReason || 'open_new_tab',
          });
        }

        if (this.shouldGuardExternalNavigation(targetUrl)) {
          const reason = 'Navigation blocked by domain policy.';
          if (this.externalNavigationPolicy === 'open_new_tab_notice') {
            return await this.openUrlInNewTab(targetUrl, {
              policyBlocked: true,
              reason,
            });
          }
          return this.domainScopeBlockedResponse(targetUrl, reason);
        }

        const intent = this.buildNavigationIntent(targetUrl);
        if (intent.isCrossHost) {
          const preflight = await this.resolveAgentNavigationDecision(intent, this.getNavigationFallbackDecision(targetUrl));
          if (preflight.decision === 'block') {
            return this.domainScopeBlockedResponse(
              targetUrl,
              preflight.reason || 'Navigation blocked by policy.',
              { decisionReason: preflight.decisionReason },
            );
          }
          if (preflight.decision === 'open_new_tab') {
            return await this.openUrlInNewTab(targetUrl, {
              policyBlocked: true,
              reason: preflight.reason || 'Navigation policy requires opening a new tab.',
              decisionReason: preflight.decisionReason || 'open_new_tab',
            });
          }
          return this.scheduleSameTabNavigation(targetUrl, intent, {
            decisionReason: preflight.decisionReason || 'allow_same_tab',
            reason: preflight.reason || 'Navigation allowed.',
          });
        }
        this.notifyAgentNavigation(intent);
        return this.scheduleSameTabNavigation(targetUrl, intent, {
          decisionReason: 'allow_same_tab',
          reason: 'Navigation allowed.',
        });
      }
      case SystemToolNames.google_search: {
        const query = String(args.query || '').trim();
        if (!query) return { success: false, error: 'google_search: missing query', allowFallback: true };
        const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

        if (this.shouldPreserveHostRuntime(targetUrl)) {
          const intent = this.buildNavigationIntent(targetUrl);
          const inAllowedDomain = isUrlAllowedByDomains(targetUrl, this.allowedDomains);
          if (!inAllowedDomain && this.externalNavigationPolicy === 'block') {
            return this.domainScopeBlockedResponse(targetUrl, 'Google search blocked by domain policy.');
          }
          const preflight = await this.resolveAgentNavigationDecision(
            intent,
            this.getNavigationFallbackDecision(targetUrl),
          );
          if (preflight.decision === 'block') {
            return this.domainScopeBlockedResponse(
              targetUrl,
              preflight.reason || 'Navigation blocked by policy.',
              { decisionReason: preflight.decisionReason },
            );
          }
          if (preflight.decision === 'allow_same_tab') {
            return this.scheduleSameTabNavigation(targetUrl, intent, {
              decisionReason: preflight.decisionReason || 'allow_same_tab',
              reason: preflight.reason || 'Navigation allowed.',
            });
          }
          return await this.openUrlInNewTab(targetUrl, {
            policyBlocked: true,
            reason: preflight.reason || 'Opened in a new tab to preserve Rover runtime continuity across hostnames.',
            decisionReason: preflight.decisionReason || 'open_new_tab',
          });
        }

        if (this.shouldGuardExternalNavigation(targetUrl)) {
          const reason = 'Google search opens outside the allowed navigation scope.';
          if (this.externalNavigationPolicy === 'open_new_tab_notice') {
            return await this.openUrlInNewTab(targetUrl, {
              policyBlocked: true,
              reason,
            });
          }
          return this.domainScopeBlockedResponse(targetUrl, reason);
        }

        const intent = this.buildNavigationIntent(targetUrl);
        if (intent.isCrossHost) {
          const preflight = await this.resolveAgentNavigationDecision(intent, this.getNavigationFallbackDecision(targetUrl));
          if (preflight.decision === 'block') {
            return this.domainScopeBlockedResponse(
              targetUrl,
              preflight.reason || 'Navigation blocked by policy.',
              { decisionReason: preflight.decisionReason },
            );
          }
          if (preflight.decision === 'open_new_tab') {
            return await this.openUrlInNewTab(targetUrl, {
              policyBlocked: true,
              reason: preflight.reason || 'Navigation policy requires opening a new tab.',
              decisionReason: preflight.decisionReason || 'open_new_tab',
            });
          }
          return this.scheduleSameTabNavigation(targetUrl, intent, {
            decisionReason: preflight.decisionReason || 'allow_same_tab',
            reason: preflight.reason || 'Navigation allowed.',
          });
        }
        this.notifyAgentNavigation(intent);
        return this.scheduleSameTabNavigation(targetUrl, intent, {
          decisionReason: 'allow_same_tab',
          reason: 'Navigation allowed.',
        });
      }
      case SystemToolNames.go_back: {
        const intent = this.buildNavigationIntent(window.location.href, { isCrossHost: false });
        this.notifyAgentNavigation(intent);
        this.scheduleHistoryNavigation('back');
        return {
          success: true,
          output: {
            navigation: 'same_tab',
            navigationOutcome: 'same_tab_scheduled',
            navigationPending: true,
            decisionReason: 'allow_same_tab',
          },
        };
      }
      case SystemToolNames.go_forward: {
        const intent = this.buildNavigationIntent(window.location.href, { isCrossHost: false });
        this.notifyAgentNavigation(intent);
        this.scheduleHistoryNavigation('forward');
        return {
          success: true,
          output: {
            navigation: 'same_tab',
            navigationOutcome: 'same_tab_scheduled',
            navigationPending: true,
            decisionReason: 'allow_same_tab',
          },
        };
      }
      case SystemToolNames.refresh_page: {
        const intent = this.buildNavigationIntent(window.location.href, { isCrossHost: false });
        this.notifyAgentNavigation(intent);
        this.scheduleHistoryNavigation('reload');
        return {
          success: true,
          output: {
            navigation: 'same_tab',
            navigationOutcome: 'same_tab_scheduled',
            navigationPending: true,
            decisionReason: 'allow_same_tab',
          },
        };
      }
      case SystemToolNames.open_new_tab: {
        const rawUrl = String(args.url || '').trim();
        if (!rawUrl) return { success: false, error: 'open_new_tab: missing url', allowFallback: true };
        const targetUrl = normalizeUrl(rawUrl, window.location.href);
        if (!targetUrl) return { success: false, error: `open_new_tab: invalid url "${rawUrl}"`, allowFallback: true };
        const intent = this.buildNavigationIntent(targetUrl);
        const preflight = await this.resolveAgentNavigationDecision(intent, 'open_new_tab');
        if (preflight.decision === 'block') {
          return this.domainScopeBlockedResponse(
            targetUrl,
            preflight.reason || 'Navigation blocked by policy.',
            { decisionReason: preflight.decisionReason },
          );
        }
        return await this.openUrlInNewTab(targetUrl, {
          policyBlocked: false,
          reason: preflight.reason,
          decisionReason: preflight.decisionReason || 'open_new_tab',
        });
      }
      case SystemToolNames.switch_tab: {
        const logicalTabId = Number(args.logical_tab_id ?? args.tab_id);
        if (!Number.isFinite(logicalTabId) || logicalTabId <= 0) {
          const mappingError = typeof args._tab_id_mapping_error === 'string' ? String(args._tab_id_mapping_error).trim() : '';
          return {
            success: false,
            error: mappingError || 'switch_tab: missing/invalid logical_tab_id',
            allowFallback: true,
          };
        }

        if (this.externalNavigationPolicy !== 'allow' && this.listKnownTabs) {
          const tab = this.listKnownTabs().find(entry => Number(entry.logicalTabId) === logicalTabId);
          if (tab?.external) {
            return this.domainScopeBlockedResponse(
              tab.url || `logical_tab_id:${logicalTabId}`,
              `Tab ${logicalTabId} is out of scope. Direct actions are blocked for this tab.`,
            );
          }
        }

        if (!this.switchToLogicalTab) {
          return capabilityUnavailableResponse('switch_tab requires session coordinator support.', 'CAPABILITY_UNAVAILABLE');
        }

        try {
          const result = await this.switchToLogicalTab(logicalTabId);
          if (!result?.ok) {
            return {
              success: false,
              error: result?.reason || `switch_tab failed for logical tab ${logicalTabId}`,
              allowFallback: true,
            };
          }

          return {
            success: true,
            output: {
              logicalTabId,
              delegated: !!result.delegated,
              mode: result.delegated ? 'delegated' : 'local',
            },
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'switch_tab failed', allowFallback: true };
        }
      }
      case SystemToolNames.close_tab: {
        try {
          window.close();
          return { success: true };
        } catch {
          return capabilityUnavailableResponse('close_tab failed in embed mode.', 'CAPABILITY_UNAVAILABLE');
        }
      }
      default:
        return null;
    }
  }

  private shouldGuardExternalNavigation(targetUrl: string): boolean {
    if (this.externalNavigationPolicy === 'allow') return false;
    return !isUrlAllowedByDomains(targetUrl, this.allowedDomains);
  }

  private shouldPreserveHostRuntime(targetUrl: string): boolean {
    if (this.externalNavigationPolicy === 'allow') return false;
    return !isUrlAllowedByDomains(targetUrl, this.allowedDomains);
  }

  private getNavigationFallbackDecision(targetUrl?: string): 'allow_same_tab' | 'open_new_tab' | 'block' {
    if (!targetUrl) return 'allow_same_tab';
    if (isUrlAllowedByDomains(targetUrl, this.allowedDomains)) {
      if (this.crossHostPolicy === 'open_new_tab' && this.isCrossHostNavigation(targetUrl)) {
        return 'open_new_tab';
      }
      return 'allow_same_tab';
    }
    if (this.externalNavigationPolicy === 'block') {
      return 'block';
    }
    if (this.externalNavigationPolicy === 'open_new_tab_notice') {
      return 'open_new_tab';
    }
    return 'allow_same_tab';
  }

  private isCrossHostNavigation(targetUrl: string): boolean {
    const currentHost = extractHostname(window.location.href);
    const targetHost = extractHostname(targetUrl);
    if (!currentHost || !targetHost) return false;
    return currentHost !== targetHost;
  }

  private buildNavigationIntent(targetUrl: string, options?: { isCrossHost?: boolean; runId?: string }): NavigationIntentEvent {
    let handoffId = '';
    try {
      handoffId = crypto.randomUUID();
    } catch {
      handoffId = `handoff_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    }
    return {
      handoffId,
      targetUrl,
      sourceRuntimeId: this.runtimeId,
      sourceLogicalTabId: this.actionGateContext.localLogicalTabId,
      runId: options?.runId,
      isCrossHost: options?.isCrossHost ?? this.isCrossHostNavigation(targetUrl),
      ts: Date.now(),
    };
  }

  private notifyAgentNavigation(event: NavigationIntentEvent): void {
    try {
      const maybePromise = this.onBeforeAgentNavigation?.(event);
      if (maybePromise && typeof (maybePromise as any)?.then === 'function') {
        void (maybePromise as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      // ignore
    }
  }

  private async resolveAgentNavigationDecision(
    event: NavigationIntentEvent,
    fallbackDecision: 'allow_same_tab' | 'open_new_tab' | 'block',
  ): Promise<Required<Pick<NavigationPreflightDecision, 'decision'>> & Omit<NavigationPreflightDecision, 'decision'>> {
    const resolvedFallback: Required<Pick<NavigationPreflightDecision, 'decision'>> & Omit<NavigationPreflightDecision, 'decision'> = {
      decision: fallbackDecision,
      decisionReason:
        fallbackDecision === 'block'
          ? 'policy_blocked'
          : fallbackDecision === 'open_new_tab'
            ? 'open_new_tab'
            : 'allow_same_tab',
    };
    if (!this.onBeforeAgentNavigation) return resolvedFallback;

    try {
      const maybeDecision = this.onBeforeAgentNavigation(event);
      const rawDecision = await this.awaitWithTimeout(
        maybeDecision,
        Bridge.NAV_PREFLIGHT_TIMEOUT_MS,
      );
      if (!rawDecision || typeof rawDecision !== 'object') return resolvedFallback;
      const decisionRaw = String((rawDecision as NavigationPreflightDecision).decision || '').trim();
      const normalizedDecision =
        decisionRaw === 'allow_same_tab'
        || decisionRaw === 'open_new_tab'
        || decisionRaw === 'block'
          ? decisionRaw
          : (decisionRaw === 'stale_run' ? fallbackDecision : resolvedFallback.decision);
      return {
        decision: normalizedDecision,
        reason: String((rawDecision as NavigationPreflightDecision).reason || '').trim() || undefined,
        decisionReason:
          String((rawDecision as NavigationPreflightDecision).decisionReason || '').trim()
          || resolvedFallback.decisionReason,
      };
    } catch {
      return resolvedFallback;
    }
  }

  private async awaitWithTimeout<T>(value: T | Promise<T>, timeoutMs: number): Promise<T | undefined> {
    const maybePromise = value as any;
    if (!maybePromise || typeof maybePromise.then !== 'function') {
      return value as T;
    }
    return await Promise.race([
      maybePromise as Promise<T>,
      new Promise<undefined>(resolve => {
        window.setTimeout(() => resolve(undefined), Math.max(0, timeoutMs));
      }),
    ]);
  }

  private scheduleHistoryNavigation(mode: 'back' | 'forward' | 'reload'): void {
    window.setTimeout(() => {
      if (mode === 'back') {
        window.history.back();
      } else if (mode === 'forward') {
        window.history.forward();
      } else {
        window.location.reload();
      }
    }, this.navigationDelayMs);
  }

  private scheduleSameTabNavigation(
    targetUrl: string,
    intent: NavigationIntentEvent,
    options?: { convertedFrom?: string; decisionReason?: string; reason?: string },
  ): any {
    this.notifyCrossHostNavigation(intent);
    window.setTimeout(() => {
      try {
        window.location.href = targetUrl;
      } catch {
        window.location.assign(targetUrl);
      }
    }, this.navigationDelayMs);
    return {
      success: true,
      output: {
        url: targetUrl,
        navigation: 'same_tab',
        navigationOutcome: 'same_tab_scheduled',
        navigationPending: true,
        decisionReason: options?.decisionReason || 'allow_same_tab',
        reason: options?.reason,
        ...(options?.convertedFrom ? { convertedFrom: options.convertedFrom } : {}),
      },
    };
  }

  private notifyCrossHostNavigation(event: NavigationIntentEvent): void {
    if (event.isCrossHost) {
      try { this.onBeforeCrossHostNavigation?.(event); } catch { /* ignore */ }
    }
  }

  private shouldBlockForOutOfScopeContext(toolName: SystemToolNames): boolean {
    if (this.externalNavigationPolicy === 'allow') return false;
    if (NON_ACTION_TOOLS.has(toolName) || SCOPE_SAFE_TOOLS.has(toolName)) return false;
    return !isUrlAllowedByDomains(window.location.href, this.allowedDomains);
  }

  private getInterceptedClickTarget(args: Record<string, any>): {
    targetUrl: string;
    reason: string;
    forceOpenInNewTab: boolean;
  } | null {
    const targetUrl = this.getClickTargetUrl(args);
    if (!targetUrl) return null;
    if (this.shouldPreserveHostRuntime(targetUrl)) {
      const inAllowedDomain = isUrlAllowedByDomains(targetUrl, this.allowedDomains);
      if (!inAllowedDomain && this.externalNavigationPolicy === 'block') {
        return {
          targetUrl,
          reason: 'Blocked same-tab navigation to an out-of-scope destination.',
          forceOpenInNewTab: false,
        };
      }
      return {
        targetUrl,
        reason: 'Opened in a new tab to preserve Rover runtime continuity outside allowed domains.',
        forceOpenInNewTab: true,
      };
    }
    if (this.externalNavigationPolicy === 'allow') return null;
    if (!isUrlAllowedByDomains(targetUrl, this.allowedDomains)) {
      return {
        targetUrl,
        reason: 'Blocked same-tab navigation to an out-of-scope destination.',
        forceOpenInNewTab: false,
      };
    }
    return null;
  }

  private getClickTargetUrl(args: Record<string, any>): string | null {
    const elementId = getPrimaryElementId(args);
    if (!elementId) return null;
    const { doc } = getDocumentContext(document, args.iframe_id);
    const target = resolveInteractiveElementById(doc, elementId);
    if (!target) return null;
    const anchor = findAnchorWithHref(target);
    const href = anchor?.href || anchor?.getAttribute('href') || '';
    return normalizeUrl(href, window.location.href);
  }

  private domainScopeBlockedResponse(
    targetUrl: string,
    reason: string,
    options?: { fromCurrentContext?: boolean; decisionReason?: string },
  ): any {
    const policyAction = this.externalNavigationPolicy === 'block' ? 'block' : 'open_new_tab_notice';
    this.emitNavigationGuardrail({
      blockedUrl: targetUrl,
      currentUrl: window.location.href,
      policyAction,
      reason,
      allowedDomains: this.allowedDomains,
      openedInNewTab: false,
    });

    return {
      success: false,
      error: reason,
      allowFallback: true,
      output: {
        success: false,
        error: {
          code: 'DOMAIN_SCOPE_BLOCKED',
          message: reason,
          missing: [],
          next_action:
            policyAction === 'block'
              ? 'Stay on the configured domain or update allowedDomains/domainScopeMode.'
              : 'Use open_new_tab to access external pages without losing context.',
          retryable: false,
        },
        blocked_url: targetUrl,
        current_url: window.location.href,
        policy_action: policyAction,
        navigationOutcome: 'blocked',
        decisionReason: options?.decisionReason || 'policy_blocked',
        from_current_context: !!options?.fromCurrentContext,
      },
      errorDetails: {
        code: 'DOMAIN_SCOPE_BLOCKED',
        message: reason,
        retryable: false,
        details: {
          blockedUrl: targetUrl,
          currentUrl: window.location.href,
          policyAction,
        },
      },
    };
  }

  private emitNavigationGuardrail(event: NavigationGuardrailEvent): void {
    try {
      this.onNavigationGuardrail?.(event);
    } catch {
      // no-op
    }
  }

  private async openUrlInNewTab(
    targetUrl: string,
    options?: { policyBlocked?: boolean; reason?: string; decisionReason?: string },
  ): Promise<any> {
    const external = !isUrlAllowedByDomains(targetUrl, this.allowedDomains);
    const knownTabIdsBeforeOpen = this.snapshotKnownTabIds();
    let popupAttempt = this.openVerifiedPopup(targetUrl);

    let logicalTabId: number | undefined;
    if (popupAttempt.opened && this.registerOpenedTab) {
      try {
        const registered = await this.registerOpenedTab({
          url: targetUrl,
          title: undefined,
          external,
          openerRuntimeId: this.runtimeId,
        });
        logicalTabId = registered?.logicalTabId;
      } catch {
        // no-op
      }
    }
    if (popupAttempt.opened && !logicalTabId) {
      logicalTabId = await this.reconcileOpenedTab(targetUrl, knownTabIdsBeforeOpen);
    }
    if (!popupAttempt.opened) {
      const reconciledTabId = await this.reconcileOpenedTab(targetUrl, knownTabIdsBeforeOpen);
      if (reconciledTabId) {
        popupAttempt = { opened: true, verified: false };
        logicalTabId = logicalTabId || reconciledTabId;
      }
    }
    const registrationFailed = popupAttempt.opened && !logicalTabId && !!this.registerOpenedTab;

    if (!popupAttempt.opened) {
      const reason = 'Browser popup settings blocked opening a new tab.';
      if (options?.policyBlocked) {
        this.emitNavigationGuardrail({
          blockedUrl: targetUrl,
          currentUrl: window.location.href,
          policyAction: 'open_new_tab_notice',
          reason: options.reason || reason,
          allowedDomains: this.allowedDomains,
          openedInNewTab: false,
        });
      }
      return {
        success: false,
        error: 'open_new_tab blocked by browser popup settings',
        allowFallback: true,
        output: {
          url: targetUrl,
          external,
          logicalTabId,
          navigationOutcome: 'blocked',
          decisionReason: options?.decisionReason || 'policy_blocked',
        },
        errorDetails: {
          code: 'POPUP_BLOCKED',
          message: reason,
          retryable: true,
          next_action: 'Allow popups for this site and try again.',
        },
      };
    }

    const message = options?.policyBlocked
      ? options.reason || 'Opened in a new tab due to domain policy.'
      : undefined;

    if (options?.policyBlocked) {
      this.emitNavigationGuardrail({
        blockedUrl: targetUrl,
        currentUrl: window.location.href,
        policyAction: 'open_new_tab_notice',
        reason: message || 'Opened in new tab due to domain policy.',
        allowedDomains: this.allowedDomains,
        openedInNewTab: true,
      });
    }

    const warningMessages: string[] = [];
    if (registrationFailed) {
      warningMessages.push('Tab opened but registration failed; tab may not be targetable.');
    }
    if (!popupAttempt.verified) {
      warningMessages.push('Tab open was triggered, but browser did not return a popup handle.');
    }

    return {
      success: true,
      output: {
        url: targetUrl,
        external,
        logicalTabId,
        openedInNewTab: true,
        navigationOutcome: 'new_tab_opened',
        navigationPending: true,
        decisionReason: options?.decisionReason || 'open_new_tab',
        openVerification: popupAttempt.verified ? 'verified' : 'unverified',
        policyBlocked: !!options?.policyBlocked,
        message,
        ...(warningMessages.length ? { warning: warningMessages.join(' ') } : {}),
      },
      allowFallback: true,
    };
  }

  private openVerifiedPopup(targetUrl: string): { opened: boolean; verified: boolean } {
    // Opening about:blank first gives us a reliable handle to detect real popup blocks.
    const popup = window.open('about:blank', '_blank');
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        // noop
      }

      try {
        popup.location.href = targetUrl;
      } catch {
        // keep the opened tab as success even if navigation assignment fails in this step
      }

      return { opened: true, verified: true };
    }

    try {
      const directPopup = window.open(targetUrl, '_blank');
      if (directPopup) {
        try {
          directPopup.opener = null;
        } catch {
          // noop
        }
        return { opened: true, verified: true };
      }
    } catch {
      // noop
    }

    try {
      const noOpenerPopup = window.open(targetUrl, '_blank', 'noopener,noreferrer');
      if (noOpenerPopup) {
        try {
          noOpenerPopup.opener = null;
        } catch {
          // noop
        }
        return { opened: true, verified: true };
      }
      // Some browsers return null when noopener is used even if the tab opens.
      return { opened: true, verified: false };
    } catch {
      // noop
    }

    try {
      const anchor = document.createElement('a');
      anchor.href = targetUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return { opened: true, verified: false };
    } catch {
      return { opened: false, verified: false };
    }
  }

  private snapshotKnownTabIds(): Set<number> {
    const ids = new Set<number>();
    if (!this.listKnownTabs) return ids;
    try {
      const tabs = this.listKnownTabs();
      for (const tab of tabs) {
        const logicalTabId = Number(tab?.logicalTabId);
        if (!Number.isFinite(logicalTabId) || logicalTabId <= 0) continue;
        ids.add(logicalTabId);
      }
    } catch {
      return ids;
    }
    return ids;
  }

  private async reconcileOpenedTab(targetUrl: string, beforeIds: Set<number>): Promise<number | undefined> {
    if (!this.listKnownTabs) return undefined;
    const targetHost = extractHostname(targetUrl);
    const deadline = Date.now() + 2_000;

    while (Date.now() < deadline) {
      try {
        const knownTabs = this.listKnownTabs();
        for (const tab of knownTabs) {
          const logicalTabId = Number(tab?.logicalTabId);
          if (!Number.isFinite(logicalTabId) || logicalTabId <= 0) continue;
          if (beforeIds.has(logicalTabId)) continue;

          const knownUrl = String(tab?.url || '').trim();
          if (!knownUrl) return logicalTabId;

          const knownHost = extractHostname(knownUrl);
          if (!targetHost || !knownHost || knownHost === targetHost) {
            return logicalTabId;
          }
        }
      } catch {
        // no-op
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }

    return undefined;
  }

  private async openElementInNewTab(args: Record<string, any>): Promise<any> {
    const elementId = getPrimaryElementId(args);
    if (!elementId) {
      return {
        success: false,
        error: 'click_element with open_in_new_tab requires element_id.',
        allowFallback: true,
      };
    }

    const { doc } = getDocumentContext(document, args.iframe_id);
    const target = resolveInteractiveElementById(doc, elementId);
    if (!target) {
      return {
        success: false,
        error: `click_element: element_id ${String(elementId)} not found.`,
        allowFallback: true,
      };
    }

    const anchor = findAnchorWithHref(target);
    const href = anchor?.href || anchor?.getAttribute('href') || '';
    const targetUrl = normalizeUrl(href, window.location.href);
    if (!targetUrl) {
      return {
        success: false,
        error: 'click_element open_in_new_tab only works when target resolves to a valid link URL.',
        allowFallback: true,
      };
    }

    return await this.openUrlInNewTab(targetUrl, { policyBlocked: false });
  }

  private async waitForElement(args: Record<string, any>): Promise<any> {
    const selector = String(args.selector || '').trim();
    const timeout = Math.max(0, Math.min(Number(args.timeout ?? 5000), 30_000));
    if (!selector) return { success: false, error: 'wait_for_element: missing selector', allowFallback: true };

    const start = Date.now();
    const doc = document;
    while (Date.now() - start < timeout) {
      let found: Element | null = null;
      try {
        found = doc.querySelector(selector);
      } catch {
        found = null;
      }
      if (!found) found = findByText(doc, selector);
      if (found) return { success: true };
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return { success: false, error: `wait_for_element: not found (${selector})`, allowFallback: true };
  }

  private async describeImages(args: Record<string, any>): Promise<any> {
    const ids = normalizeDescribeImageIds(args as any);
    if (!ids.length) return { success: false, error: 'describe_images: element_ids is empty', allowFallback: false };

    const images: any[] = [];
    const errors: string[] = [];

    for (const id of ids) {
      const el = resolveInteractiveElementById(document, id) as any;
      if (!el) {
        errors.push(`element_id ${id} not found`);
        continue;
      }

      try {
        const candidate = await extractImageCandidate(el);
        if (!candidate?.data || !candidate?.mimeType) {
          errors.push(`element_id ${id}: unsupported image`);
          continue;
        }
        images.push({ element_id: id, ...candidate });
      } catch (err: any) {
        errors.push(`element_id ${id}: ${err?.message || String(err)}`);
      }
    }

    if (!images.length) {
      return { success: false, error: errors[0] || 'describe_images failed', output: { images: [], errors } };
    }

    return { success: true, output: { images, errors: errors.length ? errors : undefined } };
  }

  private ensureUploadProvider(): void {
    if (this.uploadProviderInstalled) return;
    this.uploadProviderInstalled = true;
    this.setUploadBytesProvider(async ({ token, byteLength }) => {
      this.pruneUploadStore();
      const entry = this.uploadStore.get(token);
      if (!entry) throw new Error('upload bytes token not found');
      if (entry.bytes.byteLength !== byteLength) throw new Error('upload bytes size mismatch');
      return entry.bytes;
    });
  }

  private pruneUploadStore(): void {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [token, entry] of this.uploadStore.entries()) {
      if (entry.createdAt < cutoff) this.uploadStore.delete(token);
    }
  }

  private async buildUploadPayload(args: Record<string, any>): Promise<UploadFilePayload | undefined> {
    const fileUrl = String(args.file_url || '').trim();
    if (!fileUrl) return undefined;

    try {
      const download = await fetchFileForUploadSmart(0, fileUrl, document?.referrer || null);
      const bytes = download.bytes;
      const byteLength = bytes.byteLength;
      const mimeType = download.mimeType || args.mime_type || 'application/octet-stream';
      const fileName = args.file_name || download.fileName;

      const INLINE_MAX_BYTES = 1024 * 1024;
      if (byteLength <= INLINE_MAX_BYTES) {
        const inlineB64 = arrayBufferToBase64(bytes);
        return { kind: 'upload_file', inlineB64, byteLength, mimeType, fileName };
      }

      this.ensureUploadProvider();
      const token = crypto.randomUUID();
      this.uploadStore.set(token, { bytes, createdAt: Date.now() });
      return { kind: 'upload_file', token, byteLength, mimeType, fileName, durable: false } as any;
    } catch {
      return undefined;
    }
  }
}

function normalizeToolName(name: string | undefined): string {
  if (name === 'open_url_new_tab') return SystemToolNames.open_new_tab;
  return String(name || '').trim();
}

function normalizeDomainScopeMode(mode?: DomainScopeMode): DomainScopeMode {
  return mode === 'host_only' ? 'host_only' : 'registrable_domain';
}

function normalizeExternalNavigationPolicy(policy?: ExternalNavigationPolicy): ExternalNavigationPolicy {
  if (policy === 'allow' || policy === 'block' || policy === 'open_new_tab_notice') {
    return policy;
  }
  return 'open_new_tab_notice';
}

function normalizeCrossHostPolicy(policy?: CrossHostPolicy): CrossHostPolicy {
  if (policy === 'open_new_tab' || policy === 'same_tab') return policy;
  return 'same_tab';
}

function normalizeDomSettleNumber(input: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeUrl(raw: string, base: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value, base);
    return parsed.toString();
  } catch {
    return null;
  }
}

function findAnchorWithHref(element: Element): HTMLAnchorElement | null {
  if (element instanceof HTMLAnchorElement && element.href) return element;
  const closest = (element as HTMLElement).closest?.('a[href]');
  if (closest instanceof HTMLAnchorElement && closest.href) return closest;
  return null;
}

function capabilityUnavailableResponse(message: string, code = 'CAPABILITY_UNAVAILABLE') {
  return {
    success: false,
    error: message,
    allowFallback: true,
    errorDetails: {
      code,
      message,
      retryable: false,
    },
  };
}

const NON_ACTION_TOOLS = new Set<SystemToolNames>([
  SystemToolNames.describe_images,
  SystemToolNames.wait_action,
  SystemToolNames.wait_for_element,
  SystemToolNames.answer_task,
  SystemToolNames.solve_captcha,
  SystemToolNames.network_run_recipe,
]);

const SCOPE_SAFE_TOOLS = new Set<SystemToolNames>([
  SystemToolNames.goto_url,
  SystemToolNames.google_search,
  SystemToolNames.go_back,
  SystemToolNames.go_forward,
  SystemToolNames.refresh_page,
  SystemToolNames.open_new_tab,
  SystemToolNames.switch_tab,
  SystemToolNames.close_tab,
]);

function toWire(md: FrameworkElementMetadata): FrameworkElementMetadataWire {
  const frameworks = (md.frameworks || [])
    .filter((fw): fw is FrameworkName => fw in FrameworkNameToCode)
    .map(fw => FrameworkNameToCode[fw]);

  return {
    frameworks,
    listenersRaw: md.listenersRaw ?? '',
    role: md.role ?? null,
    pattern: md.pattern,
    value: md.value ?? null,
  };
}

async function ensureListenerScan(root: Element): Promise<void> {
  try {
    const doc = root.ownerDocument || document;
    const win = doc.defaultView || window;
    const internalKey = (win as any).__RTRVR_INTERNAL_KEY__ || '__RTRVR_INTERNAL__';
    const internal = (win as any)[internalKey];
    const flushScan = internal?.flushScan;
    if (typeof flushScan === 'function') {
      await flushScan({ mode: 'priority', includeShadow: true, includeSameOriginIframes: true, budgetMs: 1500 });
      return;
    }
    (win as any).rtrvrAIMarkInteractiveElements?.();
  } catch {
    // ignore
  }
}

function inferInteractionPattern(listenersRaw: string, toolName: SystemToolNames): string {
  if (toolName !== SystemToolNames.click_element) return 'standard';
  const numeric = parseNumericListenerAttribute(listenersRaw || '');
  if (!numeric) return 'standard';

  const types = new Set(
    numeric.entries
      .map(entry => EventHandlerReverseMap[entry.id])
      .filter((t): t is string => typeof t === 'string'),
  );

  const hasClick =
    types.has('click') ||
    types.has('mousedown') ||
    types.has('mouseup') ||
    types.has('pointerdown') ||
    types.has('pointerup') ||
    types.has('touchend');

  const hasHover = types.has('mouseenter') || types.has('mouseover') || types.has('pointerenter');

  if (hasHover && hasClick) return 'hover-activate';

  const hasTouchStart = types.has('touchstart');
  const hasTouchEnd = types.has('touchend');
  if (hasTouchStart && hasTouchEnd) return 'touch-sequence';

  return 'standard';
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) {
    bin += String.fromCharCode(...u8.subarray(i, i + step));
  }
  return btoa(bin);
}

function normalizePositiveElementId(raw: any): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const id = Math.trunc(n);
  return id > 0 ? id : null;
}

function collectElementIdsFromArgs(args: Record<string, any>): number[] {
  const ids: number[] = [];
  for (const key of SYSTEM_TOOLS_ELEMENT_ID_KEYS) {
    const value = (args as any)?.[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const id = normalizePositiveElementId(item);
        if (id != null) ids.push(id);
      }
      continue;
    }

    const id = normalizePositiveElementId(value);
    if (id != null) ids.push(id);
  }

  return Array.from(new Set(ids));
}

function hasAnyElementContext(args: Record<string, any>): boolean {
  return collectElementIdsFromArgs(args).length > 0;
}

function getPrimaryElementId(args: Record<string, any>): number | null {
  const ids = collectElementIdsFromArgs(args);
  return ids.length ? ids[0] : null;
}

function findByText(doc: Document, text: string): Element | null {
  const needle = text.toLowerCase();
  const selectors = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    'label',
    '[role]',
    'div',
    'span',
  ];
  const nodes = doc.querySelectorAll(selectors.join(','));
  for (const node of Array.from(nodes)) {
    const content = (node.textContent || '').trim().toLowerCase();
    if (content.includes(needle)) return node;
    const aria = (node.getAttribute('aria-label') || '').toLowerCase();
    if (aria.includes(needle)) return node;
  }
  return null;
}

async function extractImageCandidate(el: Element): Promise<{ data: string; mimeType: string; displayName?: string }> {
  if (el instanceof HTMLCanvasElement) {
    const dataUrl = el.toDataURL();
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw new Error('canvas toDataURL failed');
    return parsed;
  }

  if (el instanceof SVGElement) {
    const xml = new XMLSerializer().serializeToString(el);
    const data = btoa(unescape(encodeURIComponent(xml)));
    return { data, mimeType: 'image/svg+xml', displayName: 'svg' };
  }

  if (el instanceof HTMLImageElement) {
    const src = el.currentSrc || el.src;
    return await fetchImageToBase64(src, el.alt || el.getAttribute('aria-label') || undefined);
  }

  const style = window.getComputedStyle(el);
  const bg = style.backgroundImage || '';
  const urlMatch = /url\\((['\"]?)(.*?)\\1\\)/.exec(bg);
  if (urlMatch?.[2]) {
    return await fetchImageToBase64(urlMatch[2], el.getAttribute('aria-label') || undefined);
  }

  throw new Error('unsupported element');
}

function parseDataUrl(dataUrl: string): { data: string; mimeType: string; displayName?: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function fetchImageToBase64(src: string, displayName?: string) {
  if (!src) throw new Error('missing src');
  if (src.startsWith('data:')) {
    const parsed = parseDataUrl(src);
    if (!parsed) throw new Error('invalid data url');
    return { ...parsed, displayName };
  }

  const res = await fetch(src, { mode: 'cors' });
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const data = arrayBufferToBase64(buf);
  const mimeType = blob.type || 'image/png';
  return { data, mimeType, displayName };
}
