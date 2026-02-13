import { init } from '@rover/sdk';
import './demo.css';

type ShippingMethod = 'standard' | 'express' | 'overnight';

type DemoProduct = {
  sku: string;
  name: string;
  price: number;
  category: 'kitchen' | 'workspace' | 'travel';
  description: string;
  blurb: string;
};

type CartLine = {
  key: string;
  sku: string;
  name: string;
  price: number;
  qty: number;
  variant?: string;
};

type LastOrder = {
  orderNumber: string;
  createdAt: string;
  email: string;
  name: string;
  shippingMethod: ShippingMethod;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  items: CartLine[];
};

type DemoState = {
  cart: Record<string, CartLine>;
  profile: {
    email: string;
    name: string;
  };
  checkout: {
    coupon: string;
    shippingMethod: ShippingMethod;
  };
  lastOrder?: LastOrder;
};

type DemoConfig = {
  apiKey: string;
  apiBase: string;
  visitorId: string;
};

type StatusTone = 'normal' | 'warning' | 'error' | 'success';

const STORAGE_KEY = 'rover_demo_state_v2';
const CONFIG_KEY = 'rover_demo_config_v1';
const WEBSITE_CONFIG_GLOBAL = '__ROVER_WEBSITE_CONFIG__';
const DEFAULT_API_BASE = 'https://us-central1-rtrvr-cloud-backend.cloudfunctions.net';
const VISITOR_ID_KEY = 'rover_demo_visitor_id_v1';

const SHIPPING_COST: Record<ShippingMethod, number> = {
  standard: 6,
  express: 14,
  overnight: 28,
};

const PRODUCTS: Record<string, DemoProduct> = {
  'aurora-mug': {
    sku: 'aurora-mug',
    name: 'Aurora Ember Mug',
    price: 34,
    category: 'kitchen',
    description: 'Heat-retaining ceramic mug with reactive glaze and spill-safe travel lid.',
    blurb: 'Warm drinks for up to 3 hours',
  },
  'atlas-bottle': {
    sku: 'atlas-bottle',
    name: 'Atlas Trail Bottle',
    price: 42,
    category: 'travel',
    description: 'Insulated steel bottle with magnetic sip cap and anti-slip base.',
    blurb: 'Vacuum-sealed 24h cold / 12h hot',
  },
  'pilot-notebook': {
    sku: 'pilot-notebook',
    name: 'Pilot Grid Notebook',
    price: 19,
    category: 'workspace',
    description: 'Soft-touch cover notebook with refillable dotted + graph insert packs.',
    blurb: 'Planner and sketchbook hybrid',
  },
  'lumen-lamp': {
    sku: 'lumen-lamp',
    name: 'Lumen Arc Lamp',
    price: 79,
    category: 'workspace',
    description: 'USB-C rechargeable desk lamp with three warmth profiles and timer mode.',
    blurb: 'Adaptive brightness memory',
  },
  'wander-pack': {
    sku: 'wander-pack',
    name: 'Wander Sling Pack',
    price: 58,
    category: 'travel',
    description: 'Weather-sealed everyday sling with tablet sleeve and hidden passport pocket.',
    blurb: 'Designed for one-bag daily carry',
  },
  'fable-plate': {
    sku: 'fable-plate',
    name: 'Fable Serving Plate',
    price: 27,
    category: 'kitchen',
    description: 'Stoneware serving plate, hand-finished edge, dishwasher-safe.',
    blurb: 'Rustic glaze with matte finish',
  },
};

let roverInstance: ReturnType<typeof init> | null = null;
let state: DemoState = loadState();

declare global {
  interface Window {
    __ROVER_WEBSITE_CONFIG__?: Partial<DemoConfig>;
  }
}

start();

function start(): void {
  applyRevealDelays();
  setActiveNav();
  state = loadState();
  syncCartBadges(state);

  const config = loadConfig();
  roverInstance = initRover(config);
  bindRoverControls(config);
  setInlineNote('rover-config-status', describeConfigSource(), 'success');

  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    state = loadState();
    syncCartBadges(state);
  });

  const page = (document.body.dataset.page || 'catalog').toLowerCase();
  switch (page) {
    case 'product':
      initProductPage();
      break;
    case 'checkout':
      initCheckoutPage();
      break;
    case 'confirmation':
      initConfirmationPage();
      break;
    default:
      initCatalogPage();
      break;
  }
}

