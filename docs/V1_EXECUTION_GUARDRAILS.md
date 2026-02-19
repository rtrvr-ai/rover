# Rover v1 Execution Guardrails

## Domain Scope
- `domainScopeMode: 'registrable_domain' | 'host_only'`.
- Default is `registrable_domain` (supports `a.com` and subdomains).
- `host_only` uses exact-host matching for stricter isolation.

## External Navigation Policy
- `open_new_tab_notice` (default): out-of-scope same-tab blocked, Rover opens new tab with notice.
- `block`: hard-block out-of-scope navigation/actions.
- `allow`: no domain guardrail blocking.

## Cross-Host In-Scope Policy
- `crossHostPolicy: 'same_tab'` (default): follow target behavior for in-scope host hops.
- `crossHostPolicy: 'open_new_tab'`: open host hops in new tabs for continuity-protection mode.

## Action Safety Rules
- If current tab URL is out-of-scope and policy is not `allow`, direct DOM actions are blocked.
- Navigation tools (`goto_url`, `google_search`) apply policy checks before same-tab navigation.
- Outbound link clicks are intercepted and redirected by policy when possible.
- Popup-blocked new-tab attempts return deterministic structured error (`POPUP_BLOCKED`).

## Tab Guardrails
- Newly opened out-of-scope tabs are registered as `external`.
- `switch_tab` to `external` tabs is blocked unless policy is `allow`.
- SDK emits `navigation_guardrail` events for intercepted traversals.

## Error Contract
All domain/auth guardrail failures should include:
- `success: false`
- `error.code`
- `error.message`
- `missing[]` (if applicable)
- `next_action`
- `retryable`
