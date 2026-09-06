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
test('every indexed campaign carries its complete manifest membership', () => {
  const index = JSON.parse(fs.readFileSync('assets/campaigns/index.json'));
  for (const entry of index.campaigns) {
    const manifest = JSON.parse(fs.readFileSync(`assets/campaigns/${entry.id}.json`));
    assert.deepEqual(entry.photoIds,rules.memberIds(manifest),entry.id);
  }
});