function initRover(config: DemoConfig): ReturnType<typeof init> {
  const workerUrl = new URL('./worker.ts', import.meta.url).toString();

  const instance = init({
    siteId: 'rover-demo-store',
    apiBase: config.apiBase || DEFAULT_API_BASE,
    apiKey: config.apiKey || undefined,
    visitorId: config.visitorId,
    workerUrl,
    allowActions: true,
    sessionScope: 'shared_site',
    allowedDomains: [window.location.hostname],
    crossDomainPolicy: 'block_new_tab',
    tabPolicy: { observerByDefault: true, actionLeaseMs: 12000 },
    taskRouting: {
      mode: 'auto',
      actHeuristicThreshold: 5,
      plannerOnActError: true,
    },
    taskContext: {
      inactivityMs: 5 * 60_000,
      suggestReset: true,
      semanticSimilarityThreshold: 0.18,
    },
    checkpointing: {
      enabled: false,
      autoVisitorId: false,
      flushIntervalMs: 7000,
      pullIntervalMs: 8000,
      ttlHours: 1,
    },
    apiMode: true,
    openOnInit: false,
    ui: {
      showTaskControls: true,
    },
  });

  setRoverStatus(config.apiKey ? 'Rover ready to chat' : 'Rover booted. Add API key to run planner.', config.apiKey ? 'success' : 'warning');

  instance.on('ready', () => {
    setRoverStatus('Rover worker ready', 'success');
  });

  instance.on('status', payload => {
    const message = String(payload?.message || 'Rover is working...');
    setRoverStatus(message, 'normal');
  });

  instance.on('auth_required', payload => {
    const message = String(payload?.message || 'API key is required.');
    setRoverStatus(message, 'warning');
  });

  instance.on('error', payload => {
    const message = String(payload?.message || 'Rover error');
    setRoverStatus(message, 'error');
  });

  return instance;
}

function bindRoverControls(config: DemoConfig): void {
  const openBtn = byId<HTMLButtonElement>('open-rover-widget');
  const closeBtn = byId<HTMLButtonElement>('close-rover-widget');
  const newTaskBtn = byId<HTMLButtonElement>('new-rover-task');
  const endTaskBtn = byId<HTMLButtonElement>('end-rover-task');
  const apiKeyInput = byId<HTMLInputElement>('rover-api-key');
  const apiBaseInput = byId<HTMLInputElement>('rover-api-base');
  const saveConfigBtn = byId<HTMLButtonElement>('save-rover-config');

  if (apiKeyInput) apiKeyInput.value = config.apiKey;
  if (apiBaseInput) apiBaseInput.value = config.apiBase;

  openBtn?.addEventListener('click', () => roverInstance?.open());
  closeBtn?.addEventListener('click', () => roverInstance?.close());
  newTaskBtn?.addEventListener('click', () => roverInstance?.newTask({ reason: 'demo_toolbar' }));
  endTaskBtn?.addEventListener('click', () => roverInstance?.endTask({ reason: 'demo_toolbar' }));

  saveConfigBtn?.addEventListener('click', () => {
    const nextConfig: DemoConfig = {
      apiKey: (apiKeyInput?.value || '').trim(),
      apiBase: (apiBaseInput?.value || '').trim() || DEFAULT_API_BASE,
      visitorId: config.visitorId,
    };

    saveConfig(nextConfig);
    roverInstance?.update({
      apiKey: nextConfig.apiKey || undefined,
      apiBase: nextConfig.apiBase,
    });

    setInlineNote('rover-config-status', 'Saved Rover config for this demo browser session.', 'success');
    setRoverStatus(nextConfig.apiKey ? 'Rover config updated' : 'Config updated. API key still missing.', nextConfig.apiKey ? 'success' : 'warning');
    pushToast('Rover config saved. You can now prompt new actions.');
  });
}

