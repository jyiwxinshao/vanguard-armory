import test from 'node:test';
import assert from 'node:assert/strict';
import { isUncertainRequest } from '../src/utils/request-state.js';

test('missing responses and server errors are uncertain; 4xx rejections are definite', () => {
  assert.equal(isUncertainRequest(new Error('network down')), true);
  assert.equal(isUncertainRequest({ code: 'ECONNABORTED', message: 'timeout' }), true);
  assert.equal(isUncertainRequest({ code: 'ERR_NETWORK' }), true);
  assert.equal(isUncertainRequest({ response: { status: 409 } }), false);
  assert.equal(isUncertainRequest({ response: { status: 403 } }), false);
  assert.equal(isUncertainRequest({ response: { status: 404 } }), false);
  assert.equal(isUncertainRequest({ response: { status: 400 } }), false);
  for (const status of [500, 502, 503, 504]) {
    assert.equal(isUncertainRequest({ response: { status } }), true);
  }
});

test('client-side aborts and session changes are never reported as uncertain', () => {
  assert.equal(isUncertainRequest({ code: 'CART_SESSION_CHANGED' }), false);
  assert.equal(isUncertainRequest({ code: 'AUTH_STATE_CHANGED' }), false);
  assert.equal(isUncertainRequest({ code: 'STORAGE_UNAVAILABLE' }), false);
  assert.equal(isUncertainRequest({ code: 'ERR_CANCELED', name: 'CanceledError' }), false);
  assert.equal(isUncertainRequest({ name: 'AbortError' }), false);
  assert.equal(isUncertainRequest(null), false);
  assert.equal(isUncertainRequest('offline'), false);
  assert.equal(isUncertainRequest(undefined), false);
});
