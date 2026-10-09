import test from 'node:test';
import assert from 'node:assert/strict';
import { wslStatusReady } from '../../../scripts/wsl-status.mjs';

test('WSL status with zero exit code still rejects virtualization warnings', () => {
  const warning = 'Default Version: 2\r\nWSL2 is unable to start since virtualization is not enabled on this machine.';
  assert.equal(wslStatusReady({status: 0, stdout: Buffer.from(warning, 'utf16le')}), false);
  assert.equal(wslStatusReady({status: 0, stdout: warning, stderr: ''}), false);
  assert.equal(wslStatusReady({status: 0, stdout: 'Please enable the "Virtual Machine Platform" optional component.'}), false);
});

test('WSL failures reject readiness but a WSL1 warning alone does not reject WSL2', () => {
  assert.equal(wslStatusReady({status: 1, stdout: ''}), false);
  assert.equal(wslStatusReady({status: null, error: new Error('timeout')}), false);
  assert.equal(wslStatusReady({status: 0, stdout: Buffer.from('Default Version: 2\nWSL1 is not supported with your current machine configuration.', 'utf16le')}), true);
});
