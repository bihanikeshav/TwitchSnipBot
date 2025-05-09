"""Token-bucket rate limiter for API calls."""

import asyncio
import time


class RateLimiter:
    """Async-compatible rate limiter using the token bucket algorithm.

    The bucket starts full and tokens are consumed on each request. Tokens
    are replenished at a steady rate of ``max_requests / per_seconds``.

    Usage::

        limiter = RateLimiter(max_requests=30, per_seconds=60)

        # Blocking (waits until a token is available)
        await limiter.acquire()
        response = await make_api_call()

        # Non-blocking (returns immediately)
        if limiter.try_acquire():
            response = await make_api_call()
        else:
            print("Rate limited, try again later")

    Args:
        max_requests: Maximum number of requests (tokens) allowed in the
            time window.
        per_seconds: Length of the time window in seconds.
    """

    def __init__(self, max_requests: int, per_seconds: float) -> None:
        if max_requests <= 0:
            raise ValueError("max_requests must be positive")
        if per_seconds <= 0:
            raise ValueError("per_seconds must be positive")

        self.max_requests = max_requests
        self.per_seconds = per_seconds

        # Token replenishment rate (tokens per second)
        self._rate = max_requests / per_seconds

        # Current number of available tokens
        self._tokens = float(max_requests)

        # Timestamp of last token replenishment
        self._last_refill = time.monotonic()

        # Lock to prevent race conditions in async context
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        """Replenish tokens based on elapsed time since last refill."""
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(self.max_requests, self._tokens + elapsed * self._rate)
        self._last_refill = now

    async def acquire(self) -> None:
        """Wait until a token is available, then consume it.

        This method will block (asynchronously) if no tokens are available,
        sleeping until enough time has passed for at least one token to be
        replenished.
        """
        while True:
            async with self._lock:
                self._refill()
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return
                # Calculate how long to wait for the next token
                wait_time = (1.0 - self._tokens) / self._rate

            await asyncio.sleep(wait_time)

    def try_acquire(self) -> bool:
        """Try to consume a token without waiting.

        Returns:
            ``True`` if a token was consumed, ``False`` if rate-limited.

        Note:
            This method is synchronous and does *not* require ``await``.
            It is safe to call from both sync and async code, but note that
            without the async lock it may have minor race conditions under
            heavy concurrent use. For strict correctness under concurrency,
            use :meth:`acquire` instead.
        """
        self._refill()
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return True
        return False

    @property
    def available_tokens(self) -> float:
        """Return the approximate number of tokens currently available."""
        self._refill()
        return self._tokens

    @property
    def time_until_available(self) -> float:
        """Return seconds until the next token will be available.

        Returns 0.0 if a token is available right now.
        """
        self._refill()
        if self._tokens >= 1.0:
            return 0.0
        return (1.0 - self._tokens) / self._rate

    def reset(self) -> None:
        """Reset the limiter to a full bucket."""
        self._tokens = float(self.max_requests)
        self._last_refill = time.monotonic()
