import assert from 'node:assert/strict';
import test from 'node:test';
import { readApiBindHost } from '../../apps/api/src/app/config.ts';
test('local API retains loopback bind',()=>assert.equal(readApiBindHost({}),'127.0.0.1'));
test('container API explicitly binds all interfaces',()=>assert.equal(readApiBindHost({API_HOST:'0.0.0.0'}),'0.0.0.0'));
test('invalid bind setting fails configuration',()=>assert.throws(()=>readApiBindHost({API_HOST:'example.com'}),/API_HOST/));
