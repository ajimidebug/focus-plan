import assert from 'node:assert/strict';
import {checkBundle,treeDigest} from './release-bundle.mjs';
const record=checkBundle('.release/candidate',{sha:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,repo:process.env.GITHUB_REPOSITORY});
assert.equal(treeDigest('dist/spa'),record.treeDigest,'Browser tests changed the tested candidate');
console.log('Browser tests used the unchanged candidate.');
