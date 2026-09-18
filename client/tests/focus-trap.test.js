import test from 'node:test';
import assert from 'node:assert/strict';
import { getFocusableElements, installModalFocusTrap } from '../src/utils/focus-trap.js';

function keyEvent(key, shiftKey = false) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  Object.defineProperty(event, 'shiftKey', { value: shiftKey });
  return event;
}

function element(log, name, props = {}) {
  return {
    name,
    disabled: false,
    tabIndex: 0,
    hidden: false,
    offsetParent: {},
    focus() { log.push(name); },
    ...props,
  };
}

function container(children = []) {
  return {
    querySelectorAll: () => children,
    tabIndex: undefined,
    focus() { containerFocus.push('container'); },
  };
}

function documentLike(activeElement = null) {
  const doc = new EventTarget();
  doc.activeElement = activeElement;
  doc.body = { focus() { restoreLog.push('body'); } };
  doc.contains = (element) => element !== null && element !== undefined;
  return doc;
}

let focusLog;
let containerFocus;
let restoreLog;

test('getFocusableElements keeps only visible, enabled, positive-tabindex elements', () => {
  focusLog = [];
  const visible = element(focusLog, 'visible');
  const panel = container([visible, element(focusLog, 'disabled', { disabled: true }), element(focusLog, 'hidden', { hidden: true }), element(focusLog, 'negative', { tabIndex: -1 }), element(focusLog, 'detached', { offsetParent: null })]);
  assert.deepEqual(getFocusableElements(panel).map((element) => element.name), ['visible']);
});

test('Escape closes through the provided handler and initial focus moves inside', () => {
  focusLog = []; restoreLog = [];
  const first = element(focusLog, 'first');
  const second = element(focusLog, 'second');
  const panel = container([first, second]);
  const doc = documentLike();
  let closed = 0;
  const stop = installModalFocusTrap({ container: panel, onClose: () => { closed += 1; }, doc });
  assert.equal(focusLog.at(-1), 'first');
  doc.dispatchEvent(keyEvent('Escape'));
  assert.equal(closed, 1);
  stop();
});

test('Tab and Shift+Tab cycle inside the modal without entering the background', () => {
  focusLog = []; restoreLog = [];
  const a = element(focusLog, 'a');
  const b = element(focusLog, 'b');
  const c = element(focusLog, 'c');
  const panel = container([a, b, c]);
  const doc = documentLike();
  const stop = installModalFocusTrap({ container: panel, doc });

  doc.activeElement = c;
  doc.dispatchEvent(keyEvent('Tab'));
  assert.equal(focusLog.at(-1), 'a');

  doc.activeElement = a;
  doc.dispatchEvent(keyEvent('Tab', true));
  assert.equal(focusLog.at(-1), 'c');

  // If focus is outside, Tab lands on the first element and never leaves.
  doc.activeElement = { name: 'background' };
  doc.dispatchEvent(keyEvent('Tab'));
  assert.equal(focusLog.at(-1), 'a');
  stop();
});

test('a container with no focusable children focuses itself and does not throw', () => {
  focusLog = []; containerFocus = []; restoreLog = [];
  const panel = container([]);
  const doc = documentLike();
  const stop = installModalFocusTrap({ container: panel, doc });
  assert.deepEqual(containerFocus, ['container']);
  doc.dispatchEvent(keyEvent('Tab'));
  stop();
});

test('closing restores a still-connected opener and skips body or detached openers', () => {
  focusLog = []; restoreLog = [];
  const opener = element(restoreLog, 'opener');
  const first = element(focusLog, 'first');
  const panel = container([first]);

  const doc = documentLike(opener);
  const stop = installModalFocusTrap({ container: panel, doc });
  stop();
  assert.equal(restoreLog.at(-1), 'opener');

  restoreLog = [];
  const bodyDoc = documentLike();
  Object.defineProperty(bodyDoc, 'body', { value: { focus() { restoreLog.push('body'); } } });
  const stopBody = installModalFocusTrap({ container: panel, doc: bodyDoc });
  stopBody();
  assert.deepEqual(restoreLog, []);

  restoreLog = [];
  const detachedDoc = documentLike({ focus() { restoreLog.push('detached'); } });
  detachedDoc.contains = () => false;
  const stopDetached = installModalFocusTrap({ container: panel, doc: detachedDoc });
  stopDetached();
  assert.deepEqual(restoreLog, []);
});

test('removing the trap detaches its keydown listener', () => {
  focusLog = []; restoreLog = [];
  const first = element(focusLog, 'first');
  const panel = container([first]);
  const doc = documentLike();
  let closed = 0;
  const stop = installModalFocusTrap({ container: panel, onClose: () => { closed += 1; }, doc });
  stop();
  doc.dispatchEvent(keyEvent('Escape'));
  doc.dispatchEvent(keyEvent('Tab'));
  assert.equal(closed, 0);
});