function initCatalogPage(): void {
  const searchInput = byId<HTMLInputElement>('catalog-search');
  const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter]'));
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.product-card'));
  const grid = byId<HTMLElement>('catalog-grid');
  const miniCartList = byId<HTMLUListElement>('mini-cart-items');
  const emailForm = byId<HTMLFormElement>('email-capture-form');
  const emailInput = byId<HTMLInputElement>('capture-email');
  const clearBtn = byId<HTMLButtonElement>('clear-cart-btn');

  let activeFilter = 'all';

  const applyFilters = () => {
    const q = (searchInput?.value || '').trim().toLowerCase();
    let visible = 0;

    cards.forEach(card => {
      const category = card.dataset.category || 'all';
      const name = (card.dataset.name || '').toLowerCase();
      const matchesFilter = activeFilter === 'all' || category === activeFilter;
      const matchesText = !q || name.includes(q);
      const show = matchesFilter && matchesText;
      card.hidden = !show;
      if (show) visible += 1;
    });

    setText('catalog-results-count', `${visible} item${visible === 1 ? '' : 's'} visible`);
  };

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter || 'all';
      chips.forEach(c => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      applyFilters();
    });
  });

  searchInput?.addEventListener('input', applyFilters);

  grid?.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const addBtn = target.closest<HTMLButtonElement>('[data-action="add-to-cart"]');
    if (!addBtn) return;

    const sku = addBtn.dataset.sku || '';
    const product = PRODUCTS[sku];
    if (!product) return;

    addCartLine({
      sku,
      name: product.name,
      price: product.price,
      qty: 1,
      variant: 'standard',
    });

    setInlineNote('catalog-message', `${product.name} added to cart.`, 'success');
    pushToast(`${product.name} added to cart`);
    renderMiniCart(miniCartList);
  });

  miniCartList?.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const removeBtn = target.closest<HTMLButtonElement>('[data-remove-line]');
    if (!removeBtn) return;

    const key = removeBtn.dataset.removeLine || '';
    if (!key) return;

    removeCartLine(key);
    renderMiniCart(miniCartList);
    setInlineNote('catalog-message', 'Removed item from cart.', 'warning');
  });

  clearBtn?.addEventListener('click', () => {
    state.cart = {};
    persistState(state);
    syncCartBadges(state);
    renderMiniCart(miniCartList);
    setInlineNote('catalog-message', 'Cart cleared.', 'warning');
  });

  emailForm?.addEventListener('submit', event => {
    event.preventDefault();
    const email = (emailInput?.value || '').trim();
    if (!isValidEmail(email)) {
      setInlineNote('catalog-message', 'Enter a valid email address.', 'error');
      return;
    }

    state.profile.email = email;
    persistState(state);
    setInlineNote('catalog-message', `Saved ${email} for updates.`, 'success');
  });

  document.querySelectorAll<HTMLButtonElement>('.faq-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const contentId = btn.dataset.content;
      if (!contentId) return;
      const content = byId<HTMLElement>(contentId);
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (content) content.hidden = expanded;
    });
  });

  if (emailInput && state.profile.email) {
    emailInput.value = state.profile.email;
  }

  applyFilters();
  renderMiniCart(miniCartList);
}

