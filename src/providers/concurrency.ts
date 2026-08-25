export interface AsyncSemaphore {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createSemaphore(limit: number): AsyncSemaphore {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Semaphore limit must be a positive integer');
  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = async (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
  };

  const release = (): void => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

export interface KeyedSemaphore {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export function createKeyedSemaphore(limit: number): KeyedSemaphore {
  const semaphores = new Map<string, AsyncSemaphore>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const normalized = key.trim().toLowerCase() || 'unknown';
      let semaphore = semaphores.get(normalized);
      if (!semaphore) {
        semaphore = createSemaphore(limit);
        semaphores.set(normalized, semaphore);
      }
      return semaphore.run(task);
    },
  };
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency limit must be a positive integer');
  const output = new Array<R>(values.length);
  let nextIndex = 0;

  const runner = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      output[index] = await worker(values[index]!, index);
    }
  };

  const runners = Array.from({ length: Math.min(limit, values.length) }, () => runner());
  await Promise.all(runners);
  return output;
}

export type DeadlineRunner = <T>(task: () => Promise<T>, timeoutMs: number) => Promise<T>;

export async function withDeadline<T>(task: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('ETIMEDOUT provider deadline exceeded');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('ETIMEDOUT provider deadline exceeded')), timeoutMs);
  });
  try {
    return await Promise.race([task(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
