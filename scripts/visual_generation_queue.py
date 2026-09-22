"""Cross-process admission for visual jobs; waiting is not provider execution."""
from contextlib import ExitStack, contextmanager
import fcntl
import time


MAX_PARALLEL_GENERATIONS = 3


@contextmanager
def generation_slot(directory, proposal_id, keep_waiting, *, sleep=time.sleep):
    """Hold one of three slots and suppress duplicate workers for the same job.

    Waiting has no deadline. The caller refreshes its queued heartbeat and checks
    cancellation through keep_waiting. OS locks release even if a worker dies.
    A shared legacy lock also respects an older installed worker's exclusive
    lock during an upgrade. Never unlink these lock files while workers exist.
    """
    with ExitStack() as stack:
        job = stack.enter_context((directory / proposal_id / '.worker.lock').open('a'))
        try:
            fcntl.flock(job, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        legacy = stack.enter_context((directory / '.generation.lock').open('a'))
        slots = [stack.enter_context((directory / f'.generation-{i}.lock').open('a'))
                 for i in range(MAX_PARALLEL_GENERATIONS)]
        while keep_waiting():
            try:
                fcntl.flock(legacy, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                sleep(1)
                continue
            for slot in slots:
                try:
                    fcntl.flock(slot, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                yield True
                return
            # Do not hold the compatibility lock while waiting for capacity.
            fcntl.flock(legacy, fcntl.LOCK_UN)
            sleep(1)
        yield False
