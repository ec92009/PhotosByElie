"""Scoped Review mutations for the Owner API, sharing the native snapshot contract."""
import json
import uuid
import fixture_editions as editions


def snapshot(conn,fixture_id,asset_id):
    return dict(assetId=asset_id,edition=editions.get_edition(conn,fixture_id,asset_id),
        fixtureDecisions=[dict(r) for r in conn.execute('SELECT * FROM fixture_asset_decisions WHERE fixture_id=? AND asset_id=?',(fixture_id,asset_id))],
        proposals=[dict(r) for r in conn.execute('SELECT * FROM asset_ai_proposals WHERE fixture_id=? AND asset_id=? ORDER BY proposal_id',(fixture_id,asset_id))])


def state(conn,fixture_id,asset_id):
    e=editions.get_edition(conn,fixture_id,asset_id)
    return dict(editorialState=e['editorial_state'],title=e['title'],keywords=json.loads(e['keywords_json']),country=e['country'],
        aiReasons=json.loads(e['ai_reasons_json']),aiNote=e['ai_note'])


def apply(conn, fixture_id, asset_ids, action, *, anchor, propagate, title, keywords, country,
          proposal_id, reasons, note, visual_reasons, actor):
    from fixture_pipeline import _set_fixture_review_placement, _recompute_fixture_eligibility
    conn.execute('BEGIN IMMEDIATE')
    if not conn.execute('SELECT 1 FROM fixtures WHERE fixture_id=? AND archived_at IS NULL',(fixture_id,)).fetchone():
        raise ValueError('Fixture does not exist or is archived.')
    editions.seed_memberships(conn,fixture_id)
    targets=list(asset_ids); now=editions.timestamp(); operation_id='reviewop-'+uuid.uuid4().hex[:20]
    if anchor not in targets: raise ValueError('The Review anchor must be selected.')
    source=editions.get_edition(conn,fixture_id,anchor)
    if not source: raise ValueError('Fixture edition is missing.')
    if propagate or action.startswith('propagate-'):
        comparator='>' if action.startswith('propagate-') else '>='
        targets=list(dict.fromkeys(targets+[r[0] for r in conn.execute(f"""SELECT e.asset_id FROM fixture_asset_editions e
            JOIN fixture_asset_decisions p ON p.fixture_id=e.fixture_id AND p.asset_id=e.asset_id
            JOIN sidecar_assets a ON a.asset_id=e.asset_id
            WHERE e.fixture_id=? AND e.editorial_state!='approved' AND p.placement_state='picked' AND p.eligibility_state='active'
            AND datetime(a.captured_at) {comparator} (SELECT datetime(captured_at) FROM sidecar_assets WHERE asset_id=?)
            AND datetime(a.captured_at) <= (SELECT datetime(captured_at,'+2 hours') FROM sidecar_assets WHERE asset_id=?)""",(fixture_id,anchor,anchor))]))
    before=[snapshot(conn,fixture_id,i) for i in targets]; items=[]
    for asset_id in targets:
        e=editions.get_edition(conn,fixture_id,asset_id)
        if not e: raise ValueError('An asset is outside this fixture.')
        if conn.execute("SELECT 1 FROM sidecar_tombstones WHERE asset_id=? AND tombstone_state='active'",(asset_id,)).fetchone(): raise ValueError('The asset is in the Waste Basket.')
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='external_edit_asset_locks'").fetchone() and conn.execute('SELECT 1 FROM external_edit_asset_locks WHERE asset_id=?',(asset_id,)).fetchone(): raise ValueError('Finish the external edit before changing Review.')
        prior=state(conn,fixture_id,asset_id)
        proposal=conn.execute("SELECT * FROM asset_ai_proposals WHERE fixture_id=? AND asset_id=? AND status IN ('ready','loaded') ORDER BY attempt DESC LIMIT 1",(fixture_id,asset_id)).fetchone()
        if action=='approve' and asset_id==anchor and proposal_id and (not proposal or proposal['proposal_id']!=proposal_id): raise ValueError('The AI proposal changed. Refresh Review.')
        changes={}
        if action in ('approve','edit-metadata'):
            for field,value in (('title',title),('keywords',keywords),('country',country)):
                if asset_id==anchor and value is not None: changes[field]=value
                elif action=='approve' and proposal:
                    value=proposal['proposed_keywords_json' if field=='keywords' else 'proposed_'+field]
                    if field=='keywords': value=json.loads(value)
                    if field!='country' or value: changes[field]=value
        elif action.startswith('propagate-'):
            field=action.removeprefix('propagate-')
            changes[field]=json.loads(source['keywords_json']) if field=='keywords' else source[field]
        if changes: e=editions.edit_edition(conn,fixture_id,asset_id,actor=actor,now=now,**changes)
        if action=='approve': editions.approve_edition(conn,fixture_id,asset_id,expected_revision=editions.revision_hash(e),actor=actor,now=now)
        elif action in ('request-ai','return-to-review','hide'):
            request={'reasons':list(visual_reasons),'note':note,'fixtureId':fixture_id,'sourceVersionId':e['source_version_id'],'requestedAt':now} if visual_reasons else {}
            requested=action=='request-ai' and bool(reasons or note)
            conn.execute("""UPDATE fixture_asset_editions SET editorial_state=?,approved_at=NULL,approved_revision_hash='',
                ai_reasons_json=?,ai_note=?,requested_at=?,visual_ai_request_json=?,ai_preview_path='',ai_preview_sha256='',updated_at=?
                WHERE fixture_id=? AND asset_id=?""",('requesting-ai' if requested else 'unreviewed',editions.encoded(reasons if requested else []),note if requested else '',now if requested else None,editions.encoded(request),now,fixture_id,asset_id))
        if action in ('approve','request-ai','hide'):
            conn.execute("UPDATE asset_ai_proposals SET status=?,decided_at=? WHERE fixture_id=? AND asset_id=? AND status IN ('ready','loaded')",('accepted' if action=='approve' else 'superseded',now,fixture_id,asset_id))
        if action in ('hide','request-ai'):
            _set_fixture_review_placement(conn,fixture_id,asset_id,'hidden' if action=='hide' else 'picked',actor=actor,reason=action,timestamp=now)
        items.append(dict(assetId=asset_id,before=prior,after=state(conn,fixture_id,asset_id)))
    _recompute_fixture_eligibility(conn)
    after=[snapshot(conn,fixture_id,i) for i in targets]
    conn.execute("""INSERT INTO fixture_review_operations(operation_id,fixture_id,action,anchor_asset_id,propagated,asset_ids_json,before_json,after_json,state,actor,created_at)
        VALUES (?,?,?,?,?,?,?,?,'applied',?,?)""",(operation_id,fixture_id,action,anchor,int(propagate or action.startswith('propagate-')),editions.encoded(targets),editions.encoded(before),editions.encoded(after),actor,now))
    conn.commit()
    return dict(ok=True,operationId=operation_id,fixtureId=fixture_id,action=action,anchorAssetId=anchor,proposalId=proposal_id or '',propagated=propagate,count=len(items),items=items)


