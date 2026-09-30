"""A small in-process sliding-window rate limiter.

Good enough for a single API instance. For multiple replicas, replace the storage
with Redis (same interface) - see docs/deployment.md.
"""

from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque

from app.core.errors import RateLimitedError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: float = 60.0) -> None:
        """Record a request for ``key``; raise :class:`RateLimitedError` if over ``limit``."""
        if limit <= 0:
            return
        now = time.monotonic()
        with self._lock:
            bucket = self._hits[key]
            while bucket and now - bucket[0] >= window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = max(1, math.ceil(window_seconds - (now - bucket[0])))
                raise RateLimitedError(headers={"Retry-After": str(retry_after)})
            bucket.append(now)
            if len(self._hits) > 50_000:  # bound memory under key-spraying
                self._evict(now, window_seconds)

    def _evict(self, now: float, window: float) -> None:
        stale = [k for k, b in self._hits.items() if not b or now - b[-1] >= window]
        for key in stale:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
