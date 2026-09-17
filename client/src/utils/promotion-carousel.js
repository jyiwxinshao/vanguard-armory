export function wrapIndex(index, count) {
  if (!Number.isInteger(count) || count < 1) return 0;
  return ((index % count) + count) % count;
}

export function nextIndex(index, count) {
  return wrapIndex(index + 1, count);
}

export function previousIndex(index, count) {
  return wrapIndex(index - 1, count);
}

export function promotionActionClass(theme) {
  return `promotion-action--${theme === 'abyssal' ? 'abyssal' : 'eclipse'}`;
}

// Autoplay + circular index controller. Timers are injected so the behaviour
// can be tested without waiting on real time.
export function createPromotionCarousel({
  count,
  autoplayMs = 7000,
  interval = setInterval,
  clear = clearInterval,
  onChange,
} = {}) {
  let index = 0;
  let timer = null;
  let hovering = false;

  function stopTimer() {
    if (timer !== null) {
      clear(timer);
      timer = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (count < 2 || hovering) return;
    timer = interval(() => goTo(index + 1), autoplayMs);
  }

  function goTo(value) {
    if (count < 1) {
      index = 0;
      return index;
    }
    index = wrapIndex(value, count);
    onChange?.(index);
    startTimer();
    return index;
  }

  function next() { return goTo(index + 1); }
  function previous() { return goTo(index - 1); }

  function setHover(value) {
    hovering = Boolean(value);
    if (hovering) stopTimer();
    else startTimer();
  }

  function getIndex() { return index; }

  function dispose() { stopTimer(); }

  startTimer();

  return { goTo, next, previous, setHover, getIndex, dispose };
}
