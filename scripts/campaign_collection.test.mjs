import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import rules from '../campaign-collection.js';
test('directory and detail share complete deduplicated membership', () => {
  const campaign = {primaryPhotoIds:['a','b','a'],heroPhotoId:'h',relatedPhotoIds:['b','c']};
  assert.deepEqual(rules.memberIds(campaign), ['a','b','h','c']);
  const index = new Map(['a','c'].map(id => [id,{photo:{id,media:{publicPreview:{galleryKey:'public.jpg'}}}}]));
  index.set('b',{photo:{id:'b',media:{original:{key:'private.jpg'}}}});
  assert.deepEqual(rules.entries(rules.memberIds(campaign),index).map(x=>x.photo.id), ['a','c']);
});
test('private and draft campaign flags fail closed independently', () => {
  for (const value of ['private','draft','unpublished','archived']) {
    assert.equal(rules.publicCampaign({visibility:'public',status:value}), false);
    assert.equal(rules.publicCampaign({visibility:value,status:'published'}), false);
  }
  assert.equal(rules.publicCampaign({public:false}),false);
  assert.equal(rules.publicCampaign({title:'Historical public campaign'}),true);
});
test('editorial composite samples stay within complete campaign membership', () => {
  const campaign = {
    id: 'instagram-fuengirola-moon-mediterranean-2026-07-14',
    primaryPhotoIds: ['img-2438-769d2c55da', 'img-2448-d30fa46324', 'img-2439-acda9a345e', 'img-2450-18dd778c3d', 'img-2445-86fcda40d1'],
  };
  assert.deepEqual(rules.compositePhotoIds(campaign), [
    'img-2438-769d2c55da',
    'img-2448-d30fa46324',
    'img-2439-acda9a345e',
    'img-2445-86fcda40d1',
  ]);
  assert.deepEqual(rules.compositePhotoIds({ id: 'unlisted', primaryPhotoIds: ['a', 'b', 'a', 'c', 'd'] }), ['a', 'b', 'c', 'd']);
});
test('every indexed campaign carries its complete manifest membership', () => {
  const index = JSON.parse(fs.readFileSync('assets/campaigns/index.json'));
  for (const entry of index.campaigns) {
    const manifest = JSON.parse(fs.readFileSync(`assets/campaigns/${entry.id}.json`));
    assert.deepEqual(entry.photoIds,rules.memberIds(manifest),entry.id);
    assert.deepEqual(entry.compositePhotoIds,rules.compositePhotoIds(manifest),entry.id);
    assert.ok(entry.compositePhotoIds.every((photoId) => entry.photoIds.includes(photoId)), entry.id);
  }
});