function initProductPage(): void {
  const sku = getCurrentSku();
  const product = PRODUCTS[sku];

  setText('product-title', product.name);
  setText('product-price', currency(product.price));
  setText('product-description', product.description);
  setText('product-blurb', product.blurb);
  setText('product-sku', product.sku);
  setText('product-category', product.category);

  const qtyInput = byId<HTMLInputElement>('product-qty');
  const sizeSelect = byId<HTMLSelectElement>('variant-size');
  const colorSelect = byId<HTMLSelectElement>('variant-color');
  const engravingInput = byId<HTMLInputElement>('engraving-note');

  byId<HTMLButtonElement>('qty-decrease')?.addEventListener('click', () => {
    if (!qtyInput) return;
    qtyInput.value = String(clampNumber(Number(qtyInput.value) - 1, 1, 99));
  });

  byId<HTMLButtonElement>('qty-increase')?.addEventListener('click', () => {
    if (!qtyInput) return;
    qtyInput.value = String(clampNumber(Number(qtyInput.value) + 1, 1, 99));
  });

  byId<HTMLButtonElement>('favorite-toggle')?.addEventListener('click', event => {
    const btn = event.currentTarget as HTMLButtonElement;
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    setInlineNote('product-message', next ? 'Saved to wishlist.' : 'Removed from wishlist.', next ? 'success' : 'warning');
  });

  byId<HTMLButtonElement>('copy-sku')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(product.sku);
      setInlineNote('product-message', `Copied SKU ${product.sku}`, 'success');
    } catch {
      setInlineNote('product-message', 'Could not copy SKU in this browser.', 'warning');
    }
  });

  byId<HTMLButtonElement>('estimate-shipping')?.addEventListener('click', () => {
    const zip = (byId<HTMLInputElement>('zip-code')?.value || '').trim();
    const speed = (byId<HTMLSelectElement>('shipping-speed')?.value || 'standard') as ShippingMethod;
    if (!/^\d{5}$/.test(zip)) {
      setInlineNote('shipping-result', 'Enter a valid 5-digit ZIP code.', 'error');
      return;
    }
    const eta = speed === 'overnight' ? '1 day' : speed === 'express' ? '2-3 days' : '5-7 days';
    setInlineNote('shipping-result', `${speed} shipping to ${zip}: ${currency(SHIPPING_COST[speed])}, ETA ${eta}.`, 'success');
  });

  const addToCart = () => {
    const qty = clampNumber(Number(qtyInput?.value || 1), 1, 99);
    const size = sizeSelect?.value || 'One size';
    const color = colorSelect?.value || 'Natural';
    const engraving = (engravingInput?.value || '').trim();
    const variantParts = [size, color];
    if (engraving) variantParts.push(`engraving:${engraving}`);

    addCartLine({
      sku,
      name: product.name,
      price: product.price,
      qty,
      variant: variantParts.join(' / '),
    });

    setInlineNote('product-message', `${qty} x ${product.name} added to cart.`, 'success');
    pushToast(`${product.name} added to cart`);
  };

  byId<HTMLButtonElement>('product-add-btn')?.addEventListener('click', addToCart);

  byId<HTMLButtonElement>('buy-now-btn')?.addEventListener('click', () => {
    addToCart();
    window.location.href = './checkout.html?source=buy_now';
  });

  const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-btn'));
  const tabPanels = Array.from(document.querySelectorAll<HTMLElement>('.tab-panel'));

  const activateTab = (tabName: string) => {
    tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tabName}`));
  };

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab || 'specs'));
  });

  activateTab('specs');

  document.querySelectorAll<HTMLButtonElement>('.accordion-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const contentId = btn.dataset.content;
      if (!contentId) return;
      const content = byId<HTMLElement>(contentId);
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (content) content.hidden = expanded;
    });
  });
}

function initCheckoutPage(): void {
  state = loadState();
  syncCartBadges(state);

  const shippingInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="shipping-method"]'));
  const couponInput = byId<HTMLInputElement>('coupon-code');
  const form = byId<HTMLFormElement>('checkout-form');
  const summaryBody = byId<HTMLTableSectionElement>('checkout-items');

  if (couponInput) couponInput.value = state.checkout.coupon;

  if (state.checkout.shippingMethod) {
    shippingInputs.forEach(input => {
      input.checked = input.value === state.checkout.shippingMethod;
    });
  }

  const prefillEmail = byId<HTMLInputElement>('checkout-email');
  const prefillName = byId<HTMLInputElement>('checkout-name');
  if (prefillEmail && state.profile.email) prefillEmail.value = state.profile.email;
  if (prefillName && state.profile.name) prefillName.value = state.profile.name;

  const renderSummary = (): PricingSummary => {
    const lines = getCartLines(state);
    if (summaryBody) {
      summaryBody.innerHTML = '';
      lines.forEach(line => {
        const row = document.createElement('tr');
        row.innerHTML =
          `<td>${escapeHtml(line.name)}<div class="meta">${escapeHtml(line.variant || 'standard')}</div></td>` +
          `<td>${line.qty}</td>` +
          `<td>${currency(line.price * line.qty)}</td>` +
          `<td><button type="button" class="btn-secondary" data-remove-line="${escapeHtml(line.key)}">Remove</button></td>`;
        summaryBody.appendChild(row);
      });
    }

    const shippingMethod = getSelectedShippingMethod() || 'standard';
    const coupon = normalizeCoupon(couponInput?.value || state.checkout.coupon);
    const pricing = computePricing(lines, shippingMethod, coupon);

    setText('summary-subtotal', currency(pricing.subtotal));
    setText('summary-shipping', currency(pricing.shipping));
    setText('summary-discount', `-${currency(pricing.discount)}`);
    setText('summary-total', currency(pricing.total));

    const empty = lines.length === 0;
    setInlineNote('checkout-alert', empty ? 'Cart is empty. Add items before placing an order.' : 'Review your details then place order.', empty ? 'warning' : 'normal');

    const placeOrderBtn = byId<HTMLButtonElement>('place-order-btn');
    if (placeOrderBtn) placeOrderBtn.disabled = empty;

    return pricing;
  };

  summaryBody?.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const removeBtn = target.closest<HTMLButtonElement>('[data-remove-line]');
    if (!removeBtn) return;
    const key = removeBtn.dataset.removeLine || '';
    removeCartLine(key);
    renderSummary();
  });

  shippingInputs.forEach(input => {
    input.addEventListener('change', () => {
      state.checkout.shippingMethod = (input.value as ShippingMethod) || 'standard';
      persistState(state);
      renderSummary();
    });
  });

  byId<HTMLButtonElement>('apply-coupon-btn')?.addEventListener('click', () => {
    state.checkout.coupon = normalizeCoupon(couponInput?.value || '');
    persistState(state);
    const pricing = renderSummary();
    setInlineNote('coupon-message', pricing.couponMessage, pricing.couponValid ? 'success' : 'warning');
  });

  byId<HTMLButtonElement>('autofill-checkout')?.addEventListener('click', () => {
    setInputValue('checkout-email', state.profile.email || 'demo.buyer@example.com');
    setInputValue('checkout-name', state.profile.name || 'Jordan Rivers');
    setInputValue('checkout-phone', '+1 415 555 0134');
    setInputValue('checkout-address1', '145 Market Street');
    setInputValue('checkout-address2', 'Suite 500');
    setInputValue('checkout-city', 'San Francisco');
    setInputValue('checkout-state', 'CA');
    setInputValue('checkout-zip', '94103');
    setInputValue('card-number', '4242 4242 4242 4242');
    setInputValue('card-expiry', '12/29');
    setInputValue('card-cvc', '123');
    pushToast('Checkout form autofilled with test values');
  });

  form?.addEventListener('submit', event => {
    event.preventDefault();

    const required = [
      'checkout-email',
      'checkout-name',
      'checkout-address1',
      'checkout-city',
      'checkout-state',
      'checkout-zip',
      'card-number',
      'card-expiry',
      'card-cvc',
    ];

    clearFieldWarnings(required);

    const missing = required.filter(id => !(byId<HTMLInputElement>(id)?.value || '').trim());
    if (missing.length > 0) {
      missing.forEach(id => markFieldWarning(id));
      setInlineNote('checkout-alert', 'Complete all required fields before placing order.', 'error');
      return;
    }

    const email = (byId<HTMLInputElement>('checkout-email')?.value || '').trim();
    if (!isValidEmail(email)) {
      markFieldWarning('checkout-email');
      setInlineNote('checkout-alert', 'Email address format is invalid.', 'error');
      return;
    }

    if (!byId<HTMLInputElement>('agree-terms')?.checked) {
      setInlineNote('checkout-alert', 'You must agree to the terms before placing order.', 'error');
      return;
    }

    const lines = getCartLines(state);
    if (lines.length === 0) {
      setInlineNote('checkout-alert', 'Cart is empty.', 'error');
      return;
    }

    const pricing = renderSummary();
    const shippingMethod = getSelectedShippingMethod() || 'standard';

    const orderNumber = `RV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const order: LastOrder = {
      orderNumber,
      createdAt: new Date().toISOString(),
      email,
      name: (byId<HTMLInputElement>('checkout-name')?.value || '').trim(),
      shippingMethod,
      subtotal: pricing.subtotal,
      shipping: pricing.shipping,
      discount: pricing.discount,
      total: pricing.total,
      items: lines,
    };

    state.lastOrder = order;
    state.profile.email = email;
    state.profile.name = order.name;
    state.checkout.coupon = normalizeCoupon(couponInput?.value || '');
    state.checkout.shippingMethod = shippingMethod;
    state.cart = {};

    persistState(state);
    syncCartBadges(state);

    pushToast(`Order ${orderNumber} placed`);
    window.location.href = `./confirmation.html?order=${encodeURIComponent(orderNumber)}`;
  });

  renderSummary();
}

