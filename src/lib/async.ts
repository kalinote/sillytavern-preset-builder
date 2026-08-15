export function runSafely(action: () => void | Promise<unknown>) {
  void Promise.resolve()
    .then(action)
    .catch(() => undefined);
}
