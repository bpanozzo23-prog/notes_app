// A rejected task must not poison the queue. All store mutations, including recovery, use it.
export function createQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}