function initConfirmationPage(): void {
  state = loadState();
  syncCartBadges(state);

  const order = state.lastOrder;
  const orderParam = new URLSearchParams(window.location.search).get('order') || '';

  if (!order) {
    setInlineNote('confirmation-message', 'No recent order found. Complete checkout first.', 'warning');
    byId<HTMLButtonElement>('track-order-btn')?.setAttribute('disabled', 'true');
    byId<HTMLButtonElement>('receipt-btn')?.setAttribute('disabled', 'true');
    return;
  }

  setText('order-number', order.orderNumber);
  setText('order-date', new Date(order.createdAt).toLocaleString());
  setText('order-email', order.email);
  setText('order-total', currency(order.total));

  if (orderParam && orderParam !== order.orderNumber) {
    setInlineNote('confirmation-message', `Showing latest order ${order.orderNumber}; URL requested ${orderParam}.`, 'warning');
  } else {
    setInlineNote('confirmation-message', 'Order confirmed. You can now test follow-up actions.', 'success');
  }

  const list = byId<HTMLUListElement>('confirmation-items');
  if (list) {
    list.innerHTML = '';
    order.items.forEach(line => {
      const item = document.createElement('li');
      item.innerHTML = `<span>${escapeHtml(line.name)} x${line.qty}</span><strong>${currency(line.price * line.qty)}</strong>`;
      list.appendChild(item);
    });
  }

  const states = [
    'Label created at fulfillment center.',
    'Packed and handed to courier.',
    'Out for delivery in your area.',
    'Delivered to mailbox front desk.',
  ];
  let trackingIndex = 0;

  byId<HTMLButtonElement>('track-order-btn')?.addEventListener('click', () => {
    const message = states[trackingIndex % states.length];
    trackingIndex += 1;
    setInlineNote('tracking-status', message, 'success');
  });

  byId<HTMLButtonElement>('receipt-btn')?.addEventListener('click', () => {
    const receipt = buildReceipt(order);
    const blob = new Blob([receipt], { type: 'text/plain' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${order.orderNumber}-receipt.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  });

  byId<HTMLButtonElement>('shop-again-btn')?.addEventListener('click', () => {
    window.location.href = './index.html';
  });

  const feedbackForm = byId<HTMLFormElement>('feedback-form');
  const feedbackEmail = byId<HTMLInputElement>('feedback-email');
  if (feedbackEmail && !feedbackEmail.value) feedbackEmail.value = order.email;

  feedbackForm?.addEventListener('submit', event => {
    event.preventDefault();
    const rating = Number(byId<HTMLInputElement>('feedback-rating')?.value || 7);
    const notes = (byId<HTMLTextAreaElement>('feedback-notes')?.value || '').trim();
    const email = (feedbackEmail?.value || '').trim();

    if (!isValidEmail(email)) {
      setInlineNote('feedback-result', 'Enter a valid feedback email.', 'error');
      return;
    }

    state.profile.email = email;
    persistState(state);

    setInlineNote('feedback-result', `Feedback submitted (rating ${rating}/10). Thank you!`, 'success');
    pushToast('Feedback submitted');

    if (notes.length > 0) {
      console.info('[demo-feedback]', { rating, notes, email, orderNumber: order.orderNumber });
    }
  });
}

function computePricing(lines: CartLine[], shippingMethod: ShippingMethod, couponRaw: string): PricingSummary {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const shipping = SHIPPING_COST[shippingMethod] ?? SHIPPING_COST.standard;

  const coupon = normalizeCoupon(couponRaw);
  let discount = 0;
  let couponMessage = 'No coupon applied.';
  let couponValid = false;

  if (coupon) {
    switch (coupon) {
      case 'SAVE10':
        discount = subtotal * 0.1;
        couponMessage = 'SAVE10 applied: 10% off.';
        couponValid = true;
        break;
      case 'WELCOME15':
        discount = 15;
        couponMessage = 'WELCOME15 applied: $15 off.';
        couponValid = true;
        break;
      case 'FREESHIP':
        discount = shipping;
        couponMessage = 'FREESHIP applied: shipping waived.';
        couponValid = true;
        break;
      default:
        discount = 0;
        couponMessage = 'Coupon not recognized.';
        couponValid = false;
    }
  }

  const cappedDiscount = Math.min(discount, subtotal + shipping);
  const total = Math.max(0, subtotal + shipping - cappedDiscount);

  return {
    subtotal,
    shipping,
    discount: cappedDiscount,
    total,
    couponMessage,
    couponValid,
  };
}

function getSelectedShippingMethod(): ShippingMethod {
  const checked = document.querySelector<HTMLInputElement>('input[name="shipping-method"]:checked');
  const value = (checked?.value || state.checkout.shippingMethod || 'standard') as ShippingMethod;
  if (value === 'express' || value === 'overnight') return value;
  return 'standard';
}

function getCurrentSku(): string {
  const fallback = 'aurora-mug';
  const sku = new URLSearchParams(window.location.search).get('sku') || fallback;
  return PRODUCTS[sku] ? sku : fallback;
}

function addCartLine(line: Omit<CartLine, 'key'>): void {
  const key = makeCartKey(line.sku, line.variant);
  const existing = state.cart[key];

  if (existing) {
    existing.qty = clampNumber(existing.qty + line.qty, 1, 99);
  } else {
    state.cart[key] = {
      key,
      ...line,
      qty: clampNumber(line.qty, 1, 99),
    };
  }

  persistState(state);
  syncCartBadges(state);
}

function removeCartLine(key: string): void {
  if (!state.cart[key]) return;
  delete state.cart[key];
  persistState(state);
  syncCartBadges(state);
}

function renderMiniCart(container: HTMLUListElement | null): void {
  if (!container) return;

  const lines = getCartLines(state);
  container.innerHTML = '';

  if (lines.length === 0) {
    const empty = document.createElement('li');
    empty.innerHTML = '<span class="meta">Cart is empty</span><span></span>';
    container.appendChild(empty);
  } else {
    lines.slice(0, 6).forEach(line => {
      const item = document.createElement('li');
      item.innerHTML =
        `<div><strong>${escapeHtml(line.name)}</strong><div class="meta">${line.qty} x ${currency(line.price)}</div></div>` +
        `<button type="button" data-remove-line="${escapeHtml(line.key)}">Remove</button>`;
      container.appendChild(item);
    });
  }

  setText('mini-cart-total', currency(getCartSubtotal(state)));
}

function syncCartBadges(nextState: DemoState): void {
  const count = getCartCount(nextState);
  const total = currency(getCartSubtotal(nextState));

  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach(node => {
    node.textContent = String(count);
  });

  document.querySelectorAll<HTMLElement>('[data-cart-total]').forEach(node => {
    node.textContent = total;
  });
}

function getCartCount(nextState: DemoState): number {
  return getCartLines(nextState).reduce((sum, line) => sum + line.qty, 0);
}

function getCartSubtotal(nextState: DemoState): number {
  return getCartLines(nextState).reduce((sum, line) => sum + line.price * line.qty, 0);
}

function getCartLines(nextState: DemoState): CartLine[] {
  return Object.values(nextState.cart || {});
}

function makeCartKey(sku: string, variant?: string): string {
  return `${sku}::${variant || 'standard'}`;
}

function loadState(): DemoState {
  const fallback = defaultState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DemoState>;

    return {
      cart: parsed.cart && typeof parsed.cart === 'object' ? (parsed.cart as Record<string, CartLine>) : {},
      profile: {
        email: parsed.profile?.email || '',
        name: parsed.profile?.name || '',
      },
      checkout: {
        coupon: parsed.checkout?.coupon || '',
        shippingMethod: normalizeShipping(parsed.checkout?.shippingMethod),
      },
      lastOrder: parsed.lastOrder,
    };
  } catch {
    return fallback;
  }
}

function persistState(nextState: DemoState): void {
  state = nextState;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

function defaultState(): DemoState {
  return {
    cart: {},
    profile: {
      email: '',
      name: '',
    },
    checkout: {
      coupon: '',
      shippingMethod: 'standard',
    },
  };
}

function loadConfig(): DemoConfig {
  const visitorId = getOrCreateDemoVisitorId();
  const fallback: DemoConfig = {
    apiKey: '',
    apiBase: DEFAULT_API_BASE,
    visitorId,
  };

  const website = loadWebsiteConfig();

  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) {
      return {
        apiKey: website.apiKey || fallback.apiKey,
        apiBase: website.apiBase || fallback.apiBase,
        visitorId: website.visitorId || fallback.visitorId,
      };
    }
    const parsed = JSON.parse(raw) as Partial<DemoConfig>;

    return {
      apiKey: (parsed.apiKey || '').trim() || website.apiKey || fallback.apiKey,
      apiBase: (parsed.apiBase || '').trim() || website.apiBase || fallback.apiBase,
      visitorId: (parsed.visitorId || '').trim() || website.visitorId || fallback.visitorId,
    };
  } catch {
    return {
      apiKey: website.apiKey || fallback.apiKey,
      apiBase: website.apiBase || fallback.apiBase,
      visitorId: website.visitorId || fallback.visitorId,
    };
  }
}

