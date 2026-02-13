import type { FrameworkElementMetadataWire, MainWorldToolRequest } from '@rover/shared/lib/system-tools/wire.js';
import type { FrameworkElementMetadata, FrameworkName } from '@rover/shared/lib/utils/main-listener-utils.js';
import type { PageConfig } from '@rover/shared';
import { SystemToolNames, normalizeDescribeImageIds } from '@rover/shared/lib/system-tools/tools.js';
import { FrameworkNameToCode, ToolNameToOpcode } from '@rover/shared/lib/system-tools/wire.js';
import { getDocumentContext, resolveInteractiveElementById } from '@rover/shared/lib/page/index.js';
import { EventHandlerReverseMap, parseNumericListenerAttribute } from '@rover/a11y-tree';
import type { UploadFilePayload } from '@rover/shared/lib/system-tools/wire.js';
import { fetchFileForUploadSmart } from '@rover/shared/lib/page/file-upload-utils.js';
import { buildPageData, buildSnapshot, executeMainWorldTool, ensureMainWorldActions, ensureScrollDetector } from '@rover/dom';
import { installInstrumentation, type InstrumentationController, type InstrumentationOptions } from '@rover/instrumentation';

export type DomainScopeMode = 'host_only' | 'registrable_domain';
export type ExternalNavigationPolicy = 'open_new_tab_notice' | 'block' | 'allow';

