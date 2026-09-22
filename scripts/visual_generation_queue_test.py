"""Admission tests use separate processes and never call an image provider."""
from contextlib import ExitStack
import fcntl
import multiprocessing
from pathlib import Path
import tempfile
import unittest

from visual_generation_queue import generation_slot, MAX_PARALLEL_GENERATIONS


def worker(directory, job_id, arrivals, release, active, peak, mutex):
    """Hold a provider slot until the parent releases the synthetic work."""
    with generation_slot(Path(directory), job_id, lambda: True) as admitted:
        if not admitted:
            arrivals.put((job_id, False))
            return
        with mutex:
            active.value += 1
            peak.value = max(peak.value, active.value)
        arrivals.put((job_id, True))
        release.wait(15)
        with mutex:
            active.value -= 1


class VisualGenerationQueueTests(unittest.TestCase):
    def test_parallel_bound_and_crashed_worker_release(self):
        ctx = multiprocessing.get_context('spawn')
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            arrivals = ctx.Queue()
            releases = [ctx.Event() for _ in range(4)]
            active, peak, mutex = ctx.Value('i', 0), ctx.Value('i', 0), ctx.Lock()
            jobs = []
            try:
                for i in range(4):
                    (directory / str(i)).mkdir()
                    job = ctx.Process(target=worker, args=(temporary, str(i), arrivals, releases[i], active, peak, mutex))
                    job.start()
                    jobs.append(job)
                admitted = [arrivals.get(timeout=10) for _ in range(3)]
                self.assertTrue(all(result for _, result in admitted))
                self.assertEqual(active.value, MAX_PARALLEL_GENERATIONS)
                import queue
                with self.assertRaises(queue.Empty):
                    arrivals.get(timeout=0.2)
                # A crashed provider must free its OS slot without file deletion.
                crashed_id = int(admitted[0][0])
                jobs[crashed_id].terminate()
                jobs[crashed_id].join(5)
                with mutex:
                    active.value -= 1
                self.assertTrue(arrivals.get(timeout=5)[1])
                self.assertEqual(peak.value, MAX_PARALLEL_GENERATIONS)
            finally:
                for job, release in zip(jobs, releases):
                    if job.is_alive():
                        release.set()
                    job.join(5)
                    if job.is_alive():
                        job.terminate()
                        job.join(5)

    def test_waiting_has_no_deadline_and_cancels_without_admission(self):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            directory = Path(temporary)
            (directory / 'waiting').mkdir()
            for i in range(MAX_PARALLEL_GENERATIONS):
                lock = stack.enter_context((directory / f'.generation-{i}.lock').open('a'))
                fcntl.flock(lock, fcntl.LOCK_EX)
            waits = []
            # Simulate over twenty minutes of one-second queue ticks instantly.
            with generation_slot(directory, 'waiting', lambda: len(waits) < 1300,
                                 sleep=lambda seconds: waits.append(seconds)) as admitted:
                self.assertFalse(admitted)
            self.assertEqual(len(waits), 1300)

    def test_duplicate_worker_cannot_use_another_slot(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'same').mkdir()
            with generation_slot(directory, 'same', lambda: True) as first:
                self.assertTrue(first)
                with generation_slot(directory, 'same', lambda: True) as duplicate:
                    self.assertFalse(duplicate)

    def test_legacy_worker_is_respected_during_upgrade(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'new').mkdir()
            with (directory / '.generation.lock').open('a') as legacy:
                fcntl.flock(legacy, fcntl.LOCK_EX)
                waits = []
                def release_legacy(seconds):
                    waits.append(seconds)
                    fcntl.flock(legacy, fcntl.LOCK_UN)
                with generation_slot(directory, 'new', lambda: True, sleep=release_legacy) as admitted:
                    self.assertTrue(admitted)
                    self.assertEqual(waits, [1])


if __name__ == '__main__':
    unittest.main()
