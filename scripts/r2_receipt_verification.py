"""Authenticated exact-object reads for resumable uploads; no inventory scans."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import tempfile


def remote_receipt(bucket, key, *, backend=None, credentials=None):
    """Return a fresh byte receipt, None only for a definite missing key, else fail."""
    from sidecar_state_db import _default_r2_backend, _first_env
    from sync_r2_media import UploadItem, DEFAULT_THROTTLE_FILE, s3_get, wrangler_get
    if bucket not in {'photosbyelie-public','photosbyelie-private'} or not re.fullmatch(r'[a-zA-Z0-9._/-]+',key) or '..' in key.split('/'):
        raise ValueError('Unsupported exact R2 object.')
    selected = backend or _default_r2_backend()
    creds = credentials or (
        _first_env('R2_ACCOUNT_ID','CLOUDFLARE_ACCOUNT_ID'),
        _first_env('R2_ACCESS_KEY_ID','AWS_ACCESS_KEY_ID'),
        _first_env('R2_SECRET_ACCESS_KEY','AWS_SECRET_ACCESS_KEY'),
        os.environ.get('R2_S3_ENDPOINT',''))
    with tempfile.TemporaryDirectory(prefix='pbe-r2-receipt-') as directory:
        path = Path(directory)/'object'
        item = UploadItem(bucket=bucket,key=key,path=path,content_type='application/octet-stream',cache_control='')
        if selected == 's3':
            if not all(creds[:3]):
                raise ValueError('Existing R2 read credentials are unavailable; no upload was attempted.')
            _, ok, output = s3_get(item,path,0,DEFAULT_THROTTLE_FILE,0.75,30,*creds)
        elif selected == 'wrangler':
            _, ok, output = wrangler_get(item,path,0,DEFAULT_THROTTLE_FILE,0.75,30)
        else:
            raise ValueError('Unsupported R2 verification backend.')
        if not ok:
            if re.search(r'\bHTTP 404\b|\bNoSuchKey\b|The specified key does not exist',output):
                return None
            raise OSError('Exact R2 read failed or was denied; no upload or registration was attempted.')
        digest = hashlib.sha256()
        with path.open('rb') as body:
            for chunk in iter(lambda:body.read(1024*1024),b''):
                digest.update(chunk)
        return {'bytes':path.stat().st_size,'sha256':digest.hexdigest()}


def verify_receipts(receipts, *, fetch=remote_receipt):
    """Keep source-bound receipts only when remote bytes still match exactly."""
    for receipt in receipts:
        remote = fetch(receipt['bucket'],receipt['key'])
        if remote != {'bytes':receipt['bytes'],'sha256':receipt['checksumSha256']}:
            raise ValueError('An existing uploaded object is missing or changed; retain evidence and reconcile, never overwrite.')
    return receipts
