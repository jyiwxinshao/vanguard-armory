const FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function isFocusable(element) {
  if (!element) return false;
  if (element.disabled === true) return false;
  if (element.tabIndex === -1 || element.getAttribute?.('tabindex') === '-1') return false;
  if (element.hidden === true) return false;
  if (element.offsetParent === null) return false;
  return true;
}

export function getFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isFocusable);
}

// Lightweight dialog focus manager: Escape closes through the provided handler,
// Tab/Shift+Tab cycle within the container, initial focus is moved inside, and
// the previously focused element is restored when the trap is removed.
export function installModalFocusTrap({ container, onClose, doc = globalThis.document }) {
  if (!container) return () => {};
  const previous = doc?.activeElement || null;

  function focusFirst() {
    const elements = getFocusableElements(container);
    if (elements.length) {
      elements[0].focus?.();
      return;
    }
    container.tabIndex = -1;
    container.focus?.();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = getFocusableElements(container);
    if (!elements.length) return;
    const currentIndex = elements.indexOf(doc?.activeElement);
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = currentIndex === -1
      ? (direction === 1 ? 0 : elements.length - 1)
      : (currentIndex + direction + elements.length) % elements.length;
    event.preventDefault?.();
    elements[nextIndex].focus?.();
  }

  doc?.addEventListener?.('keydown', handleKeydown, { capture: true });
  focusFirst();

  return function removeFocusTrap() {
    doc?.removeEventListener?.('keydown', handleKeydown, { capture: true });
    if (previous && previous !== doc?.body && typeof previous.focus === 'function') {
      if (typeof doc?.contains === 'function' && !doc.contains(previous)) return;
      try { previous.focus(); } catch { /* ignore detached opener */ }
    }
  };
}
