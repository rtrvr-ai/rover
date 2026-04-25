import assert from 'node:assert/strict';
import test from 'node:test';

import { mountMascotMedia } from '../dist/mascot-media.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.textContent = '';
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.src = '';
    this.alt = '';
    this.poster = '';
    this.decoding = '';
    this.loading = '';
    this.draggable = false;
    this.autoplay = false;
    this.loop = false;
    this.preload = '';
    this.muted = false;
    this.defaultMuted = false;
    this.playsInline = false;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  addEventListener(type, handler, options = {}) {
    const handlers = this.listeners.get(type) || [];
    handlers.push({ handler, once: options.once === true });
    this.listeners.set(type, handlers);
  }

  dispatch(type) {
    const handlers = this.listeners.get(type) || [];
    const remaining = [];
    for (const item of handlers) {
      item.handler();
      if (!item.once) remaining.push(item);
    }
    this.listeners.set(type, remaining);
  }
}

function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
  try {
    run();
  } finally {
    globalThis.document = previousDocument;
  }
}

test('image-only custom mascot renders a static image and falls back to the token on image failure', () => {
  withFakeDocument(() => {
    const container = new FakeElement('div');
    const result = mountMascotMedia({
      container,
      token: 'RV',
      imageUrl: 'https://cdn.example.com/mascot.png',
      fallbackClassName: 'fallback',
    });

    assert.equal(result.video, null);
    assert.equal(result.image?.tagName, 'IMG');
    assert.equal(container.children.length, 2);
    assert.equal(container.children[0].tagName, 'IMG');
    assert.equal(container.children[1].tagName, 'SPAN');
    assert.equal(container.children[1].style.display, 'none');

    result.image.dispatch('error');
    assert.equal(result.image.style.display, 'none');
    assert.equal(container.children[1].style.display, 'grid');
  });
});

test('video-backed custom mascot prefers video, keeps the image as poster/fallback, and preserves mute control', () => {
  withFakeDocument(() => {
    const container = new FakeElement('div');
    const result = mountMascotMedia({
      container,
      token: 'RV',
      imageUrl: 'https://cdn.example.com/mascot.png',
      mp4Url: 'https://cdn.example.com/mascot.mp4',
      webmUrl: 'https://cdn.example.com/mascot.webm',
      muted: true,
      fallbackClassName: 'fallback',
    });

    assert.equal(result.video?.tagName, 'VIDEO');
    assert.equal(result.video?.poster, 'https://cdn.example.com/mascot.png');
    assert.equal(result.video?.muted, true);
    assert.equal(result.image?.style.display, 'none');
    assert.equal(container.children[2].style.display, 'none');

    result.setMuted(false);
    assert.equal(result.video?.muted, false);
    assert.equal(result.video?.defaultMuted, false);
    assert.equal(result.video?.attributes.has('muted'), false);

    result.video.dispatch('error');
    assert.equal(result.video.style.display, 'none');
    assert.equal(result.image.style.display, '');
    assert.equal(container.children[2].style.display, 'none');
  });
});

test('hidden mascot renders only the fallback token', () => {
  withFakeDocument(() => {
    const container = new FakeElement('div');
    const result = mountMascotMedia({
      container,
      token: 'RV',
      disabled: true,
      imageUrl: 'https://cdn.example.com/mascot.png',
      mp4Url: 'https://cdn.example.com/mascot.mp4',
      fallbackClassName: 'fallback',
    });

    assert.equal(result.video, null);
    assert.equal(result.image, null);
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].tagName, 'SPAN');
    assert.equal(container.children[0].textContent, 'RV');
  });
});
