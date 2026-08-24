import assert from 'node:assert/strict';
import test from 'node:test';
import { toolIconAssetStyle } from '../tool-icon-assets.js';

test('header asset icons preserve quoted SVG data URLs as valid CSS masks', () => {
  const dataUrl = "data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg'%3e%3c/svg%3e";
  const markup = `<span style="${toolIconAssetStyle(dataUrl)}"></span>`;

  assert.match(markup, /style="--tool-icon-asset:url\(&quot;data:image\/svg\+xml,/);
  assert.match(markup, /xmlns=&#39;http:\/\/www\.w3\.org\/2000\/svg&#39;/);
  assert.doesNotMatch(markup, /url\('data:/);
});