export type NavigationGuardrailEvent = {
  blockedUrl: string;
  currentUrl: string;
  policyAction: Exclude<ExternalNavigationPolicy, 'allow'>;
  reason: string;
  allowedDomains: string[];
  openedInNewTab: boolean;
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
  crossDomainPolicy?: 'block_new_tab' | 'allow';
  onNavigationGuardrail?: (event: NavigationGuardrailEvent) => void;
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
  private registerOpenedTab?: BridgeOptions['registerOpenedTab'];
  private listKnownTabs?: BridgeOptions['listKnownTabs'];
  private switchToLogicalTab?: BridgeOptions['switchToLogicalTab'];
  private onNavigationGuardrail?: BridgeOptions['onNavigationGuardrail'];
  private instrumentation: InstrumentationController;
  private highlightEl: HTMLDivElement | null = null;
  private clientTools = new Map<string, { handler: (args: any) => any | Promise<any>; def: any }>();
  private uploadStore = new Map<string, { bytes: ArrayBuffer; createdAt: number }>();
  private uploadProviderInstalled = false;

  constructor(opts: BridgeOptions = {}) {
    this.root = opts.root ?? document.body ?? document.documentElement;
    this.includeFrames = opts.includeFrames ?? true;
    this.disableDomAnnotations = opts.disableDomAnnotations ?? true;
    this.allowActions = opts.allowActions ?? true;
    this.runtimeId = opts.runtimeId;
    this.domainScopeMode = normalizeDomainScopeMode(opts.domainScopeMode);
    this.allowedDomains = normalizeAllowedDomains(opts.allowedDomains, window.location.hostname, this.domainScopeMode);
    this.externalNavigationPolicy = normalizeExternalNavigationPolicy(opts.externalNavigationPolicy, opts.crossDomainPolicy);
    this.registerOpenedTab = opts.registerOpenedTab;
    this.listKnownTabs = opts.listKnownTabs;
    this.switchToLogicalTab = opts.switchToLogicalTab;
    this.onNavigationGuardrail = opts.onNavigationGuardrail;
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

  setNavigationPolicy(options: {
    allowedDomains?: string[];
    domainScopeMode?: DomainScopeMode;
    externalNavigationPolicy?: ExternalNavigationPolicy;
    crossDomainPolicy?: 'block_new_tab' | 'allow';
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
    if (options.externalNavigationPolicy || options.crossDomainPolicy) {
      this.externalNavigationPolicy = normalizeExternalNavigationPolicy(
        options.externalNavigationPolicy,
        options.crossDomainPolicy,
      );
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
    return await buildPageData(this.root, this.instrumentation, {
      includeFrames: this.includeFrames,
      disableDomAnnotations: this.disableDomAnnotations,
      pageConfig: params?.pageConfig,
    });
  }

  async executeTool(call: { name: string; args?: Record<string, any> }, payload?: UploadFilePayload): Promise<any> {
    const toolName = normalizeToolName(call?.name) as SystemToolNames;
    if (!toolName) {
      return { success: false, error: `Unknown tool: ${String(call?.name)}`, allowFallback: false };
    }

    if (this.shouldBlockForOutOfScopeContext(toolName)) {
      const reason = `Current tab is outside the allowed domain scope (${formatAllowedDomainsForMessage(this.allowedDomains)}).`;
      return this.domainScopeBlockedResponse(window.location.href, reason, { fromCurrentContext: true });
    }

    if (!this.allowActions && !NON_ACTION_TOOLS.has(toolName)) {
      return { success: false, error: 'Actions disabled by configuration', allowFallback: false };
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

    if (toolName === SystemToolNames.dispatch_pointer_path) {
      return capabilityUnavailableResponse(
        'dispatch_pointer_path is not yet supported in embed mode.',
        'CAPABILITY_UNAVAILABLE',
      );
    }

    if (toolName === SystemToolNames.click_element && (call?.args as any)?.open_in_new_tab) {
      return this.openElementInNewTab(call?.args || {});
    }

    if (toolName === SystemToolNames.click_element && this.shouldInterceptExternalClick(call?.args || {})) {
      const clickedUrl = this.getExternalClickTargetUrl(call?.args || {});
      if (clickedUrl) {
        const reason = `Blocked same-tab navigation to out-of-scope domain (${new URL(clickedUrl).hostname}).`;
        if (this.externalNavigationPolicy === 'open_new_tab_notice') {
          return this.openUrlInNewTab(clickedUrl, { policyBlocked: true, reason });
        }
        return this.domainScopeBlockedResponse(clickedUrl, reason);
      }
    }

    if (toolName === SystemToolNames.describe_images) {
      return this.describeImages(call?.args || {});
    }

    if (!(toolName in ToolNameToOpcode)) {
      return { success: false, error: `Unknown tool: ${String(call?.name)}`, allowFallback: false };
    }

    const args = call?.args || {};
    const { doc } = getDocumentContext(document, args.iframe_id);

    const elementId =
      args.element_id ?? args.source_element_id ?? args.target_element_id ?? args.center_element_id ?? null;
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

        if (this.shouldGuardExternalNavigation(targetUrl)) {
          const reason = `Navigation blocked by domain policy. Allowed: ${formatAllowedDomainsForMessage(this.allowedDomains)}`;
          if (this.externalNavigationPolicy === 'open_new_tab_notice') {
            return await this.openUrlInNewTab(targetUrl, {
              policyBlocked: true,
              reason,
            });
          }
          return this.domainScopeBlockedResponse(targetUrl, reason);
        }

        window.location.href = targetUrl;
        return { success: true, output: { url: targetUrl, navigation: 'same_tab' } };
      }
      case SystemToolNames.google_search: {
        const query = String(args.query || '').trim();
        if (!query) return { success: false, error: 'google_search: missing query', allowFallback: true };
        const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

        if (this.shouldGuardExternalNavigation(targetUrl)) {
          const reason = `Google search opens outside the allowed domain scope (${formatAllowedDomainsForMessage(this.allowedDomains)}).`;
          if (this.externalNavigationPolicy === 'open_new_tab_notice') {
            return await this.openUrlInNewTab(targetUrl, {
              policyBlocked: true,
              reason,
            });
          }
          return this.domainScopeBlockedResponse(targetUrl, reason);
        }

        window.location.href = targetUrl;
        return { success: true, output: { url: targetUrl, navigation: 'same_tab' } };
      }
      case SystemToolNames.go_back: {
        window.history.back();
        return { success: true };
      }
      case SystemToolNames.go_forward: {
        window.history.forward();
        return { success: true };
      }
      case SystemToolNames.refresh_page: {
        window.location.reload();
        return { success: true };
      }
      case SystemToolNames.open_new_tab: {
        const rawUrl = String(args.url || '').trim();
        if (!rawUrl) return { success: false, error: 'open_new_tab: missing url', allowFallback: true };
        const targetUrl = normalizeUrl(rawUrl, window.location.href);
        if (!targetUrl) return { success: false, error: `open_new_tab: invalid url "${rawUrl}"`, allowFallback: true };
        return await this.openUrlInNewTab(targetUrl, { policyBlocked: false });
      }
      case SystemToolNames.switch_tab: {
        const logicalTabId = Number(args.logical_tab_id ?? args.tab_id);
        if (!Number.isFinite(logicalTabId) || logicalTabId <= 0) {
          return { success: false, error: 'switch_tab: missing/invalid logical_tab_id', allowFallback: true };
        }

        if (this.externalNavigationPolicy !== 'allow' && this.listKnownTabs) {
          const tab = this.listKnownTabs().find(entry => Number(entry.logicalTabId) === logicalTabId);
          if (tab?.external) {
            return this.domainScopeBlockedResponse(
              tab.url || `logical_tab_id:${logicalTabId}`,
              `Tab ${logicalTabId} is out of scope. Direct actions are blocked outside ${formatAllowedDomainsForMessage(this.allowedDomains)}.`,
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

  private shouldBlockForOutOfScopeContext(toolName: SystemToolNames): boolean {
    if (this.externalNavigationPolicy === 'allow') return false;
    if (NON_ACTION_TOOLS.has(toolName) || SCOPE_SAFE_TOOLS.has(toolName)) return false;
    return !isUrlAllowedByDomains(window.location.href, this.allowedDomains);
  }

  private shouldInterceptExternalClick(args: Record<string, any>): boolean {
    if (this.externalNavigationPolicy === 'allow') return false;
    const targetUrl = this.getExternalClickTargetUrl(args);
    if (!targetUrl) return false;
    return !isUrlAllowedByDomains(targetUrl, this.allowedDomains);
  }

  private getExternalClickTargetUrl(args: Record<string, any>): string | null {
    const elementId =
      args.element_id ?? args.source_element_id ?? args.target_element_id ?? args.center_element_id ?? null;
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
    options?: { fromCurrentContext?: boolean },
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
        allowed_domains: this.allowedDomains,
        policy_action: policyAction,
        from_current_context: !!options?.fromCurrentContext,
      },
      errorDetails: {
        code: 'DOMAIN_SCOPE_BLOCKED',
        message: reason,
        retryable: false,
        details: {
          blockedUrl: targetUrl,
          currentUrl: window.location.href,
          allowedDomains: this.allowedDomains,
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
    options?: { policyBlocked?: boolean; reason?: string },
  ): Promise<any> {
    const external = !isUrlAllowedByDomains(targetUrl, this.allowedDomains);
    const popup = window.open(targetUrl, '_blank', 'noopener,noreferrer');

    let logicalTabId: number | undefined;
    if (this.registerOpenedTab) {
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

    if (!popup) {
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
        output: { url: targetUrl, external, logicalTabId },
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

    return {
      success: true,
      output: {
        url: targetUrl,
        external,
        logicalTabId,
        openedInNewTab: true,
        policyBlocked: !!options?.policyBlocked,
        message,
      },
      allowFallback: true,
    };
  }

  private async openElementInNewTab(args: Record<string, any>): Promise<any> {
    const elementId =
      args.element_id ?? args.source_element_id ?? args.target_element_id ?? args.center_element_id ?? null;
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

function mapLegacyCrossDomainPolicy(policy?: 'block_new_tab' | 'allow'): ExternalNavigationPolicy | undefined {
  if (policy === 'allow') return 'allow';
  if (policy === 'block_new_tab') return 'open_new_tab_notice';
  return undefined;
}

function normalizeExternalNavigationPolicy(
  policy?: ExternalNavigationPolicy,
  legacy?: 'block_new_tab' | 'allow',
): ExternalNavigationPolicy {
  if (policy === 'allow' || policy === 'block' || policy === 'open_new_tab_notice') {
    return policy;
  }
  return mapLegacyCrossDomainPolicy(legacy) || 'open_new_tab_notice';
}

function normalizeAllowedDomains(input: string[] | undefined, currentHost: string, scopeMode: DomainScopeMode): string[] {
  const candidates = Array.isArray(input) ? input : [];
  const out = new Set<string>();

  for (const raw of candidates) {
    const cleaned = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/^\./, '');
    if (cleaned) out.add(cleaned);
  }

  if (!out.size) {
    const inferred = inferDefaultAllowedDomain(currentHost, scopeMode);
    if (inferred) out.add(inferred);
  }

  return Array.from(out);
}

function inferDefaultAllowedDomain(host: string, scopeMode: DomainScopeMode): string {
  const clean = String(host || '').trim().toLowerCase();
  if (!clean) return '';
  if (clean === 'localhost' || /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(clean)) return `=${clean}`;
  if (scopeMode === 'host_only') return `=${clean}`;
  const parts = clean.split('.').filter(Boolean);
  if (parts.length < 2) return clean;
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
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

function isUrlAllowedByDomains(url: string, allowedDomains: string[]): boolean {
  const host = extractHostname(url);
  if (!host) return false;
  if (!allowedDomains.length) return true;

  for (const pattern of allowedDomains) {
    if (matchesDomainPattern(host, pattern)) return true;
  }

  return false;
}

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesDomainPattern(host: string, pattern: string): boolean {
  const clean = String(pattern || '').trim().toLowerCase().replace(/^\./, '');
  if (!clean) return false;
  if (clean === '*') return true;
  if (clean.startsWith('=')) {
    const exact = clean.slice(1);
    return !!exact && host === exact;
  }
  if (clean.startsWith('*.')) {
    const base = clean.slice(2);
    if (!base) return false;
    return host === base || host.endsWith(`.${base}`);
  }
  if (host === clean) return true;
  return host.endsWith(`.${clean}`);
}

function formatAllowedDomainsForMessage(domains: string[]): string {
  if (!domains.length) return '*';
  return domains
    .map(domain => {
      const text = String(domain || '');
      return text.startsWith('=') ? text.slice(1) : text;
    })
    .join(', ');
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
