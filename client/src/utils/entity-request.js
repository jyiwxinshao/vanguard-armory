import { createLatestRequest } from './latest-request.js';

// Latest-wins loader for a single entity keyed by id. When a newer id is
// loaded, any response for an older id is dropped, even if the older request
// was not aborted in time.
export function createEntityRequest({ fetchEntity, onStart, onSuccess, onError, onFinish }) {
  const request = createLatestRequest();
  let activeId = null;

  return {
    load(id) {
      activeId = id;
      return request.run(
        (signal) => fetchEntity(id, signal),
        {
          onStart: () => { if (activeId === id) onStart?.(); },
          onSuccess: (result) => { if (activeId === id) onSuccess?.(result); },
          onError: (error) => { if (activeId === id) onError?.(error); },
          onFinish: () => { if (activeId === id) onFinish?.(); },
        },
      );
    },
    cancel() { activeId = null; request.cancel(); },
    dispose() { activeId = null; request.dispose(); },
  };
}