function loadWebsiteConfig(): DemoConfig {
  const raw = window[WEBSITE_CONFIG_GLOBAL];
  return {
    apiKey: typeof raw?.apiKey === 'string' ? raw.apiKey.trim() : '',
    apiBase: typeof raw?.apiBase === 'string' && raw.apiBase.trim() ? raw.apiBase.trim() : DEFAULT_API_BASE,
    visitorId: typeof raw?.visitorId === 'string' ? raw.visitorId.trim() : '',
  };
}

function getOrCreateDemoVisitorId(): string {
  try {
    const existing = (window.localStorage.getItem(VISITOR_ID_KEY) || '').trim();
    if (existing) return existing;
  } catch {
    // ignore
  }

  let next = '';
  try {
    next = `demo-${crypto.randomUUID()}`;
  } catch {
    next = `demo-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000)}`;
  }

  try {
    window.localStorage.setItem(VISITOR_ID_KEY, next);
  } catch {
    // ignore
  }
  return next;
}

function describeConfigSource(): string {
  const website = loadWebsiteConfig();
  const rawStored = window.localStorage.getItem(CONFIG_KEY);
  if (rawStored) return 'Using browser-saved Rover config (local override).';
  if (website.apiKey) return `Using website config from window.${WEBSITE_CONFIG_GLOBAL}.`;
  return `No API key set yet. Configure window.${WEBSITE_CONFIG_GLOBAL} or use this panel.`;
}