def undo(conn,operation,actor):
    fixture_id=operation['fixture_id'];before=json.loads(operation['before_json']);after=json.loads(operation['after_json'])
    if operation['state']=='undone': return dict(ok=True,operationId=operation['operation_id'],fixtureId=fixture_id,count=0,alreadyUndone=True,items=[])
    if not all(s.get('edition') for s in before): raise ValueError('This operation predates fixture editions and cannot be undone after migration.')
    conn.execute('BEGIN IMMEDIATE')
    if [snapshot(conn,fixture_id,s['assetId']) for s in after]!=after: raise ValueError('Review state changed after this operation. Refresh before Undo.')
    items=[]
    for saved in before:
        asset_id=saved['assetId']
        for table,rows in [('fixture_asset_editions',[saved['edition']]),('fixture_asset_decisions',saved['fixtureDecisions'])]:
            for row in rows:
                if row['fixture_id']!=fixture_id or row['asset_id']!=asset_id: raise ValueError('Invalid fixture snapshot.')
                columns=list(row)
                conn.execute(f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)}) ON CONFLICT(fixture_id,asset_id) DO UPDATE SET "+','.join(f"{k}=excluded.{k}" for k in columns if k not in ('fixture_id','asset_id')),[row[k] for k in columns])
        conn.execute('DELETE FROM asset_ai_proposals WHERE fixture_id=? AND asset_id=?',(fixture_id,asset_id))
        for row in saved['proposals']:
            if row['fixture_id']!=fixture_id or row['asset_id']!=asset_id: raise ValueError('Invalid proposal scope.')
            columns=list(row)
            conn.execute(f"INSERT INTO asset_ai_proposals ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",[row[k] for k in columns])
        e=state(conn,fixture_id,asset_id)
        items.append(dict(assetId=asset_id,**e,reviewItem=dict(assetId=asset_id,**e)))
    from fixture_pipeline import _recompute_fixture_eligibility
    _recompute_fixture_eligibility(conn)
    conn.execute("UPDATE fixture_review_operations SET state='undone',undone_at=? WHERE operation_id=?",(editions.timestamp(),operation['operation_id']))
    conn.commit()
    return dict(ok=True,operationId=operation['operation_id'],fixtureId=fixture_id,action=operation['action'],count=len(items),alreadyUndone=False,items=items)
