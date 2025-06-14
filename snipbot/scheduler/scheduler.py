"""APScheduler-based job runner for TwitchSnipBot."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from apscheduler.triggers.date import DateTrigger

from snipbot.scheduler.jobs import record_job, process_job

logger = logging.getLogger(__name__)


class SnipBotScheduler:
    """Manages scheduled recording and processing jobs.

    Wraps APScheduler's ``AsyncIOScheduler`` and provides convenience methods
    for the most common job types.
    """

    def __init__(self) -> None:
        jobstores = {
            "default": MemoryJobStore(),
        }
        self._scheduler = AsyncIOScheduler(
            jobstores=jobstores,
            job_defaults={
                "coalesce": True,
                "max_instances": 3,
                "misfire_grace_time": 60,
            },
        )
        self._running = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Start the scheduler."""
        if self._running:
            logger.warning("Scheduler is already running.")
            return
        self._scheduler.start()
        self._running = True
        logger.info("SnipBotScheduler started.")

    def stop(self, wait: bool = True) -> None:
        """Stop the scheduler.

        Args:
            wait: If ``True``, wait for currently executing jobs to finish.
        """
        if not self._running:
            return
        self._scheduler.shutdown(wait=wait)
        self._running = False
        logger.info("SnipBotScheduler stopped.")

    @property
    def running(self) -> bool:
        return self._running

    # ------------------------------------------------------------------
    # Job management
    # ------------------------------------------------------------------

    def add_recording_job(
        self,
        channel: str,
        start_time: datetime,
        end_time: Optional[datetime] = None,
        config: Optional[dict[str, Any]] = None,
        job_id: Optional[str] = None,
    ) -> str:
        """Schedule a recording to start at ``start_time``.

        Args:
            channel: Twitch channel name to record.
            start_time: When to begin recording.
            end_time: When to stop recording. If ``None``, recording runs
                until manually stopped or the stream ends.
            config: Optional configuration overrides passed to the job.
            job_id: Optional explicit job ID; auto-generated if omitted.

        Returns:
            The job ID assigned by the scheduler.
        """
        duration: Optional[float] = None
        if end_time is not None:
            duration = (end_time - start_time).total_seconds()
            if duration <= 0:
                raise ValueError("end_time must be after start_time")

        trigger = DateTrigger(run_date=start_time)
        job = self._scheduler.add_job(
            record_job,
            trigger=trigger,
            kwargs={
                "channel": channel,
                "duration": duration,
                "config": config,
            },
            id=job_id,
            replace_existing=True,
            name=f"record:{channel}",
        )
        logger.info(
            "Recording job scheduled: channel=%s start=%s duration=%s job_id=%s",
            channel,
            start_time.isoformat(),
            duration,
            job.id,
        )
        return job.id

    def add_processing_job(
        self,
        recording_id: int,
        delay_seconds: float = 0,
        config: Optional[dict[str, Any]] = None,
        job_id: Optional[str] = None,
    ) -> str:
        """Schedule a post-recording processing job.

        Args:
            recording_id: Database ID of the recording to process.
            delay_seconds: Seconds from now to wait before starting processing
                (e.g., to let the recording finalise on disk).
            config: Optional configuration overrides.
            job_id: Optional explicit job ID.

        Returns:
            The job ID assigned by the scheduler.
        """
        run_date = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
        trigger = DateTrigger(run_date=run_date)
        job = self._scheduler.add_job(
            process_job,
            trigger=trigger,
            kwargs={
                "recording_id": recording_id,
                "config": config,
            },
            id=job_id,
            replace_existing=True,
            name=f"process:{recording_id}",
        )
        logger.info(
            "Processing job scheduled: recording_id=%d run_date=%s job_id=%s",
            recording_id,
            run_date.isoformat(),
            job.id,
        )
        return job.id

    def remove_job(self, job_id: str) -> None:
        """Remove a scheduled job by ID."""
        try:
            self._scheduler.remove_job(job_id)
            logger.info("Job removed: %s", job_id)
        except Exception:
            logger.warning("Could not remove job %s (may have already run).", job_id)

    def get_pending_jobs(self) -> list[dict[str, Any]]:
        """Return a list of all pending jobs with their metadata."""
        jobs = self._scheduler.get_jobs()
        return [
            {
                "id": job.id,
                "name": job.name,
                "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
                "kwargs": dict(job.kwargs) if job.kwargs else {},
            }
            for job in jobs
        ]