function saveConfig(config: DemoConfig): void {
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function normalizeShipping(value?: string): ShippingMethod {
  if (value === 'express' || value === 'overnight') return value;
  return 'standard';
}

function normalizeCoupon(value: string): string {
  return value.trim().toUpperCase();
}

function pushToast(message: string): void {
  const wrap = byId<HTMLDivElement>('toast-wrap');
  if (!wrap) return;

  const toast = document.createElement('div');
  toast.className = 'toast';

  const text = document.createElement('span');
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';

  const remove = () => {
    if (toast.parentElement) toast.remove();
  };

  close.addEventListener('click', remove);

  toast.append(text, close);
  wrap.appendChild(toast);

  window.setTimeout(remove, 4200);
}

function setRoverStatus(message: string, tone: StatusTone = 'normal'): void {
  const pill = byId<HTMLElement>('rover-status-pill');
  if (!pill) return;
  pill.textContent = message;
  pill.dataset.state = tone;
}

function setInlineNote(id: string, message: string, tone: StatusTone = 'normal'): void {
  const el = byId<HTMLElement>(id);
  if (!el) return;
  el.textContent = message;
  el.className = `inline-note ${tone === 'normal' ? '' : tone}`.trim();
}

function setText(id: string, value: string): void {
  const el = byId<HTMLElement>(id);
  if (el) el.textContent = value;
}

function setInputValue(id: string, value: string): void {
  const input = byId<HTMLInputElement | HTMLSelectElement>(id);
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function applyRevealDelays(): void {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  nodes.forEach((node, idx) => {
    if (!node.style.getPropertyValue('--delay')) {
      node.style.setProperty('--delay', `${Math.min(idx * 0.05, 0.45)}s`);
    }
  });
}

function setActiveNav(): void {
  const current = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  document.querySelectorAll<HTMLAnchorElement>('.nav-link').forEach(link => {
    const href = (link.getAttribute('href') || '').replace('./', '').toLowerCase();
    const isActive = href === current || (href === 'index.html' && (current === '' || current === '/'));
    link.classList.toggle('active', isActive);
  });
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function currency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function markFieldWarning(id: string): void {
  const el = byId<HTMLInputElement>(id);
  if (el) el.style.borderColor = 'var(--danger)';
}

function clearFieldWarnings(ids: string[]): void {
  ids.forEach(id => {
    const el = byId<HTMLInputElement>(id);
    if (el) el.style.borderColor = '#cebda4';
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildReceipt(order: LastOrder): string {
  const lines = order.items
    .map(line => `${line.name} (${line.variant || 'standard'}) x${line.qty} = ${currency(line.price * line.qty)}`)
    .join('\n');

  return [
    'Rover Demo Receipt',
    '===================',
    `Order: ${order.orderNumber}`,
    `Date: ${new Date(order.createdAt).toLocaleString()}`,
    `Email: ${order.email}`,
    '',
    lines,
    '',
    `Subtotal: ${currency(order.subtotal)}`,
    `Shipping: ${currency(order.shipping)}`,
    `Discount: -${currency(order.discount)}`,
    `Total: ${currency(order.total)}`,
  ].join('\n');
}

type PricingSummary = {
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  couponMessage: string;
  couponValid: boolean;
};
